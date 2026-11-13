import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';
import { processIdentity } from '../../packages/gozar-node/journal.mjs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { recoverStop, launch, control } from '../../packages/gozar-node/daemon.mjs';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { fixture } from './helpers.mjs';

async function absentFixture(t) {
  const { directory, journal } = await fixture(t, {});
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const startIdentity = await processIdentity(child.pid), exited = once(child, 'exit');
  child.kill('SIGTERM'); await exited;
  const dnsName = 'device.example-tailnet.ts.net';
  const bindings = Object.fromEntries(Object.entries({ port: 8443, dnsName, nodeId: 'fixture-node', tailnetSuffix: 'example-tailnet.ts.net' }).map(([name, value]) => [name, { value }]));
  const resource = { id: 'recorded-child', sessionId: 'test', adapterId: 'tailscale-funnel', kind: 'process', pid: child.pid, startIdentity, continuityRef: 'fixture-continuity', nonce: 'fixture-nonce', bindings };
  const configPath = join(directory, 'provider.json'), auditPath = join(directory, 'audit.json');
  const program = join(directory, 'read-provider.mjs');
  await writeFile(program, `import {readFile,appendFile} from 'node:fs/promises';\nconst args=process.argv.slice(2);await appendFile(${JSON.stringify(auditPath)},JSON.stringify(args)+'\\n');\nif(args.join(' ')==='status --json --peers=false') console.log(JSON.stringify({BackendState:'Running',Self:{ID:'fixture-node',DNSName:'${dnsName}.'},CurrentTailnet:{StableID:'fixture-tailnet',MagicDNSSuffix:'example-tailnet.ts.net'}}));\nelse if(args.join(' ')==='serve status --json') console.log(await readFile(${JSON.stringify(configPath)},'utf8'));\nelse process.exit(2);`);
  const config = { TCP: { 443: { HTTPS: true } }, Web: { [`${dnsName}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };
  await writeFile(configPath, JSON.stringify(config));
  const observe = (id, args, assertion) => ({ id, recipe: { kind: 'spawn', program: process.execPath, args: [program, ...args], timeoutMs: 1000,
    parser: { kind: 'json-document', predicate: { op: 'exists', pointer: '' } } }, assert: assertion });
  const adapter = { id: 'tailscale-funnel', audience: 'public', ownership: 'owned', capabilities: {}, planVersion: 1, admission: { state: 'admitted', requiredFeatures: [] }, recipes: { remove: { kind: 'owned-process',
    before: [observe('identity', ['status', '--json', '--peers=false'], { op: 'all', items: [
      { op: 'equals', pointer: '/Self/ID', value: '{nodeId}' }] })],
    after: [observe('absent', ['serve', 'status', '--json'], { op: 'all', items: ['/TCP/{port}', '/Web/{dnsName}:{port}', '/Foreground/*/TCP/{port}', '/Foreground/*/Web/{dnsName}:{port}'].map(pointer => ({ op: 'not', predicate: { op: 'exists', pointer } })) })] } } };
  const driver = new EffectDriver({ journal, adapters: [adapter], sessionId: 'test' });
  return { driver, resource, config, configPath, auditPath, directory, journal, adapter };
}

test('dead immutable child plus fresh source-shaped provider absence produces only an absence receipt and preserves foreign routes', async t => {
  const { driver, resource, config, configPath, auditPath } = await absentFixture(t);
  driver.journal.value.owned[resource.id] = { ...resource, retired: true };
  assert.equal(await driver.continuity(resource.id), null, 'a dead process never receives a live continuity receipt');
  const receipt = await driver.proveProcessAbsent(resource);
  assert.equal(receipt.processGone, true); assert.equal(receipt.providerAbsent, true);
  assert.equal(receipt.continuityRef, resource.continuityRef); assert.equal(receipt.continuous, undefined);
  assert.equal(receipt.sessionId, 'test'); assert.ok(receipt.expiresAtMs > Date.now());
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config);
  assert.deepEqual((await readFile(auditPath, 'utf8')).trim().split('\n').map(JSON.parse), [['status', '--json', '--peers=false'], ['serve', 'status', '--json']]);
});

test('present or changed provider mappings, malformed provider output and live birth identities preserve cleanup debt', async t => {
  const { driver, resource, config, configPath } = await absentFixture(t);
  for (const target of ['http://127.0.0.1:4000', 'http://127.0.0.1:5000']) {
    const present = { ...config, Foreground: { fixture: { TCP: { 8443: { HTTPS: true } }, Web: { 'device.example-tailnet.ts.net:8443': { Handlers: { '/': { Proxy: target } } } } } } };
    await writeFile(configPath, JSON.stringify(present));
    await assert.rejects(driver.proveProcessAbsent(resource), /Recorded process is gone; listener 8443/);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), present);
  }
  await writeFile(configPath, 'null');
  await assert.rejects(driver.proveProcessAbsent(resource), /Recorded process is gone/);
  await assert.rejects(driver.proveProcessAbsent({ ...resource, pid: process.pid, startIdentity: await processIdentity(process.pid) }), /still running/);
});


async function recordDebt(fixture) {
  const { journal, resource, adapter } = fixture;
  resource.retired = true; resource.details = {}; resource.baseline = {};
  const step = await loadCore();
  const initial = step({ command: { type: 'status', sessionId: 'test' }, adapters: [adapter], requirements: { clientReach: 'this-device' } });
  const ledger = { handleRef: resource.id, continuityRef: resource.continuityRef, kind: 'process', details: {}, baseline: {}, bindings: resource.bindings };
  const state = { ...initial.state, selected: adapter.id, phase: 'cleanup-pending', stopRequested: true, pending: {}, resources: [{ id: resource.id, adapterId: adapter.id, generation: 1, ownership: 'owned', cleanup: 'pending', ledger }] };
  await journal.save({ state, snapshot: { phase: 'cleanup-pending' }, targetPort: 8123, owned: { [resource.id]: resource } });
}

test('recovery confirms a dead process and absent provider route, clears core debt and permits a fresh daemon launch', async t => {
  const data = await absentFixture(t); await recordDebt(data);
  const recovered = await recoverStop(data.directory);
  assert.equal(recovered.snapshot.phase, 'stopped', JSON.stringify(recovered));
  await data.journal.load(); assert.deepEqual(data.journal.value.owned, {});
  assert.deepEqual(JSON.parse(await readFile(data.configPath, 'utf8')), data.config);
  const app = http.createServer((_req, res) => res.end('restarted'));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.closeAllConnections(); app.close(); });
  const adapter = { id: 'loopback-fixture', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes: {
    create: { kind: 'local-forwarder', bindAddress: '127.0.0.1', port: 0, parser: { kind: 'json', pointer: '/origin' } },
    remove: { kind: 'local-forwarder' } } };
  t.after(async () => { try { await control(data.directory, { type: 'stop' }); } catch {} });
  const fresh = await launch(data.directory, { adapters: [adapter], requirements: { clientReach: 'this-device' }, targetPort: app.address().port,
    adapterId: adapter.id, consent: true, approveOrigin: true }, fileURLToPath(new URL('./fixtures/daemon.mjs', import.meta.url)));
  assert.equal(fresh.snapshot.phase, 'published-ready', JSON.stringify(fresh));
  assert.equal(await (await fetch(fresh.snapshot.published)).text(), 'restarted');
  assert.equal((await control(data.directory, { type: 'stop' })).snapshot.phase, 'stopped');
});

test('recovery retains the exact debt when a changed provider mapping is present', async t => {
  const data = await absentFixture(t); await recordDebt(data);
  const present = { ...data.config, Foreground: { fixture: { TCP: { 8443: { HTTPS: true } } } } };
  await writeFile(data.configPath, JSON.stringify(present));
  const recovered = await recoverStop(data.directory);
  assert.equal(recovered.snapshot.phase, 'cleanup-pending');
  assert.match(recovered.localCleanupFailures[0].detail, /Recorded process is gone; listener 8443/);
  await data.journal.load(); assert.ok(data.journal.value.owned[data.resource.id]);
  assert.deepEqual(JSON.parse(await readFile(data.configPath, 'utf8')), present);
});

test('expired readbacks and unsupported removal prerequisites cannot produce absence authority', async t => {
  const data = await absentFixture(t);
  let clockCalls = 0;
  data.driver.nowMs = () => clockCalls++ === 0 ? 1000 : 6001;
  await assert.rejects(data.driver.proveProcessAbsent(data.resource), /readbacks expired/);
  data.driver.adapters[0].recipes.remove.requires = [{ op: 'verified', fact: 'provider-admin' }];
  await assert.rejects(data.driver.proveProcessAbsent(data.resource), /Unsupported removal prerequisite/);
});
