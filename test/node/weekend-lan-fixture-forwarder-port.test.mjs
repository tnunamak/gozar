import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';
import { fixture, effect, persist } from './helpers.mjs';

const address = '192.0.2.55';
const recipe = { kind: 'local-forwarder', bindAddress: address, port: 0 };
const remove = { kind: 'local-forwarder' };
function port(overrides = {}) {
  return { kind: 'local-forwarder', operation: 'authorize', async handle(input, context) {
    assert.equal(context.fixture, true);
    return { ...input, fixture: true, authorityRef: 'fixture-selection',
      interfaces: { fixture0: [{ address, internal: false }] },
      firewallApproved: true, observedAtMs: input.nowMs, expiresAtMs: input.nowMs + 5000,
      ...overrides };
  } };
}
async function listen(t, handler) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); handler(socket);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
async function exchange(port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const chunks = [];
    socket.setTimeout(2000, () => socket.destroy(new Error('exchange timeout')));
    socket.on('connect', () => socket.write(bytes));
    socket.on('data', chunk => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length >= bytes.length) {
        const result = Buffer.concat(chunks); socket.destroy(); resolve(result);
      }
    });
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('error', reject);
  });
}
test('fixture transport preserves logical scope while forwarding real bytes and removing only its socket', async t => {
  const targetPort = await listen(t, socket => socket.pipe(socket));
  const foreignPort = await listen(t, socket => socket.pipe(socket));
  const { driver, journal } = await fixture(t, { create: recipe, remove }, { targetPort, bindAddresses: [address] });
  driver.fixtureLocalTransport = port();
  const host = await prepareHost(driver, { bindings: { selected: { type: 'selected-interface-address' } } });
  assert.equal(host.bindings.selected.value, address);
  assert.equal(host.facts['firewall-user-approved'].value.targetPort, targetPort);
  assert.equal(host.facts['selected-interface-still-present'].fixture, true);
  await persist(driver);
  const created = await driver.execute(effect(recipe, 'create'));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.ok(created.result.origin.startsWith('http://192.0.2.55:'));
  assert.equal(created.result.syntheticTransport.bindAddress, '127.0.0.1');
  assert.equal(driver.forwarders.size, 0);
  assert.equal(driver.fixtureForwarders.size, 1);
  const nonce = Buffer.from(randomUUID());
  assert.deepEqual(await exchange(created.result.port, nonce), nonce);
  await assert.rejects(driver.forward({ operation: 'remove', resourceId: 'foreign' }));
  assert.deepEqual(await exchange(foreignPort, nonce), nonce);
  await persist(driver, 'remove', created.result.resourceId, 2);
  assert.equal((await driver.execute(effect(remove, 'remove', 'remove-fixture', { resourceId: created.result.resourceId, generation: 2 }))).ok, true);
  await assert.rejects(exchange(created.result.port, nonce), error => error.code === 'ECONNREFUSED');
  assert.deepEqual(await exchange(foreignPort, nonce), nonce);
  assert.equal(Object.keys(journal.value.owned).length, 0);
});
test('missing, stale and mismatched fixture authority refuse before allocation', async t => {
  const targetPort = await listen(t, socket => socket.pipe(socket));
  for (const invalid of [{ fixture: false }, { sessionId: 'foreign' }, { generation: 9 },
    { targetPort: targetPort + 1 }, { selectedAddress: '192.0.2.56' }, { firewallApproved: false },
    { expiresAtMs: 0 }, { observedAtMs: Number.MAX_SAFE_INTEGER }, { interfaces: {} }]) {
    const { driver } = await fixture(t, { create: recipe, remove }, { targetPort, bindAddresses: [address] });
    driver.fixtureLocalTransport = port(invalid);
    await persist(driver);
    assert.equal((await driver.execute(effect(recipe, 'create'))).ok, false);
    assert.equal(driver.fixtureForwarders.size, 0);
    assert.equal(driver.forwarders.size, 0);
  }
});
test('default driver still refuses a synthetic nonlocal address', async t => {
  const { driver } = await fixture(t, { create: recipe }, { bindAddresses: [address], firewallApproved: true });
  await persist(driver);
  assert.equal((await driver.execute(effect(recipe, 'create'))).ok, false);
});
test('fixture selection is rechecked at allocation and recovery cannot infer absence', async t => {
  const targetPort = await listen(t, socket => socket.pipe(socket));
  const { driver, journal, adapter } = await fixture(t, { create: recipe, remove }, { targetPort, bindAddresses: [address] });
  driver.fixtureLocalTransport = port();
  await prepareHost(driver, { bindings: {} });
  driver.fixtureLocalTransport = port({ firewallApproved: false });
  await persist(driver);
  assert.equal((await driver.execute(effect(recipe, 'create', 'recheck'))).ok, false);
  driver.fixtureLocalTransport = port();
  const intent = await driver.execute({ kind: 'persist', operation: 'create', sessionId: 'test', generation: 1,
    id: 'fixture-retry-intent', adapterId: driver.selectedAdapter,
    record: { operation: 'create', sessionId: 'test', generation: 1, adapterId: driver.selectedAdapter } });
  assert.equal(intent.ok, true, JSON.stringify(intent));
  const created = await driver.execute(effect(recipe, 'create', 'fresh-create'));
  assert.equal(created.ok, true, JSON.stringify(created));
  const recovered = new EffectDriver({ adapters: [adapter], journal, sessionId: 'test', targetPort });
  await assert.rejects(recovered.forward({ operation: 'remove', resourceId: created.result.resourceId }), /unconfirmed/);
  assert.equal(await recovered.continuity(created.result.resourceId), null);
  assert.ok(journal.value.owned[created.result.resourceId]);
});

test('authority loss while authorization is pending refuses before allocation', { timeout: 10000 }, async t => {
  const targetPort = await listen(t, socket => socket.pipe(socket));
  for (const mutate of [
    driver => { driver.bindAddresses = []; },
    driver => { driver.generation = 2; },
    driver => { driver.selectedAdapter = 'changed-selection'; },
    driver => { driver.stopped = true; },
  ]) {
    const { driver, journal } = await fixture(t, { create: recipe, remove }, { targetPort, bindAddresses: [address] });
    let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const allowed = port();
    driver.fixtureLocalTransport = { ...allowed, async handle(input, context) {
      const result = await allowed.handle(input, context);
      entered(); await gate; return result;
    } };
    await persist(driver);
    const creating = driver.execute(effect(recipe, 'create'));
    try {
      await waiting;
      mutate(driver);
    } finally { release(); }
    assert.equal((await creating).ok, false);
    assert.equal(driver.fixtureForwarders.size, 0);
    assert.equal(driver.forwarders.size, 0);
    assert.equal(Object.values(journal.value.owned).filter(row => row.kind === 'local-forwarder').length, 0);
  }
});
