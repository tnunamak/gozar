// The managed forward lifecycle behind the `forward` contract (docs/library-ux.md). The host owns its
// loopback listener, its UI and its saved On/Off intent; this engine owns provider selection, operation
// IDs, the current consent authority, verified publication, re-establishment and cleanup for one app.
//
// Boundary: createForward(api, { home }) returns forward({ app, port, policy, onAction? }). `api` is the
// real configured low-level route API (createGozar): its registry, secret backend, identity and host
// hooks stay in force, and this engine only composes them. Every effect — setup actions, secret intake,
// route allocation, proof, watch, removal — runs inside the engine through that api. The host sees only
// result objects and UI descriptors, never candidate tokens, consent digests or provider-name branches.
//
// Ownership rules the rest of the file enforces, stated once here:
//  * A run's authority is the CURRENT SDK candidate. Every allocation spends a fresh single-use catalog
//    token from a fresh observation; a remembered origin or stored bearer is never replayed. Saved user
//    assent is reusable only while the current exact candidate's scope, disclosure and facts still match
//    it — and the SDK's own redemption re-proves binding, grant and expiry independently.
//  * A new or restarted managed run uses a fresh operation ID. A retained operation is read for status
//    and exact cleanup only; it is never re-exposed as a fresh allocation.
//  * State is committed (CAS) after every held UI or SDK await; the record commit lock is never held
//    across a provider/network call. A separate process lease (forward-state.mjs forwardManagerLock)
//    proves live-manager ownership: a short CAS commit is not a lifetime claim.
//  * Stop, withdrawal and cleanup debt are persisted before any notification (event, resolve, reject).
//    Unconfirmed owned effects are retained, never replaced by an optimistic record.
//  * The only shareable url is the CURRENT verified publication. The private record's `origin` is the
//    historical last-verified origin; it is replayed to the first 'change' subscriber only when a NEW
//    verified origin differs from it, together with every change observed since forward returned.
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
const REQUIREMENTS = Object.freeze({ reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] });
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CONTENT_FIELDS = ['run', 'approval', 'origin', 'downSince', 'cleanup'];

/** The kinds a lifetime policy may consider, in tier order. */
const kindsFor = lifetime => lifetime === 'lasting' ? ['durable'] : lifetime === 'session' ? ['session', 'attached'] : ['durable', 'session', 'attached'];

/** The SDK usage the engine requests for one forward kind. A durable route keeps a stable per-app id. */
const usageFor = (kind, app) => kind === 'durable' ? { kind: 'durable', routeId: `forward-${app}` }
  : kind === 'session' ? { kind: 'session', lifetimeMs: SESSION_LIFETIME_MS } : { kind: 'attached' };

const queryFor = (kind, run) => ({ schemaVersion: 1, owner: run.owner, target: run.target, home: run.home,
  usage: usageFor(kind, run.app), requirements: REQUIREMENTS });

/**
 * The approval identity of a catalog candidate: a sha256 fingerprint over the exact public consent
 * canonicalization (scope, typed disclosures, facts), plus the identities the private record persists.
 * No bearer, no token: this is what saved user assent is bound to and compared against.
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

export function createForward(api, { home, now = Date.now } = {}) {
  if (!api || typeof api !== 'object' || typeof api.catalogRoutes !== 'function')
    throw gozarError('invalid_input', 'createForward needs the configured Gozar route api');
  if (typeof home !== 'string' || !isAbsolute(home))
    throw gozarError('invalid_input', 'createForward needs an absolute managed home');

  /**
   * forward({ app, port, policy, onAction }) resolves to ONE current result:
   *   published: { url, kind, lifetime, provider, downSince, needsAction: null, on(type, listener), close() }
   *   pending:   { needsAction: descriptor, resume(answer), close() }
   * It rejects with the frozen Gozar codes (requirements_unsatisfied carries `unmet` rows,
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
      policy, onAction, state, release, now });
    return run.begin();
  }
  return forward;
}

class ManagedRun {
  constructor({ api, home, app, owner, target, policy, onAction, state, release, now }) {
    Object.assign(this, { api, home, app, owner, target, policy, onAction, state, now });
    this.releaseLease = release;
    this.closing = false;      // set at close() entry: the fence for late UI, proof, watch and resume
    this.stopped = false;      // set once the persisted run is committed stopped
    this.resuming = false;     // one resume per step
    this.flight = null;        // the in-flight allocation promise close() waits out
    this.operation = null;     // a live setup operation reference while its offers are walked
    this.handle = null;        // the current SDK handle once a route is adopted
    this.url = null;           // the CURRENT verified publication, never a remembered origin
    this.historicalOrigin = null;  // the record's last-verified origin, for startup-change replay only
    this.changes = [];         // ordered replay buffer: startup change + changes before subscription
    this.downSince = null;    // the current outage observation
    this.backEvent = null;     // the latest recovery observation, for first 'back' replay
    this.listeners = { change: new Set(), down: new Set(), back: new Set() };
    this.replayed = { change: false, down: false, back: false };
    this.closed = null;
    this.watcher = null;
    this.awaiting = undefined;
    this.flow = null;
    this.pending = null;
  }

  at() { return this.now(); }
  iso() { return new Date(this.now()).toISOString(); }

  // --- The persisted record (CAS after every held await; never locked across a provider call) -------

  /** Read-modify-commit with a revision fence. Only this manager writes, so contention is bounded. */
  async save(mutate) {
    for (let attempt = 0; ; attempt++) {
      const record = await this.state.read();
      const next = mutate(record ? structuredClone(contentOf(record)) : null, record);
      if (!next) return record;
      try {
        return await this.state.commit(next, { expectedRevision: record ? record.revision : 0 });
      } catch (error) {
        if (error.code === 'candidate_stale' && attempt < CAS_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** Commit the run stopped with unconfirmed cleanup owned by the run it names; return the debt error. */
  async persistDebt(message) {
    const debt = await this.save(content => ({ run: { ...content.run, phase: 'stopped' },
      approval: content.approval, origin: content.origin, downSince: content.downSince,
      cleanup: { certainty: 'unconfirmed', debt: { runId: content.run.id, generation: content.run.generation, since: this.iso() } } }));
    this.stopped = true;
    return this.debtError(debt, message);
  }

  debtError(record, message) {
    return gozarError('cleanup_debt', `${message}. Retry close on the managed resource, or call forward again for this app; `
      + `Gozar retries the removal with the retained handle of run ${record.run.id} (generation ${record.run.generation}).`,
      instructionAction('retry-managed-cleanup', 'Retry the owned cleanup',
        'The stopped run keeps its exact recovery references in Gozar private state; retrying performs the removal again.'));
  }

  /** Remove one owned route honestly: a confirmed receipt, an unconfirmed view, or a typed refusal. */
  async removeRoute(handle) {
    if (!handle) return { cleanup: { state: 'confirmed' } };
    try { return await this.api.closeRoute({ home: this.home, handle, mode: 'remove' }); }
    catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === 'cleanup_debt') return normalized.route ?? { cleanup: { state: 'unconfirmed' } };
      // A missing or unreadable record is never confirmed cleanup: the debt path retains the handle.
      if (['route_not_found', 'provider_unavailable', 'busy', 'route_conflict'].includes(normalized.code))
        return { cleanup: { state: 'unconfirmed' } };
      throw normalized;
    }
  }

  /** The stop shared by close(), denial and replacement: settled, or debt persisted before rejection. */
  async finishStop(view, message) {
    if (view?.cleanup?.state === 'confirmed') {
      await this.save(content => ({ ...content, run: { ...content.run, phase: 'stopped' }, downSince: null,
        cleanup: { certainty: 'settled', debt: null } }));
      this.stopped = true;
      return true;
    }
    throw await this.persistDebt(message);
  }

  // --- The flow driver: one generator, descriptors yielded out, answers fed back -------------------

  async begin() {
    this.flow = this.lifecycle();
    return this.advance();
  }

  async advance() {
    for (;;) {
      let state;
      try { state = await this.flow.next(this.awaiting); }
      catch (error) { throw await this.fail(error); }
      if (state.done) return state.value;
      this.pending = state.value;
      if (typeof this.onAction === 'function') {
        let answer;
        try { answer = await this.onAction(structuredClone(state.value)); }
        catch (cause) { throw await this.fail(gozarError('stopped_by_user', `The action handler failed: ${cause.message}`, null, cause)); }
        this.awaiting = this.checkAnswer(state.value, answer);
        continue;
      }
      return this.actionResult(state.value);
    }
  }

  /** A rejected flow released the lease (unless a close owns finalization); the record says the truth. */
  async fail(error) {
    if (!this.closing) await this.releaseLease();
    return normalizeError(error);
  }

  actionResult(descriptor) {
    return { needsAction: descriptor, resume: answer => this.resumeAnswer(descriptor, answer), close: () => this.close() };
  }

  resumeAnswer(descriptor, answer) {
    if (this.pending !== descriptor)
      return Promise.reject(gozarError('invalid_input', 'This step was superseded; resume the current needsAction result'));
    if (this.closing || this.stopped) return Promise.reject(this.stoppedByUser());
    if (this.resuming) return Promise.reject(gozarError('invalid_input', 'A resume for this step is already in flight'));
    this.resuming = true;
    return (async () => {
      try { this.awaiting = this.checkAnswer(descriptor, answer); return await this.advance(); }
      finally { this.resuming = false; }
    })();
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

  // --- Reconcile, then observe/select/act/publish -------------------------------------------------

  async *lifecycle() {
    const record = await this.state.read();
    if (record && record.cleanup.certainty === 'unconfirmed') {
      // Debt is reconciled before anything starts; an unsettled debt rejects with the retained refs.
      const settled = await this.removeRoute(record.run.handle);
      if (settled?.cleanup?.state !== 'confirmed') throw await this.persistDebt('The previous managed run still has unconfirmed cleanup');
      await this.save(content => ({ ...content, cleanup: { certainty: 'settled', debt: null } }));
    }
    this.historicalOrigin = record?.origin ?? null;
    let seed;
    if (!record) seed = { id: randomUUID(), generation: 1 };
    else if (record.run.phase === 'stopped') seed = { id: randomUUID(), generation: record.run.generation + 1 };
    else {
      seed = { id: record.run.id, generation: record.run.generation };
      if (record.run.handle) {
        const recovered = await this.tryRecover(record);
        if (recovered) return recovered;
        // The retained route no longer qualifies: settle its owned cleanup before a fresh allocation.
        const settled = await this.removeRoute(record.run.handle);
        if (await this.finishStop(settled, 'The retained route of the previous run could not be removed'))
          seed = { id: randomUUID(), generation: record.run.generation + 1 };
      }
    }
    // Persist the run identity before any provider effect, with the exact transition the store enforces.
    await this.save((content, current) => {
      const seedContent = { run: { id: seed.id, generation: seed.generation, operationId: null, handle: null, provider: null, phase: 'starting' },
        approval: current ? current.approval : null, origin: current ? current.origin : null,
        downSince: null, cleanup: { certainty: 'settled', debt: null } };
      if (!current) return seedContent;
      // An in-flight run without a handle keeps its identity; a stopped run is replaced by the fresh seed.
      if (current.run.id === seed.id && current.run.phase !== 'stopped')
        return { ...content, run: { ...content.run, phase: 'starting' }, downSince: null, cleanup: { certainty: 'settled', debt: null } };
      return seedContent;
    });

    for (let step = 0; step < STEP_BUDGET; step++) {
      this.checkFenced();
      const selection = await this.observe();
      if (selection.outcome === 'requirements_unsatisfied') {
        const error = gozarError('requirements_unsatisfied', selection.message, null);
        error.unmet = selection.unmet;
        throw error;
      }
      if (selection.outcome === 'action') { yield* this.setupSteps(selection); continue; }
      const published = yield* this.publishFlow(selection);
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

  // --- Recovery: revalidate the retained route against the CURRENT target, facts and policy ---------

  async tryRecover(record) {
    const handle = record.run.handle;
    let view;
    try { view = await this.api.routeStatus({ home: this.home, handle }); }
    catch (error) {
      const normalized = normalizeError(error);
      if (['route_not_found', 'ambiguous_route', 'provider_unavailable', 'verification_failed', 'busy'].includes(normalized.code)) return null;
      throw normalized;
    }
    if (!this.routeQualifies(view, record)) return null;
    const at = this.iso();
    await this.save(content => ({ run: { ...content.run, phase: 'active' }, approval: content.approval,
      origin: { url: view.published, observedAt: at }, downSince: null, cleanup: { certainty: 'settled', debt: null } }));
    this.handle = handle;
    this.url = view.published;
    this.startWatch();
    return this.resource(handle.kind, { id: record.run.provider, label: null, ownership: view.ownership ?? null, properties: view.properties });
  }

  /** Reattach only on current facts: usable+verified+published now, the requested target, and a route
   * that still satisfies the requested policy (validated through the one selector, over the live view). */
  routeQualifies(view, record) {
    if (view?.state !== 'usable' || view.verification?.status !== 'verified' ||
        typeof view.published !== 'string' || !view.published || view.cleanup?.state !== 'none') return false;
    const target = view.hostConfiguration?.target;
    if (target?.known !== true || target.value !== this.target) return false;
    const kind = view.handle.kind === 'durable' ? 'durable' : view.handle.kind === 'session' ? 'session' : 'attached';
    // A live verified view restated as the selector's own candidate shape: usable now, observed facts.
    const candidate = { providerId: record.run.provider ?? 'retained', ownership: view.ownership, rank: 1, eligible: true, unmet: [],
      properties: view.properties, setup: { state: 'ready', actions: [] }, candidateToken: 'retained-managed-route',
      availability: Object.fromEntries(['durable', 'session', 'attached'].map(
        name => [name, { state: name === kind ? 'available' : 'unsupported', reason: 'managed-recovery' }])) };
    const outcome = selectForwardCandidate({ candidates: [{ kind, candidate }], policy: this.policy });
    return outcome.outcome === 'selected' && outcome.candidate === candidate;
  }

  // --- Setup steps: one current offer at a time, executed by the real SDK machinery -----------------

  async *setupSteps({ kind, candidate, action }) {
    await this.save(content => ({ ...content, run: { ...content.run, provider: candidate.providerId, phase: 'awaiting' } }));
    const base = { home: this.home, owner: this.owner, providerId: candidate.providerId };
    if (!action.step) {
      const answer = yield this.setupDescriptor(action, candidate, null);
      if (answer.approve !== true) { await this.denyStep(); return; }
      this.checkFenced();
      // A click is never observed provider readiness: re-observe the action before running anything.
      const fresh = await this.pinnedCandidate(kind, candidate.providerId);
      const current = this.locateAction(fresh, action);
      if (!current) return;
      const request = { ...base, expectedConfigurationRevision: fresh.configuration?.revision,
        actionId: current.id, approval: this.setupApproval(current) };
      if (current.kind === 'provide-value') request.value = answer.value;
      if (current.kind === 'provide-secret') request.secretHandle = await this.storeSecret(candidate, current, answer, fresh.configuration);
      await this.api.runSetupAction(request);
      return;
    }
    // A stepped setup operation: reserve it, then walk its live offers, each re-approved as offered.
    const operationId = randomUUID();
    this.operation = { ...base, operationId };
    try {
      let view = await this.api.runSetupAction({ ...base, expectedConfigurationRevision: candidate.configuration?.revision,
        operationId, actionId: action.id, expectedSetupRevision: 0 });
      this.checkFenced();
      let offers = 0;
      while (view && !['complete', 'cancelled', 'expired', 'denied', 'blocked'].includes(view.state)) {
        const offer = view.nextAction;
        if (!offer) { view = await this.pollOperation(); continue; }
        if (++offers > STEP_BUDGET) throw gozarError('provider_unavailable', 'The setup operation did not settle within its offer budget');
        const answer = yield this.setupDescriptor(offer, candidate, view);
        if (answer.approve !== true) { await this.denyStep(); return; }
        this.checkFenced();
        const request = { ...base, expectedConfigurationRevision: view.scope?.configurationRevision ?? candidate.configuration?.revision,
          operationId, actionId: offer.id, expectedSetupRevision: view.revision, approval: this.setupApproval(offer) };
        if (offer.kind === 'provide-value') request.value = answer.value;
        if (offer.kind === 'provide-secret') request.secretHandle = await this.storeSecret(candidate, offer, answer, view.scope);
        view = await this.api.runSetupAction(request);
        this.checkFenced();
      }
      if (view?.state !== 'complete')
        throw gozarError('setup_required', `The setup operation ended as ${view?.state ?? 'unknown'}`);
    } finally { this.operation = null; }
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
    const stored = await this.api.storeSecret({ home: this.home, owner: this.owner, providerId: candidate.providerId,
      inputId, scopeId, bytes: new TextEncoder().encode(answer.secret) });
    return stored.handle;
  }

  async pollOperation() {
    const deadline = this.at() + SETUP_POLL_CAP_MS;
    for (;;) {
      this.checkFenced();
      if (this.at() >= deadline) throw gozarError('provider_unavailable', 'The setup operation did not settle in time');
      await sleep(SETUP_POLL_MS);
      this.checkFenced();
      const view = await this.api.readSetupOperation(this.operation);
      if (view.nextAction || !['pending', 'reconciling', 'authorization-required'].includes(view.state)) return view;
    }
  }

  async cancelOperation() {
    if (!this.operation) return;
    try { await this.api.cancelSetupOperation(this.operation); } catch { /* a failed cancel leaves the operation journal honest */ }
  }

  /** A denial stops this run: cancel any live operation, persist the stop, then notify by rejecting. */
  async denyStep() {
    await this.cancelOperation();
    const record = await this.state.read();
    if (record?.run.handle) {
      const view = await this.removeRoute(record.run.handle);
      await this.finishStop(view, 'Declining this step left the already-created route unremovable');
    } else {
      await this.save(content => ({ ...content, run: { ...content.run, phase: 'stopped' }, downSince: null,
        cleanup: { certainty: 'settled', debt: null } }));
      this.stopped = true;
    }
    throw this.stoppedByUser('The user declined this forward step');
  }

  // --- Publication: current assent, current grant, verified-only output ---------------------------

  async *publishFlow({ kind, candidate }) {
    const identity = approvalIdentity(candidate);
    if (!usableNow(candidate, this.at())) return null;
    const saved = (await this.state.read())?.approval ?? null;
    if (!assentMatches(saved, identity)) {
      const answer = yield this.consentDescriptor(kind, candidate, identity);
      if (answer.approve !== true) { await this.denyStep(); return null; }
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
    if (!view) return null;
    return await this.adoptPublication(view, kind, candidate);
  }

  /** One fresh operation ID per allocation; the retained handle of an old operation is never re-exposed. */
  async allocate(kind, candidate, identity) {
    const operationId = randomUUID();
    const request = { ...queryFor(kind, this), providerId: candidate.providerId, operationId,
      approval: { kind: 'route', consentFactsDigest: identity.factsDigest, candidateToken: candidate.candidateToken,
        disclosureRevision: identity.disclosureRevision } };
    const call = kind === 'durable' ? this.api.ensureRoute(request) : this.api.expose({ ...request, wait: 'verified' });
    this.flight = call.then(() => {}, () => {});
    let view;
    try { view = await call; }
    catch (error) {
      this.flight = null;
      const normalized = normalizeError(error);
      if (['consent_mismatch', 'consent_unknown', 'consent_expired', 'consent_required', 'candidate_stale'].includes(normalized.code))
        return null;  // the current SDK authority refused the grant: observe and ask again
      await this.retainFailedAllocation(normalized);
      throw normalized;
    }
    this.flight = null;
    if (!(view && view.verification?.status === 'verified' && typeof view.published === 'string' && view.published)) {
      const refused = gozarError('provider_unavailable', 'The route was allocated but its publication was not verified');
      if (view) refused.route = view;
      await this.retainFailedAllocation(refused);
      throw refused;
    }
    this.handle = view.handle;
    // Record the created route before anything else, so a close racing this proof settles exactly it.
    await this.save(content => ({ ...content, run: { ...content.run, operationId, handle: view.handle,
      provider: candidate.providerId, phase: 'active' } }));
    this.checkFenced();  // a close that began mid-proof fences here; its cleanup uses the recorded handle
    return view;
  }

  /** An allocation that failed may still have created owned effects: settle or retain the debt. */
  async retainFailedAllocation(error) {
    const handle = error.route?.handle ?? null;
    if (!handle) return;
    const view = await this.removeRoute(handle);
    if (view?.cleanup?.state === 'confirmed') {
      await this.save(content => ({ ...content, run: { ...content.run, handle: null, phase: 'starting' },
        cleanup: { certainty: 'settled', debt: null } }));
      return;
    }
    const debtError = await this.persistDebt('The failed allocation left unconfirmed owned cleanup');
    debtError.cause = error;
    throw debtError;
  }

  async adoptPublication(view, kind, candidate) {
    const at = this.iso();
    // Persist the current verified origin before any notification; the old one stays historical only.
    await this.save(content => ({ ...content, origin: { url: view.published, observedAt: at }, downSince: null }));
    if (this.historicalOrigin && this.historicalOrigin.url !== view.published)
      this.changes.push({ oldOrigin: this.historicalOrigin.url, newOrigin: view.published, at });
    this.url = view.published;
    this.startWatch();
    return this.resource(kind, { id: candidate.providerId, label: candidate.display?.label ?? null,
      ownership: candidate.ownership ?? null, properties: candidate.properties });
  }

  // --- The published resource ----------------------------------------------------------------------

  resource(kind, { id, label, ownership, properties }) {
    const traffic = properties?.traffic ?? {};
    return {
      url: this.url,
      kind,
      lifetime: kind === 'durable' ? 'lasting' : 'session',
      provider: {
        id, label, ownership,
        needsAccount: properties?.needsAccount ?? null,
        traffic: { tlsTermination: traffic.tlsTermination ?? 'unknown', providerCanReadPayload: traffic.providerCanReadPayload ?? null },
        address: { stability: properties?.address?.stability ?? 'unknown' },
        cost: properties?.cost ?? { kind: 'unknown', summary: 'The current cost facts are unknown.' },
      },
      downSince: this.downSince,
      needsAction: null,
      on: (type, listener) => this.on(type, listener),
      close: () => this.close(),
    };
  }

  on(type, listener) {
    if (!['change', 'down', 'back'].includes(type)) throw gozarError('invalid_input', "on() subscribes to 'change', 'down' or 'back'");
    if (typeof listener !== 'function') throw gozarError('invalid_input', 'on() needs a listener function');
    if (this.closing || this.stopped) throw this.stoppedByUser();
    this.listeners[type].add(listener);
    const unbind = () => { this.listeners[type].delete(listener); };
    // The replay owns the subscription gap. Change: startup change + every change since publication, in
    // order. Down/back: the current outage observation, so no state is silently lost before subscribing.
    if (!this.replayed[type]) {
      this.replayed[type] = true;
      if (type === 'change') for (const event of [...this.changes]) this.deliver(listener, event);
      if (type === 'down' && this.downSince) this.deliver(listener, { downSince: this.downSince });
      if (type === 'back' && !this.downSince && this.backEvent) this.deliver(listener, this.backEvent);
    }
    return unbind;
  }

  deliver(listener, event) {
    queueMicrotask(() => { if (!this.closing) { try { listener(structuredClone(event)); } catch { /* a listener cannot steer the run */ } } });
  }

  emit(type, event) {
    if (this.closing || this.stopped) return;  // no callback after the stop is fenced
    for (const listener of this.listeners[type]) this.deliver(listener, event);
  }

  // --- The watch: existing status/poll behavior, changes and outages observed in order --------------

  startWatch() {
    const controller = new AbortController();
    const done = (async () => {
      try {
        for await (const event of this.api.watchRoutes({ home: this.home, handle: this.handle, signal: controller.signal })) {
          if (this.closing) return;
          await this.observeView(event.route);
        }
      } catch { /* a broken watch keeps the last verified observation; the record stays honest */ }
    })();
    this.watcher = { controller, done };
  }

  /** One observed view becomes at most one ordered fact, persisted before it is notified. */
  async observeView(view) {
    if (this.closing) return;
    const at = this.iso();
    const verifiedNow = view?.state === 'usable' && view.verification?.status === 'verified' &&
      typeof view.published === 'string' && view.published ? view.published : null;
    if (verifiedNow) {
      if (this.url && verifiedNow !== this.url) {
        const event = { oldOrigin: this.url, newOrigin: verifiedNow, at };
        await this.save(content => ({ ...content, origin: { url: verifiedNow, observedAt: at } }));
        this.url = verifiedNow;
        this.changes.push(event);
        this.emit('change', event);
      }
      if (this.downSince) {
        const event = { downSince: this.downSince, at };
        this.downSince = null;
        this.backEvent = event;
        await this.save(content => ({ ...content, downSince: null }));
        this.emit('back', event);
      }
    } else if (this.url && !this.downSince) {
      this.downSince = at;
      await this.save(content => ({ ...content, downSince: at }));
      this.emit('down', { downSince: at });
    }
  }

  // --- UI descriptors: answer shape and disclosure facts, no bearer/digest plumbing ----------------

  consentDescriptor(kind, candidate, identity) {
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

  setupDescriptor(action, candidate, operation) {
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
      ...(operation ? { operation: { id: operation.operationId, revision: operation.revision, state: operation.state } } : {}),
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
    // 1. Fence first: no further UI acceptance, proof adoption, watch callback or resume.
    this.closing = true;
    this.watcher?.controller.abort();
    // 2. Wait out any in-flight allocation, so cleanup settles every owned effect it created.
    if (this.flight) await this.flight;
    // 3. A live setup operation owns its own journal; cancel it before recording the stop.
    await this.cancelOperation();
    const record = await this.state.read();
    if (!record) { await this.releaseLease(); return; }
    const handle = record.run.handle ?? this.handle;
    if (!handle) {
      // No route was ever created: the stop is settled by construction, persisted before resolving.
      await this.save(content => ({ ...content, run: { ...content.run, phase: 'stopped' }, downSince: null,
        cleanup: { certainty: 'settled', debt: null } }));
      this.stopped = true;
      await this.releaseLease();
      return;
    }
    // 4. Actual owned cleanup, then the persisted outcome, then (and only then) the notification.
    const view = await this.removeRoute(handle);
    try {
      if (await this.finishStop(view, 'Cleanup of this managed run is unconfirmed')) {
        await this.releaseLease();
        return;
      }
    } catch (error) {
      // The debt is persisted with its exact recovery refs. Abandon the lease too: a close retry,
      // or a later forward for this app, must be able to settle it without this manager alive.
      await this.releaseLease();
      throw error;
    }
  }
}
