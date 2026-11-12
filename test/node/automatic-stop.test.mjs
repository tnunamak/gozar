import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let deadline = Date.now() + 5000; Date.now() < deadline; await wait(20)) if (await check()) return;
  assert.fail('Automatic finalization did not complete');
}
async function session(home, port, lifetimeMs = 60000) {
  const directory = join(home, `port-${port}`); await mkdir(directory);
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'tunnl-gg'));
  const executable = join(directory, 'relay');
  await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({event:'tunnel',url:'https://fixture.tunnl.gg'}));setInterval(()=>{},1000);\n`, {mode:0o700});
  adapter.recipes.create.program = executable; adapter.recipes.create.process.collectMs = 20;
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:port,
    requirements:{clientReach:'internet',httpsRequired:true,sse:true}, consent:true, approveOrigin:true, lifetimeMs });
  return { directory, probeExecutor:{vantages:['public'], async verify(request) {
    const now = Math.floor(performance.timeOrigin + performance.now());
    return {probeReceipt:{...request.authorization,origin:request.origin,vantage:'public',remote:true,
      observedAtMs:now,expiresAtMs:now+30000,tls:true,instanceMatched:true,sse:true}};
  }} };
}
const start = options => serve(options.directory, {probeExecutor:options.probeExecutor});
for (const cause of ['expiry', 'relay-exit']) test(`automatic ${cause} releases the key and closes the daemon before another port starts`, async t => {
  const {directory:home} = await fixture(t, {});
  const a = await start(await session(home, 18801, cause === 'expiry' ? 1200 : 60000));
  t.after(() => a.terminate());
  assert.equal(a.controller.state.phase, 'published-ready');
  if (cause === 'relay-exit') [...a.controller.driver.children.values()][0].kill('SIGTERM');
  await until(() => a.controller.state.phase === 'stopped');
  // Do not call stop/terminate: that masked the lease defect in the earlier suite.
  const b = await start(await session(home, 18802));
  t.after(() => b.terminate());
  assert.equal(b.controller.state.phase, 'published-ready');
  await until(() => !a.server.listening);
  assert.deepEqual(a.controller.journal.value.owned, {});
});
test('automatic stop retains the lease and stop channel when local cleanup fails', async t => {
  const {directory:home} = await fixture(t, {});
  const a = await start(await session(home, 18803));
  t.after(() => a.terminate());
  const closeLocal = a.controller.driver.closeLocal.bind(a.controller.driver);
  let checked = false;
  a.controller.driver.closeLocal = async () => { await closeLocal(); checked = true; return [{resourceId:'fixture',detail:'unresolved cleanup'}]; };
  [...a.controller.driver.children.values()][0].kill('SIGTERM');
  await until(() => a.controller.state.phase === 'stopped');
  // Allow the scheduled finalizer to settle, including its lease decision.
  await wait(100);
  await assert.rejects(start(await session(home, 18804)), /installation key is held/);
  assert.ok(checked, 'automatic stop must run local cleanup');
  assert.ok(a.server.listening, 'unresolved cleanup retains the recovery channel');
  assert.ok((await readdir(join(home, 'identities'))).some(name => name.startsWith('.active-route-') && name.endsWith('.json')));
  a.controller.driver.closeLocal = closeLocal;
  const firstStop = a.controller.shutdown(), concurrentStop = a.controller.shutdown();
  assert.equal(firstStop, concurrentStop, 'concurrent shutdown calls share finalization');
  const stopped = await firstStop;
  assert.deepEqual(stopped.localCleanupFailures, []);
});

test('expiry during startup drains initialization before finalizing', async t => {
  const {directory:home} = await fixture(t, {});
  const options = await session(home, 18805, 100);
  const verify = options.probeExecutor.verify;
  options.probeExecutor.verify = async request => { await wait(250); return verify(request); };
  const a = await start(options); t.after(() => a.terminate());
  await until(() => !a.server.listening);
  assert.equal(a.controller.state.phase, 'stopped');
  assert.deepEqual(a.controller.journal.value.owned, {});
  assert.equal(a.controller.keyLease, null);
});
