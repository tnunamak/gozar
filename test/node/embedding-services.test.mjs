import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
const code = wanted => error => error.code === wanted;
test('CAS, staged rotation, route use and discard preserve old credential',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embedding-')); const values=new Map(); let effects=0;
 const backend={put:async({bytes})=>{const handle=`key-${values.size}`;values.set(handle,Buffer.from(bytes));return {handle};},withSecret:async({handle},use)=>use(values.get(handle)),presence:async({handle})=>({known:true,value:values.has(handle)}),delete:async({handle})=>({deleted:values.delete(handle)})};
 const s=createEmbeddingServices({registryId:'fixture',secretBackend:backend});
 try{
 const c=await s.readConfiguration({home,providerId:'opaque'});
 await assert.rejects(s.mutateConfiguration({home,providerId:'opaque',expectedConfigurationRevision:'stale'},async()=>{effects++;}),code('configuration_stale')); assert.equal(effects,0);
 const secret=await s.storeSecret({home,providerId:'opaque',inputId:'token',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from('canary-keychain')});
 await s.mutateConfiguration({home,providerId:'opaque',expectedConfigurationRevision:c.revision}, async tx=>tx.bindSecret('token',secret.handle));
 const applied=await s.readConfiguration({home,providerId:'opaque'}); const d=await s.beginConfigurationDraft({home,providerId:'opaque',expectedConfigurationRevision:applied.revision});
 await s.registerConfigurationUse({home,providerId:'opaque',revision:applied.revision,handle:'route'});
 await assert.rejects(s.commitConfigurationDraft({home,providerId:'opaque',draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision}),code('configuration_in_use'));
 await assert.rejects(s.discardSecret({home,handle:secret.handle}),code('secret_in_use'));
 await s.releaseConfigurationUse({home,providerId:'opaque',handle:'route'});
 assert.deepEqual(await s.discardConfigurationDraft({home,providerId:'opaque',draftId:d.draftId}),{discarded:true});
 assert.deepEqual(await s.discardConfigurationDraft({home,providerId:'opaque',draftId:d.draftId}),{discarded:false});
 assert.equal((await s.resolveConfiguration({home,providerId:'opaque'})).token,'canary-keychain');
 assert.equal((await readFile(join(home,'embedding-state.json'),'utf8')).includes('canary-keychain'),false);
 }finally{await rm(home,{recursive:true,force:true});}
});
