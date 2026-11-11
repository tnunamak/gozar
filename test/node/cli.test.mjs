import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from '../../bin/gozar.mjs';
import { launch, control } from '../../packages/gozar-node/daemon.mjs';
import { render, installLink, exposeSnapshot } from '../../packages/gozar-node/render.mjs';
import { loadCatalog } from '../../packages/gozar-node/catalog.mjs';
import { fixture } from './helpers.mjs';
import { atomicWrite, processIdentity } from '../../packages/gozar-node/journal.mjs';

const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));

test('CLI validates target/reach/origin and asks missing intent once without starting effects', () => {
  assert.equal(parseArgs(['expose', '--port', '3000', '--client-reach', 'this-device']).port, 3000);
  for (const argv of [['expose', '--port', '0'], ['expose', '--port', '2;echo'], ['expose', '--client-reach', 'private'], ['expose', '--origin', 'https://secret@example.test']]) assert.throws(() => parseArgs(argv));
  const child = spawnSync(process.execPath, [cli, 'expose', '--port', '3000', '--json'], { encoding: 'utf8' });
  assert.equal(child.status, 2, child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(output.action.title, 'Where does the app that will use this run?');
  assert.deepEqual(output.action.choices, ['internet', 'tailnet', 'lan', 'this-device']);
});

test('catalog excludes wrapped gated definitions; help remains generic', async () => {
  const records = await loadCatalog(root);
  assert.ok(records.length > 0);
  assert.equal(records.every(record => !record.admission && !record.recipes.create), true);
  const child = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.doesNotMatch(child.stdout, /Claude|ChatGPT|Anthropic|OpenAI/);
});

test('one screen folds alternatives, prints local state/recovery and validates install link data', () => {
  const adapters = [{ id: 'a', displayName: 'Example', reason: 'Exact route', clientProfile: { installLinkTemplate: 'https://client.example/add?url={url}' } }, { id: 'b' }];
  const output = render({ snapshot: { phase: 'published-ready', recommendations: ['a', 'b'], published: 'https://one.example' }, journalPath: '/private/session.json' }, adapters, { port: 3000 });
  assert.match(output, /Recommended: Example — Exact route/);
  assert.match(output, /1 alternatives · use --alternatives/);
  assert.match(output, /URL: https:\/\/one.example/);
  assert.match(output, /Public route checks passed\. Connect your MCP client\./);
  assert.match(output, /Install link: https:\/\/client.example/);
  assert.match(output, /Local state: \/private\/session.json/);
  assert.equal(installLink('javascript:alert({url})', 'https://one.example'), null);
  assert.equal(installLink('https://password@client.example/{url}', 'https://one.example'), null);
  const pending = render({ snapshot: { phase: 'cleanup-pending' } }, [], { port: 3000 });
  assert.match(pending, /Retry: gozar stop --port 3000/);
});

test('private daemon exposes fake loopback target, status works across invocations, stop owns exact mapping', async t => {
  const target = http.createServer((req, res) => res.end('fixture-target'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => { target.closeAllConnections(); target.close(); });
  const { directory } = await fixture(t, {});
  const adapter = { id: 'loopback-fixture', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes: {
    create: { kind: 'local-forwarder', bindAddress: '127.0.0.1', port: 0, parser: { kind: 'json', pointer: '/origin' } },
    remove: { kind: 'local-forwarder' },
  } };
  const config = { adapters: [adapter], requirements: { clientReach: 'this-device' }, targetPort: target.address().port, adapterId: adapter.id, consent: true, approveOrigin: true };
  const executable = fileURLToPath(new URL('./fixtures/daemon.mjs', import.meta.url));
  t.after(async () => { try { await control(directory, { type: 'stop' }); } catch {} });
  const launched = await launch(directory, config, executable);
  assert.equal(launched.snapshot.phase, 'published-ready', JSON.stringify(launched));
  const first = await control(directory, { type: 'status' });
  assert.equal(first.snapshot.published, launched.snapshot.published);
  assert.equal(await (await fetch(first.snapshot.published)).text(), 'fixture-target');
  // A second launch must not replace this daemon's selected target or nonce.
  const identityBefore = await readFile(join(directory, 'control.json'), 'utf8');
  await launch(directory, { ...config, targetPort: 1 }, executable);
  assert.equal(await readFile(join(directory, 'control.json'), 'utf8'), identityBefore);
  const stopped = await control(directory, { type: 'stop' });
  assert.equal(stopped.snapshot.phase, 'stopped');
  assert.equal(stopped.snapshot.published, null);
  await assert.rejects(fetch(first.snapshot.published));
  const saved = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
  assert.equal(Object.keys(saved.owned).length, 0);
  await assert.rejects(control(directory, { type: 'status' }));
  // Dead daemon identity plus stale saved readiness can never yield ready.
  await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: 'stale', nonce: 'old' });
  await assert.rejects(control(directory, { type: 'status' }), /not running/);
});

test('stale saved URL is never rendered as current CLI status', async t => {
  const { directory } = await fixture(t, {});
  const home = join(directory, 'home');
  await atomicWrite(join(home, 'port-3000', 'session.json'), { version: 1, owned: {}, intents: {}, snapshot: { phase: 'published-ready', published: 'https://stale.example' } });
  const child = spawnSync(process.execPath, [cli, 'status', '--port', '3000', '--json'], { encoding: 'utf8', env: { ...process.env, GOZAR_HOME: home } });
  assert.equal(child.status, 1);
  const output = JSON.parse(child.stdout);
  assert.equal(output.snapshot.phase, 'unknown');
  assert.equal(output.snapshot.published, null);
  assert.doesNotMatch(child.stdout, /stale.example/);
});

test('CLI stop recovers a crashed daemon, removes its exact local child, preserves unrelated process, then restarts', async t => {
  const target = http.createServer((req, res) => res.end('fixture-target'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => { target.closeAllConnections(); target.close(); });
  const { directory } = await fixture(t, {});
  const home = join(directory, 'home');
  const port = target.address().port;
  const sessionDirectory = join(home, `port-${port}`);
  const adapter = { id: 'owned-process-fixture', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes: {
    create: { kind: 'spawn', program: process.execPath, args: ['-e', `console.log('http://127.0.0.1:${port}');setInterval(()=>{},1000)`], longRunning: true, collectMs: 20,
      parser: { kind: 'url' }, timeoutMs: 1000 },
    remove: { kind: 'spawn', program: 'owned-process-stop', args: ['{resourceId}'] },
  } };
  const config = { adapters: [adapter], requirements: { clientReach: 'this-device' }, targetPort: port, adapterId: adapter.id, consent: true, approveOrigin: true };
  const executable = fileURLToPath(new URL('./fixtures/daemon.mjs', import.meta.url));
  t.after(async () => { try { await control(sessionDirectory, { type: 'stop' }); } catch {} });
  const first = await launch(sessionDirectory, config, executable);
  assert.equal(first.snapshot.phase, 'published-ready');
  const journal = JSON.parse(await readFile(join(sessionDirectory, 'session.json'), 'utf8'));
  const owned = Object.values(journal.owned)[0];
  const identity = JSON.parse(await readFile(join(sessionDirectory, 'control.json'), 'utf8'));
  process.kill(identity.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 100 && await processIdentity(identity.pid); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(await processIdentity(owned.pid));
  const selfIdentity = await processIdentity(process.pid);
  const stopped = spawnSync(process.execPath, [cli, 'stop', '--port', String(port), '--json'], { encoding: 'utf8', env: { ...process.env, GOZAR_HOME: home }, timeout: 10000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).snapshot.phase, 'stopped', stopped.stdout);
  assert.equal(await processIdentity(owned.pid), null);
  assert.equal(await processIdentity(process.pid), selfIdentity);
  const second = await launch(sessionDirectory, config, executable);
  assert.equal(second.snapshot.phase, 'published-ready');
  assert.notEqual(second.snapshot.sessionId, first.snapshot.sessionId);
  assert.equal((await control(sessionDirectory, { type: 'stop' })).snapshot.phase, 'stopped');
});

test('read-only detect has no persistent directory and succeeds when every provider binary is unavailable', async t => {
  const { directory } = await fixture(t, {});
  const home = join(directory, 'never-created');
  const child = spawnSync(process.execPath, [cli, 'detect', '--port', '18765', '--json'], { encoding: 'utf8',
    env: { ...process.env, PATH: '/nonexistent-gozar-fixture', GOZAR_HOME: home } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).snapshot.phase, 'planned');
  await assert.rejects(readFile(join(home, 'port-18765', 'session.json')), { code: 'ENOENT' });
});

test('daemon status stays responsive during outside validation and stop cancels a long broker wait', async t => {
  const { directory } = await fixture(t, {});
  const probeDirectory = join(directory, 'private-probes');
  const adapter = { id: 'pending-external-fixture', planVersion: 1, audience: 'public', ownership: 'external-owned', capabilities: { https: null },
    admission: { state: 'admitted', requiredFeatures: ['typed-bindings', 'probe-assertions', 'client-vantage-probe'] },
    bindings: { externalOrigin: { type: 'credential-free-https-origin' } }, endpointTemplate: '{externalOrigin}', endpoint: null, recipes: {} };
  const executable = fileURLToPath(new URL('./fixtures/daemon.mjs', import.meta.url));
  const config = { adapters: [adapter], requirements: { clientReach: 'internet', httpsRequired: true }, targetPort: 18765, adapterId: adapter.id,
    consent: true, approveOrigin: true, operational: true, origin: 'https://fixture.invalid', probeDirectory, probeWaitMs: 180000 };
  const launched = launch(directory, config, executable).catch(error => ({ error }));
  t.after(async () => { try { await control(directory, { type: 'stop' }); } catch {} });
  let status;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { status = await control(directory, { type: 'status' }, 500); if (status.snapshot.phase === 'validating') break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(status?.snapshot.phase, 'validating', JSON.stringify(status));
  const started = Date.now();
  const stopped = await control(directory, { type: 'stop' }, 2000);
  assert.equal(stopped.snapshot.phase, 'stopped');
  assert.ok(Date.now() - started < 2000);
  await launched;
});


test('expose filters next-drop plans and never calls installed active modes absent', () => {
  const snapshot = { phase: 'planned', observations: { ready: 'present', next: 'present', unknown: 'unknown' }, recommendations: ['next', 'ready', 'unknown'], plans: [
    { adapterId: 'next', preconditionActions: [{ label: 'Install next', reason: 'CLI is absent' }] },
    { adapterId: 'ready', eligibility: 'needs-validation', preconditionActions: [{ label: 'Install ready', reason: 'CLI is absent' }, { label: 'Sign in', reason: 'Account required' }] },
    { adapterId: 'unknown', eligibility: 'needs-validation', preconditionActions: [] },
  ], limitations: ['Current client capability remains unknown'] };
  const view = exposeSnapshot(snapshot, ['ready', 'unknown']);
  assert.deepEqual(view.recommendations, ['ready', 'unknown']);
  assert.deepEqual(view.plans[0].preconditionActions, []);
  assert.equal(view.observations.next, undefined);
  const output = render({ snapshot: view }, [{ id: 'ready', label: 'Ready CLI' }, { id: 'unknown' }], { port: 3000 });
  assert.doesNotMatch(output, /Install ready|CLI is absent|Sign in|Install next/);
  assert.match(output, /checks run automatically after approval/);
  assert.match(output, /capability remains unknown/);
  assert.equal(snapshot.plans[1].preconditionActions.length, 2);
});


test('successful saved snapshot hides stale catalog validation/setup and other routes while retaining core errors', () => {
  const adapters = [
    { id: 'chosen', label: 'Chosen route', unknowns: ['Chosen catalog capability unknown'] },
    { id: 'other', label: 'Other route', unknowns: ['Other catalog port warning'] },
  ];
  const snapshot = { phase: 'published-ready', adapterId: 'chosen', published: 'https://ready.example', recommendations: ['chosen','other'],
    observations: { chosen: 'present', other: 'unknown' }, plans: [{ adapterId: 'chosen', eligibility: 'needs-validation', preconditionActions: [{ label:'Install route', reason:'CLI is absent' }] }],
    limitations: ['Chosen catalog capability unknown','Other catalog port warning','Actual core cleanup failure remains'] };
  const output = render({ snapshot }, adapters, { port: 18765 });
  assert.match(output, /URL: https:\/\/ready.example/);
  assert.match(output, /Actual core cleanup failure remains/);
  assert.doesNotMatch(output, /Validation required|Install route|CLI is absent|Chosen catalog capability unknown|Other catalog port warning|Other route: unknown/);
  const expanded = render({ snapshot }, adapters, { port: 18765, alternatives: true });
  assert.match(expanded, /Other catalog port warning/);
  const pending = render({ snapshot: { ...snapshot, phase:'validating', published:null } }, adapters, { port:18765 });
  assert.match(pending, /Chosen catalog capability unknown/);
  assert.doesNotMatch(pending, /Other catalog port warning/);
});
