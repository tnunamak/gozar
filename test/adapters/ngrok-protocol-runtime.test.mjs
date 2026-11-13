import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runAttachedController, controlAttached } from '../../packages/gozar-node/attached-route.mjs';
import { createAttachedEffectContext } from '../../packages/gozar-node/adapter-runtime.mjs';
import { storeSecret } from '../../packages/gozar-node/secret-store.mjs';
import { bindSetupValue } from '../../packages/gozar-node/adapter-configuration.mjs';
import { createNgrokTcpAdapter } from '../../adapters/providers/ngrok-tcp-passthrough/index.mjs';
import { createNgrokTlsAdapter } from '../../adapters/providers/ngrok-tls-passthrough/index.mjs';

const credentials = { key: await readFile(new URL('./fixtures/stream-proof-key.pem', import.meta.url)), cert: await readFile(new URL('./fixtures/stream-proof-cert.pem', import.meta.url)) };
const ctx = { platform: 'linux', now: Date.now, generation: 1, assertGeneration: async () => {}, configuration: async () => ({ auth: 'synthetic-secret', 'reserved-domain': 'reserved.example.com' }) };
const request = { target: '127.0.0.1:8123', origin: null, configurationRef: null, usage: { kind: 'attached' }, requirements: {} };
const attempt = signal => ({ id: 'attempt-runtime', nonce: 'synthetic-runtime-nonce', deadlineMs: Date.now() + 2000, signal: signal ?? new AbortController().signal });
const relaySdk = () => {
  const calls = [], opened = [];
  return { calls, opened, async forward(options) {
    calls.push(options);
    const sockets = new Set();
    const relay = net.createServer({ allowHalfOpen: true }, socket => {
      const [host, p] = options.addr.split(':'); const upstream = net.connect({ host, port: Number(p) });
      sockets.add(socket); sockets.add(upstream);
      socket.on('error', () => {}); upstream.on('error', () => socket.destroy()); socket.once('close', () => upstream.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    const listener = { url: () => `tcp://127.0.0.1:${relay.address().port}`, closed: false, async close() {
      listener.closed = true; for (const socket of sockets) socket.destroy();
      await new Promise(resolve => relay.close(resolve));
    } };
    opened.push(listener); return listener;
  } };
};

test('SDK fake carries real TCP proof through the SAME listener and removal is idempotent', async t => {
  const sdk = relaySdk(), adapter = createNgrokTcpAdapter({ loadSdk: async () => sdk });
  assert.equal((await adapter.detect(ctx)).state, 'ready');
  const plan = await adapter.plan(ctx, request), current = attempt();
  const proof = await adapter.prepareProof(ctx, request, current); t.after(() => proof.close());
  const applied = { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) };
  const receipt = await adapter.create(ctx, applied); t.after(() => adapter.remove(ctx, receipt));
  assert.deepEqual(sdk.calls[0], { proto: 'tcp', authtoken: 'synthetic-secret', addr: proof.target });
  assert.equal(receipt.readback.target, request.target);
  assert.equal((await proof.verify({ origin: receipt.origin, receipt, attempt: current })).status, 'verified');
  assert.equal((await adapter.observe(ctx, request)).present, true);
  assert.equal((await adapter.verify(ctx, receipt)).status, 'unverified', 'HTTP verifier cannot supply stream proof');
  await assert.rejects(adapter.remove(ctx, { ...receipt, generation: 9 }));
  assert.equal(sdk.opened[0].closed, false);
  assert.deepEqual(await adapter.remove(ctx, receipt), { removed: true, debt: null });
  assert.deepEqual(await adapter.remove(ctx, receipt), { removed: true, debt: null });
  assert.equal(sdk.opened[0].closed, true);
  assert.ok(!JSON.stringify([plan, receipt, await adapter.detect(ctx)]).includes('synthetic-secret'));
});

test('TLS SDK options select passthrough without edge certificate/key or traffic policy', async t => {
  let seen, closed = false;
  const adapter = createNgrokTlsAdapter({ certificate: async () => credentials, certificateTool: async () => true,
    loadSdk: async () => ({ forward: async options => { seen = options; return { url: () => 'tls://reserved.example.com', close: async () => { closed = true; } }; } }) });
  const plan = await adapter.plan(ctx, request), proof = await adapter.prepareProof(ctx, request, attempt()); t.after(() => proof.close());
  const receipt = await adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) });
  assert.deepEqual(seen, { proto: 'tls', authtoken: 'synthetic-secret', addr: proof.target, domain: 'reserved.example.com' });
  assert.equal(receipt.origin, 'tls://reserved.example.com:443');
  assert.equal(adapter.definition.capabilities.transport, 'tls');
  assert.notEqual(adapter.configurationActions()[0].digest, createNgrokTcpAdapter().configurationActions()[0].digest, 'setup approval must bind the specific adapter disclosure');
  await adapter.remove(ctx, receipt); assert.equal(closed, true);
});

test('cancellation while SDK is opening closes late listener instead of resurrecting resource', async t => {
  let resolveOpen, started, lateClosed = false;
  const entered = new Promise(resolve => { started = resolve; });
  const adapter = createNgrokTcpAdapter({ loadSdk: async () => ({ forward: () => { started(); return new Promise(resolve => { resolveOpen = resolve; }); } }) });
  const controller = new AbortController(), current = attempt(controller.signal);
  const proof = await adapter.prepareProof(ctx, request, current); t.after(() => proof.close());
  const plan = await adapter.plan(ctx, request);
  const pending = adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) });
  await entered; controller.abort();
  await assert.rejects(pending, error => error.code === 'provider_unavailable');
  resolveOpen({ get closed(){return lateClosed;},url: () => 'tcp://127.0.0.1:9999', close: async () => { lateClosed = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateClosed, true); assert.equal((await adapter.observe(ctx, request)).present, false);
});

test('wrong SDK protocol/endpoint fails closed; setup descriptors stay adapter-owned', async t => {
  let closed = false;
  const adapter = createNgrokTcpAdapter({ loadSdk: async () => ({ forward: async () => ({ url: () => 'https://wrong.example.com', close: async () => { closed = true; } }) }) });
  const proof = await adapter.prepareProof(ctx, request, attempt()); t.after(() => proof.close());
  const plan = await adapter.plan(ctx, request);
  await assert.rejects(adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) }));
  assert.equal(closed, true);
  const missing = await adapter.detect({ ...ctx, configuration: async () => null });
  assert.deepEqual(adapter.setupActions(missing.facts).map(a => a.id), ['auth']);
  await assert.rejects(adapter.plan(ctx, { ...request, usage: { kind: 'session' } }), error => error.code === 'unsupported');
});

test('controller publishes only after proof; repeated fresh status retains proof time while app streams work', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-protocol-controller-'));
  const sdk = relaySdk(), adapter = createNgrokTcpAdapter({ loadSdk: async () => sdk });
  const app = net.createServer(socket => socket.pipe(socket));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const listener of sdk.opened) if (!listener.closed) await listener.close(); await new Promise(resolve => app.close(resolve)); await rm(home, { recursive: true, force: true }); });
  await bindSetupValue({ home, adapterId: adapter.id, actionId: 'auth', handle: (await storeSecret({ home, value: 'synthetic-secret' })).handle });
  const read = { ...ctx, home }, ask = { ...request, target: `127.0.0.1:${app.address().port}`, requirements: { transport: 'tcp', protocols: [] } };
  const plan = await adapter.plan(read, ask), directory = join(home, 'att_0123456789abcdef');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify({ id: 'att_0123456789abcdef', home, platform: 'linux', adapterId: adapter.id, request: ask, plan, leaseExpiryMs: 60000 }));
  const done = runAttachedController(directory, { adapters: [adapter], readContext: read, effectContext: createAttachedEffectContext });
  t.after(async () => { await controlAttached(directory, { type: 'close' }).catch(() => {}); await done; });
  let saved;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); } catch { /* startup */ }
    if (saved?.phase === 'usable' || saved?.phase === 'lost') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(saved?.phase, 'usable'); assert.ok(saved.lastView.published);
  const originalTime = saved.lastView.verification.checkedAt;
  const endpoint = new URL(saved.lastView.published), socket = net.connect({ host: endpoint.hostname, port: Number(endpoint.port) });
  t.after(() => socket.destroy()); await new Promise(resolve => socket.once('connect', resolve));
  const payload = Buffer.from([0, 255, 1, 128, 10, 13, 0]);
  const first = new Promise(resolve => socket.once('data', resolve)); socket.write(payload); assert.deepEqual(await first, payload);
  const status = await controlAttached(directory, { type: 'status', fresh: true });
  assert.equal(status.view.state, 'usable'); assert.equal(status.view.verification.checkedAt, originalTime);
  const second = new Promise(resolve => socket.once('data', resolve)); socket.write(payload); assert.deepEqual(await second, payload);
  socket.destroy();
  const closed = await controlAttached(directory, { type: 'close' }); assert.equal(closed.view.state, 'released'); await done;
  assert.equal(sdk.opened[0].closed, true);
});

test('TLS does not erase forbidden SDK URL components while inserting default port', async t => {
  let closed = false;
  const adapter = createNgrokTlsAdapter({ certificate: async () => credentials,
    loadSdk: async () => ({ forward: async () => ({ url: () => 'tls://reserved.example.com?policy=wrong', close: async () => { closed = true; } }) }) });
  const plan = await adapter.plan(ctx, request), proof = await adapter.prepareProof(ctx, request, attempt()); t.after(() => proof.close());
  await assert.rejects(adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) }));
  assert.equal(closed, true);
});

test('failed SDK removal reports debt and closes the forwarding gate; retry can finish cleanup', async t => {
  let fail = true, absent=false;
  const adapter = createNgrokTcpAdapter({ loadSdk: async () => ({ forward: async () => ({ get closed(){return absent;},url: () => 'tcp://127.0.0.1:9999', close: async () => { if (fail) throw new Error('synthetic-secret'); absent=true; } }) }) });
  const proof = await adapter.prepareProof(ctx, request, attempt()); t.after(() => proof.close());
  const plan = await adapter.plan(ctx, request), receipt = await adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) });
  const removal = await adapter.remove(ctx, receipt);
  assert.equal(removal.removed, false); assert.equal(removal.debt.code, 'close_failed');
  assert.ok(!JSON.stringify(removal).includes('synthetic-secret'));
  const [host, p] = proof.target.split(':');
  await assert.rejects(new Promise((resolve, reject) => { const s = net.connect({ host, port: Number(p) }); s.once('connect', () => { s.destroy(); resolve(); }); s.once('error', reject); }));
  fail = false; assert.deepEqual(await adapter.remove(ctx, receipt), { removed: true, debt: null });
});

test('provider close timeout returns cleanup debt instead of hanging stop', async t => {
  const adapter = createNgrokTcpAdapter({ closeTimeoutMs: 20,
    loadSdk: async () => ({ forward: async () => ({ url: () => 'tcp://127.0.0.1:9999', close: () => new Promise(() => {}) }) }) });
  const proof = await adapter.prepareProof(ctx, request, attempt()); t.after(() => proof.close());
  const plan = await adapter.plan(ctx, request), receipt = await adapter.create(ctx, { ...plan, effects: plan.effects.map(e => ({ ...e, target: proof.target })) });
  const started = Date.now(), removal = await adapter.remove(ctx, receipt);
  assert.equal(removal.removed, false); assert.equal(removal.debt.code, 'close_failed');
  assert.ok(Date.now() - started < 1000);
});
