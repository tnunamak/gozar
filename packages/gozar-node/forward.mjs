// The managed forward lifecycle behind the `forward` contract (docs/library-ux.md). The host owns its
// loopback listener, its UI and its saved On/Off intent; this engine owns provider selection, operation
// IDs, the current consent authority, verified publication, re-establishment and cleanup for one app.
//
// Boundary: createForward(api, { home, reconnect? }) returns forward({ app, port, policy, onAction? }).
// `api` is the real configured low-level route API (createGozar): its registry, secret backend, identity
// and host hooks stay in force, and this engine only composes them. Every effect — setup actions, secret
// intake, route allocation, proof, watch, removal — runs inside the engine through that api. The host sees
// only result objects and UI descriptors, never candidate tokens, consent digests or provider-name branches.
//
// Ownership rules the rest of the file enforces, stated once here:
//  * A run's authority is the CURRENT SDK candidate. Every allocation spends a fresh single-use catalog
//    token from a fresh observation; a remembered origin or stored bearer is never replayed. Saved user
//    assent (identities only, target included) is reusable only while the current exact candidate's scope,
//    disclosure and facts still match it — and the SDK's own redemption re-proves binding, grant and
//    expiry independently. Recovery of a retained route uses the same two checks plus the route's own
//    consent digest; it never invents a token.
//  * A new or restarted managed run uses a fresh operation ID. A retained operation is read for status
//    and exact cleanup only; it is never re-exposed as a fresh allocation.
//  * Custody before effect: the exact operation id and provider are persisted before any provider call, and
//    the exact handle is persisted before anything can remove or rely on it. A missing handle is not proof
//    of no effects: an operation with no recorded handle is resolved through the SDK's own operation
//    journal (listRoutes), and an unreadable journal blocks replacement. A setup operation this run reserved
//    is likewise persisted (run.setup) before it starts and settled by cancel, never merely forgotten.
//  * State is committed (CAS) after every held UI or SDK await; the record commit lock is never held
//    across a provider/network call. A separate process lease (forward-state.mjs forwardManagerLock)
//    proves live-manager ownership: a short CAS commit is not a lifetime claim.
//  * Stop, withdrawal and cleanup debt are persisted before any notification (event, resolve, reject).
//    Unconfirmed owned effects are retained, never replaced by an optimistic record, and unconfirmed
//    cleanup blocks any replacement.
//  * The only shareable url is the CURRENT verified publication (null while down or unpublished). The
//    private record's `origin` is the historical last-verified origin; it is replayed to the first 'change'
//    subscriber only when a NEW verified origin differs from it, together with every change observed since
//    forward returned.
//  * While the managed intent is on, a terminal route, a withdrawn proof or a broken watch is handled by the
//    engine: bounded watch restarts, then confirmed cleanup of the old route, then a fresh scoped operation
//    under unchanged exact assent (a changed disclosure is a user step, offered through onAction or the
//    resource's needsAction/resume and an 'action' event). All retries are bounded with backoff; nothing
//    reconnects after close() or a denial, and there is no background process: the loop lives only while
//    the app holds the resource.
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { acquireProcessLock } from './process-lock.mjs';
import { openForwardState, forwardManagerLock } from './forward-state.mjs';
import { selectForwardCandidate } from './forward-policy.mjs';
import { consentReview } from './consent-facts.mjs';
import { portListening } from './target-check.mjs';
import { gozarError, normalizeError, instructionAction } from './error-normalizer.mjs';

const APP = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000;
const STEP_BUDGET = 16;
const CAS_ATTEMPTS = 8;
const SETUP_POLL_MS = 200;
const SETUP_POLL_CAP_MS = 30_000;
const TOKEN_GRACE_MS = 30_000;
const RECONNECT = Object.freeze({ attempts: 5, baseMs: 1000, capMs: 60_000 });
const REQUIREMENTS = Object.freeze({ reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] });
const CONSENT_REFUSALS = ['consent_mismatch', 'consent_unknown', 'consent_expired', 'consent_required', 'candidate_stale'];
// Route states (route-contract.d.ts) after which the SDK route no longer publishes and will not recover on
// its own: released (terminal) and lost (a durable provider rule that vanished). Every other non-usable state
// is an outage the route can still come back from; cleanup that is not 'none' is handled as loss as well.
const GONE_STATES = new Set(['released', 'lost']);
const SETUP_DONE = new Set(['complete', 'cancelled', 'expired', 'denied']);
const NO_RETRY = new Set(['stopped_by_user', 'cleanup_debt']);
const EVENTS = ['change', 'down', 'back', 'action', 'halted'];
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CONTENT_FIELDS = ['run', 'approval', 'origin', 'downSince', 'cleanup'];
const handleKey = handle => JSON.stringify([handle.kind, handle.id]);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The kinds a lifetime policy may consider, in tier order. */
const kindsFor = lifetime => lifetime === 'lasting' ? ['durable'] : lifetime === 'session' ? ['session', 'attached'] : ['durable', 'session', 'attached'];

/** The SDK usage the engine requests for one forward kind. A durable route keeps a stable per-app id. */
const usageFor = (kind, app) => kind === 'durable' ? { kind: 'durable', routeId: `forward-${app}` }
  : kind === 'session' ? { kind: 'session', lifetimeMs: SESSION_LIFETIME_MS } : { kind: 'attached' };

const queryFor = (kind, run) => ({ schemaVersion: 1, owner: run.owner, target: run.target, home: run.home,
  usage: usageFor(kind, run.app), requirements: REQUIREMENTS });

/**
 * The approval identity of a catalog candidate: a sha256 fingerprint over the exact public consent
 * canonicalization (scope — which carries the requested target —, typed disclosures, facts), plus the
 * identities the private record persists. No bearer, no token: this is what saved user assent is bound to
 * and compared against, so a changed port, policy kind, disclosure or fact is a different assent.
 */
function approvalIdentity(candidate) {
  const consent = candidate.consent;
  if (!consent || typeof consent.consentFactsDigest !== 'string' || !consent.consentFactsDigest ||
      !consent.scope || !consent.disclosures || !Array.isArray(consent.facts))
    throw gozarError('internal_error', 'The selected candidate carries no consent receipt to approve');
  const review = consentReview({ scope: consent.scope, typedDisclosures: consent.disclosures, facts: consent.facts });
  return { fingerprint: `sha256:${sha256(review.canonicalJson)}`, provider: candidate.providerId,
    disclosureRevision: candidate.disclosure.revision, factsDigest: consent.consentFactsDigest };
}

/** Saved assent applies only while every identity of the CURRENT candidate still matches it. */
const assentMatches = (saved, identity) => !!saved && saved.provider === identity.provider &&
  saved.factsDigest === identity.factsDigest && saved.disclosureRevision === identity.disclosureRevision &&
  saved.fingerprint === identity.fingerprint;

/** A candidate is a current usable grant only with an issued token that has not expired. */
function usableNow(candidate, at) {
  if (typeof candidate?.candidateToken !== 'string' || !candidate.candidateToken) return false;
  const expiresAt = Date.parse(candidate.expiresAt ?? '');
  return Number.isFinite(expiresAt) && expiresAt > at + TOKEN_GRACE_MS;
}

/** The content fields of a stored record, or null. */
const contentOf = record => record ? Object.fromEntries(CONTENT_FIELDS.map(field => [field, record[field]])) : null;

function reconnectPolicy(reconnect) {
  const policy = { ...RECONNECT, ...(reconnect ?? {}) };
  const ok = (value, min) => Number.isInteger(value) && value >= min;
  if (!ok(policy.attempts, 1) || !ok(policy.baseMs, 0) || !ok(policy.capMs, 0))
    throw gozarError('invalid_input', 'reconnect needs integer attempts >= 1 and baseMs/capMs >= 0');
  return Object.freeze(policy);
}

export function createForward(api, { home, now = Date.now, reconnect } = {}) {
  if (!api || typeof api !== 'object' || typeof api.catalogRoutes !== 'function')
    throw gozarError('invalid_input', 'createForward needs the configured Gozar route api');
  if (typeof home !== 'string' || !isAbsolute(home))
    throw gozarError('invalid_input', 'createForward needs an absolute managed home');
  const retry = reconnectPolicy(reconnect);

  /**
   * forward({ app, port, policy, onAction }) resolves to ONE managed resource:
   *   { url, kind, lifetime, provider, downSince, needsAction, resume(answer), on(type, listener), close() }
   * Published: needsAction is null and url is the current verified origin (null while down). Pending:
   * needsAction is the one descriptor to render and resume(answer) continues. The same object stays current
   * for later steps. It rejects with the frozen Gozar codes (requirements_unsatisfied carries `unmet` rows,
   * cleanup_debt retains the exact persisted recovery refs, stopped_by_user after a denial or close).
   */
  async function forward({ app, port, policy = {}, onAction } = {}) {
    if (arguments.length === 0 || typeof app !== 'string' || !APP.test(app))
      throw gozarError('invalid_input', 'forward needs app: 1..64 lowercase letters, digits or hyphens');
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw gozarError('invalid_input', 'forward needs a loopback listener port (1..65535)');
    if (onAction !== undefined && typeof onAction !== 'function')
      throw gozarError('invalid_input', 'onAction must be a function(descriptor) returning the UI answer');
    // One policy implementation validates and interprets the request: the selector's closed vocabulary.
    selectForwardCandidate({ candidates: [], policy });
    // The host owns its listener; a port where nothing listens is refused before any provider effect.
    if (!await portListening(port)) throw gozarError('invalid_input', `Nothing is listening on 127.0.0.1:${port}; start the app listener first`);

    const state = openForwardState({ home, app });
    const leasePath = await forwardManagerLock({ home, app });
    let release;
    try { release = await acquireProcessLock(leasePath, { waitMs: 0 }); }
    catch (cause) {
      throw gozarError('busy', `Another live process owns the managed forward lifecycle for app ${app}`, null, cause);
    }
    const run = new ManagedRun({ api, home, app, owner: `forward:${app}`, target: `127.0.0.1:${port}`,
      policy, onAction, state, release, leasePath, now, retry });
    return run.begin();
  }
  return forward;
}

class ManagedRun {
  constructor({ api, home, app, owner, target, policy, onAction, state, release, leasePath, now, retry }) {
    Object.assign(this, { api, home, app, owner, target, policy, onAction, state, now, retry });
    this.leasePath = leasePath;
    this.releaseManager = release;
    this.runIdentity = null;
    this.releaseLease = async () => {
      const release = this.releaseManager;
      this.releaseManager = null;
      if (release) await release();
    };
    this.closing = false;        // set at close() entry: the fence for late UI, proof, watch, resume and retry
    this.stopped = false;        // set once the persisted run is committed stopped
    this.inflight = new Set();   // effectful sections (allocation + custody, removal, setup step) close() waits out
    this.operation = null;       // the live setup operation reference while its offers are polled
    this.handle = null;          // the current SDK handle once a route is adopted
    this.pub = null;             // the current publication's provider facts: { kind, provider }
    this.currentUrl = null;      // the CURRENT verified publication, never a remembered origin; null while down
    this.lastOrigin = null;      // the last announced verified origin (seeded from the record's origin)
    this.downSince = null;       // the current outage observation
    this.halted = null;
    this.backEvent = null;       // the latest recovery observation, for first 'back' replay
    this.changes = [];           // ordered replay buffer for the first 'change' subscriber
    this.listeners = Object.fromEntries(EVENTS.map(type => [type, new Set()]));
    this.replayed = Object.fromEntries(EVENTS.map(type => [type, false]));
    this.pending = null;         // the one descriptor awaiting an answer
    this.parked = null;          // { descriptor, latch } while no onAction hook can answer it
    this.turn = null;            // what the current caller of forward()/resume() awaits
    this.watcher = null;
    this.closeGate = deferred(); // resolves at close(): wakes every backoff sleep
    this.closeDone = null;
    this.closeInFlight = null;
    this.resource = this.makeResource();
  }

  at() { return this.now(); }
  iso() { return new Date(this.now()).toISOString(); }

  // --- The persisted record (CAS after every held await; never locked across a provider call) -------

  /** Read-modify-commit with a revision fence. Only this manager writes, so contention is bounded. */
  async save(mutate) {
    for (let attempt = 0; ; attempt++) {
      const record = await this.state.read();
      if (this.runIdentity && !this.owns(record)) throw this.stoppedByUser('A successor owns this managed service');
      const next = mutate(record ? structuredClone(contentOf(record)) : null, record);
      if (!next) return record;
      try {
        const committed = await this.state.commit(next, { expectedRevision: record ? record.revision : 0 });
        this.runIdentity = { id: committed.run.id, generation: committed.run.generation };
        return committed;
      } catch (error) {
        if (error.code === 'candidate_stale' && attempt < CAS_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  owns(record) {
    return record && this.runIdentity && record.run.id === this.runIdentity.id &&
      record.run.generation === this.runIdentity.generation;
  }

  /** Check and register work synchronously; check again before the callback can start an effect. */
  effect(call) {
    this.checkFenced();
    return this.track(Promise.resolve().then(() => { this.checkFenced(); return call(); }));
  }

  /** Commit the run stopped with unconfirmed cleanup owned by the run it names; return the debt error. */
  async persistDebt(message) {
    const debt = await this.save(content => ({ run: { ...content.run, phase: 'stopped' },
      approval: content.approval, origin: content.origin, downSince: content.downSince,
      cleanup: { certainty: 'unconfirmed', debt: { runId: content.run.id, generation: content.run.generation, since: this.iso() } } }));
    this.stopped = true;
    this.currentUrl = null;
    return this.debtError(debt, message);
  }

  debtError(record, message) {
    return gozarError('cleanup_debt', `${message}. Retry close on the managed resource, or call forward again for this app; `
      + `Gozar retries the removal with the retained handle of run ${record.run.id} (generation ${record.run.generation}).`,
      instructionAction('retry-managed-cleanup', 'Retry the owned cleanup',
        'The stopped run keeps its exact recovery references in Gozar private state; retrying performs the removal again.'));
  }

  /** Record the exact handle (and provider) the SDK returned, before anything removes or relies on it. */
  async recordHandle(handle, provider, phase) {
    await this.save(content => {
      const run = content.run;
      const same = run.handle && handleKey(run.handle) === handleKey(handle) && run.handle.generation === handle.generation;
      const nextPhase = run.phase === 'stopped' ? 'stopped' : phase ?? run.phase;
      if (same && run.provider === (provider ?? run.provider) && run.phase === nextPhase) return null;
      return { ...content, run: { ...run, handle, provider: provider ?? run.provider, phase: nextPhase } };
    });
    this.handle = handle;
  }

  /** Run one effectful section under the close fence: close() waits every tracked section out. */
  track(promise) {
    const tracked = promise.then(() => {}, () => {});
    this.inflight.add(tracked);
    tracked.then(() => this.inflight.delete(tracked));
    return promise;
  }

  // --- Owned effects: removal, operation journal, setup operations ------------------------------------

  /** Remove one owned route honestly: a confirmed receipt, an unconfirmed view, or a typed refusal. */
  removeRoute(handle) {
    return this.track((async () => {
      try { return await this.api.closeRoute({ home: this.home, handle, mode: 'remove' }); }
      catch (error) {
        const normalized = normalizeError(error);
        if (normalized.code === 'cleanup_debt') return normalized.route ?? { cleanup: { state: 'unconfirmed' } };
        // A missing or unreadable record is never confirmed cleanup: the debt path retains the handle.
        if (['route_not_found', 'provider_unavailable', 'busy', 'route_conflict'].includes(normalized.code))
          return { cleanup: { state: 'unconfirmed' } };
        throw normalized;
      }
    })());
  }

  /**
   * What the SDK's own operation journal says an operation id created: the exact handle that may still owe
   * cleanup, or null when the journal proves nothing was created or everything was confirmed removed. A
   * journal that cannot be read throws, and the caller keeps the operation reference and blocks replacement.
   */
  async journaledRoute(operationId) {
    const listed = await this.api.listRoutes({ home: this.home, owner: this.owner });
    const rows = (listed?.routes ?? []).filter(row => row?.operationId === operationId && row.handle);
    const byRoute = new Map();
    for (const row of rows) {
      const key = handleKey(row.handle);
      const known = byRoute.get(key);
      if (!known || row.handle.generation > known.handle.generation) byRoute.set(key, row);
    }
    if (byRoute.size > 1) throw gozarError('ambiguous_route', 'The operation journal names more than one route for this managed operation');
    const [row] = byRoute.values();
    if (!row || row.cleanup?.state === 'confirmed') return null;
    return row.handle;
  }

  /** Settle one reserved setup operation by its exact reference: terminal already, or cancelled and read back. */
  async settleSetup({ operationId, provider }) {
    const reference = { home: this.home, owner: this.owner, providerId: provider, operationId };
    try {
      let view;
      try { view = await this.api.readSetupOperation(reference); }
      catch (error) {
        // An operation the SDK never recorded has nothing to cancel.
        if (normalizeError(error).code === 'route_not_found') return 'settled';
        throw error;
      }
      if (!SETUP_DONE.has(view?.state)) view = await this.api.cancelSetupOperation(reference);
      return SETUP_DONE.has(view?.state) ? 'settled' : 'unconfirmed';
    } catch { return 'unconfirmed'; }
  }

  /**
   * Settle every effect this run may own — a live setup operation, an allocation whose result was never
   * recorded, a route — then persist the stop. Resolves only on confirmed cleanup; otherwise the debt is
   * persisted (with every retained reference) and thrown. A settled stopped run owes nothing.
   */
  async settleOwned(message) {
    let record = await this.state.read();
    if (!record && this.runIdentity) throw gozarError('cleanup_debt', 'The managed recovery record is missing; owned cleanup cannot be confirmed', instructionAction('restore-managed-state', 'Restore the managed recovery record', 'Keep the saved route references until cleanup is confirmed.'));
    if (!record || !this.owns(record)) return;
    if (record.run.phase === 'stopped' && record.cleanup.certainty === 'settled' && !record.run.setup) { this.stopped = true; return; }
    let unconfirmed = false;
    if (record.run.setup) {
      if (await this.settleSetup(record.run.setup) === 'settled') record = await this.save(content => ({ ...content, run: { ...content.run, setup: null } }));
      else unconfirmed = true;
    }
    if (record.run.operationId && !record.run.handle) {
      try {
        const handle = await this.journaledRoute(record.run.operationId);
        record = await this.save(content => handle ? { ...content, run: { ...content.run, handle } }
          : { ...content, run: { ...content.run, operationId: null } });
      } catch { unconfirmed = true; }
    }
    if (record.run.handle) {
      const view = await this.removeRoute(record.run.handle);
      if (view?.cleanup?.state !== 'confirmed') unconfirmed = true;
    }
    if (unconfirmed) throw await this.persistDebt(message);
    await this.save(content => ({ ...content, run: { ...content.run, phase: 'stopped', setup: null }, downSince: null,
      cleanup: { certainty: 'settled', debt: null } }));
    this.stopped = true;
    this.currentUrl = null;
  }

  /** A setup operation left behind by a failed step is settled (cancelled), not forgotten. */
  async releaseSetup() {
    const record = await this.state.read();
    if (!record?.run.setup || record.run.phase === 'stopped') return;
    if (await this.settleSetup(record.run.setup) !== 'settled') throw await this.persistDebt('A setup operation of this run is still unconfirmed');
    await this.save(content => ({ ...content, run: { ...content.run, setup: null } }));
    this.operation = null;
  }

  // --- The flow driver: one coroutine; descriptors parked for the host, answers fed back -------------

  newTurn() {
    const turn = deferred();
    turn.promise.catch(() => {});  // a rejection nobody is awaiting (background re-establishment) is not unhandled
    return turn;
  }

  begin() {
    this.turn = this.newTurn();
    const promise = this.turn.promise;
    this.coroutine = this.start();
    return promise;
  }

  async start() {
    try {
      const found = await this.startup();
      this.checkFenced();
      await this.adoptPublication(found);
      this.checkFenced();
      this.turn.resolve(this.resource);
    } catch (error) { this.turn.reject(await this.fail(error)); }
  }

  /** A rejected flow settles what it still owns and releases the lease (unless a close owns the settlement). */
  async fail(error, { background = false } = {}) {
    let failure = normalizeError(error);
    if (this.closing) return failure;
    if (!this.stopped) {
      try { await this.releaseSetup(); } catch (debt) { failure = normalizeError(debt); }
    }
    if (!background || this.stopped) await this.releaseLease();
    return failure;
  }

  /** The one question for the host: through onAction, or parked until resume(answer) (and an 'action' event). */
  async ask(descriptor) {
    this.pending = descriptor;
    if (this.onAction) {
      let answer;
      try { answer = await this.onAction(structuredClone(descriptor)); }
      catch {
        // The handler's own message can carry anything the UI knew; the public error never echoes it.
        this.pending = null;
        return this.stopRun('The action handler failed');
      }
      this.pending = null;
      this.checkFenced();
      return this.checkAnswer(descriptor, answer);
    }
    const parked = { descriptor, latch: deferred() };
    this.parked = parked;
    this.emit('action', descriptor);
    this.turn.resolve(this.resource);
    try { return await parked.latch.promise; }
    finally { if (this.parked === parked) this.parked = null; this.pending = null; }
  }

  resume(answer) {
    if (this.closing || this.stopped) return Promise.reject(this.stoppedByUser());
    const parked = this.parked;
    if (!parked) return Promise.reject(gozarError('invalid_input', 'There is no pending step to resume'));
    let checked;
    try { checked = this.checkAnswer(parked.descriptor, answer); } catch (error) { return Promise.reject(error); }
    this.parked = null;
    this.turn = this.newTurn();
    const promise = this.turn.promise;
    parked.latch.resolve(checked);
    return promise;
  }

  checkAnswer(descriptor, answer) {
    const bad = why => { throw gozarError('invalid_input', `The answer for step ${descriptor.step} is invalid: ${why}`); };
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) bad('an answer object is required');
    if (answer.approve !== true && answer.approve !== false) bad('answer.approve must be true or false');
    if (answer.approve === false) return answer;
    const type = descriptor.answer?.type;
    if (type === 'value' && typeof answer.value !== 'string') bad('answer.value must be a string');
    if (type === 'secret' && (typeof answer.secret !== 'string' || !answer.secret)) bad('answer.secret must be a non-empty string');
    if (type === 'decision' && ('value' in answer || 'secret' in answer)) bad('this step takes only the approve decision');
    return answer;
  }

  checkFenced() {
    if (this.closing) throw this.stoppedByUser();
  }

  stoppedByUser(reason) {
    return gozarError('stopped_by_user', reason ?? `The managed forward run for app ${this.app} was closed`);
  }

  /** A denial or a failed handler stops this run: settle everything it owns, persist the stop, then reject. */
  async stopRun(reason) {
    await this.settleOwned('Stopping this step left owned cleanup unconfirmed');
    throw this.stoppedByUser(reason);
  }

  backoff(index) { return Math.min(this.retry.capMs, this.retry.baseMs * 2 ** index); }

  /** A sleep that close() wakes at once. */
  async nap(ms) {
    let timer;
    await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, ms); }), this.closeGate.promise]);
    clearTimeout(timer);
    this.checkFenced();
  }

  // --- Reconcile, then observe/select/act/publish -------------------------------------------------

  /**
   * Startup order is fixed: (1) a setup operation a dead manager reserved is settled by its exact reference;
   * (2) an allocation whose handle was never recorded is resolved through the SDK journal; (3) debt is
   * retried with the retained handle; (4) a retained route is recovered only on current facts, or settled
   * before a fresh allocation. Any unconfirmed step is debt and blocks replacement.
   */
  async startup() {
    let record = await this.state.read();
    if (record) this.runIdentity = { id: record.run.id, generation: record.run.generation };
    if (record) record = await this.reconcile(record);
    this.lastOrigin = record?.origin?.url ?? null;
    let seed;
    if (!record) seed = { id: randomUUID(), generation: 1 };
    else if (record.run.phase === 'stopped') seed = { id: randomUUID(), generation: record.run.generation + 1 };
    else {
      seed = { id: record.run.id, generation: record.run.generation };
      if (record.run.handle) {
        const recovered = await this.qualifiedRecovery(record);
        if (recovered) return recovered;
        // The retained route no longer qualifies: settle its owned cleanup before a fresh allocation.
        const removed = await this.removeRoute(record.run.handle);
        if (removed?.cleanup?.state !== 'confirmed') throw await this.persistDebt('The retained route of the previous run could not be removed');
        await this.save(content => ({ ...content, run: { ...content.run, phase: 'stopped', setup: null }, downSince: null,
          cleanup: { certainty: 'settled', debt: null } }));
        seed = { id: randomUUID(), generation: record.run.generation + 1 };
      }
    }
    // Persist the run identity before any provider effect, with the exact transition the store enforces.
    await this.save((content, current) => {
      const seedContent = { run: { id: seed.id, generation: seed.generation, operationId: null, handle: null, provider: null, phase: 'starting', setup: null },
        approval: current ? current.approval : null, origin: current ? current.origin : null,
        downSince: null, cleanup: { certainty: 'settled', debt: null } };
      if (!current) return seedContent;
      // An in-flight run without a handle keeps its identity; a stopped run is replaced by the fresh seed.
      if (current.run.id === seed.id && current.run.phase !== 'stopped')
        return { ...content, run: { ...content.run, phase: 'starting' }, downSince: null, cleanup: { certainty: 'settled', debt: null } };
      return seedContent;
    });
    return this.establish();
  }

  /** Steps 1-3 of startup: everything a previous manager may have left owing cleanup, settled exactly or retained. */
  async reconcile(record) {
    let owed = false;
    if (record.run.setup) {
      if (await this.settleSetup(record.run.setup) === 'settled') record = await this.save(content => ({ ...content, run: { ...content.run, setup: null } }));
      else owed = true;
    }
    if (record.run.operationId && !record.run.handle) {
      // A missing handle is not proof of no effects: an unreadable journal rejects here, record untouched.
      const handle = await this.journaledRoute(record.run.operationId);
      record = await this.save(content => handle ? { ...content, run: { ...content.run, handle } }
        : { ...content, run: { ...content.run, operationId: null } });
    }
    if (record.cleanup.certainty === 'unconfirmed') {
      if (record.run.handle) {
        const removed = await this.removeRoute(record.run.handle);
        if (removed?.cleanup?.state !== 'confirmed') owed = true;
      }
      if (owed) throw await this.persistDebt('The previous managed run still has unconfirmed cleanup');
      return this.save(content => ({ ...content, cleanup: { certainty: 'settled', debt: null } }));
    }
    if (owed) throw await this.persistDebt('A setup operation of the previous run is still unconfirmed');
    return record;
  }

  /** The shared observe -> setup/consent -> publish loop of the first start and every re-establishment. */
  async establish() {
    for (let step = 0; step < STEP_BUDGET; step++) {
      this.checkFenced();
      const selection = await this.observe();
      if (selection.outcome === 'requirements_unsatisfied') {
        const error = gozarError('requirements_unsatisfied', selection.message, null);
        error.unmet = selection.unmet;
        throw error;
      }
      if (selection.outcome === 'action') { await this.setupSteps(selection); continue; }
      const published = await this.publishFlow(selection);
      if (published) return published;
      // The world moved under a held decision or the grant was not current: observe again.
    }
    throw gozarError('provider_unavailable', `The managed forward for app ${this.app} did not settle within ${STEP_BUDGET} observed steps`);
  }

  /** The current observation: catalog the policy's kinds, then the one selection over typed envelopes. */
  async observe() {
    const kinds = kindsFor(this.policy.lifetime ?? 'prefer-lasting');
    const catalogs = {};
    const envelopes = kind => (catalogs[kind] ?? []).map(candidate => ({ kind, candidate }));
    // A ready durable route answers without anonymous-session probes; any other outcome needs the rest.
    if (kinds.includes('durable')) {
      catalogs.durable = await this.catalog('durable');
      const lasting = selectForwardCandidate({ candidates: envelopes('durable'), policy: this.policy });
      if (lasting.outcome === 'selected') return lasting;
    }
    for (const kind of kinds) if (!catalogs[kind]) catalogs[kind] = await this.catalog(kind);
    const all = [];
    for (const kind of kinds) all.push(...envelopes(kind));
    return selectForwardCandidate({ candidates: all, policy: this.policy });
  }

  async catalog(kind) {
    const catalog = await this.api.catalogRoutes(queryFor(kind, this));
    return catalog?.candidates ?? [];
  }

  /** The current candidate of one provider and kind, after a held await. Never a remembered one. */
  async pinnedCandidate(kind, providerId) {
    const catalog = await this.api.catalogRoutes({ ...queryFor(kind, this), providerId });
    return (catalog?.candidates ?? []).find(candidate => candidate.providerId === providerId) ?? null;
  }

  // --- Recovery: revalidate the retained route against CURRENT facts and SDK authority ---------------

  /**
   * Reattach only when every current fact agrees: the route is usable, verified and published now, for the
   * requested target, under the consent digest the user saved; the current exact candidate of that provider
   * (a fresh catalog read, never an invented token) still satisfies the policy through the one selector;
   * and the saved assent still matches that candidate's exact scope, disclosure and facts. Anything else
   * returns null and the retained route is settled before anything new starts. Never re-exposes.
   */
  async qualifiedRecovery(record) {
    const handle = record.run.handle;
    const saved = record.approval;
    const kind = handle.kind === 'durable' ? 'durable' : handle.kind === 'session' ? 'session' : handle.kind === 'attached' ? 'attached' : null;
    if (!kind || !saved || (record.run.provider ?? saved.provider) !== saved.provider) return null;
    let view;
    try { view = await this.api.routeStatus({ home: this.home, handle }); }
    catch (error) {
      const normalized = normalizeError(error);
      if (['route_not_found', 'ambiguous_route', 'provider_unavailable', 'verification_failed', 'busy'].includes(normalized.code)) return null;
      throw normalized;
    }
    if (!this.viewQualifies(view) || view.consentFactsDigest !== saved.factsDigest) return null;
    let current;
    try { current = await this.pinnedCandidate(kind, saved.provider); }
    catch { return null; }  // no current SDK authority is read: conservative, the route is settled instead
    if (!current) return null;
    const outcome = selectForwardCandidate({ candidates: [{ kind, candidate: current }], policy: this.policy });
    if (outcome.outcome !== 'selected' || outcome.candidate !== current) return null;
    if (!assentMatches(saved, approvalIdentity(current))) return null;
    await this.save(content => ({ ...content, run: { ...content.run, phase: 'active', provider: saved.provider } }));
    return { view, kind, candidate: current };
  }

  viewQualifies(view) {
    if (view?.state !== 'usable' || view.verification?.status !== 'verified' || typeof view.published !== 'string' ||
        !view.published || view.cleanup?.state !== 'none') return false;
    if (view.consentChange && view.consentChange.oldDigest !== view.consentChange.newDigest) return false;
    const target = view.hostConfiguration?.target;
    return target?.known === true && target.value === this.target;
  }

  // --- Setup steps: one current offer at a time, executed by the real SDK machinery -----------------

  async setupSteps({ kind, candidate, action }) {
    await this.save(content => ({ ...content, run: { ...content.run, provider: candidate.providerId, phase: 'awaiting' } }));
    const base = { home: this.home, owner: this.owner, providerId: candidate.providerId };
    if (!action.step) {
      const answer = await this.ask(this.setupDescriptor(action));
      if (answer.approve !== true) return this.stopRun('The user declined this forward step');
      this.checkFenced();
      // A click is never observed provider readiness: re-observe the action before running anything.
      const fresh = await this.pinnedCandidate(kind, candidate.providerId);
      this.checkFenced();
      const current = this.locateAction(fresh, action);
      if (!current) return;
      const request = { ...base, expectedConfigurationRevision: fresh.configuration?.revision,
        actionId: current.id, approval: this.setupApproval(current) };
      if (current.kind === 'provide-value') request.value = answer.value;
      if (current.kind === 'provide-secret') request.secretHandle = await this.storeSecret(candidate, current, answer, fresh.configuration);
      await this.effect(() => this.api.runSetupAction(request));
      return;
    }
    // A stepped setup operation: persist its exact reference BEFORE it reserves anything, then walk its live
    // offers, each re-approved as offered. A step that does not complete leaves the reference for settleSetup.
    const operationId = randomUUID();
    this.operation = { ...base, operationId };
    await this.save(content => ({ ...content, run: { ...content.run, setup: { operationId, provider: candidate.providerId } } }));
    this.checkFenced();
    let view = await this.effect(() => this.api.runSetupAction({ ...base, expectedConfigurationRevision: candidate.configuration?.revision,
      operationId, actionId: action.id, expectedSetupRevision: 0 }));
    this.checkFenced();
    let offers = 0;
    while (view && !['complete', 'cancelled', 'expired', 'denied', 'blocked'].includes(view.state)) {
      const offer = view.nextAction;
      if (!offer) { view = await this.pollOperation(); continue; }
      if (++offers > STEP_BUDGET) throw gozarError('provider_unavailable', 'The setup operation did not settle within its offer budget');
      const answer = await this.ask(this.setupDescriptor(offer));
      if (answer.approve !== true) return this.stopRun('The user declined this forward step');
      this.checkFenced();
      const request = { ...base, expectedConfigurationRevision: view.scope?.configurationRevision ?? candidate.configuration?.revision,
        operationId, actionId: offer.id, expectedSetupRevision: view.revision, approval: this.setupApproval(offer) };
      if (offer.kind === 'provide-value') request.value = answer.value;
      if (offer.kind === 'provide-secret') request.secretHandle = await this.storeSecret(candidate, offer, answer, view.scope);
      view = await this.effect(() => this.api.runSetupAction(request));
      this.checkFenced();
    }
    if (view?.state !== 'complete')
      throw gozarError('setup_required', `The setup operation ended as ${view?.state ?? 'unknown'}`);
    // Completed: nothing remains to cancel, so the private reference is cleared.
    this.operation = null;
    await this.save(content => ({ ...content, run: { ...content.run, setup: null } }));
  }

  locateAction(candidate, action) {
    if (candidate?.setup?.state !== 'action-required' || !Array.isArray(candidate.setup.actions)) return null;
    const current = candidate.setup.actions.find(item => item.id === action.id);
    if (!current) return null;
    if (current.digest !== action.digest || current.disclosure?.revision !== action.disclosure?.revision) return null;
    return current;
  }

  setupApproval(action) {
    if (!action.consent?.consentFactsDigest)
      throw gozarError('consent_required', 'The offered action carries no consent receipt; ask the catalog again');
    return { kind: 'setup', consentFactsDigest: action.consent.consentFactsDigest,
      digest: action.digest, disclosureRevision: action.disclosure.revision };
  }

  /** The host supplies the secret value; only its SDK-side private handle crosses into setup. */
  async storeSecret(candidate, action, answer, scope) {
    const inputId = action.inputId ?? scope?.inputRequirements?.find?.(row => row.actionId === action.id)?.id ?? action.id;
    const scopeId = scope?.scopeId ?? candidate.configuration?.scopeId;
    if (!scopeId) throw gozarError('setup_required', 'The offered secret step has no configuration scope');
    const stored = await this.effect(() => this.api.storeSecret({ home: this.home, owner: this.owner, providerId: candidate.providerId,
      inputId, scopeId, bytes: new TextEncoder().encode(answer.secret) }));
    return stored.handle;
  }

  async pollOperation() {
    const deadline = this.at() + SETUP_POLL_CAP_MS;
    for (;;) {
      this.checkFenced();
      if (this.at() >= deadline) throw gozarError('provider_unavailable', 'The setup operation did not settle in time');
      await this.nap(SETUP_POLL_MS);
      const view = await this.api.readSetupOperation(this.operation);
      if (view.nextAction || !['pending', 'reconciling', 'authorization-required'].includes(view.state)) return view;
    }
  }

  // --- Publication: current assent, current grant, verified-only output ---------------------------

  async publishFlow({ kind, candidate }) {
    const identity = approvalIdentity(candidate);
    if (!usableNow(candidate, this.at())) return null;
    const saved = (await this.state.read())?.approval ?? null;
    if (!assentMatches(saved, identity)) {
      const answer = await this.ask(this.consentDescriptor(kind, candidate));
      if (answer.approve !== true) return this.stopRun('The user declined this forward step');
      this.checkFenced();
      // A fresh current grant after the held await; the SDK's redemption re-proves it independently.
      const fresh = await this.pinnedCandidate(kind, candidate.providerId);
      if (!fresh || !usableNow(fresh, this.at())) return null;
      const freshIdentity = approvalIdentity(fresh);
      if (freshIdentity.provider !== identity.provider || freshIdentity.factsDigest !== identity.factsDigest ||
          freshIdentity.disclosureRevision !== identity.disclosureRevision || freshIdentity.fingerprint !== identity.fingerprint)
        return null;  // the disclosure or scope changed under the held decision: reoffer, never reuse it
      candidate = fresh;
    }
    // Saved user assent bound to the CURRENT exact candidate — identities only, persisted before effects.
    await this.save(content => ({ ...content, approval: { fingerprint: identity.fingerprint, provider: identity.provider,
      disclosureRevision: identity.disclosureRevision, factsDigest: identity.factsDigest } }));
    const view = await this.allocate(kind, candidate, identity);
    return view ? { view, kind, candidate } : null;
  }

  /**
   * One fresh operation ID per allocation; the retained handle of an old operation is never re-exposed. The
   * exact intent (operation id + provider) is durable BEFORE the provider call, and the call plus the
   * custody of its result is ONE tracked flight, so close() cannot resolve while either is pending.
   */
  async allocate(kind, candidate, identity) {
    const operationId = randomUUID();
    await this.save(content => ({ ...content, run: { ...content.run, operationId, handle: null,
      provider: candidate.providerId, phase: 'starting' } }));
    this.checkFenced();
    const view = await this.effect(() => this.performAllocation(kind, candidate, identity, operationId));
    this.checkFenced();  // a close that began mid-proof fences here; its cleanup uses the recorded handle
    return view;
  }

  async performAllocation(kind, candidate, identity, operationId) {
    const request = { ...queryFor(kind, this), providerId: candidate.providerId, operationId,
      approval: { kind: 'route', consentFactsDigest: identity.factsDigest, candidateToken: candidate.candidateToken,
        disclosureRevision: identity.disclosureRevision } };
    let view;
    try { view = await (kind === 'durable' ? this.api.ensureRoute(request) : this.api.expose({ ...request, wait: 'verified' })); }
    catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === 'verification_failed') normalized.message += ' For HTTP targets, mount createServiceVerifier() before application routes and check the HTTPS path.';
      if (CONSENT_REFUSALS.includes(normalized.code)) {
        // The current SDK authority refused the grant before any effect: observe and ask again.
        await this.save(content => content.run.operationId === operationId && !content.run.handle
          ? { ...content, run: { ...content.run, operationId: null } } : null);
        return null;
      }
      await this.retainFailedAllocation(normalized, operationId);
      throw normalized;
    }
    if (!(view && view.verification?.status === 'verified' && typeof view.published === 'string' && view.published)) {
      const refused = gozarError('provider_unavailable', 'The route was allocated but its publication was not verified. For HTTP targets, mount createServiceVerifier() before application routes and check the HTTPS path.');
      if (view) refused.route = view;
      await this.retainFailedAllocation(refused, operationId);
      throw refused;
    }
    // Record the created route before anything else, so a close racing this proof settles exactly it.
    await this.recordHandle(view.handle, candidate.providerId, 'active');
    return view;
  }

  /** An allocation that failed may still have created owned effects: settle them or retain the exact debt. */
  async retainFailedAllocation(error, operationId) {
    let handle = error.route?.handle ?? null;
    if (handle) await this.recordHandle(handle, undefined, undefined);  // the exact handle is retained BEFORE removal
    else {
      // No handle came back, and that is not proof of no effects: ask the SDK's own journal.
      try { handle = await this.journaledRoute(operationId); }
      catch { const debt = await this.persistDebt('The failed allocation left an unresolved operation'); debt.cause = error; throw debt; }
      if (handle) await this.recordHandle(handle, undefined, undefined);
    }
    if (!handle) {
      await this.save(content => content.run.operationId === operationId && !content.run.handle
        ? { ...content, run: { ...content.run, operationId: null } } : null);
      return;
    }
    const removed = await this.removeRoute(handle);
    if (removed?.cleanup?.state === 'confirmed') {
      await this.save(content => ({ ...content, run: { ...content.run, handle: null, operationId: null, phase: 'starting' },
        cleanup: { certainty: 'settled', debt: null } }));
      this.handle = null;
      return;
    }
    const debt = await this.persistDebt('The failed allocation left unconfirmed owned cleanup');
    debt.cause = error;
    throw debt;
  }

  async adoptPublication({ view, kind, candidate }) {
    this.handle = view.handle;
    this.pub = { kind, provider: this.providerFacts(candidate) };
    if (this.closing) return;
    await this.observeVerified(view.published, { force: true });
    this.startWatch();
  }

  providerFacts(candidate) {
    const properties = candidate.properties ?? {};
    const traffic = properties.traffic ?? {};
    return { id: candidate.providerId, label: candidate.display?.label ?? null, ownership: candidate.ownership ?? null,
      needsAccount: properties.needsAccount ?? null,
      traffic: { tlsTermination: traffic.tlsTermination ?? 'unknown', providerCanReadPayload: traffic.providerCanReadPayload ?? null },
      address: { stability: properties.address?.stability ?? 'unknown' },
      cost: properties.cost ?? { kind: 'unknown', summary: 'The current cost facts are unknown.' } };
  }

  // --- The published resource ----------------------------------------------------------------------

  makeResource() {
    const run = this;
    return {
      get url() { return run.currentUrl; },
      get kind() { return run.pub?.kind ?? null; },
      get lifetime() { return run.pub ? (run.pub.kind === 'durable' ? 'lasting' : 'session') : null; },
      get provider() { return run.pub?.provider ?? null; },
      get downSince() { return run.downSince; },
      get needsAction() { return run.pending ? structuredClone(run.pending) : null; },
      resume: answer => run.resume(answer),
      on: (type, listener) => run.on(type, listener),
      close: () => run.close(),
    };
  }

  on(type, listener) {
    if (!EVENTS.includes(type)) throw gozarError('invalid_input', "on() subscribes to 'change', 'down', 'back', 'action' or 'halted'");
    if (typeof listener !== 'function') throw gozarError('invalid_input', 'on() needs a listener function');
    if (this.closing || (this.stopped && type !== 'halted')) throw this.stoppedByUser();
    this.listeners[type].add(listener);
    const unbind = () => { this.listeners[type].delete(listener); };
    // The replay owns the subscription gap. Change: startup change + every change since publication, in
    // order. Down/back/action: the current outage or pending step, so no state is lost before subscribing.
    if (!this.replayed[type]) {
      this.replayed[type] = true;
      if (type === 'change') { for (const event of this.changes.splice(0)) this.deliver(listener, event); }
      if (type === 'down' && this.downSince) this.deliver(listener, { downSince: this.downSince });
      if (type === 'back' && !this.downSince && this.backEvent) this.deliver(listener, this.backEvent);
      if (type === 'action' && this.pending) this.deliver(listener, this.pending);
      if (type === 'halted' && this.halted) this.deliver(listener, this.halted);
    }
    return unbind;
  }

  deliver(listener, event) {
    const warn = () => process.emitWarning('A Gozar forward listener threw; route management continues', { code: 'GOZAR_FORWARD_LISTENER' });
    queueMicrotask(() => {
      if (this.closing) return;
      try { Promise.resolve(listener(structuredClone(event))).catch(warn); }
      catch { warn(); }
    });
  }

  emit(type, event) {
    if (this.closing || (this.stopped && type !== 'halted')) return;  // only the terminal notice survives a background stop
    for (const listener of this.listeners[type]) this.deliver(listener, event);
  }

  // --- The watch: status observed in order; loss re-establishes through a fresh scoped operation ----

  startWatch() {
    if (this.closing || this.stopped) return;
    const controller = new AbortController();
    this.watcher = { controller, done: this.watchLoop(this.handle, controller) };
  }

  async watchLoop(handle, controller) {
    const { signal } = controller;
    let failures = 0;
    while (!signal.aborted && !this.closing) {
      try {
        for await (const event of this.api.watchRoutes({ home: this.home, handle, signal })) {
          if (signal.aborted || this.closing) return;
          failures = 0;
          if (await this.observeView(event.route, event.type) === 'lost') { controller.abort(); return this.reestablish(); }
        }
      } catch { /* a broken watch is not an observation: it is withdrawn and restarted below */ }
      if (signal.aborted || this.closing) return;
      // The stream ended or broke without a verdict. Nothing proves the route is still published, so the
      // url is withdrawn; the watch restarts a bounded number of times, then the route counts as lost.
      try { await this.markDown(); } catch { /* the outage observation is retried by the next observation */ }
      if (++failures > this.retry.attempts) { controller.abort(); return this.reestablish(); }
      try { await this.nap(this.backoff(failures - 1)); } catch { return; }
    }
  }

  /** One observed view becomes at most one ordered fact, persisted before it is notified. */
  async observeView(view, type) {
    if (this.closing) return 'closed';
    const consentMoved = view?.consentChange && view.consentChange.oldDigest !== view.consentChange.newDigest;
    if (type === 'terminal' || type === 'consent_changed' || consentMoved || GONE_STATES.has(view?.state) ||
        (view?.cleanup?.state && view.cleanup.state !== 'none')) return 'lost';
    const verified = view?.state === 'usable' && view.verification?.status === 'verified' &&
      typeof view.published === 'string' && view.published ? view.published : null;
    if (verified) await this.observeVerified(verified);
    else await this.markDown();
    return 'ok';
  }

  /** A verified origin: persisted first, then the change (against the last announced origin) and recovery. */
  async observeVerified(url, { force = false } = {}) {
    const at = this.iso();
    const changed = this.lastOrigin !== null && this.lastOrigin !== url;
    const outage = this.downSince;
    if (!force && !changed && !outage && this.currentUrl === url) return;
    await this.save(content => ({ ...content, origin: !force && content.origin?.url === url ? content.origin : { url, observedAt: at }, downSince: null }));
    if (this.closing || this.stopped) return;
    const oldOrigin = this.lastOrigin;
    this.currentUrl = url;
    this.lastOrigin = url;
    this.downSince = null;
    if (changed) {
      const event = { oldOrigin, newOrigin: url, at };
      if (!this.replayed.change) this.changes.push(event);
      this.emit('change', event);
    }
    if (outage) {
      const event = { downSince: outage, at };
      this.backEvent = event;
      this.emit('back', event);
    }
  }

  /** The route is not provably published: withdraw the url at once, persist the outage, then notify. */
  async markDown() {
    this.currentUrl = null;
    if (this.closing || this.stopped || this.downSince) return;
    const at = this.iso();
    this.downSince = at;
    await this.save(content => ({ ...content, downSince: at }));
    this.emit('down', { downSince: at });
  }

  // --- Re-establishment: confirmed old cleanup, then a fresh scoped operation, bounded -------------

  async reestablish() {
    if (this.closing) return;
    this.turn = this.newTurn();
    this.coroutine = (async () => {
      try {
        await this.markDown();
        await this.settleLost();
        for (let attempt = 0; ; attempt++) {
          this.checkFenced();
          try {
            const found = await this.establish();
            this.checkFenced();
            await this.adoptPublication(found);
            this.checkFenced();
            this.turn.resolve(this.resource);
            return;
          } catch (error) {
            const normalized = normalizeError(error);
            if (this.closing || NO_RETRY.has(normalized.code) || attempt + 1 >= this.retry.attempts) throw normalized;
            await this.releaseSetup();  // a failed attempt settles its own setup operation before the next one
            await this.nap(this.backoff(attempt));
          }
        }
      } catch (error) {
        const failure = await this.fail(error, { background: true });
        this.halted = { code: failure.code, downSince: this.downSince, retrying: false };
        this.emit('halted', this.halted);
        this.turn.reject(failure);
      }
    })();
    return this.coroutine;
  }

  /** The lost route's exact cleanup is confirmed (bounded retries) before anything replaces it; else it is debt. */
  async settleLost() {
    const record = await this.state.read();
    const handle = record?.run.handle ?? this.handle;
    if (handle) {
      for (let attempt = 0; ; attempt++) {
        this.checkFenced();
        const removed = await this.removeRoute(handle);
        if (removed?.cleanup?.state === 'confirmed') break;
        if (attempt + 1 >= this.retry.attempts) throw await this.persistDebt('The lost route could not be removed');
        await this.nap(this.backoff(attempt));
      }
    }
    await this.save(content => ({ ...content, run: { ...content.run, handle: null, operationId: null, phase: 'starting' },
      cleanup: { certainty: 'settled', debt: null } }));
    this.handle = null;
  }

  // --- UI descriptors: answer shape and disclosure facts, no bearer/digest plumbing ----------------

  consentDescriptor(kind, candidate) {
    return {
      step: 'approve-route',
      kind: 'consent',
      label: `Publish ${this.app} at a public HTTPS address through ${candidate.display?.label ?? 'the selected provider'}`,
      help: `The route reaches public internet clients over HTTPS and lasts ${kind === 'durable' ? 'as a persistent provider rule' : 'for this managed session'}.`,
      disclosure: { revision: candidate.disclosure.revision, text: candidate.disclosure.text, links: candidate.disclosure.links },
      facts: candidate.consent?.facts ?? [],
      target: this.target,
      answer: { type: 'decision', approve: 'boolean' },
    };
  }

  setupDescriptor(action) {
    const answer = action.kind === 'provide-value'
      ? { type: 'value', format: action.valueFormat ?? 'text', label: action.valueLabel ?? null, options: action.step?.options ?? null }
      : action.kind === 'provide-secret' ? { type: 'secret', label: action.secretLabel ?? null }
      : { type: 'decision', approve: 'boolean' };
    return {
      step: action.id,
      kind: action.kind,
      label: action.label,
      help: action.help ?? null,
      instructions: action.instructions ?? null,
      href: action.href ?? null,
      obtainUrl: action.obtainUrl ?? null,
      disclosure: action.disclosure ? { revision: action.disclosure.revision, text: action.disclosure.text, links: action.disclosure.links } : null,
      facts: action.consent?.facts ?? [],
      answer,
    };
  }

  // --- close: fence, settle, persist, then notify ---------------------------------------------------

  close() {
    // Idempotent once resolved; one attempt at a time; a rejected attempt (cleanup_debt above all)
    // leaves the run fenced and the debt persisted, and a later close() retries the settlement.
    if (this.closeDone) return this.closeDone;
    if (this.closeInFlight) return this.closeInFlight;
    const attempt = this.doClose().then(value => { this.closeDone = attempt; return value; },
      error => { if (this.closeInFlight === attempt) this.closeInFlight = null; throw error; });
    this.closeInFlight = attempt;
    return attempt;
  }

  async doClose() {
    if (!this.releaseManager) {
      const record = await this.state.read();
      if (record && !this.owns(record)) return;
      try { this.releaseManager = await acquireProcessLock(this.leasePath, { waitMs: 0 }); }
      catch (cause) { throw gozarError('busy', 'Another manager owns this managed service; retry its cleanup later', null, cause); }
    }
    // 1. Fence first: no further UI acceptance, proof adoption, watch callback, retry or resume.
    this.closing = true;
    this.closeGate.resolve();
    this.watcher?.controller.abort();
    if (this.parked) this.parked.latch.reject(this.stoppedByUser());
    // 2. Wait out every in-flight effect (allocation and its custody write, removals, a setup step), so the
    //    settlement below sees, and cleans up, exactly what they created.
    while (this.inflight.size) await Promise.all([...this.inflight]);
    // 3. Settle everything the run owns — setup operation, unrecorded allocation, route — and persist the
    //    outcome; only then (and only on confirmed cleanup) resolve. Otherwise the debt is persisted with its
    //    exact recovery refs and thrown. The lease is released either way: a close retry, or a later forward
    //    for this app, must be able to settle debt without this manager alive.
    try { await this.settleOwned('Cleanup of this managed run is unconfirmed'); }
    finally { await this.releaseLease(); }
  }
}
