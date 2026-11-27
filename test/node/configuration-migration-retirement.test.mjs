import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createGozar,discardEarlierConfigurationDraft} from '../../packages/gozar-node/api.mjs';
import {inputKindsOf} from '../../packages/gozar-node/embedding-state.mjs';
import {createNamedAdapter} from '../../adapters/providers/cloudflare-named/index.mjs';

test('current managed setup inputs have the roles of their declared write actions',()=>{
  const adapter=createNamedAdapter();
  const kinds=inputKindsOf(adapter);
  assert.deepEqual({...kinds},{
    'managed-api-token':'secret', token:'secret', origin:'text', 'gate-port':'text',
    'managed-account':'text', 'managed-zone':'text', 'managed-hostname':'text', 'managed-port':'text',
  });
  assert.equal(Object.hasOwn(kinds,'unknown-input'),false);
  assert.deepEqual(adapter.configurationActions().map(action=>action.id),['managed-api-token','token','origin','gate-port']);
});

test('invalid supplemental input declarations fail closed',()=>{
  const base={definition:{},configurationActions:()=>[{id:'token',kind:'provide-secret'}]};
  for(const actions of [
    [{id:'token',kind:'provide-value'}],
    [{id:'bogus',kind:'instructions'}],
    [{id:'',kind:'provide-value'}],
    null,
  ]) assert.equal(inputKindsOf({...base,configurationInputActions:()=>actions}),undefined);
  assert.equal(inputKindsOf({...base,configurationInputActions(){throw new Error('bad declaration');}}),undefined);
});

for(const cancelled of [false,true])test(`configuration-migration-retirement: resource-free ${cancelled?'cancelled':'completed'} earlier setup permits adoption`,async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const request={home,owner:'upgrade-fixture',providerId:'localhost-run',operationId:'terminal-setup'};
 const earlier=createEmbeddingServices({registryId:PUBLISHED_REGISTRY_IDS[1]});
 const configuration=await earlier.readConfiguration(request);
 await earlier.setupTransaction(request,async storage=>storage.reserve({scopeId:configuration.scopeId,draftId:null,
  configurationRevision:configuration.revision,revision:1,startedAt:'2026-11-18T12:39:25.959Z',cancelled,
  management:{},replays:{},resources:[],offerKey:null}));
 let observations=0;
 const current=createEmbeddingServices({registryId:'registry-v1:upgrade-fixture',lineage:bundledLineage(),currentInputKinds:async()=>({}),
  observeEarlierSetupOperation:async({operation})=>{observations++;assert.equal(operation.cancelled,cancelled);return {state:cancelled?'cancelled':'complete',nextAction:null};}});
 const adopted=await current.readConfiguration(request);
 assert.notEqual(adopted.scopeId,configuration.scopeId);
 const saved=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 assert.equal(saved.configs[configuration.scopeId].migratedTo,adopted.scopeId);
 assert.equal(Object.values(saved.setupOperations??{}).filter(op=>op.scopeId===configuration.scopeId).length,0);
 assert.equal(observations,1);
 await current.readConfiguration(request);assert.equal(observations,1);
});

for(const [label,change,observation]of [
 ['unobserved completion',()=>{},null],
 ['pending observation',()=>{},{state:'pending',nextAction:null}],
 ['a remaining action',()=>{},{state:'complete',nextAction:{id:'next'}}],
 ['an active draft',(s,c,op)=>{c.drafts.active={};op.draftId='active';},{state:'complete',nextAction:null}],
 ['unknown resource presence',(s,c,op)=>{op.resources=[{presence:{known:false}}];},{state:'complete',nextAction:null}],
 ['operation-held credential',(s,c,op)=>{s.secrets.held={scopeId:c.scopeId,operationId:'terminal-setup'};},{state:'complete',nextAction:null}],
 ['management credential',(s,c,op)=>{op.management.token='retained';},{state:'complete',nextAction:null}],
 ['a route reservation',(s,c)=>{c.uses=['retained-route'];},{state:'complete',nextAction:null}],
])test(`configuration-migration-retirement: ${label} preserves the earlier state`,async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const request={home,owner:'upgrade-fixture',providerId:'localhost-run',operationId:'terminal-setup'};
 const old=createEmbeddingServices({registryId:PUBLISHED_REGISTRY_IDS[1]});
 const config=await old.readConfiguration(request);
 await old.setupTransaction(request,async storage=>storage.reserve({scopeId:config.scopeId,draftId:null,configurationRevision:config.revision,
  revision:1,cancelled:false,management:{},resources:[],offerKey:null}));
 const path=join(home,'embedding-state.json'),state=JSON.parse(await readFile(path,'utf8'));
 change(state,state.configs[config.scopeId],Object.values(state.setupOperations)[0]);
 await writeFile(path,JSON.stringify(state));const before=await readFile(path,'utf8');
 const current=createEmbeddingServices({registryId:'registry-v1:upgrade-fixture',lineage:bundledLineage(),currentInputKinds:async()=>({}),observeEarlierSetupOperation:async()=>observation});
 await assert.rejects(current.readConfiguration(request),{code:'configuration_migration_required'});
 assert.equal(await readFile(path,'utf8'),before);
});

test('earlier draft discard is restricted to exact declared predecessor and is a byte-stable no-op on repeat',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'c'.repeat(64);
 const request={home,owner:'draft-owner-fixture',providerId:'localhost-run'};
 const old=createEmbeddingServices({registryId:fromRegistryId});
 const oldConfig=await old.readConfiguration(request);
 const {draftId}=await old.beginConfigurationDraft({...request,expectedConfigurationRevision:oldConfig.revision});
 const current=createEmbeddingServices({
  registryId:'registry-v1:'+'d'.repeat(64),lineage:{id:'draft-cleanup-fixture',replaces:[fromRegistryId]},
  currentInputKinds:async()=>({})
 });
 const discard={...request,fromRegistryId,draftId};
 const filename=join(home,'embedding-state.json');
 const before=await readFile(filename,'utf8');
 await assert.rejects(current.readConfiguration(request),{code:'configuration_migration_required',reason:'inflight'});
 assert.deepEqual(await current.discardEarlierConfigurationDraft({...discard,owner:'other-fixture'}),{discarded:false});
 assert.deepEqual(await current.discardEarlierConfigurationDraft({...discard,providerId:'other-fixture'}),{discarded:false});
 await assert.rejects(current.discardEarlierConfigurationDraft({...discard,fromRegistryId:'registry-v1:'+'b'.repeat(64)}),{code:'invalid_input'});
 await assert.rejects(current.discardEarlierConfigurationDraft({...discard,draftId:''}),{code:'invalid_input'});
 assert.equal(await readFile(filename,'utf8'),before);
 assert.deepEqual(await current.discardEarlierConfigurationDraft(discard),{discarded:true});
 const after=await readFile(filename,'utf8');
 assert.deepEqual(await current.discardEarlierConfigurationDraft(discard),{discarded:false});
 assert.equal(await readFile(filename,'utf8'),after);
 assert.notEqual((await current.readConfiguration(request)).scopeId,oldConfig.scopeId);
 const adopted=await readFile(filename,'utf8');
 assert.deepEqual(await current.discardEarlierConfigurationDraft(discard),{discarded:false});
 assert.equal(await readFile(filename,'utf8'),adopted);
 const rival=createEmbeddingServices({registryId:'rival-test',lineage:{id:'rival-draft-cleanup',replaces:[fromRegistryId]}});
 await assert.rejects(rival.discardEarlierConfigurationDraft(discard),{code:'configuration_migration_required',reason:'taken'});
 assert.equal(await readFile(filename,'utf8'),adopted);
});

test('earlier draft cleanup checkpoints partial progress, retries after restart, and preserves shared references',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'a'.repeat(64);
 const request={home,owner:'cleanup-fixture',providerId:'localhost-run'};
 const previous=createEmbeddingServices({registryId:fromRegistryId});
 const old=await previous.readConfiguration(request);
 const begin=()=>previous.beginConfigurationDraft({...request,expectedConfigurationRevision:old.revision});
 const {draftId}=await begin(),sibling=await begin();
 const filename=join(home,'embedding-state.json'),state=JSON.parse(await readFile(filename,'utf8'));
 const record=state.configs[old.scopeId];
 const ids={first:'fixture-first',retry:'fixture-retry',applied:'fixture-applied',sibling:'fixture-sibling'};
 for(const [name,handle]of Object.entries(ids)){
  state.secrets[handle]={registryId:fromRegistryId,scopeId:old.scopeId,draftId,inputId:name,revision:old.revision};
  record.drafts[draftId].bindings[name]=handle;
 }
 record.bindings.applied=ids.applied;
 record.drafts[sibling.draftId].bindings.sibling=ids.sibling;
 await writeFile(filename,JSON.stringify(state));
 const present=new Set(Object.values(ids)),removed=[];
 let refusal='locked',byteReads=0;
 const secretBackend={
  presence:async({scopeId,handle})=>{
   assert.equal(scopeId,old.scopeId);
   return handle===ids.retry&&refusal==='locked'
    ?{known:false,reason:'secret_backend_locked'}:{known:true,value:present.has(handle)};
  },
  delete:async({scopeId,handle})=>{
   assert.equal(scopeId,old.scopeId);removed.push(handle);
   if(!(handle===ids.retry&&refusal==='lying'))present.delete(handle);
   return {deleted:true};
  },
  withSecret:async()=>{byteReads++;assert.fail('cleanup requested secret bytes');}
 };
 const make=()=>createEmbeddingServices({registryId:'registry-v1:'+'b'.repeat(64),
  lineage:{id:'cleanup-fixture',replaces:[fromRegistryId]},currentInputKinds:async()=>({}),secretBackend});
 const selector={...request,fromRegistryId,draftId};
 await assert.rejects(make().discardEarlierConfigurationDraft(selector),{code:'secret_backend_locked'});
 const after=JSON.parse(await readFile(filename,'utf8'));
 assert.equal(after.configs[old.scopeId].drafts[draftId],undefined);
 assert.equal(after.secrets[ids.first],undefined);
 assert.ok(after.secrets[ids.retry]);
 await assert.rejects(make().readConfiguration(request),error=>{
  assert.equal(error.reason,'inflight');
  assert.ok(error.migration.candidates[0].draftIds.includes(draftId));
  return true;
 });
 refusal='lying';
 await assert.rejects(make().discardEarlierConfigurationDraft(selector),{code:'secret_backend_unavailable'});
 assert.ok(JSON.parse(await readFile(filename,'utf8')).secrets[ids.retry]);
 refusal=null;
 assert.deepEqual(await make().discardEarlierConfigurationDraft(selector),{discarded:false});
 const final=JSON.parse(await readFile(filename,'utf8'));
 assert.equal(final.secrets[ids.retry],undefined);
 assert.equal(final.configs[old.scopeId].bindings.applied,ids.applied);
 assert.equal(final.configs[old.scopeId].drafts[sibling.draftId].bindings.sibling,ids.sibling);
 assert.deepEqual(removed,[ids.first,ids.retry,ids.retry]);
 assert.equal(byteReads,0);
});

test('earlier discard refuses same-draft setup custody without detaching it',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'f'.repeat(64);
 const request={home,owner:'custody-fixture',providerId:'localhost-run'};
 const previous=createEmbeddingServices({registryId:fromRegistryId});
 const old=await previous.readConfiguration(request);
 const {draftId}=await previous.beginConfigurationDraft({...request,expectedConfigurationRevision:old.revision});
 await previous.setupTransaction({...request,draftId,operationId:'setup-fixture'},async storage=>{
  const configuration=await storage.tx.configuration();
  storage.reserve({scopeId:old.scopeId,draftId,revision:1,configurationRevision:configuration.revision,
   cancelled:false,management:{},resources:[]});
 });
 const current=createEmbeddingServices({registryId:'registry-v1:'+'9'.repeat(64),
  lineage:{id:'custody-fixture',replaces:[fromRegistryId]}});
 const filename=join(home,'embedding-state.json'),before=await readFile(filename,'utf8');
 await assert.rejects(current.discardEarlierConfigurationDraft({...request,fromRegistryId,draftId}),
  {code:'configuration_migration_required',reason:'inflight'});
 assert.equal(await readFile(filename,'utf8'),before);
});

test('one blocked predecessor keeps cached provider inventory usable and exposes only migration metadata',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'e'.repeat(64);
 const request={home,owner:'upgrade-fixture',providerId:'localhost-run'};
 const earlier=createEmbeddingServices({registryId:fromRegistryId});
 const configuration=await earlier.readConfiguration(request);
 const draft=await earlier.beginConfigurationDraft({...request,expectedConfigurationRevision:configuration.revision});
 const api=createRouteApi({
  registryLineage:{id:'inventory-upgrade-fixture',replaces:[fromRegistryId]},
  readContext:{now:Date.now,probe:async()=>({ok:true})}
 });
 const migration={reason:'inflight',candidates:[{fromRegistryId,draftIds:[draft.draftId],setupOperationIds:[],uses:0}]};
 for(const refresh of [false,true,false]){
  const report=await api.listProviders({...request,refresh});
  assert.ok(report.catalogRevision);
  const blocked=report.providers.find(row=>row.providerId===request.providerId);
  assert.deepEqual(blocked.configuration,{known:false,reason:'configuration_migration_required',migration});
  assert.equal(blocked.reach,'internet');
  assert.equal(blocked.transport,'https');
  assert.ok(Object.values(blocked.availability).every(row=>row.state==='unsupported'&&row.reason==='configuration_migration_required'));
  assert.ok(report.providers.some(row=>row.providerId!==request.providerId&&row.configuration.reason!=='configuration_migration_required'));
  assert.equal(JSON.stringify(blocked.configuration).includes(home),false);
 }
 await assert.rejects(api.adoptConfiguration({...request,fromRegistryId}),error=>{
  assert.equal(error.code,'configuration_migration_required');
  assert.equal(error.reason,'inflight');
  assert.deepEqual(error.migration,migration);
  return true;
 });
 const preserved=await earlier.readConfigurationDraft({...request,draftId:draft.draftId});
 assert.equal(preserved.draftId,draft.draftId);
});

test('configuration-migration-retirement: bundled inventory observes historical localhost.run setup before adopting',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const request={home,owner:'upgrade-fixture',providerId:'localhost-run',operationId:'terminal-setup'};
 const old=createEmbeddingServices({registryId:PUBLISHED_REGISTRY_IDS[1]}),config=await old.readConfiguration(request);
 await old.setupTransaction(request,async storage=>storage.reserve({scopeId:config.scopeId,draftId:null,configurationRevision:config.revision,
  revision:1,startedAt:'2026-11-18T12:39:25.959Z',cancelled:false,management:{},resources:[],offerKey:null}));
 let probes=0;
 const api=createRouteApi({readContext:{now:Date.now,probe:async recipe=>{probes++;assert.equal(recipe.program,'ssh');return {ok:true};}}});
 await api.listProviders({home,owner:request.owner,providerId:request.providerId});
 const saved=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 assert.ok(saved.configs[config.scopeId].migratedTo);
 assert.equal(Object.keys(saved.setupOperations).length,0);
 assert.ok(probes>0);
});


test('earlier setup journal keys are not advertised as actionable public operation IDs',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'d'.repeat(64),request={home,owner:'scope-owner',providerId:'localhost-run',operationId:'public-operation-id'};
 const earlier=createEmbeddingServices({registryId:fromRegistryId}),configuration=await earlier.readConfiguration(request);
 await earlier.setupTransaction(request,storage=>storage.reserve({scopeId:configuration.scopeId,draftId:null,configurationRevision:configuration.revision,
  revision:1,cancelled:false,management:{},resources:[],offerKey:null}));
 const current=createEmbeddingServices({registryId:'current-test',lineage:{id:'setup-diagnostic-scope',replaces:[fromRegistryId]},currentInputKinds:async()=>({})});
 const path=join(home,'embedding-state.json'),before=await readFile(path,'utf8');
 const journalKey=Object.keys(JSON.parse(before).setupOperations)[0];
 await assert.rejects(current.readConfiguration(request),error=>{
  const candidate=error.migration.candidates[0];
  assert.deepEqual(candidate.setupOperationIds,[]);
  assert.equal(candidate.unaddressableSetupOperations,1);
  assert.deepEqual(error.migration.recovery,{available:false,reason:'unaddressable_setup_operations'});
  assert.equal(JSON.stringify(candidate).includes(journalKey),false);
  return error.code==='configuration_migration_required'&&error.reason==='inflight';
 });
 assert.equal(await readFile(path,'utf8'),before);
});


test('public earlier-draft recovery restores flat provider inventory and is byte-stable after adoption',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'9'.repeat(64),request={home,owner:'public-draft-fixture',providerId:'localhost-run'};
 const earlier=createEmbeddingServices({registryId:fromRegistryId});
 const previous=await earlier.readConfiguration(request);
 const {draftId}=await earlier.beginConfigurationDraft({...request,expectedConfigurationRevision:previous.revision});
 const registryLineage={id:'public-cleanup-fixture',replaces:[fromRegistryId]};
 const make=()=>createGozar({registryLineage});
 const api=make();
 const selector={...request,fromRegistryId,draftId};
 const before=await api.listProviders({home,owner:request.owner});
 const blocked=before.providers.filter(row=>row.configuration.known===false);
 const migration={reason:'inflight',candidates:[{fromRegistryId,draftIds:[draftId],setupOperationIds:[],uses:0}]};
 assert.equal(blocked.length,1);
 assert.equal(blocked[0].providerId,request.providerId);
 assert.deepEqual(blocked[0].configuration,{known:false,reason:'configuration_migration_required',migration});
 const others=before.providers.filter(row=>row.providerId!==request.providerId);
 assert.ok(others.length>0);
 for(const {configuration} of others){
  assert.equal(typeof configuration.revision,'string');
  assert.equal(Object.hasOwn(configuration,'known'),false);
 }
 assert.equal(typeof discardEarlierConfigurationDraft,'function');
 assert.deepEqual(await api.discardEarlierConfigurationDraft(selector),{discarded:true});
 const after=await api.listProviders({home,owner:request.owner});
 assert.deepEqual(after.providers.map(row=>row.providerId).sort(),before.providers.map(row=>row.providerId).sort());
 const configuration=after.providers.find(row=>row.providerId===request.providerId).configuration;
 assert.equal(typeof configuration.revision,'string');
 assert.notEqual(configuration.scopeId,previous.scopeId);
 assert.equal(Object.hasOwn(configuration,'known'),false);
 const path=join(home,'embedding-state.json'),state=await readFile(path,'utf8');
 assert.deepEqual(await api.discardEarlierConfigurationDraft(selector),{discarded:false});
 assert.deepEqual(await make().discardEarlierConfigurationDraft(selector),{discarded:false});
 assert.equal(await readFile(path,'utf8'),state);
 const rival=createGozar({registryLineage:{...registryLineage,id:'public-cleanup-rival'}});
 await assert.rejects(rival.discardEarlierConfigurationDraft(selector),error=>{
  assert.equal(error.code,'configuration_migration_required');
  assert.equal(error.reason,'taken');
  assert.equal(error.migration.reason,'taken');
  return true;
 });
});

test('public inventory preserves unavailable earlier setup recovery details',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'7'.repeat(64),request={home,owner:'public-setup-fixture',providerId:'localhost-run'};
 const earlier=createEmbeddingServices({registryId:fromRegistryId}),configuration=await earlier.readConfiguration(request);
 await earlier.setupTransaction({...request,operationId:'fixture-setup'},storage=>storage.reserve({
  scopeId:configuration.scopeId,draftId:null,configurationRevision:configuration.revision,
  revision:1,cancelled:false,management:{},resources:[{id:'inert-retained-resource'}],offerKey:null,
 }));
 const api=createGozar({registryLineage:{id:'public-setup-fixture',replaces:[fromRegistryId]}});
 const {providers}=await api.listProviders({home,owner:request.owner});
 const blocked=providers.find(row=>row.providerId===request.providerId).configuration;
 assert.equal(blocked.known,false);
 assert.equal(blocked.reason,'configuration_migration_required');
 assert.deepEqual(blocked.migration.recovery,{available:false,reason:'unaddressable_setup_operations'});
 assert.equal(blocked.migration.candidates[0].unaddressableSetupOperations,1);
 assert.deepEqual(blocked.migration.candidates[0].setupOperationIds,[]);
});

test('public recovery declarations enforce the request and both inventory branches',async t=>{
 const compiler=process.env.GOZAR_TSC||'tsc';
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-types-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const consumer=join(home,'consumer.mts');
 const declarations=fileURLToPath(new URL('../../packages/gozar-node/route-contract.js',import.meta.url)).replaceAll('\\','/');
 await writeFile(consumer,`
import {createGozar,discardEarlierConfigurationDraft} from ${JSON.stringify(declarations)};
import type {ConfigurationMigration,ConfigurationMigrationReason,GozarThrownError,ProviderInventory} from ${JSON.stringify(declarations)};
const api=createGozar();
const selector={home:'/fixture',providerId:'localhost-run',fromRegistryId:'fixture-registry',draftId:'fixture-draft'};
const check:typeof discardEarlierConfigurationDraft=api.discardEarlierConfigurationDraft;
const result:Promise<{discarded:boolean}>=check(selector);
// @ts-expect-error The exact earlier registry identity is required.
void discardEarlierConfigurationDraft({home:'/fixture',providerId:'localhost-run',draftId:'fixture-draft'});
function project(row:ProviderInventory,error:GozarThrownError){
 if(row.configuration.known===false){
  const migration:ConfigurationMigration=row.configuration.migration;
  const reason:ConfigurationMigrationReason=migration.reason;
  if(migration.recovery?.available===false){
   const unavailable:'unaddressable_setup_operations'=migration.recovery.reason;
   void unavailable;
  }
  return {reason,candidates:migration.candidates,error:error.migration};
 }
 return row.configuration.revision;
}
// @ts-expect-error Migration reasons are a closed vocabulary.
const arbitrary:ConfigurationMigrationReason='fixture-not-a-migration-reason';
void [result,project,arbitrary];
`);
 await new Promise((resolve,reject)=>execFile(compiler,
  ['--strict','--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext',consumer],
  {timeout:15_000},(error,stdout,stderr)=>error?reject(new Error(String(stdout)+String(stderr),{cause:error})):resolve())).catch(error=>{
   if(error.cause?.code==='ENOENT')return t.skip('TypeScript compiler is not installed');
   throw error;
  });
});

test('earlier draft cleanup also removes default-store draft-owned files',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const fromRegistryId='registry-v1:'+'8'.repeat(64),request={home,owner:'default-store-fixture',providerId:'localhost-run'};
 const earlier=createEmbeddingServices({registryId:fromRegistryId}),configuration=await earlier.readConfiguration(request);
 const draft=await earlier.beginConfigurationDraft({...request,expectedConfigurationRevision:configuration.revision});
 const stored=await earlier.storeSecret({...request,draftId:draft.draftId,scopeId:configuration.scopeId,
  expectedConfigurationRevision:draft.configuration.revision,inputId:'token',bytes:new TextEncoder().encode('inert-fixture-credential')});
 const current=createEmbeddingServices({registryId:'default-store-current',lineage:{id:'default-store-lineage',replaces:[fromRegistryId]},currentInputKinds:async()=>({token:'secret'})});
 assert.deepEqual(await current.discardEarlierConfigurationDraft({...request,fromRegistryId,draftId:draft.draftId}),{discarded:true});
 await assert.rejects(readFile(join(home,'secrets',stored.handle)),{code:'ENOENT'});
 const saved=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 assert.equal(saved.secrets[stored.handle],undefined);
});
