import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs, clientRequirements } from '../../bin/gozar.mjs';
import { selectedInterfaceAddress } from '../../packages/gozar-node/interfaces.mjs';
import { validateBinding } from '../../packages/gozar-node/plan.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { loadActiveDrop, loadCatalog, loadDropRequirements } from '../../packages/gozar-node/catalog.mjs';
import { render, renderDetection } from '../../packages/gozar-node/render.mjs';
import { serve, control } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'bin/gozar.mjs');

test('selected interface rejects loopback, unspecified, multicast and invalid link-local representations at both boundaries', () => {
  for (const address of ['127.0.0.2', '127.255.255.255', '0.1.2.3', '0.0.0.0', '224.0.0.1', '239.1.2.3', '255.255.255.255', '169.254.0.1', '169.254.255.1', '::', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.2', '::ffff:7f00:2', 'ff02::1', 'fe80::1', 'fe80::1%bad/zone', 'invalid']) {
    assert.equal(selectedInterfaceAddress(address), false, address);
    assert.equal(validateBinding('selected-interface-address', address), false, address);
    assert.throws(() => parseArgs(['expose', '--port', '3000', '--bind-address', address]), undefined, address);
  }
  for (const address of ['192.168.1.2', '10.1.2.3', '169.254.1.2', '2001:db8::2', 'fd00::2', 'fe80::1%eth0']) assert.equal(selectedInterfaceAddress(address), true, address);
});

test('public HTTPS default does not replace LAN HTTP but explicit HTTPS and profiles remain strict', async () => {
  const defaults = await loadDropRequirements(root);
  const lan = parseArgs(['expose', '--port', '3000', '--client-reach', 'lan', '--transport', 'http']);
  assert.equal(clientRequirements(lan, defaults).httpsRequired, false);
  assert.equal(clientRequirements({ ...lan, transport: 'https' }, defaults).httpsRequired, true);
  assert.equal(clientRequirements(lan, defaults, { httpsRequired: true }).httpsRequired, true);
  assert.equal(clientRequirements({ ...lan, clientReach: 'internet' }, defaults).httpsRequired, true);
});

test('supplied install template is encoded, persisted-profile data is rendered and unsafe links fail closed', () => {
  const template = 'https://client.example/install?endpoint={url}';
  assert.equal(parseArgs(['expose', '--port', '3000', '--install-link-template', template]).installLinkTemplate, template);
  for (const value of ['http://client.example/{url}', 'https://user:secret@client.example/{url}', 'javascript:{url}', 'https://client.example/no-placeholder']) assert.throws(() => parseArgs(['expose', '--install-link-template', value]));
  const output = render({ snapshot: { phase: 'published-ready', published: 'https://service.example' }, connectionProfile: { installLinkTemplate: template } }, [], { port: 3000 });
  assert.match(output, /Install link: https:\/\/client.example\/install\?endpoint=https%3A%2F%2Fservice.example%2Fmcp/);
  assert.match(output, /"mcpServers"/); assert.match(output, /tool call still need checking/);
  assert.match(output, /gozar health --port 3000/);
});

test('interface and firewall require exact scoped approval without claiming client reach', async t => {
  const address = Object.values(networkInterfaces()).flat().find(item => !item.internal && selectedInterfaceAddress(item.address))?.address;
  if (!address) return t.skip('No unicast interface in fixture environment');
  assert.throws(() => parseArgs(['expose', '--port', '3000', '--bind-address', address, '--firewall-ack', '192.0.2.1']));
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

test('detect inventories all modes and never treats binary presence as account or capability proof', async () => {
  const adapters = await loadCatalog(root, { operational: true });
  const active = await loadActiveDrop(root);
  assert.equal(active.length, 5);
  const output = renderDetection({ snapshot: { observations: Object.fromEntries(adapters.map(adapter => [adapter.id, 'present'])) } }, adapters, active);
  for (const adapter of adapters) assert.ok(output.includes(`${adapter.displayName ?? adapter.label ?? adapter.id}: present`));
  assert.match(output, /Login: unknown/); assert.match(output, /Capability: unknown/);
  assert.equal(output.split('\n').filter(line => line.includes('NEXT DROP')).length, adapters.length - active.length);
});

test('no-flag JSON expose asks reach once after silent detection without persisting a session', async t => {
  const { directory } = await fixture(t, {});
  const result = spawnSync(process.execPath, [cli, 'expose', '--port', '18765', '--json'], { encoding: 'utf8', env: { ...process.env, GOZAR_HOME: directory, PATH: '/missing-fixture-binaries' } });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(result.stdout).action.kind, 'choose');
});

test('missing generic route inputs return explicit Actions and HTTPS never falls back to LAN HTTP', async t => {
  const { directory } = await fixture(t, {});
  const env = { ...process.env, GOZAR_HOME: directory, PATH: '/missing-fixture-binaries' };
  for (const [flags, field] of [[['--client-reach', 'lan'], 'bindAddress'], [['--client-reach', 'internet', '--adapter', 'own-address'], 'origin']]) {
    const result = spawnSync(process.execPath, [cli, 'expose', '--port', '18765', '--json', ...flags], { encoding: 'utf8', env });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).action.field, field);
  }
  const https = spawnSync(process.execPath, [cli, 'expose', '--port', '18765', '--json', '--client-reach', 'lan', '--adapter', 'lan', '--transport', 'https', '--yes'], { encoding: 'utf8', env });
  assert.equal(https.status, 1);
  assert.match(JSON.parse(https.stdout).error, /provides HTTP/);
  assert.equal(JSON.parse(https.stdout).action.kind, 'repair');
});

test('own-origin setup shows exact live gate before probing, status retains action, health resumes, stop preserves external route', async t => {
  const { directory, journal } = await fixture(t, {});
  const adapter = { id: 'external-fixture', planVersion: 1, audience: 'public', ownership: 'external-owned', capabilities: { https: null },
    admission: { state: 'admitted', requiredFeatures: ['typed-bindings', 'probe-assertions', 'client-vantage-probe'] },
    bindings: { externalOrigin: { type: 'credential-free-https-origin' } }, endpointTemplate: '{externalOrigin}', recipes: {}, setup: { requiresProxyTarget: true }, clientProfile: { installLinkTemplate: 'https://client.example/{url}' } };
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters: [adapter], requirements: { clientReach: 'internet', httpsRequired: true }, targetPort: 18765,
    adapterId: adapter.id, origin: 'https://owner.fixture.invalid', consent: true, approveOrigin: true });
  let probes = 0;
  const running = await serve(directory, { probeExecutor: { vantages: ['public'], verify: async () => { probes++; throw new Error('Fixture has no outside route'); } } });
  t.after(async () => { await running.terminate(); });
  const pending = await control(directory, { type: 'status' });
  assert.equal(probes, 0);
  assert.equal(pending.action.kind, 'external'); assert.equal(pending.action.target, pending.gateTarget);
  assert.equal(pending.connectionProfile.installLinkTemplate, adapter.clientProfile.installLinkTemplate);
  assert.match(pending.action.instruction, /gozar health --port 18765/);
  assert.equal(pending.snapshot.published, null);
  const gateIdentity = await fetch(`${pending.gateTarget}${running.gate.challenge().identityPath}`);
  assert.equal(gateIdentity.status, 200);
  const updated = await control(directory, { type: 'update-origin', origin: 'https://changed.fixture.invalid' });
  assert.equal(probes, 0); assert.equal(updated.action.target, pending.gateTarget);
  assert.match(updated.action.instruction, /changed.fixture.invalid/);
  await control(directory, { type: 'health' });
  assert.ok(probes > 0);
  const stopped = await control(directory, { type: 'stop' });
  assert.equal(stopped.snapshot.phase, 'stopped'); assert.equal(stopped.action, undefined);
  assert.deepEqual(journal.value.owned, {});
});
