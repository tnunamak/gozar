import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGozar } from '@tnunamak/gozar';
import { fakeRegistry, createTestingGozar } from '@tnunamak/gozar/testing';
import { startEmbeddingBroker, connectEmbeddingBroker } from '../../packages/gozar-node/embedding-broker.mjs';

async function fixture() {
  const parent = join(homedir(), '.tmp');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(parent, 'supervisor-'));
  await chmod(home, 0o700);
  const app = http.createServer((_req, res) => res.end('foreign-app-still-owned'));
  try {
    await new Promise((resolve, reject) => {
      app.once('error', reject); app.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) { await rm(home, { recursive: true, force: true }); throw error; }
  const target = '127.0.0.1:' + app.address().port;
  return { home, target, async close() {
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
    await rm(home, { recursive: true, force: true });
  } };
}
function query(f) {
  return { schemaVersion: 1, home: f.home, owner: 'fixture-owner', target: f.target,
    usage: { kind: 'attached' },
    requirements: { reach: 'this-device', transport: 'tcp', payloadAccess: 'allow-provider',
      address: 'any', setup: 'allow', protocols: [] } };
}
function approval(candidate) {
  assert.equal(typeof candidate.candidateToken, 'string');
  return { kind: 'route', candidateToken: candidate.candidateToken,
    disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest };
}
function assertIdentity(route, identity, target) {
  assert.equal(route.verification.status, 'verified');
  assert.equal(route.verification.subject.instanceId, identity.instanceId);
  assert.equal(route.verification.subject.bootId, identity.bootId);
  assert.equal(route.verification.subject.handleGeneration, route.handle.generation);
  assert.equal(route.verification.subject.target, target);
}
async function appPresent(target) {
  const value = await new Promise((resolve, reject) => {
    const req = http.get('http://' + target, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.once('end', () => resolve(text)); res.once('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('app probe timeout')));
    req.once('error', reject);
  });
  assert.equal(value, 'foreign-app-still-owned');
}
async function socketPresent(origin) {
  const url = new URL(origin);
  assert.ok(['tcp:', 'http:'].includes(url.protocol), 'fixture advertises local clear transport');
  return new Promise(resolve => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    const finish = present => { socket.destroy(); resolve(present); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(2000, () => finish(false));
  });
}

for (let n = 0; n < 2; n++) {
  test('unknown public echo provider preserves supplied supervisor identity ' + n, async () => {
    const f = await fixture();
    let registry, api, route;
    try {
      registry = await fakeRegistry({ id: 'unknown-' + randomUUID(), dir: join(f.home, 'registry-' + randomUUID()),
        kinds: ['attached'], reach: 'this-device', transport: 'tcp', proofProtocol: 'echo', setupActions: [] });
      const identity = { instanceId: randomUUID(), bootId: randomUUID() };
      api = createGozar({ manifest: registry.manifest, root: registry.root, identity });
      const q = query(f);
      const catalog = await api.catalogRoutes(q);
      assert.equal(catalog.candidates.length, 1);
      route = await api.expose({ ...q, operationId: randomUUID(), wait: 'verified',
        approval: approval(catalog.candidates[0]) });
      assertIdentity(route, identity, q.target);
      assertIdentity(await api.routeStatus({ home: f.home, handle: route.handle }), identity, q.target);
      const origin = route.origin;
      assert.equal(typeof origin, 'string');
      assert.equal(await socketPresent(origin), true);
      const closed = await api.closeRoute({ home: f.home, handle: route.handle, mode: 'remove' });
      assert.equal(closed.cleanup.state, 'confirmed');
      assert.equal(await socketPresent(origin), false);
      await appPresent(f.target);
      route = null;
    } finally {
      try { if (route) await api.closeRoute({ home: f.home, handle: route.handle, mode: 'remove' }); }
      finally { try { await registry?.cleanup(); } finally { await f.close(); } }
    }
  });
}

// A stateful fake process boundary: its advertised HTTPS origin is relayed to
// the real local gate. Proof bytes always originate at that gate, never here.
function processEffects() {
  const owned = new Map(), opened = [], closed = [];
  const detect = async () => ({ available: true });
  const read = async ({ handle }) => ({ present: owned.has(handle) });
  return { owned, opened, closed, read, effects: [
    { kind: 'process-runtime', operation: 'detect', handle: detect },
    { kind: 'process-runtime', operation: 'open', handle: async input => {
      const handle = randomUUID();
      owned.set(handle, { origin: input.origin, target: input.target });
      opened.push(handle);
      return { handle };
    } },
    { kind: 'process-runtime', operation: 'read', handle: read },
    { kind: 'process-runtime', operation: 'close', handle: async ({ handle }) => {
      const removed = owned.delete(handle);
      if (removed) closed.push(handle);
      return { closed: removed };
    } },
    { kind: 'sdk-listener', operation: 'detect', handle: async () => ({ available: false }) },
    { kind: 'recipe', operation: 'probe', handle: async () => ({ stdout: '', stderr: '', exitCode: 1 }) },
    { kind: 'network', operation: 'fetch', handle: async input => {
      const advertised = new URL(input.url);
      const entry = [...owned.values()].find(row => new URL(row.origin).origin === advertised.origin);
      if (!entry) throw new Error('no owned relay');
      const gate = new URL(String(entry.target).includes('://') ? entry.target : 'http://' + entry.target);
      assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(gate.hostname), 'relay is local only');
      return new Promise((resolve, reject) => {
        const headers = { ...input.headers, host: advertised.host };
        const req = http.request({ hostname: gate.hostname, port: gate.port, method: input.method,
          path: advertised.pathname + advertised.search, headers }, res => {
          const chunks = []; let last = Date.now();
          res.on('data', data => {
            const now = Date.now(); chunks.push({ data: Buffer.from(data).toString('base64'), delayMs: now - last }); last = now;
          });
          res.once('error', reject);
          res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('relay timeout')));
        req.once('error', reject); req.end();
      });
    } },
  ] };
}

async function configure(api, q, candidate) {
  const providerId = candidate.providerId;
  // Draft CAS and every later read/mutation use the catalog's explicit owner.
  let draft = await api.beginConfigurationDraft({ home: q.home, owner: q.owner, providerId,
    expectedConfigurationRevision: candidate.configuration.revision });
  const done = new Set();
  for (let count = 0; count < 32; count++) {
    draft = await api.readConfigurationDraft({ home: q.home, owner: q.owner, providerId, draftId: draft.draftId });
    const input = draft.configuration.inputRequirements.find(row => !done.has(row.id));
    if (!input) break;
    let action = draft.configuration.actions.find(row => row.id === input.actionId);
    assert.ok(action?.consent, 'input has a current offered consent');
    let answer;
    if (input.secret) {
      const stored = await api.storeSecret({ home: q.home, owner: q.owner, providerId, inputId: input.id,
        scopeId: draft.scopeId, expectedConfigurationRevision: draft.configuration.revision,
        draftId: draft.draftId, bytes: new TextEncoder().encode('synthetic-account-' + randomUUID()) });
      answer = { secretHandle: stored.handle };
      draft = await api.readConfigurationDraft({ home: q.home, owner: q.owner, providerId, draftId: draft.draftId });
      action = draft.configuration.actions.find(row => row.id === input.actionId);
      assert.ok(action?.consent);
    } else {
      assert.ok(['https-origin', 'domain', 'text'].includes(input.kind));
      answer = { value: input.kind === 'https-origin' ? 'https://fixture.example.invalid'
        : input.kind === 'domain' ? 'fixture.example.invalid' : randomUUID() };
    }
    await api.runSetupAction({ home: q.home, owner: q.owner, providerId, actionId: action.id,
      draftId: draft.draftId, expectedConfigurationRevision: draft.configuration.revision, ...answer,
      approval: { kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
        consentFactsDigest: action.consent.consentFactsDigest } });
    done.add(input.id);
    draft = await api.readConfigurationDraft({ home: q.home, owner: q.owner, providerId, draftId: draft.draftId });
  }
  assert.ok(draft.configuration.inputRequirements.every(row => done.has(row.id)), 'bounded configuration completed');
  await api.commitConfigurationDraft({ home: q.home, owner: q.owner, providerId, draftId: draft.draftId,
    expectedConfigurationRevision: draft.configuration.revision });
}

test('shipped process adapter public proof uses exact supervisor and actual gate', async () => {
  const f = await fixture(), fx = processEffects();
  let harness, route;
  try {
    const identity = { instanceId: randomUUID(), bootId: randomUUID() };
    harness = await createTestingGozar({ identity, effects: fx.effects });
    const api = harness.gozar;
    // Selecting shipped inventory is test-only, never a production provider branch.
    const q = { ...query(f), providerId: 'cloudflare-named', origin: 'https://fixture.example.invalid',
      requirements: { ...query(f).requirements, reach: 'internet', transport: 'https' } };
    let candidate = (await api.catalogRoutes(q)).candidates.find(row => row.providerId === q.providerId);
    assert.ok(candidate);
    await configure(api, q, candidate);
    candidate = (await api.catalogRoutes(q)).candidates.find(row => row.providerId === q.providerId);
    assert.ok(candidate?.eligible);
    route = await api.expose({ ...q, operationId: randomUUID(), wait: 'verified', approval: approval(candidate) });
    assertIdentity(route, identity, q.target);
    assert.ok(fx.opened.length > 0, 'actual process adapter requested an owned process');
    for (const handle of fx.opened) assert.equal((await fx.read({ handle })).present, true);
    assert.equal((await api.closeRoute({ home: f.home, handle: route.handle, mode: 'remove' })).cleanup.state, 'confirmed');
    for (const handle of fx.opened) {
      assert.equal((await fx.read({ handle })).present, false);
      assert.ok(fx.closed.includes(handle));
    }
    assert.equal(fx.owned.size, 0);
    await appPresent(f.target);
    route = null;
  } finally {
    try { if (route) await harness.gozar.closeRoute({ home: f.home, handle: route.handle, mode: 'remove' }); }
    finally { try { await harness?.close(); } finally { await f.close(); } }
  }
});

test('broker admits first identity once and rotates only to never-admitted boots', async () => {
  const f = await fixture();
  let broker, oldClient, client;
  const identity = { instanceId: randomUUID(), bootId: randomUUID() };
  let losses = 0;
  try {
    broker = await startEmbeddingBroker({ home: f.home, identity,
      services: { readConfiguration: async () => ({ fixture: true }) }, onLoss: () => { losses++; } });
    await assert.rejects(broker.registerController({ identity: { ...identity, bootId: randomUUID() } }));
    const first = await broker.registerController();
    assert.equal(first.instanceId, identity.instanceId); assert.equal(first.bootId, identity.bootId);
    assert.equal(losses, 0);
    oldClient = await connectEmbeddingBroker({ descriptor: first, identity });
    await assert.rejects(connectEmbeddingBroker({ descriptor: first, identity: { ...identity, bootId: 'wrong' } }));
    for (const next of [undefined, identity, { ...identity, bootId: '' },
      { instanceId: 'foreign', bootId: randomUUID() }]) {
      await assert.rejects(broker.registerController(next ? { identity: next } : undefined));
    }
    const next = { ...identity, bootId: randomUUID() };
    const descriptor = await broker.registerController({ identity: next });
    assert.ok(losses > 0);
    await assert.rejects(oldClient.readConfiguration({}));
    await assert.rejects(broker.registerController({ identity }));
    client = await connectEmbeddingBroker({ descriptor, identity: next });
    assert.deepEqual(await client.readConfiguration({}), { fixture: true });
  } finally {
    oldClient?.close(); client?.close();
    try { await broker?.close(); } finally { await f.close(); }
  }
});
