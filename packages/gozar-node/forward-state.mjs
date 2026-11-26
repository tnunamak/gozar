// Durable per-app state for the managed forward contract (docs/library-ux.md): one small private
// store that owns app/service continuity between forward() calls. Internal module: not a package
// export. It reuses the service-state filesystem trust helpers and journal.mjs atomic writes; it
// adds run/stop/debt transition validation, not another persistence framework.
//
// openForwardState({ home, app }) -> { read(), commit(nextRecord, { expectedRevision }) }
//
// read() -> ForwardRecord | null. null means no state exists yet, and the caller must pass
// expectedRevision 0 to create one. A malformed, insecure, oversize or foreign record (wrong kind,
// wrong app, unknown fields) is never null and never overwritten: read throws. Insecure ancestry
// surfaces as the service-state 'unsafe_state_path' error; a record that is a symlink, weakened,
// oversize, unparseable or of the wrong shape fails as internal_error 'not a valid record' with the
// original error kept on `cause`.
//
// commit(nextRecord, { expectedRevision }) -> ForwardRecord. nextRecord carries exactly the five
// content fields { run, approval, origin, downSince, cleanup }; the store owns schemaVersion,
// kind, app and revision, so no caller input can forge them. The next record is validated before
// any filesystem effect, then one exclusive process lock is taken, the current record is re-read
// and compared: a stale expectedRevision rejects (candidate_stale) without writing. The transition
// rules below are enforced under the same lock and the record is written atomically (0600 file,
// fsync, rename, synced directory). The returned record has revision = current + 1, so stale or
// competing commits can never overwrite.
//
// ForwardRecord = {
//   schemaVersion: 1, kind: 'gozar-forward-state', app, revision,
//   run: { id: uuid, generation: positive integer, operationId: uuid|null, handle: Handle|null,
//          provider: provider id|null, phase: 'starting'|'awaiting'|'active'|'stopped',
//          setup?: null | { operationId: uuid, provider } },  // a live SDK setup operation this run owns
//   (operationId with a null handle is an allocation whose result was never recorded: its effects are
//    uncertain and are resolved through the SDK operation journal, never assumed absent.)
//   approval: null | { fingerprint: 'sha256:<64 hex>', provider, disclosureRevision,
//                      factsDigest: 'consent-v1:<64 hex>' }, // saved identities, never authority bearers
//   origin: null | { url: https origin, observedAt: UTC ISO-8601 },  // last verified origin
//   downSince: null | UTC ISO-8601,                                  // retained outage start
//   cleanup: { certainty: 'settled'|'unconfirmed',
//              debt: null | { runId: uuid, generation, since: UTC ISO-8601 } },
// }
//
// Transition invariants, enforced under the lock with existing typed error codes:
//  * a run becomes stopped only in place: an initial or replacement record cannot arrive stopped
//  * a stopped run cannot become active again (stopped_by_user); a later forward() is a NEW run
//  * a fresh run needs a different id and generation exactly current + 1 (invalid_input)
//  * a run still in flight must be stopped first (route_conflict)
//  * unconfirmed owned cleanup (debt) blocks replacement until a retry settles it (cleanup_debt);
//    the stopped run and its debt survive process exit in this record
//  * unconfirmed cleanup requires its debt to name the stopped run it belongs to
// The store never persists candidate tokens, consent bearers, raw credentials, provider output or
// arbitrary request payloads: every field above is explicit and shape-checked, and any unknown
// field is refused. Preserving the last origin, outage and approval across run turnover is the
// engine's restatement of those fields; stopping a run does not itself revoke a saved approval,
// and explicitly revoking one stays allowed.
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { atomicWrite } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, readRecord, uuid, withExclusiveLock } from './service-state.mjs';
import { gozarError } from './error-normalizer.mjs';

const KIND = 'gozar-forward-state';
const RECORD_FIELDS = ['schemaVersion', 'kind', 'app', 'revision', 'run', 'approval', 'origin', 'downSince', 'cleanup'];
const CONTENT_FIELDS = ['run', 'approval', 'origin', 'downSince', 'cleanup'];
const RUN_FIELDS = ['id', 'generation', 'operationId', 'handle', 'provider', 'phase'];
const SETUP_FIELDS = ['operationId', 'provider'];
const APPROVAL_FIELDS = ['fingerprint', 'provider', 'disclosureRevision', 'factsDigest'];
const ORIGIN_FIELDS = ['url', 'observedAt'];
const CLEANUP_FIELDS = ['certainty', 'debt'];
const DEBT_FIELDS = ['runId', 'generation', 'since'];
const PHASES = new Set(['starting', 'awaiting', 'active', 'stopped']);
const APP = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CONSENT_DIGEST = /^consent-v1:[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OPAQUE = /^[\x21-\x7e]{1,256}$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

// The forward scope's directory: canonical home + a private `forward` directory. Shared by the state
// store and the live-manager ownership lease so one app identity maps to exactly one scope.
async function forwardDirectory(home, create) {
  const path = join(await canonicalHome(home, create), 'forward');
  await trustedDirectory(path, create);
  await privateDirectory(path);
  return path;
}

const scopeKeyOf = app => createHash('sha256').update(`${KIND}\0${app}`).digest('hex');

function validateScope({ home, app } = {}) {
  if (typeof home !== 'string' || !isAbsolute(home))
    throw gozarError('invalid_input', 'a forward scope needs an absolute home directory');
  if (typeof app !== 'string' || !APP.test(app))
    throw gozarError('invalid_input', 'app must be 1..64 lowercase letters, digits or hyphens');
}

/**
 * The live-manager ownership lease path: `<home>/forward/<scope>.manager`, one dedicated process lock
 * per app scope. It is a DIFFERENT lock from the per-commit record lock above: holding it means "this
 * process is the live manager for this app", proven by process identity (process-lock.mjs), never by a
 * state revision. A short CAS commit is not a lifetime claim, and a dead holder's lease is take-over-able.
 */
export async function forwardManagerLock({ home, app } = {}) {
  validateScope({ home, app });
  return join(await forwardDirectory(home, true), `${scopeKeyOf(app)}.manager`);
}

function validateHandle(handle) {
  if (handle === null) return null;
  requireFields(handle, ['kind', 'id', 'generation'], 'run.handle');
  if (!['session', 'attached', 'durable', 'external'].includes(handle.kind) ||
      typeof handle.id !== 'string' || !OPAQUE.test(handle.id) ||
      !Number.isSafeInteger(handle.generation) || handle.generation < 1)
    throw gozarError('invalid_input', 'run.handle must be a structured SDK handle or null');
  return {kind: handle.kind, id: handle.id, generation: handle.generation};
}

function requireFields(value, fields, where) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw gozarError('invalid_input', `${where} must be an object`);
  for (const name of Object.keys(value))
    if (!fields.includes(name)) throw gozarError('invalid_input', `${where} has an unknown field ${name}`);
  for (const name of fields)
    if (!Object.hasOwn(value, name)) throw gozarError('invalid_input', `${where} is missing the field ${name}`);
}

const isoString = (value, where) => {
  if (typeof value !== 'string' || !ISO.test(value) || Number.isNaN(Date.parse(value)))
    throw gozarError('invalid_input', `${where} must be a UTC ISO-8601 timestamp`);
  return value;
};

// A public HTTPS origin, the same shape the service route records accept.
function originValue(value) {
  if (typeof value !== 'string' || value.length > 2048) throw gozarError('invalid_input', 'origin.url must be an HTTPS origin');
  let url;
  try { url = new URL(value); } catch { throw gozarError('invalid_input', 'origin.url must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname || (value !== url.origin && value !== url.origin + '/'))
    throw gozarError('invalid_input', 'origin.url must be an HTTPS origin');
  return url.origin;
}

// The private setup-operation reference: an SDK setup operation this run reserved and must settle.
function validateSetup(setup) {
  if (setup === undefined || setup === null) return null;
  requireFields(setup, SETUP_FIELDS, 'run.setup');
  if (typeof setup.operationId !== 'string' || !uuid.test(setup.operationId))
    throw gozarError('invalid_input', 'run.setup.operationId must be a UUID');
  if (typeof setup.provider !== 'string' || !PROVIDER.test(setup.provider))
    throw gozarError('invalid_input', 'run.setup.provider must be a provider id');
  return { operationId: setup.operationId, provider: setup.provider };
}

function validateRun(run) {
  if (typeof run !== 'object' || run === null || Array.isArray(run)) throw gozarError('invalid_input', 'run must be an object');
  const { setup, ...rest } = run;
  requireFields(rest, RUN_FIELDS, 'run');
  const setupRef = validateSetup(setup);
  if (typeof run.id !== 'string' || !uuid.test(run.id))
    throw gozarError('invalid_input', 'run.id must be a UUID run identity');
  if (!Number.isSafeInteger(run.generation) || run.generation < 1)
    throw gozarError('invalid_input', 'run.generation must be a positive integer');
  if (run.operationId !== null && (typeof run.operationId !== 'string' || !uuid.test(run.operationId)))
    throw gozarError('invalid_input', 'run.operationId must be a UUID or null');
  const handle = validateHandle(run.handle);
  if (run.provider !== null && (typeof run.provider !== 'string' || !PROVIDER.test(run.provider)))
    throw gozarError('invalid_input', 'run.provider must be a provider id or null');
  if (typeof run.phase !== 'string' || !PHASES.has(run.phase))
    throw gozarError('invalid_input', 'run.phase must be starting, awaiting, active or stopped');
  return { id: run.id, generation: run.generation, operationId: run.operationId,
    handle, provider: run.provider, phase: run.phase, setup: setupRef };
}

function validateApproval(approval) {
  if (approval === null) return null;
  requireFields(approval, APPROVAL_FIELDS, 'approval');
  if (typeof approval.fingerprint !== 'string' || !DIGEST.test(approval.fingerprint))
    throw gozarError('invalid_input', 'approval.fingerprint must be a sha256 digest of the bound scope, provider, disclosure and facts');
  if (typeof approval.provider !== 'string' || !PROVIDER.test(approval.provider))
    throw gozarError('invalid_input', 'approval.provider must be a provider id');
  if (typeof approval.disclosureRevision !== 'string' || !REVISION.test(approval.disclosureRevision))
    throw gozarError('invalid_input', 'approval.disclosureRevision must be a disclosure revision');
  if (typeof approval.factsDigest !== 'string' || !CONSENT_DIGEST.test(approval.factsDigest))
    throw gozarError('invalid_input', 'approval.factsDigest must be an SDK consent-v1 digest');
  return { fingerprint: approval.fingerprint, provider: approval.provider,
    disclosureRevision: approval.disclosureRevision, factsDigest: approval.factsDigest };
}

function validateContent(value) {
  requireFields(value, CONTENT_FIELDS, 'the next forward record');
  const origin = value.origin === null ? null : (requireFields(value.origin, ORIGIN_FIELDS, 'origin'),
    { url: originValue(value.origin.url), observedAt: isoString(value.origin.observedAt, 'origin.observedAt') });
  const cleanup = (() => {
    requireFields(value.cleanup, CLEANUP_FIELDS, 'cleanup');
    if (value.cleanup.certainty === 'settled') {
      if (value.cleanup.debt !== null) throw gozarError('invalid_input', 'settled cleanup carries no debt');
      return { certainty: 'settled', debt: null };
    }
    if (value.cleanup.certainty !== 'unconfirmed') throw gozarError('invalid_input', 'cleanup.certainty must be settled or unconfirmed');
    requireFields(value.cleanup.debt, DEBT_FIELDS, 'cleanup.debt');
    if (typeof value.cleanup.debt.runId !== 'string' || !uuid.test(value.cleanup.debt.runId))
      throw gozarError('invalid_input', 'cleanup.debt.runId must be a UUID');
    if (!Number.isSafeInteger(value.cleanup.debt.generation) || value.cleanup.debt.generation < 1)
      throw gozarError('invalid_input', 'cleanup.debt.generation must be a positive integer');
    return { certainty: 'unconfirmed', debt: { runId: value.cleanup.debt.runId,
      generation: value.cleanup.debt.generation, since: isoString(value.cleanup.debt.since, 'cleanup.debt.since') } };
  })();
  const content = { run: validateRun(value.run), approval: validateApproval(value.approval),
    origin, downSince: value.downSince === null ? null : isoString(value.downSince, 'downSince'), cleanup };
  // Unconfirmed cleanup is owned by the stopped run it names; the debt cannot describe another run.
  if (content.cleanup.certainty === 'unconfirmed' &&
      (content.run.phase !== 'stopped' || content.cleanup.debt.runId !== content.run.id ||
       content.cleanup.debt.generation !== content.run.generation))
    throw gozarError('invalid_input', 'Unconfirmed cleanup requires the debt to name the stopped run it belongs to');
  return content;
}

function checkTransition(current, content) {
  if (!current) {
    // A first record starts a run; it cannot arrive stopped or already owing cleanup.
    if (content.run.phase === 'stopped')
      throw gozarError('invalid_input', 'An initial forward record cannot start stopped');
    if (content.run.generation !== 1)
      throw gozarError('invalid_input', 'A first forward run starts at generation 1');
    return;
  }
  if (content.run.id === current.run.id) {
    if (content.run.generation !== current.run.generation)
      throw gozarError('invalid_input', 'The run generation cannot change within one run');
    if (current.run.phase === 'stopped' && content.run.phase !== 'stopped')
      throw gozarError('stopped_by_user', 'This managed run was stopped; start a fresh run instead of restarting it');
    return;
  }
  // A fresh run replaces the current one only in the documented order.
  if (current.run.phase !== 'stopped')
    throw gozarError('route_conflict', 'A managed run is still in flight; stop it before starting a fresh run');
  if (current.cleanup.certainty !== 'settled')
    throw gozarError('cleanup_debt', 'The stopped run still has unconfirmed cleanup; settle it before replacing it');
  if (content.run.generation !== current.run.generation + 1)
    throw gozarError('invalid_input', `A fresh run must advance the generation to ${current.run.generation + 1}`);
  if (content.run.phase === 'stopped')
    throw gozarError('invalid_input', 'A fresh run record cannot arrive stopped; a run becomes stopped only in place');
}

// Only the store composes the full record; a stored file must be exactly what the store writes.
function checkStoredRecord(app, value) {
  try {
    requireFields(value, RECORD_FIELDS, 'the stored forward record');
    if (value.schemaVersion !== 1 || value.kind !== KIND || value.app !== app ||
        !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('envelope');
    const content = validateContent({ run: value.run, approval: value.approval, origin: value.origin,
      downSince: value.downSince, cleanup: value.cleanup });
    return { schemaVersion: 1, kind: KIND, app, revision: value.revision, ...content };
  } catch (error) {
    throw gozarError('internal_error', `The stored forward state for app ${app} is not a valid record`, null, error);
  }
}

export function openForwardState({ home, app } = {}) {
  validateScope({ home, app });
  // The stored name is the hash of the app identity: no identifier can alias another or escape
  // the forward scope, and the record itself re-verifies the app on every read.
  const key = scopeKeyOf(app);
  const fileName = `${key}.json`, lockName = `${key}.lock`;
  const directory = async create => forwardDirectory(home, create);
  // Missing state is null; anything unreadable or invalid is an error, never an empty success.
  const readCurrent = async () => {
    let dir;
    try { dir = await directory(false); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let value;
    try { value = await readRecord(join(dir, fileName)); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code === 'unsafe_state_path') throw error;
      throw gozarError('internal_error', `The stored forward state for app ${app} is not a valid record`, null, error);
    }
    return checkStoredRecord(app, value);
  };
  return {
    read: readCurrent,
    async commit(nextRecord, { expectedRevision } = {}) {
      const content = validateContent(nextRecord);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw gozarError('invalid_input', 'expectedRevision must be a non-negative integer');
      const dir = await directory(true);
      return withExclusiveLock(join(dir, lockName), async () => {
        const current = await readCurrent();
        const revision = current ? current.revision : 0;
        if (expectedRevision !== revision)
          throw gozarError('candidate_stale',
            `The forward state for app ${app} is at revision ${revision}, not ${expectedRevision}; read it again and retry`);
        checkTransition(current, content);
        const record = { schemaVersion: 1, kind: KIND, app, revision: revision + 1, ...content };
        if (Buffer.byteLength(JSON.stringify(record)) > 65536)
          throw gozarError('invalid_input', 'Forward state record exceeds size limit');
        await atomicWrite(join(dir, fileName), record);
        return record;
      }, { waitSeconds: 10 });
    },
  };
}
