// The managed forward lifecycle engine (packages/gozar-node/forward.mjs) behind the `forward` contract
// (docs/library-ux.md). Bounded transition invariants, written before the effects they govern:
//   1. No publication without current approval and current verified proof.
//   2. No resurrection after a stop; a later explicit forward is a new run and generation.
//   3. No replacement of a run that owes cleanup; the debt is persisted before any notification.
//   4. One live manager per app (a dedicated process lease; a CAS commit is not a lifetime claim).
//   5. No lost replay: the first 'change' subscriber receives the persisted startup change and every
//      change observed since forward returned, in order; 'down' replays the current outage.
// TLA+/TLC: no TLC toolchain is present on PATH (checked `command -v tlc tla2tools TLC`; only a java
// shim exists, no TLA+ tools), matching the forward-state foundation's finding. No model is claimed;
// instead the stop/reconnect/approval interleavings are replayed as deterministic latched tests below.
//
// The stand-in section is clearly labeled: a RECORDING SDK STAND-IN (scripted candidates/views, no
// provider semantics) exercises ONLY the engine's orchestration interleavings. Every publication,
// consent redemption, proof and cleanup in the "real SDK" section runs through the actual configured
// route API (createRouteApi) with the shipped testing fixtures (fakeRegistry/fakeReadContext), the
// real durable engine and — for the session kind — a real detached generic controller.
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createForward } from '../../packages/gozar-node/forward.mjs';
import { openForwardState } from '../../packages/gozar-node/forward-state.mjs';
import { consentReview } from '../../packages/gozar-node/consent-facts.mjs';
import { fakeRegistry, fakeReadContext, createRouteApi as createTestingRouteApi } from '../../packages/gozar-node/testing.mjs';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { stopController } from '../../packages/gozar-node/controller-start.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const ISO = '2026-11-26T10:00:00.000Z';
const RUN_X = '9e9e9e9e-9999-4999-8999-999999999999';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, ms = 4000, step = 20) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) return null; await sleep(step); }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function scratch(t) {
  await mkdtemp(join(homedir(), '.tmp'), { recursive: true }).catch(() => {});
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-forward-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

/** A real loopback listener the host owns; forward() refuses a port where nothing listens. */
async function loopbackApp(t) {
  const app = http.createServer((req, res) => res.end('fixture-app'));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections?.(); app.close(resolve); }));
  return app.address().port;
}

const stateOf = (home, app = 'faravan') => openForwardState({ home, app });

async function rejects(promise, code, label) {
  try { await promise; } catch (error) {
    if (code) assert.equal(error.code, code, `${label ?? 'rejected'}: expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`${label ?? 'promise'} resolved; expected rejection`);
}

// --- Catalog-shaped candidates with REAL consent snapshots (consent-v1 canonicalization) ------------

const traffic = (tlsTermination, providerCanReadPayload) => ({ tlsTermination, providerCanReadPayload,
  readers: tlsTermination === 'provider' ? ['fixture edge'] : [], metadataVisibleTo: [], evidenceRef: 'fixture' });
const properties = (over = {}) => ({ reach: 'internet', transport: 'https', traffic: traffic('provider', true),
  address: { stability: 'ephemeral', scope: 'fixture', conditions: [], ports: null },
  cost: { kind: 'free', summary: 'Fixture cost.' }, needsAccount: false, lifetimes: ['session'], supervision: 'controller',
  protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'public', checks: ['tls', 'nonce'] }, ...over });

function candidate({ providerId = 'fixture-run', kind = 'session', rank = 1, needsAccount = false,
    disclosureRevision = 'disc-1', token = null, action = null, trafficShape = traffic('provider', true),
    target = '127.0.0.1:18765', expiresAt = new Date(Date.now() + 3_600_000).toISOString() } = {}) {
  const disclosures = { ownership: 'gozar-owned', reach: 'internet', transport: 'https', traffic: trafficShape,
    address: { stability: 'ephemeral', scope: 'fixture', conditions: [], ports: null },
    cost: { kind: 'free', summary: 'Fixture cost.' }, lifetimes: [kind === 'durable' ? 'durable' : 'session'],
    supervision: 'controller', protocols: { sse: true, streamableHttp: true, oauthDcr: true },
    disclosure: { revision: disclosureRevision, text: `Fixture disclosure ${disclosureRevision}.`, links: [] } };
  const review = consentReview({
    scope: { kind: 'route', registryId: 'reg-test', providerId, configurationRevision: 'cfg-1', scopeId: 'scope-1',
      query: { usage: kind === 'durable' ? { kind: 'durable', routeId: 'forward-faravan' } : { kind, lifetimeMs: 14_400_000 },
        reach: 'internet', transport: 'https', target, expectedOrigin: null } },
    typedDisclosures: disclosures, facts: [] });
  const consent = { scope: review.canonicalInput.scope, consentFactsDigest: review.consentFactsDigest,
    facts: review.canonicalInput.facts, disclosures: review.canonicalInput.typedDisclosures };
  return {
    providerId, ownership: 'gozar-owned', name: `cand_${providerId}`, preferenceRef: `pref_${providerId}`, rank,
    eligible: !action, unmet: action ? [{ requirement: 'setup', actual: 'action-required', reasonCode: 'not_met' }] : [],
    display: { label: `Fixture ${providerId}`, description: 'Fixture candidate.', needs: 'Fixture prerequisites.' },
    properties: properties({ needsAccount, traffic: trafficShape }), prerequisites: [], facts: [],
    availability: Object.fromEntries(['durable', 'session', 'attached'].map(
      name => [name, { state: name === kind ? 'available' : 'unsupported', reason: 'fixture-usage' }])),
    configuration: { revision: 'cfg-1', scopeId: 'scope-1', inputRequirements: [], values: {}, credentials: {}, actions: [] },
    setup: action ? { state: 'action-required', actions: [action] } : { state: 'ready', actions: [] },
    disclosure: { revision: disclosureRevision, text: `Fixture disclosure ${disclosureRevision}.`, links: [] },
    consentFactsDigest: review.consentFactsDigest, consent,
    candidateToken: token ?? `tok-${providerId}`, expiresAt,
  };
}

const setupAction = (over = {}) => ({ id: 'ssh-install', kind: 'instructions', label: 'Install the OpenSSH client',
  instructions: 'Install the OpenSSH client.', disclosure: { revision: 'disc-act', text: 'Action disclosure.', links: [] },
  digest: 'a1b2c3', ...over });

/** A setup action's real consent snapshot (setupConsentReview shape), as the SDK's decorated actions carry. */
function setupConsent(action) {
  const { consent, review, step, href, ...safe } = action;
  const snapshot = consentReview({
    scope: { kind: 'setup', registryId: 'reg-test', scopeId: 'scope-1', providerId: 'fixture-run',
      configurationRevision: 'cfg-1', draftId: null, actionId: action.id,
      disclosureRevision: action.disclosure.revision, actionDigest: action.digest },
    typedDisclosures: { action: safe }, facts: [] });
  return { scope: snapshot.canonicalInput.scope, consentFactsDigest: snapshot.consentFactsDigest,
    facts: snapshot.canonicalInput.facts, disclosures: snapshot.canonicalInput.typedDisclosures };
}

/** A RouteView-shaped observation; only the fields the engine reads. */
function view({ handle, url = 'https://one.fixture.example', state = 'usable', target = '127.0.0.1:18765', published = url }) {
  return { handle, state, ownership: 'gozar-owned', published, origin: url,
    verification: { status: state === 'usable' ? 'verified' : 'unverified', checkedAt: ISO },
    cleanup: { state: 'none' }, hostConfiguration: { target: { known: true, value: target } }, properties: properties() };
}

// --- The RECORDING SDK STAND-IN: orchestration interleavings only, never provider semantics --------

/** A queue of observed views the stand-in watch yields; abort-aware so close() cancels its timers. */
function eventQueue() {
  const pending = [], waiting = [];
  let closed = false;
  const pull = signal => {
    const queued = pending.shift();
    if (queued) return Promise.resolve({ value: queued });
    if (closed) return Promise.resolve({ value: null });
    return new Promise(resolve => {
      const done = value => { signal?.removeEventListener('abort', onAbort); resolve({ value }); };
      const onAbort = () => done(null);
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      waiting.push({ resolve: done });
    });
  };
  return { pull, push(value) { const waiter = waiting.shift(); if (waiter) waiter.resolve(value); else pending.push(value); },
    close() { closed = true; for (const waiter of waiting.splice(0)) waiter.resolve(null); } };
}

/**
 * The scripted world behind the stand-in. `mode` drives the catalog: 'ready' (selectable), 'needs-setup'
 * (one offered action), 'unsatisfied' (fixed rows). Everything else is a per-test switch.
 */
function standInWorld({ kindsOffered = ['session'], providerId = 'fixture-run', needsAccount = false,
    disclosureRevision = 'disc-1', trafficShape = traffic('provider', true), expiresAt = null, url = 'https://one.fixture.example' } = {}) {
  const world = { mode: 'ready', serial: 0, tokenSerial: 0, routes: new Map(), closeOutcome: 'confirmed',
    queue: eventQueue(), url, allocateLatch: null,
    offered: (kind, request) => {
      if (!kindsOffered.includes(kind)) return [];
      if (world.mode === 'needs-setup') return [candidate({ providerId, kind, needsAccount, disclosureRevision,
        trafficShape, action: { ...setupAction(), consent: setupConsent(setupAction()) }, token: null, target: request?.target })];
      if (world.mode === 'unsatisfied') return [
        candidate({ providerId: 'tunnl.gg', kind: 'session', needsAccount: true, token: `tok-tunnl-${world.serial}` }),
        candidate({ providerId: 'localhost.run', kind: 'session', trafficShape: traffic('unknown', null), token: `tok-local-${world.serial}` }),
      ];
      return [candidate({ providerId, kind, needsAccount, disclosureRevision, trafficShape,
        token: `tok-${++world.tokenSerial}`, expiresAt: expiresAt ?? undefined, target: request?.target })];
    } };
  const api = {
    async catalogRoutes(request) {
      const kind = request.usage.kind;
      if (request.providerId !== undefined) {
        return { schemaVersion: 2, candidates: world.offered(kind, request).filter(row => row.providerId === request.providerId) };
      }
      return { schemaVersion: 2, candidates: kind === 'durable' ? [] : world.offered(kind, request) };
    },
    async ensureRoute(request) { return allocate('durable', request); },
    async expose(request) { return allocate(request.usage.kind, request); },
    async routeStatus(request) {
      const route = world.routes.get(request.handle.id);
      if (!route) throw Object.assign(new Error('The managed route is gone'), { code: 'route_not_found' });
      return view({ handle: request.handle, url: route.url, target: route.target });
    },
    async closeRoute(request) {
      if (world.closeOutcome !== 'confirmed') return { cleanup: { state: 'unconfirmed' } };
      world.routes.delete(request.handle.id);
      return { cleanup: { state: 'confirmed' }, handle: request.handle };
    },
    async *watchRoutes(request) {
      while (!request.signal?.aborted) {
        const pulled = await world.queue.pull(request.signal);
        if (!pulled || pulled.value === null || request.signal?.aborted) return;
        yield { route: pulled.value };
      }
    },
    async runSetupAction(request) {
      world.setupRan = request;
      if (request.operationId !== undefined) return operationView(world, request);
      world.mode = 'ready';
      return { schemaVersion: 1, state: 'complete', nextAction: null };
    },
    async readSetupOperation(request) { return operationView(world, request); },
    async cancelSetupOperation() { world.cancelled = true; return { schemaVersion: 1, state: 'cancelled', revision: 0, nextAction: null, evidence: { known: false, reason: 'fixture' }, resources: [] }; },
    async storeSecret(request) { return { handle: `sec_${request.inputId}`, configurationRevision: 'cfg-1', scopeId: request.scopeId }; },
  };
  const calls = [];
  const recorded = new Proxy(api, { get(target, name) {
    const value = target[name];
    if (typeof value !== 'function' || name === 'watchRoutes') return value;
    return async (...args) => { const result = await value(...args); calls.push([name, structuredClone({ request: args[0], result })]); return result; };
  } });
  async function allocate(kind, request) {
    world.allocated = request;
    world.allocateLatch?.resolve(request);
    if (world.holdAllocate) await world.holdAllocate.promise;
    const handle = { kind, id: `s-${++world.serial}`, generation: 1 };
    const routeUrl = world.nextUrl ?? world.url;
    world.routes.set(handle.id, { url: routeUrl, target: request.target });
    return view({ handle, url: routeUrl, target: request.target });
  }
  return { world, api: recorded, calls };
}

function operationView(world, request) {
  const revision = (world.operationRevision ?? 0) + 1;
  world.operationRevision = revision;
  return { schemaVersion: 1, operationId: request.operationId, revision, state: 'complete',
    evidence: { known: false, reason: 'fixture' }, nextAction: null, resources: [],
    scope: { registryId: 'reg-test', scopeId: 'scope-1', providerId: 'fixture-run', configurationRevision: 'cfg-1', draftId: null } };
}

async function standIn(t, options = {}) {
  const home = await scratch(t);
  const port = await loopbackApp(t);
  const stand = standInWorld({ url: 'https://one.fixture.example', ...options });
  return { home, port, ...stand, forward: createForward(stand.api, { home }), state: () => stateOf(home).read() };
}

const noBearerPlumbing = (value, label) => {
  const text = JSON.stringify(value);
  for (const secret of ['candidateToken', 'consentFactsDigest', 'tok-', 'Bearer', 'secretHandle'])
    assert.ok(!text.includes(secret), `${label} must not carry ${secret}: ${text.slice(0, 200)}`);
};

// --- The pending-to-published journey ---------------------------------------------------------------

test('stand-in: one actionable step, then consent, then a published managed resource', async t => {
  const s = await standIn(t);
  s.world.mode = 'needs-setup';
  const first = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(first.needsAction.step, 'ssh-install');
  assert.equal(first.needsAction.kind, 'instructions');
  assert.equal(first.needsAction.answer.type, 'decision');
  noBearerPlumbing(first.needsAction, 'the setup descriptor');

  const second = await first.resume({ approve: true });
  assert.equal(second.needsAction.step, 'approve-route');
  assert.equal(second.needsAction.kind, 'consent');
  assert.equal(second.needsAction.disclosure.revision, 'disc-1');
  noBearerPlumbing(second.needsAction, 'the consent descriptor');

  const third = await second.resume({ approve: true });
  assert.equal(third.needsAction, null);
  assert.equal(third.url, 'https://one.fixture.example');
  assert.equal(third.kind, 'session');
  assert.equal(third.lifetime, 'session');
  assert.equal(third.provider.id, 'fixture-run');
  assert.equal(third.provider.traffic.providerCanReadPayload, true);
  noBearerPlumbing(third, 'the published resource');

  // The setup ran through the SDK with the action's own consent receipt; the allocation spent the
  // FRESH re-observed token, not the one observed before the UI await, under a fresh operation id.
  const setup = s.calls.find(([name]) => name === 'runSetupAction');
  assert.equal(setup[1].request.actionId, 'ssh-install');
  assert.equal(setup[1].request.approval.digest, 'a1b2c3');
  assert.equal(setup[1].request.secretHandle, undefined);
  const exposed = s.calls.find(([name]) => name === 'expose');
  assert.equal(exposed[1].request.approval.candidateToken, 'tok-2', 'the re-observed current grant');
  assert.match(exposed[1].request.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(exposed[1].request.usage.kind, 'session');

  const record = await s.state();
  assert.equal(record.run.phase, 'active');
  assert.deepEqual(record.run.handle, { kind: 'session', id: 's-1', generation: 1 });
  assert.equal(record.approval.provider, 'fixture-run');
  assert.match(record.approval.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(record.approval.factsDigest, /^consent-v1:[0-9a-f]{64}$/);
  assert.deepEqual(record.origin, { url: 'https://one.fixture.example', observedAt: record.origin.observedAt });
  assert.equal(record.cleanup.certainty, 'settled');
  await third.close();
  assert.equal((await s.state()).run.phase, 'stopped');
});

test('stand-in: a denied consent stops the run cleanly and never allocates', async t => {
  const s = await standIn(t);
  const first = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(first.needsAction.step, 'approve-route');
  await rejects(first.resume({ approve: false }), 'stopped_by_user');
  const record = await s.state();
  assert.equal(record.run.phase, 'stopped');
  assert.equal(record.cleanup.certainty, 'settled');
  assert.equal(record.approval, null, 'a denial saves no assent');
  assert.ok(!s.calls.some(([name]) => name === 'expose'), 'nothing was allocated');
  // close() on the dismissed UI is safe and idempotent; resume after close is fenced.
  await first.close();
  await first.close();
  await rejects(first.resume({ approve: true }), 'stopped_by_user');
  // A later explicit forward is a NEW run: it asks again, it does not resurrect.
  const second = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(second.needsAction.step, 'approve-route');
  const record2 = await s.state();
  assert.equal(record2.run.generation, 2);
  assert.notEqual(record2.run.id, record.run.id);
});

test('stand-in: no match rejects with complete per-provider diagnostics and no allocation', async t => {
  const s = await standIn(t);
  s.world.mode = 'unsatisfied';
  const error = await rejects(s.forward({ app: 'faravan', port: s.port, policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } }),
    'requirements_unsatisfied');
  assert.equal(error.nextAction, null);
  assert.deepEqual(error.unmet, [
    { provider: 'tunnl.gg', kind: 'session', missing: ['account'], policyChanges: { accounts: 'allow-setup' } },
    { provider: 'localhost.run', kind: 'session', missing: ['traffic-readability'], policyChanges: null },
  ]);
  assert.ok(!s.calls.some(([name]) => name === 'expose'));
});

test('stand-in: unchanged assent is reused with a fresh current grant and no second consent', async t => {
  const s = await standIn(t);
  const first = await s.forward({ app: 'faravan', port: s.port });
  const second = await first.resume({ approve: true });
  const runOne = s.calls.find(([name]) => name === 'expose')[1].request;
  await second.close();
  const third = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(third.needsAction, null, 'the exact same disclosure and scope needs no second consent click');
  assert.equal(third.url, 'https://one.fixture.example');
  const runTwo = s.calls.filter(([name]) => name === 'expose').at(-1)[1].request;
  assert.notEqual(runTwo.approval.candidateToken, runOne.approval.candidateToken, 'a fresh single-use grant, never a stored bearer');
  assert.notEqual(runTwo.operationId, runOne.operationId, 'a fresh operation id per allocation');
  const record = await s.state();
  assert.equal(record.run.generation, 2);
  await third.close();
});

test('stand-in: a changed disclosure is re-offered, never silently reused', async t => {
  const s = await standIn(t, { disclosureRevision: 'disc-1' });
  const first = await s.forward({ app: 'faravan', port: s.port });
  await (await first.resume({ approve: true })).close();
  const saved = (await s.state()).approval;
  // The provider's disclosure moves before the next launch.
  s.world.offered = (kind, request) => [candidate({ kind, disclosureRevision: 'disc-2', token: `tok-x-${++s.world.tokenSerial}` })];
  const second = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(second.needsAction.step, 'approve-route');
  assert.equal(second.needsAction.disclosure.revision, 'disc-2');
  await rejects(second.resume({ approve: false }), 'stopped_by_user');
  // Declining preserves the earlier saved assent; stopping is not revoking.
  assert.deepEqual((await s.state()).approval, saved);
});

test('stand-in: an expired grant is not current authority and nothing is exposed', async t => {
  const s = await standIn(t, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
  await rejects(s.forward({ app: 'faravan', port: s.port }), 'provider_unavailable');
  assert.ok(!s.calls.some(([name]) => name === 'expose'), 'an expired candidate token was never spent');
});

// --- The change/down/back replay contract -------------------------------------------------------------

test('stand-in: a change before the first subscriber is replayed, then live changes arrive in order', async t => {
  const s = await standIn(t);
  const resource = await (await s.forward({ app: 'faravan', port: s.port })).resume({ approve: true });
  // The route's origin moves BEFORE the app subscribes (the engine owns the subscription gap).
  s.world.routes.get('s-1').url = 'https://two.fixture.example';
  s.world.queue.push(view({ handle: { kind: 'session', id: 's-1', generation: 1 }, url: 'https://two.fixture.example' }));
  const originMoved = await waitFor(async () => (await s.state()).origin?.url === 'https://two.fixture.example');
  assert.ok(originMoved, 'the verified origin change was persisted');
  const seen = [];
  resource.on('change', event => seen.push(event));
  await sleep(50);
  assert.equal(seen.length, 1);
  assert.deepEqual({ oldOrigin: seen[0].oldOrigin, newOrigin: seen[0].newOrigin },
    { oldOrigin: 'https://one.fixture.example', newOrigin: 'https://two.fixture.example' });
  assert.ok(seen[0].at && !Number.isNaN(Date.parse(seen[0].at)));
  // A later live change is delivered after the replay, in order.
  s.world.routes.get('s-1').url = 'https://three.fixture.example';
  s.world.queue.push(view({ handle: { kind: 'session', id: 's-1', generation: 1 }, url: 'https://three.fixture.example' }));
  await waitFor(async () => seen.length === 2);
  assert.deepEqual(seen.at(-1), { oldOrigin: 'https://two.fixture.example', newOrigin: 'https://three.fixture.example', at: seen[1].at });
  await resource.close();
});

test('stand-in: down persists downSince, back preserves the outage observation, no events after close', async t => {
  const s = await standIn(t);
  const resource = await (await s.forward({ app: 'faravan', port: s.port })).resume({ approve: true });
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  const events = { change: [], down: [], back: [] };
  resource.on('change', e => events.change.push(e));
  resource.on('down', e => events.down.push(e));
  resource.on('back', e => events.back.push(e));
  await sleep(20);
  s.world.queue.push(view({ handle, state: 'unverified', published: null }));
  await waitFor(async () => events.down.length === 1);
  assert.ok(events.down[0].downSince);
  assert.equal((await s.state()).downSince, events.down[0].downSince, 'the outage is persisted before it is notified');
  s.world.queue.push(view({ handle, url: 'https://one.fixture.example' }));
  await waitFor(async () => events.back.length === 1);
  assert.equal(events.back[0].downSince, events.down[0].downSince, 'the back event preserves the outage start');
  assert.equal((await s.state()).downSince, null);
  // After close, no further observation is delivered, and late subscriptions are refused.
  s.world.queue.push(view({ handle, state: 'unverified', published: null }));
  await resource.close();
  s.world.queue.push(view({ handle, state: 'unverified', published: null }));
  await sleep(80);
  assert.equal(events.down.length, 1);
  assert.equal(events.back.length, 1);
  assert.throws(() => resource.on('change', () => {}), error => error.code === 'stopped_by_user');
});

// --- close against held approval and in-flight proof (deterministic latches) -------------------------

test('stand-in: close during a held approval fences the run and settles with nothing created', async t => {
  const s = await standIn(t);
  const first = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(first.needsAction.step, 'approve-route');
  await first.close();
  const record = await s.state();
  assert.equal(record.run.phase, 'stopped');
  assert.equal(record.cleanup.certainty, 'settled');
  assert.ok(!s.calls.some(([name]) => name === 'expose'));
  await rejects(first.resume({ approve: true }), 'stopped_by_user');
});

test('stand-in: close during an in-flight proof waits it out, then settles exactly what it created', async t => {
  const s = await standIn(t);
  s.world.holdAllocate = deferred();
  s.world.allocateLatch = deferred();
  const first = await s.forward({ app: 'faravan', port: s.port });
  const resuming = first.resume({ approve: true });
  await s.world.allocateLatch.promise;                 // the engine is inside the allocation now
  const closing = first.close();                      // the fence goes up mid-proof
  s.world.holdAllocate.resolve();                     // the late proof completes
  await rejects(resuming, 'stopped_by_user', 'the late proof cannot complete the run');
  await closing;
  const record = await s.state();
  assert.equal(record.run.phase, 'stopped');
  assert.equal(record.cleanup.certainty, 'settled');
  const closed = s.calls.filter(([name]) => name === 'closeRoute');
  assert.equal(closed.length, 1, 'the just-created route was removed exactly once');
  assert.deepEqual(closed[0][1].request.handle, { kind: 'session', id: 's-1', generation: 1 });
  assert.ok(!s.calls.some(([name]) => name === 'watchRoutes'), 'no watcher was started for a closed run');
});

// --- removal refusal, retained debt, and the restart it blocks ---------------------------------------

test('stand-in: refused removal persists cleanup debt, blocks a restart, and a retry settles it', async t => {
  const s = await standIn(t);
  const resource = await (await s.forward({ app: 'faravan', port: s.port })).resume({ approve: true });
  s.world.closeOutcome = 'unconfirmed';
  await rejects(resource.close(), 'cleanup_debt');
  const debt = await s.state();
  assert.equal(debt.run.phase, 'stopped');
  assert.equal(debt.cleanup.certainty, 'unconfirmed');
  assert.equal(debt.cleanup.debt.runId, debt.run.id);
  // A later forward reconciles the debt first and rejects while removal is still unconfirmed.
  await rejects(s.forward({ app: 'faravan', port: s.port }), 'cleanup_debt');
  const still = await s.state();
  assert.equal(still.cleanup.certainty, 'unconfirmed');
  assert.equal(still.cleanup.debt.runId, debt.cleanup.debt.runId, 'the exact recovery refs are retained');
  assert.equal(still.run.id, debt.run.id);
  // The provider confirms removal on retry; only then may a fresh run start.
  s.world.closeOutcome = 'confirmed';
  const next = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(next.needsAction, null, 'the settled debt admits a fresh run with reused assent');
  const record = await s.state();
  assert.equal(record.run.generation, 2);
  assert.equal(record.cleanup.certainty, 'settled');
  assert.notEqual(record.run.id, debt.run.id);
  await next.close();
});

// --- one manager per app, and apps stay isolated ------------------------------------------------------

test('stand-in: a second concurrent manager for the same app is fenced; other apps proceed', async t => {
  const s = await standIn(t);
  const first = await s.forward({ app: 'faravan', port: s.port });
  await rejects(s.forward({ app: 'faravan', port: s.port }), 'busy', 'a live manager owns the app lease');
  const other = await s.forward({ app: 'other-app', port: s.port });
  assert.equal(other.needsAction.step, 'approve-route', 'a different app is a different scope');
  await first.close();
  await other.close();
  assert.equal((await stateOf(s.home, 'faravan').read()).run.phase, 'stopped');
  assert.equal((await stateOf(s.home, 'other-app').read()).run.phase, 'stopped');
});

test('stand-in: closing one app removes only its own route and leaves the other untouched', async t => {
  const s = await standIn(t);
  const a = await (await s.forward({ app: 'app-a', port: s.port })).resume({ approve: true });
  s.world.nextUrl = 'https://two.fixture.example';
  const b = await (await s.forward({ app: 'app-b', port: s.port })).resume({ approve: true });
  assert.notEqual(a.url, b.url);
  await a.close();
  const handles = s.calls.filter(([name]) => name === 'closeRoute').map(([, entry]) => entry.request.handle.id);
  assert.deepEqual(handles, ['s-1'], 'only the closing app\'s route was removed');
  assert.ok(s.world.routes.has('s-2'), 'the other app\'s route is untouched');
  assert.equal((await stateOf(s.home, 'app-b').read()).run.phase, 'active');
  await b.close();
  assert.equal(s.calls.filter(([name]) => name === 'closeRoute').length, 2);
});

test('stand-in: an in-flight run without a handle is taken over, not resurrected', async t => {
  const home = await scratch(t);
  const port = await loopbackApp(t);
  // A manager died mid-step: the persisted run is awaiting with no route (a valid first record).
  await stateOf(home).commit({ run: { id: RUN_X, generation: 1, operationId: null, handle: null, provider: null, phase: 'awaiting' },
    approval: null, origin: { url: 'https://old.fixture.example', observedAt: ISO }, downSince: null,
    cleanup: { certainty: 'settled', debt: null } }, { expectedRevision: 0 });
  const stand = standInWorld();
  const forward = createForward(stand.api, { home });
  const first = await forward({ app: 'faravan', port });
  assert.equal(first.needsAction.step, 'approve-route');
  const second = await first.resume({ approve: true });
  assert.equal(second.needsAction, null);
  const record = await stateOf(home).read();
  assert.equal(record.run.id, RUN_X, 'the same run identity continues');
  assert.equal(record.run.generation, 1);
  assert.equal(record.run.phase, 'active');
  // The startup change (historical last-verified vs the newly verified origin) replays to the first subscriber.
  const seen = [];
  second.on('change', event => seen.push(event));
  await sleep(50);
  assert.deepEqual(seen.map(({ oldOrigin, newOrigin }) => ({ oldOrigin, newOrigin })),
    [{ oldOrigin: 'https://old.fixture.example', newOrigin: 'https://one.fixture.example' }]);
  await second.close();
});

// --- The REAL configured SDK: publication, cleanup, restart reuse ------------------------------------

/** The durable fake world: real catalog, real single-use tokens, real durable engine and rule store. */
async function durableWorld(t, { id = 'fw-real-durable' } = {}) {
  const home = await scratch(t);
  const registry = await fakeRegistry({ id, kinds: ['durable'], reach: 'internet', transport: 'https', dir: join(home, 'registry') });
  const port = await loopbackApp(t);
  const previous = process.env.GOZAR_HOME;
  process.env.GOZAR_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.GOZAR_HOME; else process.env.GOZAR_HOME = previous; });
  const api = createTestingRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
  return { home, port, registry, api, forward: createForward(api, { home }), id,
    store: () => readFile(join(home, 'registry', 'providers', id, 'store.json'), 'utf8').then(JSON.parse) };
}

test('real SDK: approved publication, exact cleanup, and restart reuse without a second consent', async t => {
  const w = await durableWorld(t);
  const first = await w.forward({ app: 'faravan', port: w.port });
  assert.equal(first.needsAction.step, 'approve-route');
  assert.equal(first.needsAction.disclosure.revision, `disc-${w.id}`);
  noBearerPlumbing(first.needsAction, 'the real consent descriptor');
  const second = await first.resume({ approve: true });
  assert.equal(second.needsAction, null);
  assert.equal(second.url, `https://a.${w.id}.invalid`);
  assert.equal(second.kind, 'durable');
  assert.equal(second.lifetime, 'lasting');
  assert.equal(second.provider.id, w.id);
  assert.equal(second.provider.traffic.tlsTermination, 'provider');
  noBearerPlumbing(second, 'the real published resource');
  const record = await stateOf(w.home).read();
  assert.equal(record.run.phase, 'active');
  assert.deepEqual(record.run.handle, { kind: 'durable', id: 'forward-faravan', generation: 1 });
  assert.match(record.approval.factsDigest, /^consent-v1:[0-9a-f]{64}$/);
  const ruleStore = await w.store();
  assert.ok(ruleStore.entries.a, 'the durable engine wrote its rule');
  await second.close();
  assert.equal((await stateOf(w.home).read()).run.phase, 'stopped');
  assert.deepEqual((await w.store()).entries, {}, 'the owned provider rule was removed');
  // Restart: the same exact disclosure and scope needs no second consent; the grant is fresh.
  const third = await w.forward({ app: 'faravan', port: w.port });
  assert.equal(third.needsAction, null, 'unchanged approved disclosure is reused across a restart');
  assert.equal(third.url, `https://a.${w.id}.invalid`);
  await third.close();
});

test('real SDK: a crashed manager is fenced while live, recovered after death, and closed by the next one', async t => {
  const w = await durableWorld(t);
  const childSource = `
import { createRouteApi, fakeReadContext } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'packages/gozar-node/testing.mjs')).href)};
import { createForward } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'packages/gozar-node/forward.mjs')).href)};
const api = createRouteApi({ manifest: ${JSON.stringify(w.registry.manifest)}, root: ${JSON.stringify(join(w.home, 'registry'))}, readContext: fakeReadContext({ home: ${JSON.stringify(w.home)} }) });
const forward = createForward(api, { home: ${JSON.stringify(w.home)} });
const result = await forward({ app: 'faravan', port: ${w.port}, onAction: () => ({ approve: true }) });
process.stdout.write('READY ' + result.url + '\\n');
await new Promise(() => {});
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource],
    { cwd: repoRoot, env: { ...process.env, GOZAR_HOME: w.home }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let out = '', err = '';
  child.stdout.on('data', b => { out += String(b); });
  child.stderr.on('data', b => { err += String(b); });
  const ready = await waitFor(() => out.includes('READY') ? out.trim() : null, 30000, 50);
  assert.ok(ready, `the child published: ${err}`);
  const url = ready.split(' ')[1];
  assert.equal(url, `https://a.${w.id}.invalid`);
  // While the child lives, its lease fences every other manager out.
  await rejects(w.forward({ app: 'faravan', port: w.port }), 'busy');
  const before = await stateOf(w.home).read();
  assert.equal(before.run.phase, 'active');
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  // The crashed manager's run is recovered as-is: no new consent, no new operation, same verified origin.
  let asked = 0;
  const recovered = await w.forward({ app: 'faravan', port: w.port, onAction: () => { asked++; return { approve: true }; } });
  assert.equal(asked, 0, 'recovery of an unchanged approved route needs no fresh consent');
  assert.equal(recovered.needsAction, null);
  assert.equal(recovered.url, url);
  const after = await stateOf(w.home).read();
  assert.equal(after.run.id, before.run.id, 'the same run identity is recovered, never resurrected');
  assert.equal(after.run.generation, before.run.generation);
  await recovered.close();
  assert.equal((await stateOf(w.home).read()).cleanup.certainty, 'settled');
  assert.deepEqual((await w.store()).entries, {});
});

// --- The REAL configured SDK, session kind: a detached generic controller ----------------------------

test('real SDK: a session publication runs through a real detached controller and closes confirmed', async t => {
  const home = await scratch(t);
  const port = await loopbackApp(t);
  const target = `127.0.0.1:${port}`;
  const registry = await fakeRegistry({ id: 'fw-real-session', kinds: ['attached', 'session'], reach: 'internet', transport: 'https', protocols: [] });
  t.after(() => registry.cleanup());
  const previous = process.env.GOZAR_HOME;
  process.env.GOZAR_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.GOZAR_HOME; else process.env.GOZAR_HOME = previous; });
  // The origin-acknowledgment sessionWorld pattern: fixture transport effects and real gate probes.
  const transports = new Map(); let serial = 0;
  const counts = { probes: 0, closes: 0 };
  const handlers = new Map(Object.entries({
    '["recipe","probe"]': async () => ({ ok: true }),
    '["process-runtime","open"]': async ({ origin, target: t }) => { const handle = `owned-${++serial}`; transports.set(handle, { url: origin, target: t }); return { handle, origin }; },
    '["process-runtime","read"]': async ({ handle }) => transports.has(handle) ? { present: true } : { present: false },
    '["process-runtime","close"]': async ({ handle }) => { counts.closes++; transports.delete(handle); return { closed: true }; },
    '["network","fetch"]': async request => {
      const parsed = new URL(request.url), resource = [...transports.values()].find(r => r.url === parsed.origin);
      if (!resource) throw new Error('no fixture resource for ' + request.url);
      if (/^\/\.gozar-/.test(parsed.pathname)) counts.probes++;
      const response = await fetch('http://' + resource.target + parsed.pathname + parsed.search, { method: request.method, headers: request.headers });
      const chunks = []; let last = Date.now();
      for await (const chunk of response.body) { const at = Date.now(); chunks.push({ data: Buffer.from(chunk).toString('base64'), delayMs: at - last }); last = at; }
      return { status: response.status, headers: Object.fromEntries(response.headers), chunks };
    },
  }));
  const dispatchEffect = async request => {
    const handler = handlers.get(JSON.stringify([request?.kind, request?.operation]));
    if (!handler) throw Object.assign(new Error('No fixture effect: ' + JSON.stringify([request?.kind, request?.operation])), { code: 'unsupported' });
    return structuredClone(await handler(structuredClone(request.input)));
  };
  const api = createRouteApi({ manifest: registry.manifest, root: registry.root, dispatchEffect, readContext: fakeReadContext({ home }), expose: { startTimeoutMs: 30_000 } });
  const forward = createForward(api, { home });
  const sessionDirectory = join(home, `port-${port}`);
  t.after(async () => {
    const control = JSON.parse(await readFile(join(sessionDirectory, 'control.json'), 'utf8').catch(() => 'null'));
    if (control) {
      const stopped = await stopController(control);
      if (stopped.state === 'unconfirmed') t.diagnostic(`Retained owned controller evidence at ${home}`);
    }
  });
  const first = await forward({ app: 'faravan', port });
  assert.equal(first.needsAction.step, 'approve-route');
  const second = await first.resume({ approve: true });
  assert.equal(second.needsAction, null);
  assert.equal(second.kind, 'session');
  assert.equal(second.lifetime, 'session');
  assert.match(second.url, /^https:\/\/[0-9a-f]{16}\.fw-real-session\.invalid$/);
  assert.ok(counts.probes >= 1, 'the publication was verified by real gate probes through the controller');
  await second.close();
  assert.equal(counts.closes, 1, 'the session transport was removed');
  assert.equal((await stateOf(home).read()).run.phase, 'stopped');
});
