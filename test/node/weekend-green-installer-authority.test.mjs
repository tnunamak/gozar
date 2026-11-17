import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executeArtifact} from '../../packages/gozar-node/embedding-prerequisites.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const allow=()=>({'installer.execute':{known:true,value:true},'privilege.elevate':{known:true,value:true}});
const action=()=>({artifact:{url:'https://example.invalid/a',sha256:hash(Uint8Array.of(1,2)),platform:'test',architecture:'test'},effects:{writes:['a'],networkOrigins:['https://example.invalid'],requiresPrivilege:false,restartRequired:false}});
const options=(executor,hostCapabilities=allow())=>({executor,hostCapabilities,platform:'test',architecture:'test'});
const rejectsCode=(p,code)=>assert.rejects(p,e=>e.code===code);
test('owned descriptor, bound callbacks and owned verified bytes survive aliases',async()=>{
 const a=action(),caps=allow(),source=Uint8Array.of(1,2);let resume,entered,seen,calls=0;
 const ready=new Promise(r=>entered=r),pending=new Promise(r=>resume=r);
 const executor={async fetchArtifact(d){assert.equal(this,executor);seen=d;entered();return pending;},
 executeArtifact(payload){assert.equal(this,executor);calls++;assert.deepEqual([...payload.bytes],[1,2]);assert.notEqual(payload.bytes,source);assert.equal(payload.artifact.url,'https://example.invalid/a');assert.deepEqual(payload.effects.writes,['a']);assert.ok(Object.isFrozen(payload.artifact));assert.ok(Object.isFrozen(payload.effects));assert.ok(Object.isFrozen(payload.effects.writes));assert.ok(Object.isFrozen(payload.effects.networkOrigins));return 'done';}};
 const p=executeArtifact(a,options(executor,caps));await ready;
 assert.throws(()=>{seen.sha256='0'.repeat(64);},TypeError);
 a.artifact.url='https://evil.invalid';a.artifact.sha256='0'.repeat(64);a.effects.writes.push('evil');a.effects.requiresPrivilege=true;
 executor.executeArtifact=()=>assert.fail('replacement callback');
 // Re-admission happens after hashing. Mutating the fetcher's alias here must not change executed bytes.
 Object.defineProperty(caps,'installer.execute',{get(){source[0]=9;return {known:true,value:true};}});
 resume(source);assert.equal(await p,'done');assert.equal(calls,1);
});
for(const key of ['installer.execute','privilege.elevate']){
 for(const [observation,code] of [[undefined,'unsupported'],[{known:false,value:true},'unsupported'],[{known:1,value:true},'unsupported'],[{known:true,value:1},'unsupported'],[{known:true,value:false},'host_policy_denied']]){
 test(key+' exact initial observation '+JSON.stringify(observation),async()=>{
  const a=action();a.effects.requiresPrivilege=true;const caps=allow();caps[key]=observation;
  let fetched=0,executed=0;
  await rejectsCode(executeArtifact(a,options({fetchArtifact(){fetched++;return Uint8Array.of(1,2);},executeArtifact(){executed++;}},caps)),code);
  assert.equal(fetched,0);assert.equal(executed,0);
 });
 }
 for(const [observation,code] of [[{known:true,value:false},'host_policy_denied'],[{known:false},'unsupported'],[undefined,'unsupported']]){
 test(key+' revocation during fetch '+JSON.stringify(observation),async()=>{
  const a=action();a.effects.requiresPrivilege=true;const caps=allow();let executed=0;
  await rejectsCode(executeArtifact(a,options({async fetchArtifact(){caps[key]=observation;return Uint8Array.of(1,2);},executeArtifact(){executed++;}},caps)),code);assert.equal(executed,0);
 });
 }
}
test('privilege admission is not required for unprivileged effects; invocations are not deduplicated',async()=>{
 let n=0;const executor={fetchArtifact(){return Uint8Array.of(1,2);},executeArtifact(){return ++n;}},caps=allow();delete caps['privilege.elevate'];
 assert.equal(await executeArtifact(action(),options(executor,caps)),1);assert.equal(await executeArtifact(action(),options(executor,caps)),2);
});
test('invalid descriptor and callback shapes never fetch or execute',async()=>{
 const mutations=[a=>{a.artifact=null;},a=>{a.artifact.url='http://example.invalid';},a=>{a.artifact.sha256='bad';},a=>{a.artifact.platform='other';},a=>{a.effects.requiresPrivilege='false';},a=>{a.effects.writes=[1];},a=>{a.effects.networkOrigins=null;},a=>{a.effects.restartRequired=undefined;}];
 for(const mutate of mutations){const a=action();mutate(a);await rejectsCode(executeArtifact(a,options({fetchArtifact(){assert.fail('fetch');},executeArtifact(){assert.fail('execute');}})),'unsupported');}
 for(const executor of [{fetchArtifact:1,executeArtifact(){}},{fetchArtifact(){assert.fail('fetch');},executeArtifact:null}])await rejectsCode(executeArtifact(action(),options(executor)),'unsupported');
});
test('invalid returned bytes and mismatched hashes never execute',async()=>{
 for(const bytes of [null,[1,2],Uint8Array.of(3,4)])await rejectsCode(executeArtifact(action(),options({fetchArtifact(){return bytes;},executeArtifact(){assert.fail('execute');}})),'artifact_integrity_failed');
});
test('callback errors preserve identity without retry',async()=>{
 for(const phase of ['fetch','execute']){const sentinel=new Error(phase);let fetches=0,executes=0;
 await assert.rejects(executeArtifact(action(),options({fetchArtifact(){fetches++;if(phase==='fetch')throw sentinel;return Uint8Array.of(1,2);},executeArtifact(){executes++;throw sentinel;}})),e=>e===sentinel);
 assert.equal(fetches,1);assert.equal(executes,phase==='fetch'?0:1);}
});
