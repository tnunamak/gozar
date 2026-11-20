// The selected LAN interface and its firewall approval, at the two places that judge them (the address grammar and host preparation).
// The rest of the earlier file tested `expose --port` flags, `detect`, the human renderer and the daemon, all removed (matrix in the delivery report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { selectedInterfaceAddress } from '../../packages/gozar-node/interfaces.mjs';
import { validateBinding } from '../../packages/gozar-node/plan.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { fixture } from './helpers.mjs';

test('selected interface rejects loopback, unspecified, multicast and invalid link-local representations at both boundaries', () => {
  for (const address of ['127.0.0.2', '127.255.255.255', '0.1.2.3', '0.0.0.0', '224.0.0.1', '239.1.2.3', '255.255.255.255', '169.254.0.1', '169.254.255.1', '::', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.2', '::ffff:7f00:2', 'ff02::1', 'fe80::1', 'fe80::1%bad/zone', 'invalid']) {
    assert.equal(selectedInterfaceAddress(address), false, address);
    assert.equal(validateBinding('selected-interface-address', address), false, address);
  }
  for (const address of ['192.168.1.2', '10.1.2.3', '169.254.1.2', '2001:db8::2', 'fd00::2', 'fe80::1%eth0']) assert.equal(selectedInterfaceAddress(address), true, address);
});

test('interface and firewall require exact scoped approval without claiming client reach', async t => {
  const address = Object.values(networkInterfaces()).flat().find(item => !item.internal && selectedInterfaceAddress(item.address))?.address;
  if (!address) return t.skip('No unicast interface in fixture environment');
  const { driver } = await fixture(t, {}, { bindAddresses: [address], firewallApproved: true });
  const adapter = { bindings: { interfaceAddress: { type: 'selected-interface-address' }, gatePort: { type: 'loopback-port' } } };
  let host = await prepareHost(driver, adapter);
  assert.deepEqual(host.facts['selected-interface-still-present'].value, { address });
  assert.deepEqual(host.facts['firewall-user-approved'].value, { bindAddress: address, port: 0, targetHost: '127.0.0.1', targetPort: driver.targetPort, scheme: 'http' });
  assert.equal(host.facts['client-reachable-lan-address'], undefined);
  for (const fact of Object.values(host.facts)) {
    assert.equal(fact.sessionId, driver.sessionId); assert.equal(fact.generation, 1);
    assert.ok(fact.authorityRef && fact.expiresAtMs > host.nowMs);
  }
});

