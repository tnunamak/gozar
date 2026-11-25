import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
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
