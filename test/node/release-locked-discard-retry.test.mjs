import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

const code = expected => error => error.code === expected;

for (const initialFailure of ['secret_backend_locked','secret_backend_unavailable']) {
 test(`persisted draft discard retries after ${initialFailure} without losing authority`,async()=>{
  const home=await mkdtemp(join(tmpdir(),'discard-retry-'));
  const live=new Set(),deletions=[],observations=[];
  let sequence=0,readCount=0,failure=null,failHandle=null,lie=false,inspect=null;
  const state=async()=>JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
  const backend={
   put:async()=>{const handle=`opaque-${++sequence}`;live.add(handle);return {handle};},
   withSecret:async({handle},use)=>{readCount++;assert.ok(live.has(handle));return use(new Uint8Array([7]));},
   presence:async({handle})=>{
    observations.push(handle);
    if(inspect)await inspect(handle);
    if(failure)throw {code:failure};
    return {known:true,value:live.has(handle)};
   },
   delete:async({handle})=>{
    deletions.push(handle);
    if(handle===failHandle)throw {code:'secret_backend_unavailable'};
    if(!lie)live.delete(handle);
    return {deleted:true};
   },
  };
  const restart=()=>createEmbeddingServices({registryId:'fixture',secretBackend:backend});
  let service=restart();
  const request={home,providerId:'p',owner:'alice'};
  const put=async(r,inputId)=>{
   const configuration=await service.readConfiguration(r);
   return service.storeSecret({...r,inputId,scopeId:configuration.scopeId,
    expectedConfigurationRevision:configuration.revision,bytes:new Uint8Array([7])});
  };
  const bind=async(r,inputId,handle)=>{
   const configuration=await service.readConfiguration(r);
   return service.mutateConfiguration({...r,expectedConfigurationRevision:configuration.revision},
    tx=>tx.bindSecret(inputId,handle));
  };
  const draft=async(r)=>{
   const configuration=await service.readConfiguration(r);
   return service.beginConfigurationDraft({...r,expectedConfigurationRevision:configuration.revision});
  };
  try {
   // Create the applied handle via a draft so its original draft ownership
   // survives promotion. A later retry must respect its current references.
   const origin=await draft(request),originRequest={...request,draftId:origin.draftId};
   const applied=await put(originRequest,'token');
   const promoted=await bind(originRequest,'token',applied.handle);
   await service.commitConfigurationDraft({...originRequest,expectedConfigurationRevision:promoted.configuration.revision});
   const other=await draft(request),otherRequest={...request,draftId:other.draftId};
   const otherOwned=await put(otherRequest,'other');
   await bind(otherRequest,'other',otherOwned.handle);
   const foreignRequest={...request,owner:'bob'};
   const foreign=await put(foreignRequest,'token');
   await bind(foreignRequest,'token',foreign.handle);
   const target=await draft(request),targetRequest={...request,draftId:target.draftId};
   const first=await put(targetRequest,'token');
   await bind(targetRequest,'token',first.handle);
   const second=await put(targetRequest,'second');
   const absent=await put(targetRequest,'absent');
   live.delete(absent.handle); // The backend authoritatively knows this item is absent.
   const before=await state(),scope=target.scopeId;
   const ownedMetadata=Object.fromEntries([first,second,absent].map(({handle})=>[handle,before.secrets[handle]]));
   for(const metadata of Object.values(ownedMetadata)){
    assert.equal(metadata.registryId,'fixture');
    assert.equal(metadata.scopeId,scope);
    assert.equal(metadata.draftId,target.draftId);
   }
   const protectedHandles=[applied.handle,otherOwned.handle,foreign.handle];
   const protectedMetadata=Object.fromEntries(protectedHandles.map(handle=>[handle,before.secrets[handle]]));
   const readsBeforeDiscard=readCount;
   observations.length=0;
   const assertProtected=async()=>{
    const saved=await state();
    assert.deepEqual(saved.configs[scope].bindings,before.configs[scope].bindings);
    assert.deepEqual(saved.configs[scope].drafts[other.draftId],before.configs[scope].drafts[other.draftId]);
    assert.deepEqual(saved.configs[foreign.scopeId],before.configs[foreign.scopeId]);
    for(const handle of protectedHandles){
     assert.deepEqual(saved.secrets[handle],protectedMetadata[handle]);
     assert.ok(live.has(handle));
     assert.ok(!deletions.includes(handle));
    }
    assert.equal(readCount,readsBeforeDiscard,'cleanup must use presence, never raw secret reads');
   };
   // On the very first backend observation the detached draft must already
   // be durable, even though presence cannot answer while locked/unavailable.
   inspect=async()=>{
    assert.equal((await state()).configs[scope].drafts[target.draftId],undefined);
   };
   failure=initialFailure;
   await assert.rejects(service.discardConfigurationDraft(targetRequest),code(initialFailure));
   assert.deepEqual(deletions,[]);
   let saved=await state();
   assert.equal(saved.configs[scope].drafts[target.draftId],undefined);
   for(const [handle,metadata]of Object.entries(ownedMetadata))assert.deepEqual(saved.secrets[handle],metadata);
   await assertProtected();

   // A fresh factory reads the persisted retry authority, not an in-memory draft.
   service=restart();failure=null;failHandle=second.handle;
   inspect=async(handle)=>{
    const disk=await state();
    assert.equal(disk.configs[scope].drafts[target.draftId],undefined);
    if(handle===second.handle)assert.equal(disk.secrets[first.handle],undefined,'confirmed first removal must be checkpointed');
   };
   await assert.rejects(service.discardConfigurationDraft(targetRequest),code('secret_backend_unavailable'));
   assert.deepEqual(deletions,[first.handle,second.handle]);
   assert.ok(!live.has(first.handle));assert.ok(live.has(second.handle));
   saved=await state();
   assert.equal(saved.secrets[first.handle],undefined);
   assert.deepEqual(saved.secrets[second.handle],ownedMetadata[second.handle]);
   assert.deepEqual(saved.secrets[absent.handle],ownedMetadata[absent.handle]);
   await assertProtected();

   // An affirmative delete result alone is not confirmation if presence
   // still says true. Keep the exact metadata available for another restart.
   service=restart();failHandle=null;lie=true;
   await assert.rejects(service.discardConfigurationDraft(targetRequest),code('secret_backend_unavailable'));
   assert.deepEqual((await state()).secrets[second.handle],ownedMetadata[second.handle]);
   assert.ok(live.has(second.handle));
   await assertProtected();

   service=restart();lie=false;
   assert.deepEqual(await service.discardConfigurationDraft(targetRequest),{discarded:false});
   saved=await state();
   for(const {handle}of [first,second,absent])assert.equal(saved.secrets[handle],undefined);
   assert.deepEqual(deletions,[first.handle,second.handle,second.handle,second.handle]);
   assert.ok(!live.has(second.handle));
   assert.ok(observations.includes(absent.handle));
   assert.ok(!deletions.includes(absent.handle),'known absent needs no deletion');
   await assertProtected();
   const calls=observations.length;
   service=restart();
   assert.deepEqual(await service.discardConfigurationDraft(targetRequest),{discarded:false});
   assert.equal(observations.length,calls,'completed retry has no residual authority to revisit');

   // The promoted handle is still owned by origin, but referenced by the
   // applied configuration and another draft. Neither retry may delete it.
   assert.deepEqual(await service.discardConfigurationDraft(originRequest),{discarded:false});
   await assertProtected();
   assert.deepEqual(await service.discardSecret({home,handle:'unknown'}),{discarded:false});
   await assert.rejects(service.discardSecret({home,handle:applied.handle}),code('secret_in_use'));
   await assertProtected();
  }finally{
   await rm(home,{recursive:true,force:true});
  }
 });
}
