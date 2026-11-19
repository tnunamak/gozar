// 0.5.2 defect 3: an awaited exact-origin host acknowledgment must sit between a provider allocation and
// publication verification. A host that declares `acknowledgeOrigin` on its factory is telling Gozar it
// binds its own verifier allowance to the exact origin only when it says so; until it acknowledges that
// exact validated origin for this exact route and attempt, no verification request may leave Gozar, and
// nothing may publish. A host that declares no handler keeps the 0.5.1 behavior.
// The attached cases drive the real shipped ngrok-https-edge adapter through fixture effects and a real
// detached controller, so the acknowledgment crosses the real embedding broker; the durable cases drive the
// real durable engine through a fake registry; the session cases drive the generic session controller.
//
// Boundary of this file's evidence: these tests prove the ACKNOWLEDGMENT BOUNDARY — the exact allocation ->
// ack -> proof -> publication ordering, foreign/refused/held/late-ack refusals, cancellation, owner loss and
// exact retained cleanup — with real gate probes as the proof events. They do NOT prove that an arbitrary
// Host header is denied by the host's own service verifier: that authority belongs to the embedding host's
// acknowledgeOrigin handler (DataConnect's own code), whose end-to-end behavior stays with DataConnect.
// The broker test pins the channel: undeclared method, unauthenticated calls and the held-ack
// non-blocking property.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { fakeRegistry, fakeReadContext } from '../../packages/gozar-node/testing.mjs';
import { attachedScratch, scratch, query, assertShape } from './route-schema-check.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, ms, step = 25) { const end = Date.now() + ms; for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// The full attached stack over the real registry: real catalog/consent/tokens, real detached controller,
// fixture provider effects, real local gate. `ack` shapes the host acknowledgment; `over` selects timing.
async function attachedWorld(t, { ack, over = {} } = {}) {
  const home = await attachedScratch(t), owner = 'fixture-owner';
  const app = http.createServer((req, res) => res.end('application-bytes'));
  const appPort = await listen(app);
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  const ledger = new Map(); let serial = 0;
  const counts = { opens: 0, closes: 0, probes: 0 };
  const acks = [];
  const handlers = new Map(Object.entries({
    '["process-runtime","detect"]': async () => ({ available: true }),
    '["recipe","probe"]': async () => ({ ok: false }),
    '["sdk-listener","detect"]': async () => ({ available: true }),
    '["sdk-listener","open"]': async ({ options }) => {
      counts.opens++; const handle = `owned-${++serial}`;
      ledger.set(handle, { url: `https://${options.domain}`, target: options.addr });
      return { handle, url: `https://${options.domain}` };
    },
    '["sdk-listener","read"]': async ({ handle }) => ledger.has(handle) ? { present: true, url: ledger.get(handle).url } : { present: false },
    '["sdk-listener","close"]': async ({ handle }) => { counts.closes++; ledger.delete(handle); return { closed: true }; },
    '["network","fetch"]': async request => {
      const parsed = new URL(request.url), resource = [...ledger.values()].find(r => r.url === parsed.origin);
      if (!resource) throw new Error('no fixture resource for ' + parsed.origin);
      if (/^\/\.gozar-/.test(parsed.pathname)) counts.probes++;
      const response = await fetch('http://' + resource.target + parsed.pathname + parsed.search, { method: request.method, headers: request.headers });
      const chunks = []; let last = Date.now();
      for await (const chunk of response.body) {
        const at = Date.now(); chunks.push({ data: Buffer.from(chunk).toString('base64'), delayMs: at - last }); last = at;
      }
      return { status: response.status, headers: Object.fromEntries(response.headers), chunks };
    },
  }));
  const dispatchEffect = async request => {
    const handler = handlers.get(JSON.stringify([request?.kind, request?.operation]));
    if (!handler) throw Object.assign(new Error('No matching testing effect is declared'), { code: 'unsupported' });
    try { return structuredClone(await handler(structuredClone(request.input))); }
    catch { throw Object.assign(new Error('The testing effect failed'), { code: 'provider_unavailable' }); }
  };
  const api = createRouteApi({
    embeddingServices: createEmbeddingServices({ registryId: await registryIdentity({}) }),
    dispatchEffect,
    expose: {
      ...(ack ? { acknowledgeOrigin: async request => { acks.push(structuredClone(request)); return ack(request); } } : {}),
      startTimeoutMs: 30_000, ...over,
    },
  });
  const provider = (await api.listProviders({ home, owner })).providers.find(p => p.providerId === 'ngrok-https-edge');
  assert.ok(provider, 'the shipped registry lists ngrok-https-edge');
  let config = provider.configuration;
  for (const requirement of config.inputRequirements) {
    const action = config.actions.find(a => a.id === requirement.actionId);
    let input;
    if (requirement.secret) {
      const { handle } = await api.storeSecret({ home, owner, providerId: provider.providerId, inputId: requirement.id,
        scopeId: config.scopeId, expectedConfigurationRevision: config.revision, bytes: new TextEncoder().encode('synthetic-canary') });
      input = { secretHandle: handle };
    } else input = { value: 'fixture.example.invalid' };
    config = (await api.runSetupAction({ home, owner, providerId: provider.providerId, expectedConfigurationRevision: config.revision,
      actionId: action.id, ...input, approval: { kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
        consentFactsDigest: action.consent.consentFactsDigest } })).configuration;
  }
  const q = query({ home, owner, operationId: 'ack-fixture-op', providerId: provider.providerId, usage: { kind: 'attached' },
    target: `127.0.0.1:${appPort}`,
    requirements: { reach: provider.reach, transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const candidate = (await api.catalogRoutes(q)).candidates[0];
  assert.equal(candidate.eligible, true, 'the fixture ngrok candidate is eligible: ' + JSON.stringify(candidate.unmet));
  const request = { ...q, wait: 'verified', approval: { kind: 'route', consentFactsDigest: candidate.consentFactsDigest,
    candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } };
  return { home, owner, api, acks, counts, ledger, request, appPort };
}

const settle = outcome => outcome.then(value => ({ value }), error => ({ error }));

test('a correct announced-origin acknowledgment permits proof and publishes; the request is exactly scoped', async t => {
  const world = await attachedWorld(t, { ack: request => ({ acknowledged: true, origin: request.origin,
    handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }) });
  const { value, error } = await settle(world.api.expose(world.request));
  if (error) throw error;
  assertShape('RouteView', value);
  assert.equal(value.state, 'usable');
  assert.ok(value.published, 'the acknowledged route publishes');
  assert.equal(world.acks.length, 1, 'exactly one acknowledgment request');
  const [ack] = world.acks;
  assert.equal(ack.owner, world.owner);
  assert.equal(ack.providerId, 'ngrok-https-edge');
  assert.equal(ack.operationId, 'ack-fixture-op');
  assert.equal(ack.target, `127.0.0.1:${world.appPort}`);
  assert.equal(ack.home, world.home);
  assert.equal(typeof ack.home, 'string');
  assert.deepEqual(ack.handle, { kind: 'attached', id: value.handle.id, generation: 1 });
  assert.equal(ack.origin, value.origin, 'the acknowledged origin is the allocated origin');
  assert.equal(typeof ack.attemptId, 'string', 'the acknowledgment binds a proof attempt');
  assert.ok(world.counts.probes >= 1, 'verification ran after the acknowledgment');
  await world.api.closeRoute({ home: world.home, handle: value.handle, mode: 'remove' });
});

test('red: a held acknowledgment permits no proof and fails the start with exact cleanup', async t => {
  const held = deferred();
  const world = await attachedWorld(t, { ack: () => held.promise, over: { originAckTimeoutMs: 400 } });
  const outcome = await settle(world.api.expose(world.request));
  assert.ok(outcome.error, 'the start must fail while the host holds the acknowledgment');
  assert.equal(outcome.error.code, 'verification_failed');
  assert.equal(world.counts.probes, 0, 'no verification request may leave Gozar before the acknowledgment');
  assert.equal(world.counts.opens, 1, 'the allocation happened');
  assert.equal(world.counts.closes, 1, 'the allocated runtime was removed');
  assert.equal(outcome.error.route?.cleanup?.state, 'confirmed', 'cleanup is confirmed and retained');
  assert.equal(outcome.error.route?.published, null);
  // The late acknowledgment cannot revive the failed start.
  held.resolve({ acknowledged: true, origin: outcome.error.route?.origin, handle: { id: 'x', generation: 1 }, attemptId: 'late' });
  await sleep(300);
  assert.equal(world.counts.probes, 0, 'a late acknowledgment changes nothing');
});

test('red: a foreign-origin acknowledgment (foreign Host) permits no proof and publishes nothing', async t => {
  const world = await attachedWorld(t, { ack: request => ({ acknowledged: true, origin: 'https://foreign.example',
    handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }) });
  const outcome = await settle(world.api.expose(world.request));
  assert.ok(outcome.error);
  assert.equal(outcome.error.code, 'verification_failed');
  assert.equal(world.counts.probes, 0, 'an acknowledgment naming another origin never permits verification');
  assert.equal(world.counts.closes, 1);
  assert.equal(outcome.error.route?.cleanup?.state, 'confirmed');
  assert.equal(outcome.error.route?.published, null);
});

test('red: a refused, throwing, and echo-mismatched acknowledgment all fail closed', async t => {
  for (const ack of [
    () => { throw new Error('host refused'); },
    () => ({ acknowledged: false }),
    request => ({ acknowledged: true, origin: request.origin, handle: { id: request.handle.id, generation: 99 }, attemptId: request.attemptId }),
    request => ({ acknowledged: true, origin: request.origin, handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: 'another-attempt' }),
  ]) {
    const world = await attachedWorld(t, { ack });
    const outcome = await settle(world.api.expose(world.request));
    assert.ok(outcome.error, 'each malformed or refused acknowledgment fails the start');
    assert.equal(outcome.error.code, 'verification_failed');
    assert.equal(world.counts.probes, 0, 'no proof without a well-formed exact acknowledgment');
    assert.equal(world.counts.closes, 1, 'the runtime is removed exactly once');
    assert.equal(outcome.error.route?.cleanup?.state, 'confirmed');
  }
});

test('red: a close during a held acknowledgment withdraws the route with exact cleanup and no late publication', async t => {
  const held = deferred();
  const world = await attachedWorld(t, { ack: () => held.promise, over: { originAckTimeoutMs: 60_000 } });
  // Settled the moment it is created: the close withdraws the route, and the start's rejection must never
  // become an unhandled rejection while this test still holds the close.
  const exposing = world.api.expose(world.request).then(value => ({ value }), error => ({ error }));
  const root = join(world.home, 'attached');
  const id = await waitFor(async () => {
    for (const name of (await readdir(root).catch(() => []))) {
      if (!/^att_/.test(name)) continue;
      const state = await readFile(join(root, name, 'state.json'), 'utf8').then(JSON.parse, () => null);
      if (state?.lastView?.origin) return name;
    }
    return null;
  }, 15_000);
  assert.ok(id, 'the allocated route is published while the acknowledgment is held');
  const closed = await settle(world.api.closeRoute({ home: world.home, handle: { kind: 'attached', id, generation: 1 }, mode: 'remove' }));
  if (closed.error) throw closed.error;
  assertShape('RouteView', closed.value);
  assert.equal(closed.value.state, 'released');
  assert.equal(closed.value.cleanup.state, 'confirmed');
  assert.equal(world.counts.probes, 0, 'cancellation during the acknowledgment runs no proof');
  assert.equal(world.counts.closes, 1);
  const outcome = await exposing;
  assert.ok(outcome.error, 'the canceled start cannot succeed');
  assert.equal(outcome.error.route?.published ?? null, null);
  held.resolve({ acknowledged: true, origin: 'https://anything.example', handle: { id, generation: 1 }, attemptId: 'late' });
  await sleep(300);
  assert.equal(world.counts.probes, 0, 'the late acknowledgment cannot publish after the close');
});

test('red: owner loss during a held acknowledgment removes the route and a late acknowledgment revives nothing', async t => {
  const held = deferred();
  const world = await attachedWorld(t, { ack: () => held.promise, over: { originAckTimeoutMs: 60_000, heartbeatMs: 60_000, leaseExpiryMs: 800 } });
  const outcome = await settle(world.api.expose(world.request));
  assert.ok(outcome.error, 'owner loss during the held acknowledgment fails the start');
  assert.equal(world.counts.probes, 0, 'no proof ran');
  assert.equal(world.counts.closes, 1, 'owner loss removed the allocated runtime exactly once');
  const root = join(world.home, 'attached');
  const [directory] = (await readdir(root)).filter(name => name.startsWith('att_'));
  const record = JSON.parse(await readFile(join(root, directory, 'state.json'), 'utf8'));
  assert.equal(record.lastView.cleanup.state, 'confirmed', 'the retained record keeps the cleanup receipt');
  assert.equal(record.lastView.published, null);
  held.resolve({ acknowledged: true, origin: 'https://anything.example', handle: { id: directory, generation: 1 }, attemptId: 'late' });
  await sleep(300);
  assert.equal(world.counts.probes, 0, 'a dead owner cannot be revived by a late acknowledgment');
});

test('a host that declares no acknowledgment boundary keeps the 0.5.1 behavior', async t => {
  const world = await attachedWorld(t);
  const { value, error } = await settle(world.api.expose(world.request));
  if (error) throw error;
  assert.equal(value.state, 'usable');
  assert.ok(value.published);
  assert.ok(world.counts.probes >= 1, 'verification still runs without the declared boundary');
  await world.api.closeRoute({ home: world.home, handle: value.handle, mode: 'remove' });
});

// --- Generic-session starts: the same boundary through the generic session controller --------------------------

// A session-capable fake registry whose session runs on the GENERIC controller (no recipe), so the
// acknowledgment boundary is exercised with a real detached controller and a real gate, not assumed
// from attached parity. Transport effects are fixture-dispatched; the proof is the real gate probe.
async function sessionWorld(t, { ack, over = {} } = {}) {
  // attached+session kinds: the fake's detect short-circuits (no recipe probe), and session usage
  // still runs the generic controller, which is exactly the parity under test.
  const registry = await fakeRegistry({ id: 'ack-session', kinds: ['attached', 'session'], reach: 'internet', transport: 'https', protocols: [] });
  t.after(() => registry.cleanup());
  const home = await attachedScratch(t), owner = 'fixture-owner';
  const acks = [], counts = { opens: 0, closes: 0, probes: 0 };
  const transports = new Map(); let serial = 0;
  const handlers = new Map(Object.entries({
    '["recipe","probe"]': async () => ({ ok: true }),
    '["process-runtime","open"]': async ({ origin, target }) => { counts.opens++; const handle = `session-owned-${++serial}`; transports.set(handle, { url: origin, target }); return { handle, origin }; },
    '["process-runtime","read"]': async ({ handle }) => transports.has(handle) ? { present: true } : { present: false },
    '["process-runtime","close"]': async ({ handle }) => { counts.closes++; transports.delete(handle); return { closed: true }; },
    '["network","fetch"]': async request => {
      const parsed = new URL(request.url), resource = [...transports.values()].find(r => r.url === parsed.origin);
      if (!resource) throw new Error('no fixture resource for ' + parsed.origin);
      if (/^\/\.gozar-/.test(parsed.pathname)) counts.probes++;
      const response = await fetch('http://' + resource.target + parsed.pathname + parsed.search, { method: request.method, headers: request.headers });
      const chunks = []; let last = Date.now();
      for await (const chunk of response.body) { const at = Date.now(); chunks.push({ data: Buffer.from(chunk).toString('base64'), delayMs: at - last }); last = at; }
      return { status: response.status, headers: Object.fromEntries(response.headers), chunks };
    },
  }));
  const dispatchEffect = async request => {
    const handler = handlers.get(JSON.stringify([request?.kind, request?.operation]));
    if (!handler) throw Object.assign(new Error('No matching testing effect: ' + JSON.stringify([request?.kind, request?.operation])), { code: 'unsupported' });
    try { return structuredClone(await handler(structuredClone(request.input))); }
    catch { throw Object.assign(new Error('The testing effect failed'), { code: 'provider_unavailable' }); }
  };
  const api = createRouteApi({
    manifest: registry.manifest, root: registry.root, dispatchEffect,
    readContext: fakeReadContext({ home }),
    expose: {
      ...(ack ? { acknowledgeOrigin: async request => { acks.push(structuredClone(request)); return ack(request); } } : {}),
      startTimeoutMs: 30_000, ...over,
    },
  });
  const q = { schemaVersion: 1, owner, operationId: 'ack-session-op', providerId: 'ack-session', home,
    usage: { kind: 'session', lifetimeMs: 120_000 }, target: '127.0.0.1:8799',
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } };
  const candidate = (await api.catalogRoutes(q)).candidates[0];
  assert.equal(candidate.eligible, true, JSON.stringify(candidate.unmet));
  return { api, home, owner, acks, counts, request: { ...q, wait: 'verified', approval: { kind: 'route', consentFactsDigest: candidate.consentFactsDigest,
    candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } } };
}

test('session parity: a correct acknowledgment permits the session proof; the request scope is the session handle', async t => {
  const world = await sessionWorld(t, { ack: request => ({ acknowledged: true, origin: request.origin,
    handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }) });
  const { value, error } = await settle(world.api.expose(world.request));
  if (error) throw error;
  assert.equal(value.state, 'usable');
  assert.ok(value.published);
  assert.equal(value.handle.kind, 'session');
  assert.equal(world.counts.probes >= 1, true, 'the session verification ran after the acknowledgment');
  assert.equal(world.acks.length, 1);
  assert.equal(world.acks[0].handle.kind, 'session');
  assert.equal(world.acks[0].handle.id, value.handle.id);
  assert.equal(world.acks[0].handle.generation, 1);
  assert.equal(world.acks[0].operationId, 'ack-session-op');
  assert.equal(world.acks[0].origin, value.origin);
  await world.api.closeRoute({ home: world.home, handle: value.handle, mode: 'remove' });
});

test('red: session parity: a held acknowledgment permits no proof and the session is withdrawn with exact cleanup', async t => {
  const held = deferred();
  const world = await sessionWorld(t, { ack: () => held.promise, over: { originAckTimeoutMs: 400 } });
  const outcome = await settle(world.api.expose(world.request));
  assert.ok(outcome.error, 'the session start must fail while the acknowledgment is held');
  assert.equal(outcome.error.code, 'verification_failed');
  assert.equal(world.counts.probes, 0, 'no session verification request left Gozar');
  assert.equal(world.counts.closes, 1, 'the session transport was removed');
  assert.equal(outcome.error.route?.cleanup?.state, 'confirmed');
  held.resolve({ acknowledged: true, origin: 'https://anything.example', handle: { id: 'x', generation: 1 }, attemptId: 'late' });
  await sleep(200);
  assert.equal(world.counts.probes, 0, 'the late acknowledgment changes nothing');
});

// --- Broker-level obligations for the new channel method --------------------------------------------------------

test('the acknowledgeOrigin broker method: undeclared is unsupported, unauthenticated is refused, and a held acknowledgment never blocks the channel', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createEmbeddingServices } = await import('../../packages/gozar-node/embedding-services.mjs');
  const { startEmbeddingBroker, connectEmbeddingBroker } = await import('../../packages/gozar-node/embedding-broker.mjs');
  const home = await mkdtemp(join(tmpdir(), 'ack-broker-'));
  try {
    const identity = { instanceId: 'ack-host', bootId: 'ack-boot' };
    const services = createEmbeddingServices({ registryId: 'ack-broker', identity });
    const undeclared = await startEmbeddingBroker({ services, home, identity });
    const first = await connectEmbeddingBroker({ descriptor: await undeclared.registerController({ identity }), identity });
    await assert.rejects(first.acknowledgeOrigin({ owner: 'o', providerId: 'p', origin: 'https://x.example', attemptId: 'a' }),
      { code: 'unsupported' });
    await undeclared.close();

    let release;
    const held = new Promise(resolve => { release = resolve; });
    const broker = await startEmbeddingBroker({ services: { ...services, ping: services.ping }, home, identity,
      acknowledgeOrigin: async () => { await held; return { acknowledged: true, origin: 'https://x.example', handle: { id: 'h', generation: 1 }, attemptId: 'a' }; } });
    const descriptor = await broker.registerController({ identity });
    const client = await connectEmbeddingBroker({ descriptor, identity });
    const pending = client.acknowledgeOrigin({ owner: 'o', providerId: 'p', origin: 'https://x.example', attemptId: 'a' });
    // The held acknowledgment must not occupy the per-socket queue: a configuration read on the same
    // channel still completes, so a hung host handler cannot block the controller's cleanup path.
    const reply = await client.readConfiguration({ owner: 'o', providerId: 'ack-broker' });
    assert.ok(reply, 'the channel answers while the acknowledgment is held');
    release();
    assert.deepEqual(await pending, { acknowledged: true, origin: 'https://x.example', handle: { id: 'h', generation: 1 }, attemptId: 'a' });
    // An unauthenticated call on the same socket is refused before any host handler runs.
    const forged = { ...identity, bootId: 'forged' };
    await assert.rejects(connectEmbeddingBroker({ descriptor, identity: forged }), { code: 'secret_backend_unavailable' });
    await broker.close();
  } finally { await rm(home, { recursive: true, force: true }); }
});

// --- Durable starts: the same typed boundary, awaited in-process before publication verification ------------

async function durableWorld(t, { ack, over = {} } = {}) {
  const registry = await fakeRegistry({ id: 'ack-durable', kinds: ['durable'], reach: 'internet' });
  t.after(() => registry.cleanup());
  const home = await scratch(t);
  const acks = [], verifies = { count: 0 };
  const api = createRouteApi({
    manifest: registry.manifest, root: registry.root,
    readContext: fakeReadContext({ home }),
    ...(ack ? { acknowledgeOrigin: async request => { acks.push(structuredClone(request)); return ack(request); } } : {}),
    ...(over.originAckTimeoutMs ? { originAckTimeoutMs: over.originAckTimeoutMs } : {}),
    verify: request => { verifies.count++; return { status: 'verified', checkedAt: new Date().toISOString() }; },
  });
  const q = { schemaVersion: 1, owner: 'fixture-owner', target: '127.0.0.1:8799', home, operationId: 'durable-ack-op',
    usage: { kind: 'durable', routeId: 'ack-route' },
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } };
  const candidate = (await api.catalogRoutes(q)).candidates[0];
  assert.equal(candidate.eligible, true);
  return { api, home, acks, verifies, request: { ...q, approval: { kind: 'route', consentFactsDigest: candidate.consentFactsDigest,
    candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } } };
}

test('durable: a correct acknowledgment permits publication verification', async t => {
  const world = await durableWorld(t, { ack: request => ({ acknowledged: true, origin: request.origin,
    handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }) });
  const view = await world.api.ensureRoute(world.request);
  assert.equal(view.state, 'usable');
  assert.ok(view.published);
  assert.equal(world.verifies.count, 1, 'the durable verification ran once');
  assert.equal(world.acks.length, 1);
  assert.deepEqual(world.acks[0].handle, { kind: 'durable', id: 'ack-route', generation: 1 });
  assert.equal(world.acks[0].operationId, 'durable-ack-op');
  assert.equal(world.acks[0].owner, 'fixture-owner');
  assert.equal(world.acks[0].home, world.home);
  assert.equal(world.acks[0].origin, view.origin);
  await world.api.closeRoute({ home: world.home, handle: view.handle, mode: 'remove' });
});

test('red: durable foreign-origin or held acknowledgments never publish', async t => {
  for (const ack of [
    request => ({ acknowledged: true, origin: 'https://foreign.example', handle: { id: request.handle.id, generation: 1 }, attemptId: request.attemptId }),
    () => new Promise(() => {}),
  ]) {
    const world = await durableWorld(t, { ack, over: { originAckTimeoutMs: 300 } });
    const view = await world.api.ensureRoute(world.request);
    assert.equal(view.state, 'unverified', 'a bad or missing acknowledgment leaves the durable route unverified');
    assert.equal(view.published, null, 'nothing is published');
    assert.equal(world.verifies.count, 0, 'no publication verification ran');
    assert.equal(view.origin, view.allocatedOrigin ?? view.origin, 'the allocated origin stays observable');
    await world.api.closeRoute({ home: world.home, handle: view.handle, mode: 'remove' });
  }
});

test('durable: a host that declares no boundary keeps the 0.5.1 behavior', async t => {
  const world = await durableWorld(t);
  const view = await world.api.ensureRoute(world.request);
  assert.equal(view.state, 'usable');
  assert.ok(view.published);
  assert.equal(world.acks.length, 0);
  await world.api.closeRoute({ home: world.home, handle: view.handle, mode: 'remove' });
});

test('durable: a later reconcile proof (ensure on an existing route) passes the acknowledgment first; a refused one runs no challenge', async t => {
  let mode = 'accept';
  const world = await durableWorld(t, { ack: request => mode === 'accept' ? ({ acknowledged: true, origin: request.origin,
    handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }) : ({ acknowledged: false }) });
  const view = await world.api.ensureRoute(world.request);
  assert.equal(view.state, 'usable');
  const proofs = world.verifies.count, asked = world.acks.length;
  mode = 'refuse';
  const again = await world.api.ensureRoute({ ...world.request, approval: undefined }).catch(error => ({ error }));
  assert.ok(world.acks.length > asked, 'the reconcile proof asked the host to acknowledge the exact origin first');
  assert.equal(world.verifies.count, proofs, 'a refused acknowledgment ran no challenge');
  await world.api.closeRoute({ home: world.home, handle: view.handle, mode: 'remove' });
});
