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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** SIGKILL a child and wait for its exit, even if it already exited. */
async function killAndWait(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
  }
}

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
function view({ handle, url = 'https://one.fixture.example', state = 'usable', target = '127.0.0.1:18765', published = url,
    consentFactsDigest, operationId = null, cleanup = { state: 'none' } }) {
  return { handle, state, ownership: 'gozar-owned', published, origin: url, operationId,
    ...(consentFactsDigest ? { consentFactsDigest } : {}),
    verification: { status: state === 'usable' ? 'verified' : 'unverified', checkedAt: ISO },
    cleanup, hostConfiguration: { target: { known: true, value: target } }, properties: properties() };
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
  const world = { mode: 'ready', serial: 0, tokenSerial: 0, routes: new Map(), journal: new Map(), closeOutcome: 'confirmed',
    queue: eventQueue(), url, allocateLatch: null,
    offered: (kind, request) => {
      if (!kindsOffered.includes(kind)) return [];
      if (world.mode === 'needs-setup') return [candidate({ providerId, kind, needsAccount, disclosureRevision,
        trafficShape, action: { ...setupAction(world.stepped ? { step: { kind: 'guided' } } : {}), consent: setupConsent(setupAction()) }, token: null, target: request?.target })];
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
      return view({ handle: request.handle, url: route.url, target: route.target, consentFactsDigest: route.consentFactsDigest,
        operationId: route.operationId, ...(route.down ? { state: 'unverified', published: null } : {}) });
    },
    async closeRoute(request) {
      if (world.closeOutcome !== 'confirmed') return { cleanup: { state: 'unconfirmed' } };
      world.routes.delete(request.handle.id);
      for (const entry of world.journal.values()) if (entry.handle.id === request.handle.id) entry.released = true;
      return { cleanup: { state: 'confirmed' }, handle: request.handle };
    },
    // The SDK's scoped recovery read: every operation journal, live or retained, with its exact handle.
    async listRoutes() {
      return { routes: [...world.journal.entries()].map(([operationId, entry]) => entry.released
        ? view({ handle: entry.handle, state: 'released', published: null, operationId, cleanup: { state: 'confirmed' } })
        : { ...view({ handle: entry.handle, state: 'uncertain', published: null, operationId, cleanup: { state: 'unconfirmed' } }) }) };
    },
    async *watchRoutes(request) {
      world.watchStarts = (world.watchStarts ?? 0) + 1;
      if (world.watchBrokenFor === request.handle.id) throw new Error('watch transport broke');
      while (!request.signal?.aborted) {
        const pulled = await world.queue.pull(request.signal);
        if (!pulled || pulled.value === null || request.signal?.aborted) return;
        if (pulled.value.throw) throw pulled.value.throw;
        if (pulled.value.type) { yield pulled.value; return; }
        yield { route: pulled.value };
      }
    },
    async runSetupAction(request) {
      world.setupRan = request;
      if (request.operationId !== undefined && world.stepped) {
        // A stepped SDK operation: reserve, offer one action, complete after that action is run.
        world.operations ??= new Map();
        if (request.expectedSetupRevision === 0) {
          world.operations.set(request.operationId, 'pending');
          return pendingOperation(world, request.operationId, 1);
        }
        world.operations.set(request.operationId, 'complete'); world.mode = 'ready';
        return operationView(world, request);
      }
      if (request.operationId !== undefined) return operationView(world, request);
      world.mode = 'ready';
      return { schemaVersion: 1, state: 'complete', nextAction: null };
    },
    async readSetupOperation(request) {
      world.reads = (world.reads ?? 0) + 1;
      if (world.stepped && world.operations?.get(request.operationId) === 'pending') return pendingOperation(world, request.operationId, 1);
      if (world.stepped && world.operations?.get(request.operationId) === 'cancelled') return { ...operationView(world, request), state: 'cancelled' };
      return operationView(world, request);
    },
    async cancelSetupOperation(request) {
      world.cancelled = true; (world.cancelRequests ??= []).push(structuredClone(request));
      if (world.cancelRefused) throw Object.assign(new Error('the provider refused the cancel'), { code: 'provider_unavailable' });
      world.operations?.set(request.operationId, 'cancelled');
      return { schemaVersion: 1, state: 'cancelled', revision: 0, nextAction: null, evidence: { known: false, reason: 'fixture' }, resources: [] };
    },
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
    world.allocations = (world.allocations ?? 0) + 1;
    if (world.failAllocations > 0) { world.failAllocations--; throw Object.assign(new Error('provider refused the allocation'), { code: 'provider_unavailable' }); }
    world.allocateLatch?.resolve(request);
    if (world.holdAllocate) await world.holdAllocate.promise;
    // The SDK journals the handle under the operation id BEFORE any effect, then creates the route.
    const handle = { kind, id: `s-${++world.serial}`, generation: 1 };
    world.journal.set(request.operationId, { handle });
    const routeUrl = world.nextUrl ?? world.url;
    world.routes.set(handle.id, { url: routeUrl, target: request.target, consentFactsDigest: request.approval.consentFactsDigest, operationId: request.operationId });
    world.effectCreated?.resolve(handle);
    if (world.holdAfterEffect) await world.holdAfterEffect.promise;
    if (world.unverifiedAllocation) return view({ handle, url: routeUrl, state: 'unverified', published: null, target: request.target, operationId: request.operationId });
    return view({ handle, url: routeUrl, target: request.target, consentFactsDigest: request.approval.consentFactsDigest, operationId: request.operationId });
  }
  return { world, api: recorded, calls };
}

function pendingOperation(world, operationId, revision) {
  const offer = { ...setupAction({ id: 'ssh-step', label: 'Run the offered step' }) };
  return { schemaVersion: 1, operationId, revision, state: 'pending', evidence: { known: false, reason: 'fixture' },
    nextAction: { ...offer, consent: setupConsent(offer) }, resources: [],
    scope: { registryId: 'reg-test', scopeId: 'scope-1', providerId: 'fixture-run', configurationRevision: 'cfg-1', draftId: null } };
}

function operationView(world, request) {
  const revision = (world.operationRevision ?? 0) + 1;
  world.operationRevision = revision;
  return { schemaVersion: 1, operationId: request.operationId, revision, state: 'complete',
    evidence: { known: false, reason: 'fixture' }, nextAction: null, resources: [],
    scope: { registryId: 'reg-test', scopeId: 'scope-1', providerId: 'fixture-run', configurationRevision: 'cfg-1', draftId: null } };
}

const FAST = { attempts: 3, baseMs: 5, capMs: 20 };
async function standIn(t, { reconnect, ...options } = {}) {
  const home = await scratch(t);
  const port = await loopbackApp(t);
  const stand = standInWorld({ url: 'https://one.fixture.example', ...options });
  return { home, port, ...stand, forward: createForward(stand.api, { home, ...(reconnect ? { reconnect } : {}) }), state: () => stateOf(home).read() };
}

/** Publish through the stand-in with one approval click; returns the published resource. */
async function published(s, extra = {}) {
  const first = await s.forward({ app: 'faravan', port: s.port, ...extra });
  return first.needsAction ? first.resume({ approve: true }) : first;
}

const exposeCalls = s => s.calls.filter(([name]) => name === 'expose');
const closeCalls = s => s.calls.filter(([name]) => name === 'closeRoute');
const closeOf = (s, id) => closeCalls(s).find(([, entry]) => entry.request.handle.id === id);
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ZERO_DIGEST = `consent-v1:${'0'.repeat(64)}`;

/**
 * The persisted record a manager that died mid-run leaves behind (an orchestration cut: the process itself is
 * not killed here; the real SDK crash cuts below kill an actual child). Needs a prior saved approval.
 */
async function deadManagerRecord(s, { operationId, handle, phase = 'starting', downSince = null }) {
  const rec = await s.state();
  await stateOf(s.home).commit({ run: { id: RUN_X, generation: rec.run.generation + 1, operationId, handle, provider: 'fixture-run', phase, setup: null },
    approval: rec.approval, origin: rec.origin, downSince, cleanup: { certainty: 'settled', debt: null } }, { expectedRevision: rec.revision });
}
const plantRoute = (s, { id, operationId, url, digest, target }) => {
  const handle = { kind: 'session', id, generation: 1 };
  s.world.journal.set(operationId, { handle });
  s.world.routes.set(id, { url, target: target ?? `127.0.0.1:${s.port}`, consentFactsDigest: digest, operationId });
  return handle;
};

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

test('stand-in: saved assent is bound to the exact target; a changed port is a fresh decision', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  const sameAgain = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(sameAgain.needsAction, null, 'the same port keeps the saved assent');
  await sameAgain.close();
  const other = await loopbackApp(t);
  const moved = await s.forward({ app: 'faravan', port: other });
  assert.equal(moved.needsAction.step, 'approve-route', 'another listener port is not the approved target');
  assert.equal(moved.needsAction.target, `127.0.0.1:${other}`);
  await moved.close();
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

// === Concern 1 + 4: an uncertain allocation and recovery are resolved from current SDK facts ============

test('stand-in: a dead manager\'s recorded allocation intent resolves through the SDK journal and recovers the exact route', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  const saved = (await s.state()).approval;
  // The effect exists (a verified route + SDK journal), but the dead manager never recorded its handle.
  const orphan = plantRoute(s, { id: 's-orphan', operationId: OP, url: 'https://orphan.fixture.example', digest: saved.factsDigest });
  await deadManagerRecord(s, { operationId: OP, handle: null });
  const exposes = exposeCalls(s).length;
  let asked = 0;
  const resource = await s.forward({ app: 'faravan', port: s.port, onAction: () => { asked++; return { approve: true }; } });
  assert.equal(asked, 0, 'unchanged exact assent: no second consent click');
  assert.equal(resource.url, 'https://orphan.fixture.example', 'the exact owned route is recovered');
  assert.equal(exposeCalls(s).length, exposes, 'no new or competing allocation was made');
  const record = await s.state();
  assert.deepEqual(record.run.handle, orphan, 'the exact SDK handle was recorded from the operation journal');
  assert.equal(record.run.operationId, OP);
  // Recovery used the CURRENT SDK candidate (a pinned catalog read), never a placeholder token.
  assert.ok(s.calls.some(([name, entry]) => name === 'catalogRoutes' && entry.request.providerId === 'fixture-run'), 'a current pinned catalog read');
  assert.ok(!JSON.stringify(s.calls).includes('retained-managed-route'), 'no invented authority');
  await resource.close();
  assert.ok(!s.world.routes.has('s-orphan'), 'the recovered route was removed by close');
});

test('stand-in: an uncertain allocation that no longer qualifies is removed exactly before a fresh allocation', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  const saved = (await s.state()).approval;
  // Wrong target for this request: not the route the app asked for now, so it must be settled, not adopted.
  const orphan = plantRoute(s, { id: 's-orphan', operationId: OP, url: 'https://orphan.fixture.example', digest: saved.factsDigest, target: '127.0.0.1:1' });
  await deadManagerRecord(s, { operationId: OP, handle: null });
  const resource = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(resource.needsAction, null, 'a settled stale route, then a fresh allocation under unchanged assent');
  assert.deepEqual(closeOf(s, 's-orphan')[1].request.handle, orphan, 'the exact journaled handle was removed first');
  const closeAt = s.calls.findIndex(([name, entry]) => name === 'closeRoute' && entry.request.handle.id === 's-orphan');
  const exposeAt = s.calls.findIndex(([name], index) => name === 'expose' && index > closeAt);
  assert.ok(exposeAt > closeAt, 'replacement happened only after confirmed cleanup');
  assert.ok(!s.world.routes.has('s-orphan'));
  assert.notEqual((await s.state()).run.operationId, OP, 'the new allocation has a fresh operation id');
  await resource.close();
});

test('stand-in: an unreadable SDK journal blocks replacement; an absent journal proves no effects', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  await deadManagerRecord(s, { operationId: OP, handle: null });
  s.api.listRoutes = async () => { throw Object.assign(new Error('journal unreadable'), { code: 'provider_unavailable' }); };
  await rejects(s.forward({ app: 'faravan', port: s.port }), null, 'an unresolved uncertain operation never allows a new allocation');
  const record = await s.state();
  assert.equal(record.run.operationId, OP, 'the exact operation reference is retained');
  assert.equal(record.run.id, RUN_X);
  assert.equal(exposeCalls(s).length, 1, 'only the first run ever allocated');
  // With a readable journal that has no such operation, the SDK reserved nothing: it is safe to proceed.
  s.api.listRoutes = async () => ({ routes: [] });
  const resource = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(resource.needsAction, null);
  assert.notEqual((await s.state()).run.operationId, OP);
  await resource.close();
});

test('stand-in: allocation intent (operation id + provider) is persisted before the provider effect', async t => {
  const s = await standIn(t);
  s.world.holdAllocate = deferred();
  s.world.allocateLatch = deferred();
  const first = await s.forward({ app: 'faravan', port: s.port });
  const resuming = first.resume({ approve: true });
  const request = await s.world.allocateLatch.promise;   // inside the provider call; no effect yet
  const record = await s.state();
  assert.equal(record.run.operationId, request.operationId, 'the exact operation id is durable before the effect');
  assert.equal(record.run.provider, 'fixture-run');
  assert.equal(record.run.handle, null);
  s.world.holdAllocate.resolve();
  const resource = await resuming;
  assert.equal((await s.state()).run.operationId, request.operationId);
  await resource.close();
});

test('stand-in: recovery refuses a route whose approval no longer matches the current exact candidate', async t => {
  const s = await standIn(t, { disclosureRevision: 'disc-1' });
  await (await published(s)).close();
  const saved = (await s.state()).approval;
  const orphan = plantRoute(s, { id: 's-orphan', operationId: OP, url: 'https://orphan.fixture.example', digest: saved.factsDigest });
  await deadManagerRecord(s, { operationId: OP, handle: orphan, phase: 'active' });
  // The provider's disclosure moved while the manager was dead: the saved assent is for another candidate.
  s.world.offered = (kind, request) => [candidate({ kind, disclosureRevision: 'disc-2', token: `tok-d2-${++s.world.tokenSerial}`, target: request?.target })];
  const pending = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(pending.needsAction.step, 'approve-route', 'changed disclosure needs a fresh user decision');
  assert.equal(pending.needsAction.disclosure.revision, 'disc-2');
  assert.deepEqual(closeOf(s, 's-orphan')[1].request.handle, orphan, 'the unqualified route was removed, not adopted');
  assert.equal(exposeCalls(s).length, 1, 'nothing re-exposed before approval');
  await pending.close();
});

test('stand-in: recovery refuses a route approved under a different consent than the saved assent', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  const orphan = plantRoute(s, { id: 's-orphan', operationId: OP, url: 'https://orphan.fixture.example', digest: ZERO_DIGEST });
  await deadManagerRecord(s, { operationId: OP, handle: orphan, phase: 'active' });
  const resource = await s.forward({ app: 'faravan', port: s.port });
  assert.notEqual(resource.url, 'https://orphan.fixture.example', 'a route carrying other consent is never adopted');
  assert.deepEqual(closeOf(s, 's-orphan')[1].request.handle, orphan);
  await resource.close();
});

test('stand-in: a stopped run stays terminal even if its old route still looks live', async t => {
  const s = await standIn(t);
  const first = await published(s);
  const oldRecord = await s.state();
  await first.close();
  // Late proof: the old run's route reappears live in the world after its run was stopped and settled.
  const live = plantRoute(s, { id: 's-late', operationId: OP, url: 'https://late.fixture.example', digest: oldRecord.approval.factsDigest });
  const next = await s.forward({ app: 'faravan', port: s.port });
  assert.notEqual(next.url, 'https://late.fixture.example', 'a stopped run is never revived by an observed live route');
  const record = await s.state();
  assert.equal(record.run.generation, 2);
  assert.notDeepEqual(record.run.handle, live);
  await next.close();
});

// === Concern 2: failed-return cleanup refusal retains the exact operation and handle ===================

test('stand-in: a failed allocation return whose removal is refused retains the exact handle across exit and blocks replacement', async t => {
  const s = await standIn(t);
  s.world.unverifiedAllocation = true;      // the provider created the route, but proof did not verify
  s.world.closeOutcome = 'unconfirmed';     // and the removal is refused
  const first = await s.forward({ app: 'faravan', port: s.port });
  const error = await rejects(first.resume({ approve: true }), 'cleanup_debt');
  assert.ok(error.message.length > 0);
  const debt = await s.state();
  assert.equal(debt.run.phase, 'stopped');
  assert.equal(debt.cleanup.certainty, 'unconfirmed');
  assert.deepEqual(debt.run.handle, { kind: 'session', id: 's-1', generation: 1 }, 'the exact handle of the failed return is retained');
  assert.equal(debt.run.operationId, exposeCalls(s)[0][1].request.operationId, 'and the exact operation');
  assert.equal(closeCalls(s).length, 1);
  // The manager exited (lease released on failure). A restart reconciles with the retained handle first.
  await rejects(s.forward({ app: 'faravan', port: s.port }), 'cleanup_debt');
  assert.deepEqual(closeCalls(s).at(-1)[1].request.handle, { kind: 'session', id: 's-1', generation: 1 }, 'the retry removes exactly the retained handle');
  assert.equal(exposeCalls(s).length, 1, 'replacement is blocked while cleanup is unconfirmed');
  // The provider finally confirms removal: only then is a fresh run admitted.
  s.world.closeOutcome = 'confirmed';
  s.world.unverifiedAllocation = false;
  const next = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(next.needsAction, null);
  assert.ok(!s.world.routes.has('s-1'), 'the retained route was removed');
  assert.equal((await s.state()).run.generation, 2);
  await next.close();
});

test('stand-in: close() does not resolve while a failed allocation return and its custody are still pending', async t => {
  const s = await standIn(t);
  s.world.holdAllocate = deferred();
  s.world.allocateLatch = deferred();
  s.world.unverifiedAllocation = true;
  s.world.closeOutcome = 'unconfirmed';
  const first = await s.forward({ app: 'faravan', port: s.port });
  const resuming = first.resume({ approve: true }).then(() => 'resolved', error => error.code);
  await s.world.allocateLatch.promise;      // the API call is in flight
  let closeSettled = null;
  const closing = first.close().then(() => { closeSettled = 'resolved'; }, error => { closeSettled = error.code; });
  s.world.holdAllocate.resolve();           // the call completes with a created-but-unverified route
  await closing;
  assert.equal(closeSettled, 'cleanup_debt', 'close cannot report success while the created route is unconfirmed');
  assert.equal(await resuming, 'cleanup_debt');
  const record = await s.state();
  assert.deepEqual(record.run.handle, { kind: 'session', id: 's-1', generation: 1 }, 'the created route is retained, not forgotten');
  assert.equal(record.cleanup.certainty, 'unconfirmed');
  // A close retry settles it once the provider confirms.
  s.world.closeOutcome = 'confirmed';
  await first.close();
  assert.ok(!s.world.routes.has('s-1'));
  assert.equal((await s.state()).cleanup.certainty, 'settled');
});

test('stand-in: close() during an in-flight allocation waits for the custody write, not just the API promise', async t => {
  const s = await standIn(t);
  s.world.holdAllocate = deferred();
  s.world.allocateLatch = deferred();
  const first = await s.forward({ app: 'faravan', port: s.port });
  const resuming = first.resume({ approve: true }).then(() => 'resolved', error => error.code);
  await s.world.allocateLatch.promise;
  const closing = first.close();
  s.world.holdAllocate.resolve();
  assert.equal(await resuming, 'stopped_by_user');
  await closing;
  const record = await s.state();
  assert.equal(record.run.phase, 'stopped');
  assert.deepEqual(record.run.handle, { kind: 'session', id: 's-1', generation: 1 }, 'the created route handle was recorded before the stop');
  assert.equal(record.cleanup.certainty, 'settled');
  assert.ok(!s.world.routes.has('s-1'), 'the created route was removed');
});

// === Concern 3: re-establishment while the managed intent stays active ================================

const awaitNull = (resource, key = 'url') => waitFor(() => resource[key] === null);

test('stand-in: provider termination re-establishes through a fresh scoped operation without a second click', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  const events = { change: [], down: [], back: [], action: [] };
  for (const type of Object.keys(events)) resource.on(type, event => events[type].push(event));
  const firstRecord = await s.state();
  const oldOp = firstRecord.run.operationId;
  s.world.nextUrl = 'https://two.fixture.example';
  // The provider terminates the route: it is gone and the watch reports its terminal state.
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.routes.delete('s-1');
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  assert.ok(await awaitNull(resource) || resource.url === 'https://two.fixture.example', 'the old origin is not presented as current once the route is lost');
  assert.ok(await waitFor(() => events.back.length === 1), 'the managed intent re-established the route');
  assert.equal(resource.url, 'https://two.fixture.example');
  assert.equal(resource.downSince, null);
  assert.equal(resource.needsAction, null, 'unchanged exact assent needs no second click');
  assert.equal(events.down.length, 1);
  assert.ok(events.down[0].downSince);
  assert.equal(events.back[0].downSince, events.down[0].downSince);
  assert.deepEqual({ oldOrigin: events.change[0].oldOrigin, newOrigin: events.change[0].newOrigin },
    { oldOrigin: 'https://one.fixture.example', newOrigin: 'https://two.fixture.example' });
  assert.deepEqual(events.action, []);
  assert.equal(exposeCalls(s).length, 2);
  const [one, two] = exposeCalls(s).map(([, entry]) => entry.request);
  assert.notEqual(two.operationId, one.operationId, 'a fresh scoped operation');
  assert.notEqual(two.approval.candidateToken, one.approval.candidateToken, 'a fresh single-use grant');
  assert.equal(closeCalls(s)[0][1].request.handle.id, 's-1', 'the old route was settled before the replacement');
  const closeAt = s.calls.findIndex(([name]) => name === 'closeRoute');
  assert.ok(s.calls.findIndex(([name], index) => name === 'expose' && index > closeAt) > closeAt);
  const record = await s.state();
  assert.deepEqual(record.run.handle, { kind: 'session', id: 's-2', generation: 1 });
  assert.equal(record.run.operationId, two.operationId);
  assert.notEqual(record.run.operationId, oldOp);
  assert.equal(record.run.id, firstRecord.run.id, 'the same managed run, not a restarted one');
  assert.equal(record.origin.url, 'https://two.fixture.example');
  assert.equal(record.downSince, null);
  await resource.close();
  assert.ok(!s.world.routes.has('s-2'), 'the replacement is cleaned up by close');
});

test('stand-in: a broken watch is retried a bounded number of times, then the route is re-established', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  const backs = [];
  resource.on('back', event => backs.push(event));
  s.world.nextUrl = 'https://two.fixture.example';
  s.world.watchBrokenFor = 's-1';
  s.world.queue.push({ throw: new Error('watch transport broke') });
  assert.ok(await waitFor(() => backs.length === 1, 8000), 'a persistent watch failure ends in re-establishment');
  assert.equal(resource.url, 'https://two.fixture.example');
  const starts = s.world.watchStarts;
  assert.ok(starts <= 1 + FAST.attempts + 1, `watch restarts were bounded (${starts})`);
  assert.equal(closeCalls(s)[0][1].request.handle.id, 's-1', 'the old route was removed before the replacement');
  assert.equal(exposeCalls(s).length, 2);
  await resource.close();
});

test('stand-in: an unverified status withdraws the url and a verified one restores it', async t => {
  const s = await standIn(t);
  const resource = await published(s);
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  assert.equal(resource.url, 'https://one.fixture.example');
  s.world.queue.push(view({ handle, state: 'unverified', published: null }));
  assert.ok(await awaitNull(resource), 'no stale origin is presented as current while unverified');
  assert.ok(resource.downSince, 'downSince tracks the current outage');
  s.world.queue.push(view({ handle, url: 'https://one.fixture.example' }));
  assert.ok(await waitFor(() => resource.url === 'https://one.fixture.example'));
  assert.equal(resource.downSince, null);
  await resource.close();
});

test('stand-in: a changed disclosure during re-establishment is a user step; nothing publishes until approval', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  const actions = [];
  resource.on('action', descriptor => actions.push(descriptor));
  s.world.offered = (kind, request) => [candidate({ kind, disclosureRevision: 'disc-2', token: `tok-d2-${++s.world.tokenSerial}`, target: request?.target })];
  s.world.nextUrl = 'https://two.fixture.example';
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.routes.delete('s-1');
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  assert.ok(await waitFor(() => resource.needsAction), 'the pending step is exposed on the resource');
  assert.equal(resource.needsAction.step, 'approve-route');
  assert.equal(resource.needsAction.disclosure.revision, 'disc-2');
  assert.equal(actions.length, 1, 'an action event carries the same descriptor');
  assert.deepEqual(actions[0], resource.needsAction);
  assert.equal(resource.url, null, 'unpublished until approval');
  assert.equal(exposeCalls(s).length, 1, 'no allocation before the user decides');
  const settled = await resource.resume({ approve: true });
  assert.equal(settled, resource);
  assert.ok(await waitFor(() => resource.url === 'https://two.fixture.example'));
  assert.equal(resource.needsAction, null);
  assert.equal(exposeCalls(s).length, 2);
  assert.equal((await s.state()).approval.disclosureRevision, 'disc-2', 'the new decision is the saved assent');
  await resource.close();
});

test('stand-in: a consent change observed on the live route removes it first and asks for a new decision', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.offered = (kind, request) => [candidate({ kind, disclosureRevision: 'disc-2', token: `tok-d2-${++s.world.tokenSerial}`, target: request?.target })];
  const moved = { ...view({ handle }), consentChange: { oldDigest: ZERO_DIGEST, newDigest: `consent-v1:${'1'.repeat(64)}` } };
  s.world.queue.push({ type: 'consent_changed', route: moved });
  assert.ok(await waitFor(() => resource.needsAction), 'the changed consent is a user step');
  assert.equal(resource.needsAction.disclosure.revision, 'disc-2');
  assert.equal(resource.url, null, 'the route is not presented as current under changed consent');
  assert.ok(closeOf(s, 's-1'), 'the old route was removed before any replacement');
  assert.equal(exposeCalls(s).length, 1);
  await resource.close();
  assert.equal((await s.state()).run.phase, 'stopped');
});

test('stand-in: onAction handles a later re-establishment step, and a denial stops the run for good', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const asked = [];
  const resource = await published(s, { onAction: descriptor => { asked.push(descriptor); return { approve: asked.length === 1 ? true : false }; } });
  // (the first click is the hook's own answer when onAction is configured)
  assert.equal(asked.length, 1);
  s.world.offered = (kind, request) => [candidate({ kind, disclosureRevision: 'disc-2', token: `tok-d2-${++s.world.tokenSerial}`, target: request?.target })];
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.routes.delete('s-1');
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  assert.ok(await waitFor(() => asked.length === 2), 'the same hook receives the later step');
  assert.equal(asked[1].disclosure.revision, 'disc-2');
  assert.ok(await waitFor(async () => (await s.state()).run.phase === 'stopped'), 'a denial stops the managed run');
  assert.equal(resource.url, null);
  assert.equal(exposeCalls(s).length, 1, 'no allocation after the denial');
  await waitFor(() => false, 200);
  assert.equal(exposeCalls(s).length, 1, 'no resurrection');
  await resource.close();
});

test('stand-in: unknown cleanup of the lost route blocks any replacement and is retained as debt', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  s.world.closeOutcome = 'unconfirmed';
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  assert.ok(await waitFor(async () => (await s.state()).cleanup.certainty === 'unconfirmed', 6000), 'the unconfirmed removal is persisted as debt');
  const record = await s.state();
  assert.deepEqual(record.run.handle, handle, 'the exact handle is retained');
  assert.equal(record.run.phase, 'stopped');
  assert.equal(exposeCalls(s).length, 1, 'no replacement while cleanup is unknown');
  assert.equal(resource.url, null);
  assert.ok(closeCalls(s).length >= 2, 'removal was retried a bounded number of times');
  assert.ok(closeCalls(s).length <= FAST.attempts + 1);
  await rejects(resource.close(), 'cleanup_debt');
  s.world.closeOutcome = 'confirmed';
  await resource.close();
  assert.equal((await s.state()).cleanup.certainty, 'settled');
  assert.equal(exposeCalls(s).length, 1);
});

test('stand-in: close during re-establishment prevents resurrection and removes what it created', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  s.world.holdAllocate = deferred();
  s.world.allocateLatch = deferred();
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.routes.delete('s-1');
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  await s.world.allocateLatch.promise;     // the replacement allocation is in flight
  const closing = resource.close();
  s.world.holdAllocate.resolve();
  await closing;
  assert.equal(exposeCalls(s).length, 2, 'only the in-flight replacement was ever allocated');
  assert.ok(![...s.world.routes.keys()].length, 'the late replacement was removed by close');
  const record = await s.state();
  assert.equal(record.run.phase, 'stopped');
  assert.equal(record.cleanup.certainty, 'settled');
  await waitFor(() => false, 150);
  assert.equal(exposeCalls(s).length, 2, 'nothing resurrects after the user closed');
  assert.equal(resource.url, null);
});

test('stand-in: re-establishment attempts are bounded; a persistently failing provider leaves the resource down', async t => {
  const s = await standIn(t, { reconnect: FAST });
  const resource = await published(s);
  const downs = [];
  resource.on('down', event => downs.push(event));
  s.world.failAllocations = 1000;
  const handle = { kind: 'session', id: 's-1', generation: 1 };
  s.world.routes.delete('s-1');
  s.world.queue.push({ type: 'terminal', route: view({ handle, state: 'released', published: null, cleanup: { state: 'confirmed' } }) });
  assert.ok(await waitFor(() => s.world.allocations >= 1 + FAST.attempts, 6000));
  await waitFor(() => false, 300);
  assert.ok(s.world.allocations <= 1 + FAST.attempts, `bounded retries (${s.world.allocations})`);
  assert.equal(resource.url, null);
  assert.ok(resource.downSince);
  assert.equal(downs.length, 1, 'one outage, one down event');
  await resource.close();
  assert.equal((await s.state()).run.phase, 'stopped');
});

// === Setup operation custody, action-handler failure, and public error sanitation =====================

test('stand-in: an onAction exception stops the run, cancels the exact live setup operation and leaks no cause text', async t => {
  const s = await standIn(t);
  s.world.mode = 'needs-setup'; s.world.stepped = true;
  const secret = 'sk-live-SECRET-token-value';
  let calls = 0;
  const error = await rejects(s.forward({ app: 'faravan', port: s.port,
    onAction: () => { if (++calls === 1) throw new Error(`ui crashed with ${secret}`); return { approve: true }; } }), 'stopped_by_user');
  assert.ok(!error.message.includes(secret), `public error must not echo the cause: ${error.message}`);
  assert.ok(!JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(secret), 'nor carry it on a property');
  assert.equal(s.world.cancelRequests?.length, 1, 'the live setup operation was cancelled');
  const reserved = s.calls.find(([name, entry]) => name === 'runSetupAction' && entry.request.operationId)[1].request;
  assert.equal(s.world.cancelRequests[0].operationId, reserved.operationId);
  assert.equal(s.world.cancelRequests[0].providerId, 'fixture-run');
  const record = await s.state();
  assert.equal(record.run.setup, null, 'the confirmed cancel settled the setup reference');
  // The lease was released: the app can ask again.
  s.world.mode = 'ready';
  const next = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(next.needsAction.step, 'approve-route');
  await next.close();
});

test('stand-in: a refused setup cancel is retained as debt across exit, retried exactly, never reported settled', async t => {
  const s = await standIn(t);
  s.world.mode = 'needs-setup'; s.world.stepped = true;
  s.world.cancelRefused = true;
  const error = await rejects(s.forward({ app: 'faravan', port: s.port, onAction: () => { throw new Error('ui crashed'); } }), 'cleanup_debt');
  assert.ok(error.message.length > 0);
  const reserved = s.calls.find(([name, entry]) => name === 'runSetupAction' && entry.request.operationId)[1].request;
  const debt = await s.state();
  assert.deepEqual(debt.run.setup, { operationId: reserved.operationId, provider: 'fixture-run' }, 'the exact setup operation is retained');
  assert.equal(debt.cleanup.certainty, 'unconfirmed');
  assert.equal(debt.run.phase, 'stopped');
  // A restart retries the exact reference first and blocks while it is refused.
  await rejects(s.forward({ app: 'faravan', port: s.port }), 'cleanup_debt');
  assert.equal(s.world.cancelRequests.length, 2);
  assert.equal(s.world.cancelRequests[1].operationId, reserved.operationId);
  assert.equal((await s.state()).cleanup.certainty, 'unconfirmed');
  // Once the provider cancels, the debt settles and a fresh run starts.
  s.world.cancelRefused = false; s.world.mode = 'ready';
  const next = await s.forward({ app: 'faravan', port: s.port });
  assert.equal(next.needsAction.step, 'approve-route');
  const record = await s.state();
  assert.equal(record.run.setup, null);
  assert.equal(record.cleanup.certainty, 'settled');
  await next.close();
});

test('stand-in: a setup reserved by a dead manager is cancelled by its exact private reference at restart', async t => {
  const s = await standIn(t);
  await (await published(s)).close();
  const SETUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  s.world.stepped = true; s.world.operations = new Map([[SETUP, 'pending']]);
  const rec = await s.state();
  await stateOf(s.home).commit({ run: { id: RUN_X, generation: rec.run.generation + 1, operationId: null, handle: null, provider: 'fixture-run',
    phase: 'awaiting', setup: { operationId: SETUP, provider: 'fixture-run' } }, approval: rec.approval, origin: rec.origin, downSince: null,
    cleanup: { certainty: 'settled', debt: null } }, { expectedRevision: rec.revision });
  const resource = await s.forward({ app: 'faravan', port: s.port });
  assert.deepEqual(s.world.cancelRequests.map(row => row.operationId), [SETUP], 'the dead manager\'s setup was cancelled exactly');
  assert.equal((await s.state()).run.setup, null);
  assert.equal(resource.needsAction, null);
  await resource.close();
});

// --- The REAL configured SDK: publication, cleanup, restart reuse ------------------------------------

/** The durable fake world: real catalog, real single-use tokens, real durable engine and rule store. */
async function durableWorld(t, { id = 'fw-real-durable', verified = true, wrap = api => api, reconnect } = {}) {
  const home = await scratch(t);
  const registry = await fakeRegistry({ id, kinds: ['durable'], reach: 'internet', transport: 'https', dir: join(home, 'registry') });
  const port = await loopbackApp(t);
  const previous = process.env.GOZAR_HOME;
  process.env.GOZAR_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.GOZAR_HOME; else process.env.GOZAR_HOME = previous; });
  const real = createTestingRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home, verified }) });
  const api = wrap(real);
  return { home, port, registry, api, real, forward: createForward(api, { home, ...(reconnect ? { reconnect } : {}) }), id,
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
  await killAndWait(child);
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

// --- REAL SDK crash and failed-return custody cuts ---------------------------------------------------

test('real SDK: a host killed after the provider effect but before the result recovers the exact route', async t => {
  const w = await durableWorld(t, { id: 'fw-real-crash' });
  // ORCHESTRATION CUT (labeled): the REAL ensureRoute runs and its provider rule is durable; the host then hangs
  // before the engine can record the result, and the test SIGKILLs the actual process.
  const childSource = `
import { createRouteApi, fakeReadContext } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'packages/gozar-node/testing.mjs')).href)};
import { createForward } from ${JSON.stringify(pathToFileURL(join(repoRoot, 'packages/gozar-node/forward.mjs')).href)};
const real = createRouteApi({ manifest: ${JSON.stringify(w.registry.manifest)}, root: ${JSON.stringify(join(w.home, 'registry'))}, readContext: fakeReadContext({ home: ${JSON.stringify(w.home)} }) });
setInterval(() => {}, 1 << 30);  // keep the event loop alive: the host hangs here until the test kills it
const api = { ...real, ensureRoute: async request => { const view = await real.ensureRoute(request); process.stdout.write('EFFECT ' + view.handle.id + '\\n'); await new Promise(() => {}); } };
const forward = createForward(api, { home: ${JSON.stringify(w.home)} });
await forward({ app: 'faravan', port: ${w.port}, onAction: () => ({ approve: true }) });
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource],
    { cwd: repoRoot, env: { ...process.env, GOZAR_HOME: w.home }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let out = '', err = '';
  child.stdout.on('data', b => { out += String(b); });
  child.stderr.on('data', b => { err += String(b); });
  assert.ok(await waitFor(() => out.includes('EFFECT') ? out : null, 30000, 25), `the provider effect happened: ${err}`);
  const cut = await stateOf(w.home).read();
  assert.ok(cut.run.operationId, 'the exact operation intent was durable BEFORE the effect returned');
  assert.equal(cut.run.handle, null, 'the host died before it could record the handle');
  assert.ok((await w.store()).entries.a, 'the provider rule really exists');
  await killAndWait(child);
  // Restart: the uncertain operation is resolved through the SDK journal; no orphan, no competing route.
  let asked = 0;
  const recovered = await w.forward({ app: 'faravan', port: w.port, onAction: () => { asked++; return { approve: true }; } });
  assert.equal(asked, 0, 'recovery of an unchanged approved route needs no second consent');
  assert.equal(recovered.url, `https://a.${w.id}.invalid`);
  const listed = (await w.real.listRoutes({ home: w.home, owner: 'forward:faravan' })).routes;
  assert.equal(listed.length, 1, 'exactly one route exists for the app');
  const record = await stateOf(w.home).read();
  assert.equal(record.run.operationId, cut.run.operationId, 'the original operation is the one recovered');
  assert.deepEqual(record.run.handle, { kind: 'durable', id: 'forward-faravan', generation: 1 });
  assert.deepEqual(Object.keys((await w.store()).entries), ['a'], 'no competing provider rule');
  await recovered.close();
  assert.deepEqual((await w.store()).entries, {}, 'cleanup removed the one owned rule');
});

test('real SDK: a created-but-unverified route with refused removal keeps its exact handle, blocks replacement and is removed on retry', async t => {
  let refuse = true;
  // ORCHESTRATION DOUBLE over the REAL api: only closeRoute can be told to refuse; every effect and every
  // successful removal is the real durable engine's.
  const w = await durableWorld(t, { id: 'fw-real-unverified', verified: false, wrap: real => ({ ...real,
    closeRoute: async request => refuse ? { ...(await real.routeStatus({ home: request.home, handle: request.handle })), cleanup: { state: 'unconfirmed' } } : real.closeRoute(request) }) });
  const first = await w.forward({ app: 'faravan', port: w.port });
  const error = await rejects(first.resume({ approve: true }), 'cleanup_debt');
  assert.ok(error.message.length > 0);
  const debt = await stateOf(w.home).read();
  assert.deepEqual(debt.run.handle, { kind: 'durable', id: 'forward-faravan', generation: 1 }, 'the exact handle of the failed return is retained');
  assert.ok(debt.run.operationId);
  assert.equal(debt.cleanup.certainty, 'unconfirmed');
  assert.ok((await w.store()).entries.a, 'the real provider rule is honestly still there');
  await rejects(w.forward({ app: 'faravan', port: w.port }), 'cleanup_debt');
  assert.deepEqual(Object.keys((await w.store()).entries), ['a'], 'no replacement rule while removal is unconfirmed');
  refuse = false;
  await rejects(w.forward({ app: 'faravan', port: w.port }), 'provider_unavailable');   // unverified again, but this time removed
  assert.deepEqual((await w.store()).entries, {}, 'the real cleanup removed the retained rule');
  assert.equal((await stateOf(w.home).read()).cleanup.certainty, 'settled');
});

test('real SDK: a vanished provider rule is detected as lost and re-established through a fresh scoped operation', async t => {
  const w = await durableWorld(t, { id: 'fw-real-loss', reconnect: FAST });
  const resource = await w.forward({ app: 'faravan', port: w.port, onAction: () => ({ approve: true }) });
  const events = { down: [], back: [], change: [] };
  for (const type of Object.keys(events)) resource.on(type, event => events[type].push(event));
  const first = await stateOf(w.home).read();
  // REAL provider loss: the durable rule disappears from the provider's own store (what a removed or reset
  // upstream rule looks like to the SDK: route state 'lost').
  const storePath = join(w.home, 'registry', 'providers', w.id, 'store.json');
  const store = JSON.parse(await readFile(storePath, 'utf8'));
  assert.ok(store.entries.a, 'the owned rule exists before the loss');
  await writeFile(storePath, JSON.stringify({ ...store, entries: {} }));
  assert.ok(await waitFor(() => events.down.length === 1, 10000), 'the loss was observed and the url withdrawn');
  assert.ok(await waitFor(() => events.back.length === 1, 15000), 'the managed intent re-established the route');
  assert.equal(resource.url, `https://a.${w.id}.invalid`);
  assert.equal(resource.needsAction, null, 'unchanged exact assent needs no second consent');
  assert.equal(events.back[0].downSince, events.down[0].downSince);
  assert.ok((await readFile(storePath, 'utf8')).includes('"a"'), 'the provider rule exists again');
  const record = await stateOf(w.home).read();
  assert.equal(record.run.id, first.run.id, 'the same managed run');
  assert.notEqual(record.run.operationId, first.run.operationId, 'a fresh scoped operation');
  assert.equal(record.downSince, null);
  assert.equal(record.cleanup.certainty, 'settled');
  await resource.close();
  assert.deepEqual((await w.store()).entries, {}, 'close removed the re-established rule');
});
