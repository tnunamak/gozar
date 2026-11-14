import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Owner-scoped metadata unit boundary; run from repository root, not a detached journey.
const {createEmbeddingServices}=await import(pathToFileURL(resolve('packages/gozar-node/embedding-services.mjs')).href);
const {releaseRecordedConfigurationUse:release}=await import(pathToFileURL(resolve('packages/gozar-node/runtime-configuration-use.mjs')).href);
async function scratch(t){
 const parent=join(homedir(),'.tmp');await mkdir(parent,{recursive:true,mode:0o700});
 const info=await lstat(parent);assert.equal(info.isSymbolicLink(),false);assert.equal(info.mode&0o077,0);
 const home=await mkdtemp(join(parent,'metadata-release-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;
}
const handle={kind:'session',id:'fixture-session',generation:1};
test('matching services receive unchanged scope and propagate typed failure',async()=>{
 const scope={home:'fixture-home',owner:'owner',providerId:'provider',handle};
 let seen;
 await release({registryId:'registry',...scope},{registryId:'registry',embeddingServices:{releaseConfigurationUse:async r=>{seen=r;}}});
 assert.deepEqual(seen,scope);assert.equal(seen.handle,handle);
 await assert.rejects(release(scope,{}),{code:'secret_backend_unavailable'});
 await assert.rejects(release({registryId:7,...scope},{}),{code:'invalid_input'});
 await assert.rejects(release({registryId:'registry',...scope},{registryId:'registry',
  embeddingServices:{releaseConfigurationUse:async()=>{throw Object.assign(new Error('locked'),{code:'secret_backend_unavailable'});}}}),
  {code:'secret_backend_unavailable'});
});
test('host loss releases only recorded registry scope and exact handle, retaining applied references',async t=>{
 const home=await scratch(t);let touches=0;
 const backend=new Proxy({}, {get:()=>async()=>{touches++;throw new Error('unexpected credential access');}});
 const old=createEmbeddingServices({registryId:'old',secretBackend:backend});
 const current=createEmbeddingServices({registryId:'current',secretBackend:backend});
 const groups=[];
 for(const [services,owner,providerId]of [[old,'owner','provider'],[current,'owner','provider'],[old,'other','provider'],[old,'owner','other']]){
  const scope={home,owner,providerId};
  const c=await services.readConfiguration(scope);
  await services.registerConfigurationUse({...scope,revision:c.revision,handle});
  const draft=await services.beginConfigurationDraft({...scope,expectedConfigurationRevision:c.revision});
  const commit=()=>services.commitConfigurationDraft({...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
  await assert.rejects(commit(),{code:'configuration_in_use'});
  groups.push({services,scope,c,draft,commit});
 }
 const first=groups[0],secondHandle={...handle,id:'still-live'};
 await old.registerConfigurationUse({...first.scope,revision:first.c.revision,handle:secondHandle});
 await release({registryId:'old',...first.scope,handle},{registryId:'current',embeddingServices:current});
 await assert.rejects(first.commit(),{code:'configuration_in_use'},'second live shared use must remain');
 for(const g of groups.slice(1))await assert.rejects(g.commit(),{code:'configuration_in_use'});
 await release({registryId:'old',...first.scope,handle:secondHandle},{registryId:'old'});
 await first.commit();
 for(const g of groups.slice(1))await assert.rejects(g.commit(),{code:'configuration_in_use'});
 const before=await readFile(join(home,'embedding-state.json'),'utf8');
 await release({registryId:'old',...first.scope,handle},{});
 assert.equal(await readFile(join(home,'embedding-state.json'),'utf8'),before,'already released must not rewrite state');
 assert.equal(touches,0);
});
test('missing metadata never imports legacy configuration; corrupt metadata remains typed debt',async t=>{
 const home=await scratch(t);
 await mkdir(join(home,'setup'),{mode:0o700});
 const legacy=join(home,'setup','provider.json');
 await writeFile(legacy,'not valid legacy metadata',{mode:0o600});
 await release({registryId:'old',home,owner:'owner',providerId:'provider',handle},{});
 await assert.rejects(readFile(join(home,'embedding-state.json')),{code:'ENOENT'});
 assert.equal(await readFile(legacy,'utf8'),'not valid legacy metadata');
 await writeFile(join(home,'embedding-state.json'),'{broken',{mode:0o600});
 await assert.rejects(release({registryId:'old',home,owner:'owner',providerId:'provider',handle},{}),
  {code:'secret_backend_unavailable'});
 assert.equal(await readFile(join(home,'embedding-state.json'),'utf8'),'{broken');
});
test('metadata release preserves a live applied secret reference and backend bytes',async t=>{
 const home=await scratch(t),records=new Map();let calls=0;
 const backend={
  put:async({bytes})=>{calls++;records.set('opaque-reference',new Uint8Array(bytes));return {handle:'opaque-reference'};},
  withSecret:async({handle},use)=>{calls++;const bytes=new Uint8Array(records.get(handle));try{return await use(bytes);}finally{bytes.fill(0);}},
  presence:async({handle})=>{calls++;return {known:true,value:records.has(handle)};},
  delete:async()=>{calls++;throw new Error('applied credential must survive');}
 };
 const services=createEmbeddingServices({registryId:'shared',secretBackend:backend});
 const scope={home,owner:'owner',providerId:'provider'};
 const c=await services.readConfiguration(scope);
 const canary='canary-metadata-only-'+Date.now();
 const stored=await services.storeSecret({...scope,scopeId:c.scopeId,inputId:'credential',expectedConfigurationRevision:c.revision,bytes:new TextEncoder().encode(canary)});
 const bound=await services.mutateConfiguration({...scope,expectedConfigurationRevision:c.revision},tx=>tx.bindSecret('credential',stored.handle));
 const applied=bound.configuration;
 await services.registerConfigurationUse({...scope,revision:applied.revision,handle});
 const draft=await services.beginConfigurationDraft({...scope,expectedConfigurationRevision:applied.revision});
 const commit=()=>services.commitConfigurationDraft({...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
 await assert.rejects(commit(),{code:'configuration_in_use'});
 const before=calls;
 await release({registryId:'shared',...scope,handle},{registryId:'shared'});
 assert.equal(calls,before,'metadata recovery must never access backend');
 assert.equal(new TextDecoder().decode(records.get(stored.handle)),canary);
 const after=await commit();assert.deepEqual(after.credentials.credential,{known:true,value:true});
 assert.equal((await readFile(join(home,'embedding-state.json'),'utf8')).includes(canary),false);
 assert.equal(new TextDecoder().decode(records.get(stored.handle)),canary);
 records.get(stored.handle).fill(0);
});
