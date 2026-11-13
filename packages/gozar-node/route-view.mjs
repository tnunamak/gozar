// Consumer-side route views: errors an app may see, projections of every route kind to RouteView,
// and routeStatus / closeRoute, which dispatch on handle.kind. Apps never learn which provider
// answered; provider diagnostics stay on error.cause.
import { join } from 'node:path';

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
  address: { stability: 'unknown', scope: 'owner-managed', conditions: [] },
  cost: { kind: 'unknown', summary: 'Cost is not known to Gozar', currency: null, amount: null, period: null },
  needsAccount: null, lifetimes: ['durable'], supervision: 'host-supervised',
  protocols: { sse: false, streamableHttp: false, oauthDcr: false },
});

const iso = ms => new Date(ms).toISOString();
const STATES = new Set(['creating', 'usable', 'unverified', 'unknown', 'lost', 'address_changed', 'uncertain', 'releasing', 'released', 'handing-back']);
const verificationOf = (state, checkedAtMs) => ({ status: state === 'usable' ? 'verified' : 'unverified', checkedAt: checkedAtMs === null ? null : iso(checkedAtMs) });
const debtMessage = debt => typeof debt === 'string' ? debt : debt?.message ?? debt?.reason ?? 'Cleanup is incomplete';

function view({ handle, origin, published, state, ownership, properties, ingress = null, verification, limits, cleanup = { state: 'none' } }) {
  return { schemaVersion: 1, handle: { kind: handle.kind, id: handle.id, generation: handle.generation }, origin, published, state, ownership,
    properties, ingress, verification, limits, cleanup };
}
const limitsOf = (limits, fallbackPollMs, idleTimeoutMs = null) => ({
  recommendedPollIntervalMs: limits?.recommendedPollIntervalMs ?? fallbackPollMs, idleTimeoutMs: limits?.idleTimeoutMs ?? idleTimeoutMs });

/** From the durable engine's reply: a record view that already names its state, origin and verification. */
export function projectDurable(reply, { handle, properties, ingress = null, limits, now = Date.now() }) {
  const state = STATES.has(reply.state) ? reply.state : 'unknown';
  const published = state === 'usable' && typeof reply.origin === 'string' ? reply.origin : null;
  const checkedAt = typeof reply.verification?.checkedAt === 'string' ? Date.parse(reply.verification.checkedAt) : null;
  return view({ handle, origin: reply.origin ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification: { status: reply.verification?.status === 'verified' && state === 'usable' ? 'verified' : 'unverified', checkedAt: Number.isFinite(checkedAt) ? iso(checkedAt) : null },
    limits: limitsOf(limits, 60_000, reply.idleTimeoutMs), cleanup: reply.cleanupDebt ? { state: 'debt', message: debtMessage(reply.cleanupDebt) } : { state: 'none' } });
}

const PHASES = { idle: 'creating', detecting: 'creating', planned: 'creating', preflight: 'creating', persisting: 'creating', starting: 'creating',
  validating: 'unverified', 'transport-ready': 'unverified', 'candidate-ready': 'unverified', 'published-ready': 'usable', degraded: 'unverified',
  stopping: 'releasing', 'cleanup-pending': 'uncertain', stopped: 'released', failed: 'lost', blocked: 'unknown', unknown: 'unknown' };

/** From a session snapshot (the controller's status reply). Published only while the core says published-ready. */
export function projectSession(reply, { handle, properties, ingress = null, limits, now = Date.now() }) {
  const snapshot = reply.snapshot ?? {};
  const state = PHASES[snapshot.phase] ?? 'unknown';
  const published = state === 'usable' && typeof snapshot.published === 'string' ? snapshot.published : null;
  const debt = state === 'uncertain' || reply.localCleanupFailures?.length;
  return view({ handle, origin: snapshot.published ?? snapshot.candidate ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification: verificationOf(state, state === 'usable' ? now : null), limits: limitsOf(limits, 5_000),
    cleanup: debt ? { state: 'debt', message: 'Cleanup is incomplete; stop the route again' } : { state: 'none' } });
}

/** From an external service record (owner-managed ingress). Privacy and stability stay unknown. */
export function projectExternal(record, { handle, now = Date.now() }) {
  const verified = record.verification?.status === 'verified';
  const checkedAt = typeof record.verification?.checkedAt === 'string' ? Date.parse(record.verification.checkedAt) : now;
  return view({ handle, origin: record.origin, published: verified ? record.origin : null, state: verified ? 'usable' : 'unverified',
    ownership: 'external-owned', properties: unknownProperties(), verification: { status: verified ? 'verified' : 'unverified', checkedAt: iso(Number.isFinite(checkedAt) ? checkedAt : now) },
    limits: limitsOf(null, 60_000) });
}

/** From an attached lease record kept by its controller. */
export function projectAttached(lease, { handle, now = Date.now() }) {
  const state = STATES.has(lease.state) ? lease.state : 'unknown';
  return view({ handle, origin: lease.origin ?? null, published: state === 'usable' ? lease.origin ?? null : null, state, ownership: 'gozar-owned',
    properties: lease.properties, ingress: lease.ingress ?? null, verification: verificationOf(state, state === 'usable' ? lease.checkedAtMs ?? now : lease.checkedAtMs ?? null),
    limits: limitsOf(lease.limits, 5_000), cleanup: lease.cleanup ?? { state: 'none' } });
}

export function releasedView(last, handle) {
  const base = last ?? view({ handle, origin: null, published: null, state: 'released', ownership: handle.kind === 'external' ? 'external-owned' : 'gozar-owned',
    properties: unknownProperties(), verification: { status: 'unverified', checkedAt: null }, limits: { recommendedPollIntervalMs: 60_000, idleTimeoutMs: null } });
  return { ...base, state: 'released', published: null, ingress: null, verification: { status: 'unverified', checkedAt: base.verification.checkedAt } };
}

// --- Dispatch -----------------------------------------------------------------------------------

export async function propertiesFor(adapterId, deps) {
  const adapters = deps.adapters ?? await (await import('./adapter-runtime.mjs')).loadAdapters();
  const adapter = adapters.find(item => item.id === adapterId);
  return adapter ? { properties: adapter.definition.capabilities } : { properties: unknownProperties() };
}

const defaults = {
  durable: {
    async status({ home, handle }) {
      const { statusRoutes } = await import('./durable-route.mjs');
      const route = (await statusRoutes({ routeId: handle.id, home })).routes[0];
      if (!route) throw gozarError('route_not_found', `No durable route ${handle.id}`);
      return route;
    },
    async close({ home, handle }) {
      const { releaseRoute } = await import('./durable-route.mjs');
      return releaseRoute({ routeId: handle.id, mode: 'remove', home, expectedGeneration: handle.generation });
    },
  },
  session: {
    async status({ home, handle }) {
      const { control } = await import('./daemon.mjs');
      const [directory, sessionId] = splitSession(handle.id);
      let reply;
      try { reply = await control(join(home, directory), { type: 'status' }, 30_000); }
      catch (cause) { throw gozarError('route_not_found', `No running session ${handle.id}`, null, cause); }
      if (sessionId && reply.snapshot?.sessionId !== sessionId) throw gozarError('route_conflict', 'The session was replaced; this handle is stale');
      return reply;
    },
    async close({ home, handle }) {
      const { stopSession } = await import('./daemon.mjs');
      return stopSession(join(home, splitSession(handle.id)[0]));
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
        const reply = await (deps.durable ?? defaults.durable).status(request);
        if (Number.isInteger(reply.generation) && reply.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        return projectDurable(reply, { handle, now, ...await propertiesFor(reply.adapterId, deps) });
      }
      case 'session': {
        const reply = await (deps.session ?? defaults.session).status(request);
        return projectSession(reply, { handle, now, ...await propertiesFor(reply.snapshot?.adapterId, deps) });
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
        const before = await routeStatus({ home: request.home, handle }, deps);
        const reply = await (deps.durable ?? defaults.durable).close(request);
        const debt = reply?.cleanupDebt ?? null;
        return { ...releasedView(before, handle), state: debt ? 'uncertain' : 'released', cleanup: debt ? { state: 'debt', message: debtMessage(debt) } : { state: 'none' } };
      }
      case 'session': {
        const before = await routeStatus({ home: request.home, handle }, deps);
        const reply = await (deps.session ?? defaults.session).close(request);
        const stopped = projectSession(reply, { handle, now, properties: before.properties });
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
