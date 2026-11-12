import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite, Journal, processIdentity } from '../../packages/gozar-node/journal.mjs';
import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
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

test('one installation identity admits one live stable relay route across ports', async t => {
  const { directory: home } = await fixture(t, {});
  const makeSession = async targetPort => {
    const directory = join(home, `port-${targetPort}`); await mkdir(directory);
    const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
    const executable = join(directory, 'relay');
    await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({event:'tunnel',url:${JSON.stringify(first)},upgrade:'https://tunnl.gg/pricing'}));setInterval(()=>{},1000);\n`, { mode: 0o700 });
    adapter.recipes.create.program = executable; adapter.recipes.create.process.collectMs = 20;
    await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort,
      requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:true, approveOrigin:true, lifetimeMs:60000 });
    const probeExecutor = { vantages:['public'], async verify(request) { const now = Math.floor(performance.timeOrigin + performance.now());
      return { probeReceipt:{ ...request.authorization, origin:request.origin, vantage:'public', remote:true,
        observedAtMs:now, expiresAtMs:now+30000, tls:true, instanceMatched:true, sse:true } }; } };
    return { directory, probeExecutor };
  };
  const a = await makeSession(18765), b = await makeSession(18766);
  const starts = await Promise.allSettled([serve(a.directory, { probeExecutor:a.probeExecutor }), serve(b.directory, { probeExecutor:b.probeExecutor })]);
  const running = starts.flatMap((result, index) => result.status === 'fulfilled'
    ? [{ session:result.value, port:[18765,18766][index] }] : []);
  const refused = starts.filter(result => result.status === 'rejected').map(result => result.reason);
  t.after(async () => { await Promise.all(running.map(entry => entry.session.terminate())); });
  assert.equal(running.length, 1, `expected one route owner, got ${starts.map(result => result.status).join(', ')}`);
  assert.equal(refused.length, 1);
  const ownerPort = running[0].port;
  assert.equal(running[0].session.controller.state.published, first);
  assert.ok(refused[0].message.includes(`port ${ownerPort}`), refused[0].message);
  assert.ok(refused[0].message.includes(cliCommand('stop', ownerPort)), refused[0].message);

  await running[0].session.terminate();
  const waiting = ownerPort === 18765 ? b : a;
  await until(async () => {
    try { await lstat(join(waiting.directory, 'control.sock')); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  });
  // serve() ran in this test process, so its dead test daemon shares our still-live PID.
  // Removing the closed fixture's control record models the separate daemon process exiting.
  await unlink(join(waiting.directory, 'control.json'));
  const next = await serve(waiting.directory, { probeExecutor:waiting.probeExecutor });
  t.after(async () => { await next.terminate(); });
  assert.equal(next.controller.state.published, first);
  const relay = Object.values(next.controller.journal.value.owned).find(resource => resource.kind === 'process');
  assert.ok(relay, 'the second session owns a live relay process');
  const identities = join(home, 'identities');
  const key = await readFile(join(identities, 'ed25519'));
  const fingerprint = createHash('sha256').update(key).digest('hex');
  await atomicWrite(join(identities, `.active-route-${fingerprint}.json`), { version:1, leaseId:'stale-owner',
    keyFingerprint:fingerprint, pid:2147483647, startIdentity:'1', sessionId:next.controller.sessionId,
    sessionDirectory:waiting.directory, targetPort:next.controller.servicePort, stopCommand:cliCommand('stop', next.controller.servicePort) });
  await atomicWrite(join(waiting.directory, 'control.json'), { pid:2147483647, startIdentity:'1', nonce:'stale-owner' });

  const third = await makeSession(18768);
  const recoveredStart = await serve(third.directory, { probeExecutor:third.probeExecutor });
  t.after(async () => { await recoveredStart.terminate(); });
  assert.equal(recoveredStart.controller.state.published, first);
  assert.equal(await processIdentity(relay.pid), null, 'the previous relay child exited before the stale lease was replaced');
  const recoveredJournal = new Journal(waiting.directory); await recoveredJournal.load();
  assert.deepEqual(recoveredJournal.value.owned, {});
});

test('an unresolved stale owner keeps its key lease and reports the stop command', async t => {
  const { directory: home } = await fixture(t, {});
  const identities = join(home, 'identities'); await mkdir(identities, { mode:0o700 });
  const fingerprint = 'a'.repeat(64), oldDirectory = join(home, 'port-18765'); await mkdir(oldDirectory);
  const journal = new Journal(oldDirectory);
  await journal.save({ owned:{ orphan:{ id:'orphan', kind:'process', sessionId:'old-session' } } });
  const leasePath = join(identities, `.active-route-${fingerprint}.json`);
  await atomicWrite(leasePath, { version:1, leaseId:'cleanup-pending', keyFingerprint:fingerprint, pid:2147483647,
    startIdentity:'1', sessionId:'old-session', sessionDirectory:oldDirectory, targetPort:18765,
    stopCommand:cliCommand('stop', 18765) });

  const { acquireInstallKeyLease } = await import('../../packages/gozar-node/key-route-lease.mjs');
  await assert.rejects(acquireInstallKeyLease({ home, keyFingerprint:fingerprint,
    sessionDirectory:join(home, 'port-18766'), sessionId:'new-session', targetPort:18766 }), error => {
    assert.match(error.message, /cleanup is not confirmed/);
    assert.ok(error.message.includes(cliCommand('stop', 18765)));
    return true;
  });
  assert.equal(JSON.parse(await readFile(leasePath, 'utf8')).leaseId, 'cleanup-pending');
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
