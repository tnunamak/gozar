// Conservative assumption: missing expiry contract must not broaden cleanup
// authority. These tests prove existing identity-bound cleanup only, NOT an
// implemented expiring route or deadline/publication lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeController, stopController } from '../../packages/gozar-node/controller-start.mjs';

const record = { pid: 12345, startIdentity: 'fixture-start' };
function effects(observe) {
  const calls = [];
  return {
    calls,
    identity: async pid => { assert.equal(pid, record.pid); return observe(); },
    kill: (pid, signal) => { calls.push({ pid, signal }); },
    graceMs: 0, killWaitMs: 0, pollMs: 0,
  };
}
test('conservative expiry assumption: reused PID is never a cleanup target', async () => {
  const fx = effects(() => 'different-start');
  assert.equal(await observeController(record, fx), 'foreign');
  assert.deepEqual(await stopController(record, fx), { state: 'foreign', pid: record.pid });
  assert.deepEqual(fx.calls, []);
});
test('conservative expiry assumption: unreadable identity without child handle stays unconfirmed', async () => {
  const fx = effects(() => { throw new Error('synthetic identity unavailable'); });
  const result = await stopController(record, fx);
  assert.equal(result.state, 'unconfirmed');
  assert.equal(result.pid, record.pid);
  assert.deepEqual(fx.calls, []);
});
test('conservative expiry assumption: absent controller needs no signal', async () => {
  const fx = effects(() => null);
  assert.deepEqual(await stopController(record, fx), { state: 'gone', pid: record.pid });
  assert.deepEqual(fx.calls, []);
});
test('conservative expiry assumption: late PID replacement forbids stronger cleanup signal', async () => {
  let observations = 0;
  // Initial and grace-period observations identify our controller. Immediately
  // before SIGKILL the PID belongs to another process.
  const fx = effects(() => ++observations <= 2 ? 'fixture-start' : 'replacement-start');
  const result = await stopController(record, fx);
  assert.equal(result.state, 'stopped');
  assert.equal(observations, 3);
  assert.deepEqual(fx.calls, [{ pid: -record.pid, signal: 'SIGTERM' }]);
});
test('conservative expiry assumption: successful signal acknowledgement is not cessation proof', async () => {
  const fx = effects(() => 'fixture-start');
  const result = await stopController(record, fx);
  assert.equal(result.state, 'unconfirmed');
  assert.deepEqual(fx.calls, [
    { pid: -record.pid, signal: 'SIGTERM' },
    { pid: -record.pid, signal: 'SIGKILL' },
  ]);
});
test('conservative expiry assumption: exited child handle prevents signals despite old identity', async () => {
  const fx = effects(() => { throw new Error('identity must not be consulted after child exit'); });
  const result = await stopController({ ...record, child: { exitCode: 0, signalCode: null } }, fx);
  assert.equal(result.state, 'gone');
  assert.deepEqual(fx.calls, []);
});
