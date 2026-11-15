import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseRecordedConfigurationUse} from '../../packages/gozar-node/runtime-configuration-use.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

const request=()=>({registryId:'recorded',home:'/unused-home',owner:'owner-a',providerId:'provider-a',handle:{id:'opaque-hold',generation:7}});
for(const [name,services] of [['missing',undefined],['empty',{}],['nonfunction',{releaseConfigurationUse:true}]]){
 test('recorded reference release rejects '+name+' service',async()=>{
  const r=request(),before=structuredClone(r);
  const runtime={registryId:r.registryId,embeddingServices:services};
  await assert.rejects(releaseRecordedConfigurationUse(r,runtime),{code:'secret_backend_unavailable'});
  assert.deepEqual(r,before);
  assert.equal(runtime.embeddingServices,services);
 });
}
test('selected release service receives exact scope once and retains receiver',async()=>{
 const r=request(),before=structuredClone(r),calls=[];
 const services={async releaseConfigurationUse(scope){assert.equal(this,services);calls.push(scope);}};
 await releaseRecordedConfigurationUse(r,{registryId:r.registryId,embeddingServices:services});
 const {registryId,...scope}=r;
 assert.deepEqual(calls,[scope]);
 assert.equal(calls[0].handle,r.handle);
 assert.deepEqual(r,before);
});
test('selected release service asynchronous failure propagates unchanged',async()=>{
 const r=request(),failure=Object.assign(new Error('release failed'),{code:'metadata_write_failed'});let calls=0;
 const services={async releaseConfigurationUse(scope){calls++;assert.equal(scope.handle,r.handle);await Promise.resolve();throw failure;}};
 await assert.rejects(releaseRecordedConfigurationUse(r,{registryId:r.registryId,embeddingServices:services}),error=>error===failure);
 assert.equal(calls,1);
});
test('other registry releases only the exact recorded hold with real metadata transactions',async()=>{
 const home=await mkdtemp(join(tmpdir(),'gz-ref-'));
 try{
  const old=createEmbeddingServices({registryId:'recorded'});
  const current=createEmbeddingServices({registryId:'current'});
  const scope={home,owner:'owner-a',providerId:'provider-a'};
  const foreignScope={...scope,owner:'owner-b'};
  async function heldDraft(services,at,handles){
   const configuration=await services.readConfiguration(at);
   const draft=await services.beginConfigurationDraft({...at,expectedConfigurationRevision:configuration.revision});
   for(const handle of handles)await services.registerConfigurationUse({...at,revision:configuration.revision,handle});
   return {...at,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision};
  }
  const first={id:'first',generation:1},second={id:'second',generation:1};
  const oldDraft=await heldDraft(old,scope,[first,second]);
  const foreignDraft=await heldDraft(old,foreignScope,[first]);
  const currentDraft=await heldDraft(current,scope,[first]);
  const blocked=(services,draft)=>assert.rejects(services.commitConfigurationDraft(draft),{code:'configuration_in_use'});
  await blocked(old,oldDraft);await blocked(old,foreignDraft);await blocked(current,currentDraft);
  let wrongServiceCalls=0;
  const runtime={registryId:'current',embeddingServices:{async releaseConfigurationUse(){wrongServiceCalls++;throw new Error('wrong registry service');}}};
  await releaseRecordedConfigurationUse({registryId:'recorded',...scope,handle:first},runtime);
  assert.equal(wrongServiceCalls,0);
  // A second hold survives the exact first release; other owner and current registry survive too.
  await blocked(old,oldDraft);await blocked(old,foreignDraft);await blocked(current,currentDraft);
  await releaseRecordedConfigurationUse({registryId:'recorded',...scope,handle:second},runtime);
  const committed=await old.commitConfigurationDraft(oldDraft);
  assert.equal(typeof committed.revision,'string');
  await blocked(old,foreignDraft);await blocked(current,currentDraft);
  await old.releaseConfigurationUse({...foreignScope,handle:first});
  await old.commitConfigurationDraft(foreignDraft);
  await current.releaseConfigurationUse({...scope,handle:first});
  await current.commitConfigurationDraft(currentDraft);
  assert.equal(wrongServiceCalls,0);
 }finally{
  // All transactions above are awaited, including rejection paths, before deleting our private root.
  await rm(home,{recursive:true,force:true});
 }
});
