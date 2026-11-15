import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executeArtifact,capabilityPrerequisites} from '../../packages/gozar-node/embedding-prerequisites.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const approved=new Uint8Array([1,2,3]);
const action=()=>({artifact:{url:'https://example.invalid/fixture',sha256:digest(approved),platform:'fixture-os',architecture:'fixture-arch',metadata:{label:'approved'}},effects:{requiresPrivilege:false,details:{approved:true}}});
const capabilities=()=>({'installer.execute':{known:true,value:true}});
const rejected=code=>error=>error.code===code;
function harness({fetch=async()=>approved,execute=async()=> 'executed',caps=capabilities()}={}){
 const calls={fetch:0,execute:0};
 const options={platform:'fixture-os',architecture:'fixture-arch',hostCapabilities:caps,executor:{
  async fetchArtifact(value){calls.fetch++;return fetch(value);},
  async executeArtifact(value){calls.execute++;return execute(value);}
 }};
 return {calls,options};
}
test('open capability IDs distinguish absent, malformed, denied, present and unsupported',()=>{
 const ids=['custom.absent','custom.malformed','custom.denied','custom.present','custom.unsupported'];
 const result=capabilityPrerequisites({requiredCapabilities:ids},{
  'custom.malformed':{known:'true',value:true},'custom.denied':{known:true,value:false},
  'custom.present':{known:true,value:true},'custom.unsupported':{known:true,value:'maybe'}
 });
 assert.deepEqual(result.map(x=>x.state),['unknown','unknown','denied','present','unsupported']);
 assert.deepEqual(result[0].observation,{known:false,reason:'host-capability-undeclared'});
 assert.deepEqual(result.map(x=>x.id),ids);
});
test('strict installer admission refuses before fetch, including explicit policy denial',async()=>{
 for(const [observation,code] of [[undefined,'unsupported'],[{known:1,value:true},'unsupported'],[{known:false,value:true},'unsupported'],[{known:true,value:false},'host_policy_denied'],[{known:true,value:'true'},'unsupported']]){
  const h=harness({caps:{'installer.execute':observation}});
  await assert.rejects(executeArtifact(action(),h.options),rejected(code));
  assert.deepEqual(h.calls,{fetch:0,execute:0});
 }
});
test('privilege requires strict true observations before fetch',async()=>{
 for(const privilege of [undefined,{known:'true',value:true},{known:true,value:false}]){
  const h=harness({caps:{...capabilities(),'privilege.elevate':privilege}});
  const a=action();a.effects.requiresPrivilege=true;
  await assert.rejects(executeArtifact(a,h.options),rejected('host_policy_denied'));
  assert.deepEqual(h.calls,{fetch:0,execute:0});
 }
 const h=harness({caps:{...capabilities(),'privilege.elevate':{known:true,value:true}}});
 const a=action();a.effects.requiresPrivilege=true;
 assert.equal(await executeArtifact(a,h.options),'executed');
 assert.deepEqual(h.calls,{fetch:1,execute:1});
});
test('platform, architecture, URL and digest syntax refuse before fetching',async()=>{
 for(const fields of [{platform:'wrong'},{architecture:'wrong'},{url:'http://example.invalid'},{sha256:'bad'}]){
  const a=action();Object.assign(a.artifact,fields);const h=harness();
  await assert.rejects(executeArtifact(a,h.options),rejected('unsupported'));
  assert.deepEqual(h.calls,{fetch:0,execute:0});
 }
});
test('wrong bytes and non-byte fetch values never execute',async()=>{
 for(const bytes of [new Uint8Array([9]),[1,2,3],null]){
  const h=harness({fetch:async()=>bytes});
  await assert.rejects(executeArtifact(action(),h.options),rejected('artifact_integrity_failed'));
  assert.deepEqual(h.calls,{fetch:1,execute:0});
 }
});
test('callback rejection identity is preserved with no automatic retry',async()=>{
 const failure=new Error('fixture callback rejection');
 for(const phase of ['fetch','execute']){
  const h=harness({[phase]:async()=>{throw failure;}});
  await assert.rejects(executeArtifact(action(),h.options),e=>e===failure);
  assert.deepEqual(h.calls,{fetch:1,execute:phase==='execute'?1:0});
 }
});
test('callbacks get immutable approval snapshots and an isolated checked byte copy',async()=>{
 const a=action(), bytes=new Uint8Array(approved);let fetchedArtifact;
 const h=harness({fetch:async artifact=>{
  fetchedArtifact=artifact;
  assert.notEqual(artifact,a.artifact);
  assert.throws(()=>{artifact.sha256=digest(new Uint8Array([9]));},TypeError);
  assert.throws(()=>{artifact.metadata.label='changed';},TypeError);
  return bytes;
 },execute:async bound=>{
  assert.equal(bound.artifact,fetchedArtifact);
  assert.notEqual(bound.effects,a.effects);
  assert.throws(()=>{bound.effects.requiresPrivilege=true;},TypeError);
  assert.throws(()=>{bound.effects.details.approved=false;},TypeError);
  assert.notEqual(bound.bytes,bytes);
  bytes[0]=9;
  assert.deepEqual([...bound.bytes],[1,2,3]);
  assert.equal(bound.artifact.sha256,digest(bound.bytes));
  return 'executed';
 }});
 assert.equal(await executeArtifact(a,h.options),'executed');
 assert.deepEqual(h.calls,{fetch:1,execute:1});
 assert.equal(a.artifact.metadata.label,'approved');
 assert.equal(a.effects.requiresPrivilege,false);
});
test('deferred fetch cannot substitute approval hash or effects through caller aliases',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const a=action(),h=harness({fetch:()=>pending});
 const work=executeArtifact(a,h.options);
 const checked=assert.rejects(work,rejected('artifact_integrity_failed'));
 a.artifact.sha256=digest(new Uint8Array([9]));
 a.artifact.platform='changed';a.effects.requiresPrivilege=true;
 release(new Uint8Array([9]));await checked;
 assert.deepEqual(h.calls,{fetch:1,execute:0});
});
test('deferred caller mutation cannot change valid approved execution data or callback',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const a=action(),h=harness({fetch:()=>pending,execute:async bound=>{
  assert.equal(bound.artifact.platform,'fixture-os');
  assert.equal(bound.effects.requiresPrivilege,false);
  assert.deepEqual([...bound.bytes],[1,2,3]);return 'bound';
 }});
 const work=executeArtifact(a,h.options);
 a.artifact.sha256='f'.repeat(64);a.effects.requiresPrivilege=true;
 h.options.executor.executeArtifact=()=>assert.fail('replacement callback must not run');
 release(approved);assert.equal(await work,'bound');assert.equal(h.calls.execute,1);
});
test('caller-owned installer or privilege revocation during fetch prevents execute',async()=>{
 for(const [id,replacement,code] of [
  ['installer.execute',{known:true,value:false},'host_policy_denied'],
  ['installer.execute',{known:'true',value:true},'unsupported'],
  ['privilege.elevate',{known:true,value:false},'host_policy_denied'],
  ['privilege.elevate',{known:false},'host_policy_denied']
 ]){
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const caps={...capabilities(),'privilege.elevate':{known:true,value:true}};
  const a=action();a.effects.requiresPrivilege=true;
  const h=harness({caps,fetch:()=>pending});
  const checked=assert.rejects(executeArtifact(a,h.options),rejected(code));
  caps[id]=replacement;release(approved);await checked;
  assert.deepEqual(h.calls,{fetch:1,execute:0});
 }
});
test('one execution per invocation, without claiming a cross-invocation install journal',async()=>{
 const h=harness();
 await executeArtifact(action(),h.options);await executeArtifact(action(),h.options);
 assert.deepEqual(h.calls,{fetch:2,execute:2});
});
