// Conservative assumption: qualify the embedding service deletion boundary only,
// not detached controllers, public consent or host credential-store integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,chmod,readFile,readdir,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

for(const failure of ['retained','locked','unknown','deleted-then-interrupted']){
 test('conservative service-only discard retains retry debt: '+failure,async()=>{
  const home=await mkdtemp(join(homedir(),'.gozar-discard-'));
  await chmod(home,0o700);
  const canary='fixture-only-'+randomUUID(),foreign=randomUUID();
  const entries=new Map([[foreign,new TextEncoder().encode('foreign-fixture')]]);
  let mode=failure,deleteCalls=0;
  const backend={
   async put({bytes}){const handle=randomUUID();entries.set(handle,new Uint8Array(bytes));return {handle};},
   async presence({handle}){
    if(mode==='unknown')return {known:false,reason:'secret_backend_unavailable'};
    return {known:true,value:entries.has(handle)};
   },
   async delete({handle}){
    deleteCalls++;
    if(mode==='locked')throw Object.assign(new Error(canary),{code:'secret_backend_locked'});
    if(mode==='retained')return {deleted:false};
    entries.delete(handle);
    if(mode==='deleted-then-interrupted')throw new Error(canary);
    return {deleted:true};
   },
   async withSecret({handle},use){assert.ok(entries.has(handle));return use(entries.get(handle));},
  };
  const registryId=randomUUID(),request={home,owner:randomUUID(),providerId:randomUUID()};
  const create=()=>createEmbeddingServices({registryId,secretBackend:backend});
  const scan=async dir=>{
   for(const item of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,item.name);
    if(item.isDirectory())await scan(path);
    else if(item.isFile())assert.equal((await readFile(path)).includes(Buffer.from(canary)),false,path);
   }
  };
  try{
   let service=create();
   const config=await service.readConfiguration(request);
   const stored=await service.storeSecret({...request,inputId:'credential',scopeId:config.scopeId,
    expectedConfigurationRevision:config.revision,bytes:new TextEncoder().encode(canary)});
   await assert.rejects(service.discardSecret({home,handle:stored.handle}),error=>{
    assert.equal(error.code,failure==='locked'?'secret_backend_locked':'secret_backend_unavailable');
    assert.equal(String(error).includes(canary),false);
    assert.equal(JSON.stringify(error).includes(canary),false);
    return true;
   });
   const state=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
   assert.ok(state.secrets[stored.handle],'unconfirmed removal must retain retry authority');
   await scan(home);
   service=create(); // Reopen persisted custody, not just a same-instance retry.
   mode='ok';
   assert.deepEqual(await service.discardSecret({home,handle:stored.handle}),{discarded:true});
   assert.equal(entries.has(stored.handle),false);
   const calls=deleteCalls;
   assert.deepEqual(await service.discardSecret({home,handle:stored.handle}),{discarded:false});
   assert.equal(deleteCalls,calls);
   assert.deepEqual(await service.discardSecret({home,handle:foreign}),{discarded:false});
   assert.equal(entries.has(foreign),true);
   assert.equal(JSON.stringify(await service.readConfiguration(request)).includes(canary),false);
   await scan(home);
  }finally{await rm(home,{recursive:true,force:true});entries.clear();}
 });
}
