// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,lstat,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {packConsumerProvisional} from '../../scripts/pack-consumer-provisional.mjs';

const sha='a'.repeat(40), tree='b'.repeat(40);
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
async function fixture(t){
  const parent=join(homedir(),'.tmp');
  await mkdir(parent,{recursive:true,mode:0o700});
  const info=await lstat(parent);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink());
  assert.equal(info.mode&0o777,0o700);
  if(process.getuid)assert.equal(info.uid,process.getuid());
  const root=await mkdtemp(join(parent,'gozar-provisional-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const cwd=join(root,'source'),output=join(root,'output');
  await mkdir(cwd,{mode:0o700});
  await writeFile(join(cwd,'package.json'),JSON.stringify({scripts:{prepack:'node scripts/check-package.mjs'}}));
  const state={bytes:Buffer.from('fixture archive bytes'),dirty:false,fail:false,changed:false,ambiguous:false,missing:false,badHash:false};
  const calls=[];
  const run=async(command,args,options)=>{
    calls.push({command,args:[...args],cwd:options.cwd});
    assert.equal(options.cwd,cwd);
    if(command==='git'){
      if(args[0]==='status')return state.dirty?' M tracked.mjs\n':'';
      if(args[0]==='rev-parse'&&args[1]==='--show-toplevel')return cwd+'\n';
      if(args[0]==='rev-parse'&&args[1]==='HEAD')return (state.changed?'c'.repeat(40):sha)+'\n';
      if(args[0]==='rev-parse'&&args[1]==='HEAD^{tree}')return tree+'\n';
      throw new Error('Unexpected git invocation');
    }
    assert.equal(command,'npm');
    assert.deepEqual(args.slice(0,3),['pack','--json','--ignore-scripts=false']);
    assert.equal(args[3],'--pack-destination');
    if(state.fail)throw new Error('prepack failed');
    const filename='fixture-0.0.0.tgz';
    if(!state.missing)await writeFile(join(args[4],filename),state.bytes);
    if(state.ambiguous)await writeFile(join(args[4],'extra.tgz'),state.bytes);
    if(state.changeOnPack)state.changed=true;
    return JSON.stringify([{filename,shasum:state.badHash?'0'.repeat(40):hash(state.bytes,'sha1')}]);
  };
  return {cwd,output,state,calls,run};
}
test('source/tree and exact bytes identified; ordinary prepack; immutable same-artifact reuse',async t=>{
  const f=await fixture(t),result=await packConsumerProvisional(f);
  assert.equal(result.sourceSha,sha);assert.equal(result.sourceTree,tree);
  assert.equal(result.sha256,hash(f.state.bytes));
  assert.equal(result.ordinaryPrepack,true);
  assert.equal(result.consumerAcceptance,'PENDING');assert.equal(result.releaseGate,'NOT RUN');
  assert.deepEqual(await readFile(result.tarball),f.state.bytes);
  assert.equal((await lstat(result.tarball)).mode&0o222,0);
  const first=await readFile(result.manifest,'utf8');
  const again=await packConsumerProvisional(f);
  assert.deepEqual(again,result);
  assert.equal(await readFile(result.manifest,'utf8'),first);
  assert.equal(f.calls.filter(c=>c.command==='npm').length,2);
});
for(const failure of ['dirty','fail','missing','ambiguous','badHash','changeOnPack']){
  test('refuses '+failure+' without final artifact',async t=>{
    const f=await fixture(t);f.state[failure]=true;
    await assert.rejects(packConsumerProvisional(f));
    const names=await readdir(f.output).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    assert.deepEqual(names,[]);
    if(failure==='dirty')assert.equal(f.calls.filter(c=>c.command==='npm').length,0);
  });
}
test('same-source differently hashed artifact cannot overwrite prior bundle',async t=>{
  const f=await fixture(t),first=await packConsumerProvisional(f);
  const before=await readFile(first.tarball);
  f.state.bytes=Buffer.from('different bytes');
  await assert.rejects(packConsumerProvisional(f),/conflict/);
  assert.deepEqual(await readFile(first.tarball),before);
});
test('tampered existing bytes fail verification, never repair silently',async t=>{
  const f=await fixture(t),first=await packConsumerProvisional(f);
  // Owned fixture only: deliberately corrupt through a replacement, not an external artifact.
  const {chmod}=await import('node:fs/promises');
  await chmod(first.tarball,0o600);await writeFile(first.tarball,'corrupt');
  await assert.rejects(packConsumerProvisional(f),/conflict/);
});
test('refuses output inside source tree before packing',async t=>{
  const f=await fixture(t);f.output=join(f.cwd,'artifacts');
  await assert.rejects(packConsumerProvisional(f),/outside/);
  assert.equal(f.calls.filter(c=>c.command==='npm').length,0);
});
