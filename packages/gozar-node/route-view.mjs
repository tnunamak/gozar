// Consumer-side route views: errors an app may see, projections of every route kind to RouteView,
// and routeStatus / closeRoute, which dispatch on handle.kind. Apps never learn which provider
// answered; provider diagnostics stay on error.cause.
import { join } from 'node:path';
import {readRecord} from './service-state.mjs';
import { enrichRoute, cleanupForSession } from './embedding-state.mjs';

import { gozarError, normalizeError } from './error-normalizer.mjs';
export { gozarError, normalizeError };

// --- Shapes -------------------------------------------------------------------------------------

const KINDS = ['session', 'attached', 'durable', 'external'];
export function checkRef(request) {
  const handle = request?.handle;
  if (typeof request?.home !== 'string' || !request.home || !handle || !KINDS.includes(handle.kind) || typeof handle.id !== 'string' ||
      !handle.id || !Number.isInteger(handle.generation) || handle.generation < 0)
    throw gozarError('invalid_input', 'A route reference needs a home and a handle {kind, id, generation}');
  return handle;
}

/** What Gozar can say about a route it did not create: nothing about privacy or stability, nothing assumed. */
export const unknownProperties = () => ({
  reach: 'unknown', transport: 'https',
  traffic: { tlsTermination: 'unknown', providerCanReadPayload: null, readers: [], metadataVisibleTo: [], evidenceRef: null },
  address: { stability: 'unknown', scope: 'owner-managed', conditions: [], ports: null },
  cost: { kind: 'unknown', summary: 'Cost is not known to Gozar', currency: null, amount: null, period: null },
  needsAccount: null, lifetimes: ['durable'], supervision: 'host-supervised',
  protocols: { sse: false, streamableHttp: false, oauthDcr: false },
  proof: { vantage: 'none', checks: [] },
});

/**
 * A definition's `byUsage` entry for one usage kind replaces the ports and the needs line it declares at the top level,
 * because a usage kind can take its slot from a different list (a durable route uses the durable engine's ports).
 */
const usageEntry = (definition, kind) => definition?.byUsage?.[kind] ?? {};
export const needsFor = (definition, kind) => usageEntry(definition, kind).needs ?? definition.needs ?? '';

/**
 * A definition may leave out the two facts that came after 0.2; the consumer shape always carries them, saying "none" when
 * unknown. With the definition and a usage kind, the ports are that kind's.
 */
export const completeProperties = (properties, definition, kind) => {
  const own = usageEntry(definition, kind);
  const ports = Object.hasOwn(own, 'ports') ? own.ports : properties.address.ports ?? null;
  return { ...properties, address: { ...properties.address, ports }, proof: properties.proof ?? { vantage: 'none', checks: [] } };
};

/**
 * The declared checks that run for one request: the stream check only when the request needs SSE, and the TLS check
 * only when the origin is https (an origin not known yet keeps it; the registry already drops it for plain-HTTP providers).
 */
export const checksFor = (checks, { sse = false, origin = null } = {}) =>
  (checks ?? []).filter(check => (check !== 'sse' || sse) && (check !== 'tls' || typeof origin !== 'string' || origin.startsWith('https://')));

const iso = ms => new Date(ms).toISOString();
const STATES = new Set(['creating', 'usable', 'unverified', 'unknown', 'lost', 'suspending', 'suspended', 'address_changed', 'uncertain', 'releasing', 'released', 'handing-back']);
// What the last check proved, and from where. Every check Gozar runs for a route runs from this computer, so the
// vantage is 'this-device' once a check ran and 'none' before. Checks are listed only while the route is verified.
const proven = (status, checkedAt, checks) => ({ status, checkedAt, vantage: checkedAt === null ? 'none' : 'this-device', checks: status === 'verified' ? [...checks] : [] });
const verificationOf = (state, checkedAtMs, checks = []) => proven(state === 'usable' ? 'verified' : 'unverified', checkedAtMs === null ? null : iso(checkedAtMs), checks);
// The service challenge (a nonce read at the target and at the origin) is the check durable and external routes pass; an https origin is also read through TLS.
const challengeChecks = origin => (typeof origin === 'string' && origin.startsWith('https://') ? ['nonce', 'tls'] : ['nonce']);
const debtMessage = debt => typeof debt === 'string' ? debt : debt?.message ?? debt?.reason ?? 'Cleanup is incomplete';

function view({ handle, origin, published, state, ownership, properties, ingress = null, verification, limits, cleanup = { state: 'none' }, target, bindTarget, expiresAt, validUntil, now, facts,consentChange,consentFactsDigest,operationId }) {
  return enrichRoute({ schemaVersion: 2, handle: { kind: handle.kind, id: handle.id, generation: handle.generation }, origin, published, state, ownership,
    properties, ingress, verification, limits, cleanup,...(consentChange?{consentChange}:{}),...(consentFactsDigest?{consentFactsDigest}:{}),operationId:operationId??null }, { target, bindTarget, expiresAt, validUntil, now, facts });
}
const limitsOf = (limits, fallbackPollMs, idleTimeoutMs = null) => ({
  recommendedPollIntervalMs: limits?.recommendedPollIntervalMs ?? fallbackPollMs, idleTimeoutMs: limits?.idleTimeoutMs ?? idleTimeoutMs });

/** From the durable engine's reply: a record view that already names its state, origin and verification. */
export function projectDurable(reply, { handle, properties, ingress = null, limits, facts = [], now = Date.now() }) {
  const state = STATES.has(reply.state) ? reply.state : 'unknown';
  const published = state === 'usable' && typeof reply.origin === 'string' ? reply.origin : null;
  const checkedAt = typeof reply.verification?.checkedAt === 'string' ? Date.parse(reply.verification.checkedAt) : null;
  const proof=proven(reply.verification?.status==='verified'&&state==='usable'?'verified':'unverified',Number.isFinite(checkedAt)?iso(checkedAt):null,challengeChecks(reply.origin??reply.allocatedOrigin));
  Object.assign(proof,{observedAt:reply.verification?.observedAt??proof.checkedAt,subject:reply.verification?.subject??null});
  // RouteView.origin is the route's address, also before verification; `published` is what the app may advertise.
  return view({operationId:reply.operationId,consentChange:reply.consentChange,consentFactsDigest:reply.consentFactsDigest, target: reply.target, expiresAt: reply.expiresAt, validUntil: reply.verification?.validUntil, facts, now, handle, origin: reply.allocatedOrigin ?? reply.origin ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification: proof,
    limits: limitsOf(limits, 60_000, reply.idleTimeoutMs), cleanup: reply.cleanupDebt ? { state: 'unconfirmed', message: debtMessage(reply.cleanupDebt) } : { state: 'none' } });
}

const PHASES = { idle: 'creating', detecting: 'creating', planned: 'creating', preflight: 'creating', persisting: 'creating', starting: 'creating',
  validating: 'unverified', 'transport-ready': 'unverified', 'candidate-ready': 'unverified', 'published-ready': 'usable', degraded: 'unverified',
  stopping: 'releasing', 'cleanup-pending': 'uncertain', stopped: 'released', failed: 'lost', blocked: 'unknown', unknown: 'unknown' };

/** From a session snapshot (the controller's status reply). Published only while the core says published-ready. */
export function projectSession(reply, { handle, properties, ingress = null, limits, facts = [], now = Date.now() }) {
  const snapshot = reply.snapshot ?? {};
  const state = PHASES[snapshot.phase] ?? 'unknown';
  const published = state === 'usable' && typeof snapshot.published === 'string' ? snapshot.published : null;
  const receipt = reply.validation?.probeReceipt;
  const verification = verificationOf(state, state === 'usable' ? receipt?.observedAtMs ?? snapshot.checkedAtMs ?? null : null,
    receipt ? ['tls', 'nonce', 'sse'].filter(check => ({ tls: receipt.tls, nonce: receipt.instanceMatched, sse: receipt.sse })[check] === true)
      : checksFor(properties?.proof?.checks, { sse: reply.sseChecked === true, origin: published }));
  if (receipt && ['public', 'tailnet', 'lan', 'this-device'].includes(receipt.vantage)) verification.vantage = receipt.vantage;
  verification.subject=reply.proofSubject??null;verification.observedAt=verification.checkedAt;
  if(reply.fixtureEffects&&verification.checkedAt)verification.vantage='this-device';
  return view({operationId:reply.operationId,consentChange:reply.consentChange,consentFactsDigest:reply.consentFactsDigest, target: reply.target ?? snapshot.target, expiresAt: snapshot.expiresAt ?? (Number.isFinite(reply.expiresAtMs??snapshot.expiresAtMs) ? iso(reply.expiresAtMs??snapshot.expiresAtMs) : undefined), validUntil: Number.isFinite(reply.validation?.probeReceipt?.expiresAtMs) ? iso(reply.validation.probeReceipt.expiresAtMs) : undefined, facts, now, handle, origin: snapshot.published ?? snapshot.candidate ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification, limits: limitsOf(limits, 5_000),
    cleanup: cleanupForSession(reply) });
}

/** From an external service record (owner-managed ingress). Privacy and stability stay unknown. */
export function projectExternal(record, { handle, now = Date.now() }) {
  const verified = record.verification?.status === 'verified';
  const checkedAt = typeof record.verification?.checkedAt === 'string' ? Date.parse(record.verification.checkedAt) : now;
  return view({ target: record.target, validUntil: record.verification?.validUntil, now, handle, origin: record.origin, published: verified ? record.origin : null, state: verified ? 'usable' : 'unverified',
    ownership: 'external-owned', properties: unknownProperties(), verification: proven(verified ? 'verified' : 'unverified', iso(Number.isFinite(checkedAt) ? checkedAt : now), challengeChecks(record.origin)),
    limits: limitsOf(null, 60_000) });
}

/** From an attached lease record kept by its controller. */
export function projectAttached(lease, { handle, now = Date.now() }) {
  const state = STATES.has(lease.state) ? lease.state : 'unknown';
  const verification = lease.proof ? { status: state === 'usable' && lease.proof.status === 'verified' ? 'verified' : 'unverified', checkedAt: lease.proof.checkedAt,
    vantage: lease.proof.vantage, checks: state === 'usable' ? lease.proof.checks : [] }
    : verificationOf(state, lease.checkedAtMs ?? null, checksFor(lease.properties?.proof?.checks, { sse: lease.sseChecked === true, origin: lease.origin ?? null }));
  verification.observedAt=verification.checkedAt??null;
  verification.subject=lease.proofSubject??null;
  return view({ target: lease.target, bindTarget: lease.bindTarget, expiresAt: lease.expiresAt ?? (Number.isFinite(lease.expiresAtMs) ? iso(lease.expiresAtMs) : undefined), validUntil: lease.proof?.validUntil ?? lease.ingress?.validUntil, facts: lease.facts, now, handle, origin: lease.origin ?? null, published: state === 'usable' ? lease.origin ?? null : null, state, ownership: 'gozar-owned',
    properties: lease.properties ? completeProperties(lease.properties) : lease.properties, ingress: lease.ingress ?? null, verification,
    limits: limitsOf(lease.limits, 5_000), cleanup: lease.cleanup?.state === 'debt' ? { ...lease.cleanup, state: 'unconfirmed' } : lease.cleanup ?? { state: 'none' } });
}

export function releasedView(last, handle) {
  const base = last ?? view({ handle, origin: null, published: null, state: 'released', ownership: handle.kind === 'external' ? 'external-owned' : 'gozar-owned',
    properties: unknownProperties(), verification: proven('unverified', null, []), limits: { recommendedPollIntervalMs: 60_000, idleTimeoutMs: null } });
  return enrichRoute({ ...base, state: 'released', published: null, ingress: null, cleanup: { state: 'confirmed' }, verification: proven('unverified', base.verification.checkedAt, []) });
}

// --- Dispatch -----------------------------------------------------------------------------------

/** The declared properties of one adapter for one usage kind ('durable' or 'session'), or unknown ones when the adapter is gone. */
export async function propertiesFor(adapterId, deps, kind) {
  const adapters = deps.adapters ?? await (await import('./adapter-runtime.mjs')).loadAdapters();
  const adapter = adapters.find(item => item.id === adapterId);
  return adapter ? { properties: completeProperties(adapter.definition.capabilities, adapter.definition, kind), facts: structuredClone(adapter.definition.facts ?? []) } : { properties: unknownProperties() };
}

const defaults = {
  durable: {
    async status({ home, handle }, { adapters } = {}) {
      const { statusRoutes } = await import('./durable-route.mjs');
      const route = (await statusRoutes({ routeId: handle.id, home }, { adapters })).routes[0];
      if (!route) throw gozarError('route_not_found', `No durable route ${handle.id}`);
      return route;
    },
    async close({ home, handle }, { adapters } = {}) {
      const { releaseRoute } = await import('./durable-route.mjs');
      return releaseRoute({ routeId: handle.id, mode: 'remove', home, expectedGeneration: handle.generation }, { adapters });
    },
  },
  session: {
    async status({ home, handle }) {
      const { control } = await import('./daemon.mjs');
      const [directory, sessionId] = splitSession(handle.id);
      let reply;
      try { reply = await control(join(home, directory), { type: 'status' }, 30_000); }
      catch (cause) { if(cause.code&&cause.code!=='ENOENT'&&cause.code!=='ECONNREFUSED')throw cause;throw gozarError('route_not_found', `No running session ${handle.id}`, null, cause); }
      if (sessionId && reply.snapshot?.sessionId !== sessionId) throw gozarError('route_conflict', 'The session was replaced; this handle is stale');
      return reply;
    },
    async close({ home, handle }) {
      const { stopSession } = await import('./daemon.mjs');
      const [name,sessionId]=splitSession(handle.id),directory=join(home,name);
      if(sessionId){const bootstrap=await readRecord(join(directory,'bootstrap.json'));const recorded=bootstrap.sessionId??(await readRecord(join(directory,'session.json'))).snapshot?.sessionId;if(recorded!==sessionId)throw gozarError('route_conflict','The session was replaced; this handle is stale');}
      return stopSession(directory);
    },
  },
  async attached() { return import('./attached-route.mjs'); },
  external: {
    async status({ home, handle }) {
      const { statusServices } = await import('./service.mjs');
      const route = (await statusServices({ home, origin: handle.id })).routes.find(item => item.ownership === 'external-owned');
      if (!route) throw gozarError('route_not_found', 'No external service record for this origin');
      return route;
    },
    async close({ home, handle }) {
      const { removeService } = await import('./service.mjs');
      return removeService({ origin: handle.id, home });
    },
  },
};
export const splitSession = id => { const at = id.indexOf(':'); return at < 0 ? [id, null] : [id.slice(0, at), id.slice(at + 1)]; };

/** Fresh proof for one handle. An external service is read with handle {kind:'external', id:<origin>}. */
export async function routeStatus(request, deps = {}) {
  const handle = checkRef(request);
  const now = deps.now?.() ?? Date.now();
  try {
    switch (handle.kind) {
      case 'durable': {
        const reply = await (deps.durable ?? defaults.durable).status(request, { adapters: deps.adapters });
        if (Number.isInteger(reply.generation) && reply.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        return projectDurable(reply, { handle, now, ...await propertiesFor(reply.adapterId, deps, 'durable') });
      }
      case 'session': {
        const reply = await (deps.session ?? defaults.session).status(request);
        return projectSession(reply, { handle, now, ...await propertiesFor(reply.snapshot?.adapterId, deps, 'session') });
      }
      case 'attached': return await (deps.attached ?? await defaults.attached()).attachedStatus(request, deps.attachedDeps);
      case 'external': return projectExternal(await (deps.external ?? defaults.external).status(request), { handle, now });
    }
  } catch (error) { throw normalizeError(error); }
}

/** Ends one route. Durable, session and attached routes are removed; an external record loses its metadata only. */
export async function closeRoute(request, deps = {}) {
  const handle = checkRef(request);
  if (request.mode !== 'remove') throw gozarError('invalid_input', "closeRoute mode must be 'remove'");
  const now = deps.now?.() ?? Date.now();
  try {
    switch (handle.kind) {
      case 'durable': {
        let before;
        try { before = await routeStatus({ home: request.home, handle }, deps); }
        catch { /* Exact retained ownership is checked again by release; fresh proof is not cleanup authority. */ }
        const reply = await (deps.durable ?? defaults.durable).close(request, { adapters: deps.adapters });
        const debt = reply?.cleanupDebt ?? null;
        return { ...releasedView(before, handle), state: debt ? 'uncertain' : 'released', cleanup: debt ? { state: 'unconfirmed', message: debtMessage(debt) } : { state: 'confirmed' }, routeState: debt ? 'cleanup-unconfirmed' : 'inactive' };
      }
      case 'session': {
        let before;try{before=await routeStatus({home:request.home,handle},deps);}catch{}
        const reply = await (deps.session ?? defaults.session).close(request);
        if(reply.snapshot?.sessionId&&splitSession(handle.id)[1]&&reply.snapshot.sessionId!==splitSession(handle.id)[1])throw gozarError('route_conflict','The session was replaced; this handle is stale');
        const stopped = projectSession(reply, { handle, now, properties: before?.properties??(await propertiesFor(reply.snapshot?.adapterId,deps,'session')).properties });
        return stopped.state === 'released' ? { ...releasedView(before, handle), cleanup: stopped.cleanup } : { ...stopped, ingress: null };
      }
      case 'attached': return await (deps.attached ?? await defaults.attached()).closeAttachedRoute(request, deps.attachedDeps);
      case 'external': {
        const before = await routeStatus({ home: request.home, handle }, deps);
        await (deps.external ?? defaults.external).close(request);
        return releasedView(before, handle);
      }
    }
  } catch (error) { throw normalizeError(error); }
}

/** Pauses a durable route without releasing its address or consent. */
export async function suspendRoute(request, deps = {}) {
  const handle = checkRef(request);
  if (handle.kind !== 'durable') throw gozarError('unsupported', 'Only durable routes can be suspended');
  const { suspendRoute: suspend } = await import('./durable-route.mjs');
  const reply = await suspend({ home: request.home, routeId: handle.id, expectedGeneration: handle.generation }, { adapters: deps.adapters });
  return projectDurable(reply.route, { handle, ...await propertiesFor(reply.route.adapterId, deps, 'durable') });
}
