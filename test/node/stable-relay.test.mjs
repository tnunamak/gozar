import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const first = 'https://first.tunnl.gg', second = 'https://second.tunnl.gg';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await wait(20); }
  assert.fail('Timed out waiting for route state');
}
test('core grammar refusal creates no installation or session identity', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  // Keep admission and features valid: only the core parser grammar is invalid.
  adapter.recipes.create.parser.jsonEvent.originPointer = 'url';
  assert.equal(adapter.admission.state, 'admitted');
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:18765,
    requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:false, lifetimeMs:60000 });
  // No injected step: serve uses the packaged WASM core.
  const running = await serve(directory);
  t.after(async () => { await running.terminate(); });
  const driver = running.controller.driver;
  assert.ok(adapter.admission.requiredFeatures.every(feature => driver.host.features.includes(feature)));
  const privateDirectory = join(directory, 'private');
  const files = async () => readdir(privateDirectory).then(names => names.sort()).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const before = await files();
  const ownedBefore = Object.keys(driver.journal.value.owned).sort();
  const refusal = await running.controller.command({ type:'start', adapterId:adapter.id, consent:true }).catch(error => error);
  await assert.rejects(lstat(join(home, 'identities')), { code:'ENOENT' });
  await assert.rejects(lstat(join(home, 'identities', 'ed25519')), { code:'ENOENT' });
  assert.deepEqual(await files(), before);
  assert.deepEqual(Object.keys(driver.journal.value.owned).sort(), ownedBefore);
  assert.match(refusal?.message ?? '', /not admitted/);
  assert.equal(driver.host.bindings.installIdentityPath, undefined);
  assert.equal(running.controller.state.published, null);
});
test('consented identity and JSON announcements keep a changed route withdrawn', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  const output = join(directory, 'output.json'), executable = join(directory, 'relay');
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');console.log(JSON.stringify({event:'tunnel',url:${JSON.stringify(first)},upgrade:'https://tunnl.gg/pricing'}));let old='';setInterval(()=>{try{let n=fs.readFileSync(${JSON.stringify(output)},'utf8');if(n!==old){old=n;console.log(n)}}catch{}},10);\n`, { mode: 0o700 });
  adapter.recipes.create.program = executable; adapter.recipes.create.process.collectMs = 20;
  // Keep both private-file arguments in the owned dispatch, even for this fake relay.
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:18765,
    requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:true, approveOrigin:true, lifetimeMs:60000 });
  const requests = [];
  const probeExecutor = { vantages:['public'], async verify(request) { requests.push(request); const now = Math.floor(performance.timeOrigin + performance.now());
    return { probeReceipt:{ ...request.authorization, origin:request.origin, vantage:'public', remote:true, observedAtMs:now, expiresAtMs:now+30000, tls:true, instanceMatched:true, sse:true } }; } };
  const running = await serve(directory, { probeExecutor });
  t.after(async () => { await running.terminate(); });
  assert.equal(running.controller.state.published, first);
  assert.match(await readFile(join(home, 'identities', 'ed25519'), 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----/);
  await writeFile(output, JSON.stringify({ event:'request', url:second })); await wait(100);
  assert.equal(running.controller.state.published, first);
  await writeFile(output, JSON.stringify({ event:'tunnel', url:second, upgrade:'https://tunnl.gg/pricing' }));
  await until(() => running.controller.state.phase === 'degraded');
  assert.equal(running.controller.state.published, null); assert.equal(running.controller.state.candidate, null);
  assert.equal(requests.length, 1);
  await running.controller.command({ type:'health' }); assert.equal(running.controller.state.published, null);
  const stopped = await running.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped'); assert.deepEqual(stopped.localCleanupFailures, []);
  assert.deepEqual(running.controller.journal.value.owned, {});
  assert.match(await readFile(join(home, 'identities', 'ed25519'), 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----/);
});

test('stop while provisioning an identity leaves no late file or publication', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:18765,
    requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:false, lifetimeMs:60000 });
  const running = await serve(directory); t.after(async () => { await running.terminate(); });
  const driver = running.controller.driver, create = driver.privateFiles.create.bind(driver.privateFiles);
  let entered; const entering = new Promise(resolve => { entered = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  driver.privateFiles.create = async options => { entered(); await held; return create(options); };
  const start = running.controller.command({ type:'start', adapterId:adapter.id, consent:true });
  await entering;
  await running.controller.shutdown();
  release(); await start.catch(() => {});
  assert.equal(running.controller.state.stopRequested, true);
  assert.equal(running.controller.state.published, null);
  assert.deepEqual(running.controller.journal.value.owned, {});
});

test('detection without consent never creates an installation identity', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:18765,
    requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:false, lifetimeMs:60000 });
  const running = await serve(directory); t.after(async () => { await running.terminate(); });
  await assert.rejects(readFile(join(home, 'identities', 'ed25519')), { code: 'ENOENT' });
});

test('unadmitted identity provisioning cannot create a key', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  adapter.admission.state = 'blocked';
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:18765,
    requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:false, lifetimeMs:60000 });
  const running = await serve(directory); t.after(async () => { await running.terminate(); });
  await assert.rejects(running.controller.command({ type:'start', adapterId:adapter.id, consent:true }), /not admitted/);
  await assert.rejects(readFile(join(home, 'identities', 'ed25519')), { code:'ENOENT' });
});
