import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'embedding-displaced-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const values=new Map(),reads=[],deletes=[];
 let serial=0;
 const backend={
  put:async({scopeId,bytes})=>{
   const handle=`fixture-${++serial}`;
   values.set(handle,{scopeId,bytes:Buffer.from(bytes)});
   return {handle};
  },
  presence:async({scopeId,handle})=>({known:true,value:values.get(handle)?.scopeId===scopeId}),
  withSecret:async({scopeId,handle},use)=>{
   reads.push(handle);
   const stored=values.get(handle);
   assert.ok(stored);
   assert.equal(stored.scopeId,scopeId);
   return use(Buffer.from(stored.bytes));
  },
  delete:async({scopeId,handle})=>{
   assert.equal(values.get(handle)?.scopeId,scopeId);
   deletes.push(handle);
   return {deleted:values.delete(handle)};
  },
 };
 const services=createEmbeddingServices({registryId:'displaced-reference-fixture',secretBackend:backend});
 const base={home,owner:'alice',providerId:'opaque'};
 const initial=await services.readConfiguration(base);
 const request=(configuration,draftId)=>({
  ...base,scopeId:configuration.scopeId,expectedConfigurationRevision:configuration.revision,
  ...(draftId?{draftId}:{}),
 });
 const store=async(configuration,bytes,draftId)=>(await services.storeSecret({
  ...request(configuration,draftId),inputId:'token',bytes:Buffer.from(bytes),
 })).handle;
 const bind=async(configuration,handle,draftId)=>(await services.mutateConfiguration(
  request(configuration,draftId),tx=>tx.bindSecret('token',handle)
 )).configuration;
 async function read(configuration,handle,expected,draftId){
  const current=await services.readConfiguration({...base,...(draftId?{draftId}:{})});
  assert.equal(current.revision,configuration.revision,'the refusal must not be a stale-revision failure');
  assert.equal(current.scopeId,initial.scopeId);
  assert.equal(values.has(handle),true,'backend deletion must not explain refusal');
  const before=await readFile(join(home,'embedding-state.json'));
  const readCount=reads.length,deleteCount=deletes.length;
  let callbacks=0,received;
  const pending=services.mutateConfiguration(request(current,draftId),tx=>tx.withSecret('token',handle,bytes=>{
   callbacks++;
   received=Buffer.from(bytes).toString();
   return received;
  }),{mutatesConfiguration:false});
  if(expected===null){
   await assert.rejects(pending,{code:'invalid_input'});
   assert.equal(callbacks,0);
   assert.equal(received,undefined);
   assert.equal(reads.length,readCount,'refusal must precede the raw backend read');
  }else{
   assert.equal((await pending).result,expected);
   assert.equal(callbacks,1);
   assert.equal(received,expected);
   assert.deepEqual(reads.slice(readCount),[handle]);
  }
  assert.equal(deletes.length,deleteCount);
  assert.equal(values.has(handle),true);
  assert.deepEqual(await readFile(join(home,'embedding-state.json')),before,'read attempts must not alter persisted bytes');
 }
 return {services,base,initial,request,store,bind,read,values,deletes};
}

test('replacing an applied binding rejects its still-stored former handle at the current revision',async t=>{
 const f=await fixture(t);
 const a=await f.store(f.initial,'applied-A');
 const appliedA=await f.bind(f.initial,a);
 assert.notEqual(appliedA.revision,f.initial.revision);
 await f.read(appliedA,a,'applied-A');
 const b=await f.store(appliedA,'applied-B');
 assert.notEqual(a,b);
 const appliedB=await f.bind(appliedA,b);
 assert.notEqual(appliedB.revision,appliedA.revision);
 // A was genuinely bound; mere input presence must not authorize it after replacement.
 await f.read(appliedB,a,null);
 await f.read(appliedB,b,'applied-B');
 assert.equal(f.values.get(a).bytes.toString(),'applied-A');
 assert.deepEqual(f.deletes,[]);
});

test('draft displacement preserves applied authority, then committed clear revokes without deleting',async t=>{
 const f=await fixture(t);
 const a=await f.store(f.initial,'draft-original-A');
 const appliedA=await f.bind(f.initial,a);
 const draft=await f.services.beginConfigurationDraft(f.request(appliedA));
 await f.read(draft.configuration,a,'draft-original-A',draft.draftId);
 const b=await f.store(draft.configuration,'draft-replacement-B',draft.draftId);
 assert.notEqual(a,b);
 const draftB=await f.bind(draft.configuration,b,draft.draftId);
 assert.notEqual(draftB.revision,draft.configuration.revision);
 await f.read(draftB,a,null,draft.draftId);
 await f.read(draftB,b,'draft-replacement-B',draft.draftId);
 await f.read(appliedA,a,'draft-original-A');
 const appliedB=await f.services.commitConfigurationDraft(f.request(draftB,draft.draftId));
 await f.read(appliedB,a,null);
 await f.read(appliedB,b,'draft-replacement-B');
 const clearDraft=await f.services.beginConfigurationDraft(f.request(appliedB));
 const cleared=(await f.services.mutateConfiguration(
  f.request(clearDraft.configuration,clearDraft.draftId),tx=>tx.clearInput('token')
 )).configuration;
 await f.read(cleared,b,null,clearDraft.draftId);
 await f.read(appliedB,b,'draft-replacement-B');
 const committed=await f.services.commitConfigurationDraft(f.request(cleared,clearDraft.draftId));
 await f.read(committed,b,null);
 assert.deepEqual(committed.credentials,{});
 assert.deepEqual(f.deletes,[]);
 assert.equal(f.values.has(a),true);
 assert.equal(f.values.has(b),true);
 assert.deepEqual(await f.services.discardSecret({home:f.base.home,handle:b}),{discarded:true});
 assert.deepEqual(f.deletes,[b]);
 assert.equal(f.values.has(b),false);
 assert.equal(f.values.has(a),true);
});
