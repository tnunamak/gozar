import assert from 'node:assert/strict';
import test from 'node:test';
import lan from '../../adapters/providers/lan/index.mjs';

const fixture = configuration => ({
  platform: process.platform,
  configuration,
  observeInterfaces: async () => ({
    interfaces: { fixture0: [{ internal: false, family: 'IPv4', address: '192.168.50.10' }] },
  }),
  now: () => 0,
});
const operation = { id: 'fixture-operation', lastActionId: 'lan-setup', resources: [] };

test('unreadable saved LAN settings stay unknown and do not ask for new listener approvals', async () => {
  const ctx = fixture(async () => { throw new Error('fixture-private-read-detail'); });
  const observed = await lan.observeSetup(ctx, operation);
  assert.equal(observed.state, 'blocked');
  assert.deepEqual(observed.evidence, { known: false, reason: 'lan-configuration-unavailable' });
  assert.equal(observed.nextAction.kind, 'instructions');
  assert.match(observed.nextAction.instructions, /retry|recheck/i);
  assert.doesNotMatch(JSON.stringify(observed), /fixture-private-read-detail/);
  await assert.rejects(lan.hostChoices(ctx), /saved LAN settings could not be read/i);
});

test('an empty but readable LAN configuration still asks for interface selection', async () => {
  const observed = await lan.observeSetup(fixture(async () => ({})), operation);
  assert.equal(observed.state, 'authorization-required');
  assert.equal(observed.nextAction.id, 'interface');
  assert.equal(observed.evidence.reason, 'interface-not-selected');
});
