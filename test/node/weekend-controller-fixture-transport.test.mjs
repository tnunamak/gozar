import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { Controller } from '../../packages/gozar-node/controller.mjs';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { fixture } from './helpers.mjs';

const address = '192.0.2.55';
const recipe = { kind: 'local-forwarder', bindAddress: address, port: 0 };
const remove = { kind: 'local-forwarder' };
function transport() {
  return { kind: 'local-forwarder', operation: 'authorize', async handle(input, context) {
    assert.equal(context.fixture, true);
    return { ...input, fixture: true, authorityRef: 'controller-fixture-selection',
      interfaces: { fixture0: [{ address, internal: false }] }, firewallApproved: true,
      observedAtMs: input.nowMs, expiresAtMs: input.nowMs + 5000 };
  } };
}
async function listen(t) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
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
async function setup(t, targetPort) {
  // Reuse the existing private journal fixture, not a replacement state machine.
  const { journal, adapter, driver } = await fixture(t, { create: recipe, remove },
    { targetPort, bindAddresses: [address], firewallApproved: true });
  return { step: await loadCore(), journal, adapters: [adapter], adapter,
    requirements: { clientReach: 'this-device' }, targetPort,
    sessionId: driver.sessionId, bindAddresses: [address], firewallApproved: true };
}
test('Controller forwards explicit fixture authority and real core start/stop owns only its loopback listener',
  { timeout: 15000 }, async t => {
    const targetPort = await listen(t), foreignPort = await listen(t);
    const args = await setup(t, targetPort), port = transport();
    const controller = new Controller({ ...args, fixtureLocalTransport: port });
    try {
      assert.equal(controller.driver.fixtureLocalTransport, port);
      assert.deepEqual(controller.driver.bindAddresses, [address]);
      assert.equal(controller.driver.firewallApproved, true);
      const host = await prepareHost(controller.driver,
        { bindings: { selected: { type: 'selected-interface-address' } } });
      assert.equal(host.bindings.selected.value, address);
      assert.equal(host.bindings.selected.fixture, true);
      assert.equal(host.facts['firewall-user-approved'].value.targetPort, targetPort);
      const dispatched = [];
      controller.beforeEffect = effect => { dispatched.push(effect); };
      await controller.command({ type: 'start', adapterId: args.adapter.id, consent: true });
      assert.ok(dispatched.some(effect => effect.kind === 'local-forwarder' && effect.operation === 'create'));
      assert.equal(controller.driver.forwarders.size, 0);
      assert.equal(controller.driver.fixtureForwarders.size, 1);
      const [resource] = Object.values(args.journal.value.owned).filter(row => row.kind === 'local-forwarder');
      assert.ok(resource);
      assert.equal(resource.sessionId, args.sessionId);
      assert.equal(resource.syntheticTransport.bindAddress, '127.0.0.1');
      const localPort = resource.syntheticTransport.port;
      const bytes = Buffer.concat([Buffer.from('controller-nonce:'), randomBytes(64), Buffer.from([0, 255, 13, 10])]);
      assert.deepEqual(await exchange(localPort, bytes), bytes);
      assert.deepEqual(await exchange(foreignPort, bytes), bytes);
      const stopped = await controller.shutdown();
      assert.deepEqual(stopped.localCleanupFailures, []);
      assert.equal(stopped.snapshot.phase, 'stopped');
      assert.equal(controller.driver.fixtureForwarders.size, 0);
      assert.equal(Object.keys(args.journal.value.owned).length, 0);
      await assert.rejects(exchange(localPort, bytes), error => error.code === 'ECONNREFUSED');
      assert.deepEqual(await exchange(targetPort, bytes), bytes);
      assert.deepEqual(await exchange(foreignPort, bytes), bytes);
      assert.equal(args.journal.value.fixtureLocalTransport, undefined);
    } finally {
      // Even a failed core assertion must drain only this driver's owned sockets.
      const failures = await controller.driver.closeLocal();
      assert.deepEqual(failures, []);
    }
  });
test('Controller default leaves synthetic selected address unauthorized', { timeout: 10000 }, async t => {
  const targetPort = await listen(t), args = await setup(t, targetPort);
  const controller = new Controller(args);
  try {
    assert.equal(controller.driver.fixtureLocalTransport, null);
    const host = await prepareHost(controller.driver,
      { bindings: { selected: { type: 'selected-interface-address' } } });
    assert.equal(host.bindings.selected, undefined);
    assert.equal(host.facts['selected-interface-still-present'], undefined);
    assert.equal(host.facts['firewall-user-approved'], undefined);
    await assert.rejects(controller.driver.forward({ operation: 'create', generation: 1,
      bindAddress: address, port: 0 }), /Firewall prerequisite/);
    assert.equal(controller.driver.forwarders.size, 0);
    assert.equal(controller.driver.fixtureForwarders.size, 0);
    assert.equal(Object.keys(args.journal.value.owned).length, 0);
  } finally { assert.deepEqual(await controller.driver.closeLocal(), []); }
});
test('supplied driver takes precedence without installing or replacing its fixture authority',
  { timeout: 10000 }, async t => {
    const targetPort = await listen(t), args = await setup(t, targetPort);
    const original = new Controller(args);
    const supplied = original.driver, originalPort = transport(), ignoredPort = transport();
    supplied.fixtureLocalTransport = originalPort;
    const controller = new Controller({ ...args, driver: supplied, fixtureLocalTransport: ignoredPort });
    try {
      assert.equal(controller.driver, supplied);
      assert.equal(supplied.fixtureLocalTransport, originalPort);
      assert.notEqual(supplied.fixtureLocalTransport, ignoredPort);
      const host = await prepareHost(supplied, { bindings: { selected: { type: 'selected-interface-address' } } });
      assert.equal(host.bindings.selected.fixture, true);
      assert.equal(supplied.fixtureForwarders.size, 0);
    } finally { assert.deepEqual(await supplied.closeLocal(), []); }
  });
