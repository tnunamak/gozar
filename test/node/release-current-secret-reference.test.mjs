import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

const code=expected=>error=>error?.code===expected;
function memoryBackend(){
 const entries=new Map(), observations={reads:0,presence:0,deletes:0,locked:false};
 return {observations,
  async put({bytes}){const handle='fixture-secret-'+(entries.size+1);entries.set(handle,new Uint8Array(bytes));return {handle};},
  async withSecret({handle},use){observations.reads++;assert.ok(entries.has(handle));return use(new Uint8Array(entries.get(handle)));},
  async presence({handle}){observations.presence++;return observations.locked?{known:false,reason:'secret_backend_locked'}:{known:true,value:entries.has(handle)};},
  async delete({handle}){observations.deletes++;entries.delete(handle);return {deleted:true};},
 };
}
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'gozar-current-secret-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const backend=memoryBackend(),registryId='current-reference-registry';
 const service=createEmbeddingServices({registryId,secretBackend:backend});
 const base={home,owner:'fixture-owner',providerId:'fixture-provider'};
 return {home,backend,service,base,registryId};
}
const request=(base,configuration,draftId)=>({...base,...(draftId?{draftId}:{}),expectedConfigurationRevision:configuration.revision});
const intake=(service,base,configuration,inputId='credential',draftId)=>service.storeSecret({...request(base,configuration,draftId),scopeId:configuration.scopeId,inputId,bytes:new TextEncoder().encode('invented-secret-value')});
const readBound=(service,r,handle,inputId='credential')=>service.mutateConfiguration(r,tx=>tx.withSecret(inputId,handle,async bytes=>assert.equal(new TextDecoder().decode(bytes),'invented-secret-value')),{mutatesConfiguration:false});
const metadata=async(home,handle)=>JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8')).secrets[handle];

test('current binding survives unrelated edits, draft promotion and commit without rewriting intake metadata',async t=>{
 const {home,backend,service,base}=await fixture(t);
 let current=await service.readConfiguration(base);
 const stored=await intake(service,base,current),original=await metadata(home,stored.handle);
 const bound=await service.mutateConfiguration(request(base,current),tx=>tx.bindSecret('credential',stored.handle));
 current=bound.configuration;
 await readBound(service,request(base,current),stored.handle);
 const draft=await service.beginConfigurationDraft(request(base,current));
 let edited=(await service.mutateConfiguration(request(base,draft.configuration,draft.draftId),tx=>tx.bindText('label','unrelated'))).configuration;
 await readBound(service,request(base,edited,draft.draftId),stored.handle);
 current=await service.commitConfigurationDraft(request(base,edited,draft.draftId));
 await readBound(service,request(base,current),stored.handle);
 assert.deepEqual(await metadata(home,stored.handle),original);
 await assert.rejects(service.discardSecret({home,handle:stored.handle}),code('secret_in_use'));
 assert.equal(backend.observations.deletes,0);
 const clearing=await service.beginConfigurationDraft(request(base,current));
 edited=(await service.mutateConfiguration(request(base,clearing.configuration,clearing.draftId),tx=>tx.clearInput('credential'))).configuration;
 await assert.rejects(service.discardSecret({home,handle:stored.handle}),code('secret_in_use'));
 await service.commitConfigurationDraft(request(base,edited,clearing.draftId));
 assert.deepEqual(await service.discardSecret({home,handle:stored.handle}),{discarded:true});
 assert.equal(backend.observations.deletes,1);
});

test('draft intake can bind at its exact revision and remains readable after value edit and commit',async t=>{
 const {home,service,base}=await fixture(t);
 const current=await service.readConfiguration(base),draft=await service.beginConfigurationDraft(request(base,current));
 const stored=await intake(service,base,draft.configuration,'credential',draft.draftId),original=await metadata(home,stored.handle);
 let configuration=(await service.mutateConfiguration(request(base,draft.configuration,draft.draftId),tx=>tx.bindSecret('credential',stored.handle))).configuration;
 configuration=(await service.mutateConfiguration(request(base,configuration,draft.draftId),tx=>tx.bindText('label','second'))).configuration;
 await readBound(service,request(base,configuration,draft.draftId),stored.handle);
 configuration=await service.commitConfigurationDraft(request(base,configuration,draft.draftId));
 await readBound(service,request(base,configuration),stored.handle);
 assert.deepEqual(await metadata(home,stored.handle),original);
});

test('unbound intake remains confined to original owner, registry, scope, input, draft and revision before raw read',async t=>{
 const {backend,service,base,registryId}=await fixture(t);
 let current=await service.readConfiguration(base);
 const draft=await service.beginConfigurationDraft(request(base,current));
 const stored=await intake(service,base,draft.configuration,'credential',draft.draftId);
 const deny=async(operation,expected='invalid_input')=>{
  const before=backend.observations.reads;await assert.rejects(operation(),code(expected));assert.equal(backend.observations.reads,before);
 };
 await deny(()=>readBound(service,request(base,draft.configuration,draft.draftId),stored.handle,'different-input'));
 await deny(()=>readBound(service,{...request(base,draft.configuration,draft.draftId),expectedConfigurationRevision:'wrong'},stored.handle),'configuration_stale');
 const otherDraft=await service.beginConfigurationDraft(request(base,current));
 await deny(()=>readBound(service,request(base,otherDraft.configuration,otherDraft.draftId),stored.handle));
 await deny(()=>readBound(service,request(base,current),stored.handle));
 for(const changed of [{owner:'different-owner'},{providerId:'different-provider'}]){
  const foreign={...base,...changed},configuration=await service.readConfiguration(foreign);
  await deny(()=>readBound(service,request(foreign,configuration),stored.handle));
 }
 const foreignService=createEmbeddingServices({registryId:registryId+'-other',secretBackend:backend});
 const foreign=await foreignService.readConfiguration(base);
 await deny(()=>readBound(foreignService,request(base,foreign),stored.handle));
 const edited=(await service.mutateConfiguration(request(base,draft.configuration,draft.draftId),tx=>tx.bindText('label','changed'))).configuration;
 await deny(()=>readBound(service,request(base,edited,draft.draftId),stored.handle));
 // Positive original-intake control in another untouched draft.
 const fresh=await intake(service,base,otherDraft.configuration,'credential',otherDraft.draftId);
 await readBound(service,request(base,otherDraft.configuration,otherDraft.draftId),fresh.handle);
});

test('a current binding does not authorize another input or bypass CAS; resolvedValues still observes lock before raw reads',async t=>{
 const {backend,service,base}=await fixture(t);
 const initial=await service.readConfiguration(base),stored=await intake(service,base,initial);
 const current=(await service.mutateConfiguration(request(base,initial),tx=>tx.bindSecret('credential',stored.handle))).configuration;
 let before=backend.observations.reads;
 await assert.rejects(readBound(service,request(base,current),stored.handle,'other-input'),code('invalid_input'));
 assert.equal(backend.observations.reads,before);
 await assert.rejects(readBound(service,request(base,initial),stored.handle),code('configuration_stale'));
 assert.equal(backend.observations.reads,before);
 backend.observations.locked=true;
 await assert.rejects(service.resolveConfiguration(base),code('secret_backend_locked'));
 assert.equal(backend.observations.reads,before);
 backend.observations.locked=false;
 assert.deepEqual(await service.resolveConfiguration(base),{credential:'invented-secret-value'});
 assert.equal(backend.observations.reads,before+1);
});
