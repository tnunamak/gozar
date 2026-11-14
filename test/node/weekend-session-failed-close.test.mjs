// Bounded recovery regressions; not the full public failed-start fault matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, lstat, statfs} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
const repositoryRoot = new URL('../../', import.meta.url);
const {closeAttachedRoute} = await import(new URL('packages/gozar-node/attached-route.mjs', repositoryRoot));
const {startingRoute, listRecordedRoutes} = await import(new URL('packages/gozar-node/route-operations.mjs', repositoryRoot));
const {recordController, stopController} = await import(new URL('packages/gozar-node/controller-start.mjs', repositoryRoot));

async function checkedDirectory(path, {create = false, privateMode = false} = {}) {
  if (create) await mkdir(path, {mode:0o700}).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
  const info = await lstat(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'fixture scratch must be a real directory');
  assert.equal(info.uid, process.getuid(), 'fixture scratch must belong to the invoking user');
  assert.equal(info.mode & 0o022, 0, 'fixture scratch must not be group/other writable');
  if (privateMode) assert.equal(info.mode & 0o777, 0o700, 'fixture scratch must be mode 0700');
}

async function fixtureHome() {
  assert.equal(typeof process.getuid, 'function', 'fixture requires POSIX ownership checks');
  const userHome = homedir();
  await checkedDirectory(userHome);
  const scratch = join(userHome, '.tmp');
  await checkedDirectory(scratch, {create:true});
  const filesystem = await statfs(scratch);
  assert.ok(![0x01021994, 0x858458f6].includes(Number(filesystem.type) >>> 0),
    'fixture scratch must be disk-backed, not tmpfs/ramfs');
  const parent = join(scratch, 'gozar-weekend-failed-close');
  await checkedDirectory(parent, {create:true, privateMode:true});
  const home = await mkdtemp(join(parent, 'home-'));
  try {
    await checkedDirectory(home, {privateMode:true});
    return home;
  } catch (error) {
    await rm(home, {recursive:true, force:true});
    throw error;
  }
}

for (const receipt of [null, {generation: 1, resourceKey: 'synthetic-owned'}]) {
  test('repeated close retains failed-start debt without transient runtime: ' + Boolean(receipt), async () => {
    const home = await fixtureHome();
    const handle = {kind:'session', id:'port-43219:synthetic-failure', generation:1};
    const directory = join(home, 'port-43219');
    try {
      await mkdir(directory, {mode:0o700});
      const lastView = {...startingRoute(handle, '127.0.0.1:43219', 'failed-operation'),
        state:'uncertain', cleanup:{state:'unconfirmed'}};
      await writeFile(join(directory,'bootstrap.json'), JSON.stringify({
        execution:'generic-session-v1',handle,owner:'synthetic-owner',operationId:'failed-operation'}), {mode:0o600});
      await writeFile(join(directory,'state.json'), JSON.stringify({
        handle, phase:'failed', adapterId:'synthetic-runtime-absent', receipt, lastView}), {mode:0o600});
      await mkdir(join(home,'operations'),{mode:0o700});
      const key=createHash('sha256').update(JSON.stringify(['synthetic-owner','failed-operation'])).digest('hex');
      await writeFile(join(home,'operations',key+'.json'),JSON.stringify({schemaVersion:1,
        owner:'synthetic-owner',operationId:'failed-operation',intentDigest:'synthetic-intent',phase:'recovery',view:lastView}),{mode:0o600});
      const listed=await listRecordedRoutes({home,owner:'synthetic-owner'});
      assert.equal(listed.routes.length,1);
      assert.deepEqual(listed.routes[0].handle,handle);
      assert.equal(listed.routes[0].operationId,'failed-operation');
      let runtimeReads=0;
      const deps = {get adapters(){runtimeReads++;throw new Error('transient runtime must not be loaded');}};
      for (let i=0;i<2;i++) {
        const view=await closeAttachedRoute({home,handle},deps);
        assert.deepEqual(view.handle,handle);
        assert.equal(view.cleanup.state,'unconfirmed');
        assert.ok(view.cleanup.nextAction);
        assert.equal(view.published,null);
        assert.equal(view.operationId,'failed-operation');
      }
      assert.equal(runtimeReads,0);
    } finally {await rm(home,{recursive:true,force:true});}
  });
}

test('identity-aware cleanup stops an owned child and preserves foreign identity', {timeout:15000}, async () => {
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  await once(child,'spawn');
  const exited=once(child,'exit');
  try {
    const record=await recordController(child);
    assert.ok(record.startIdentity, 'test requires independent OS process identity');
    const foreign=await stopController({...record,child:undefined,startIdentity:'not-this-child'},{
      kill(){assert.fail('foreign identity must never be signalled');},graceMs:100,killWaitMs:100});
    assert.equal(foreign.state,'foreign');
    assert.equal(child.exitCode,null);
    process.kill(child.pid,0);
    const stopped=await stopController(record,{graceMs:1000,killWaitMs:1000});
    assert.ok(['gone','stopped','killed'].includes(stopped.state));
    await exited;
    assert.throws(()=>process.kill(child.pid,0),error=>error.code==='ESRCH');
    const repeated=await stopController(record,{kill(){assert.fail('exited child cannot be signalled');}});
    assert.equal(repeated.state,'gone');
  } finally {
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  }
});
