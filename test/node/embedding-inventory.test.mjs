import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {listProviders} from '../../packages/gozar-node/embedding-inventory.mjs';import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
test('inventory includes unfamiliar providers, audiences, and unsupported usages without tokens',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-inventory-'));const adapters=['unfamiliar-a','unfamiliar-b'].map((id,n)=>({id,definition:{id,label:id,supportedKinds:n?['durable']:['attached','session'],requiredCapabilities:['runtime.attached'],capabilities:{reach:n?'tailnet':'lan',transport:'https'},disclosure:{revision:'v'},facts:[]},detect:async()=>({state:'ready',facts:{}}),properties(){return this.definition.capabilities;},setupActions:()=>[]}));
 try{const deps={adapters,embeddingServices:createEmbeddingServices({registryId:'fixture'}),readContext:{configuration:async()=>null}};const v=await listProviders({home},deps);assert.equal(v.providers.length,2);assert.equal(v.providers[0].availability.durable.state,'unsupported');assert.equal(v.providers[0].availability.attached.state,'unsupported');assert.equal(v.providers[1].reach,'tailnet');assert.equal(v.providers[0].prerequisites.find(p=>p.id==='runtime.attached').observation.reason,'host-capability-undeclared');assert.equal(JSON.stringify(v).includes('candidateToken'),false);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('inventory decorates actions and prerequisite remedies with the same configuration snapshot',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-decorate-'));const action={id:'provide',kind:'provide-secret',label:'Key',disclosure:{revision:'v'},digest:'action'};
 const adapter={id:'unfamiliar',definition:{supportedKinds:['attached'],capabilities:{reach:'internet',transport:'https'},disclosure:{revision:'v'},prerequisites:[{id:'key',label:'Key',observation:'detected',actionId:'provide'}]},detect:async()=>({state:'action-required',facts:{detected:false}}),properties(){return this.definition.capabilities;},setupActions:()=>[action]};
 try{const s=createEmbeddingServices({registryId:'fixture'});const v=await listProviders({home},{adapters:[adapter],embeddingServices:s,readContext:{configuration:async()=>null},decorateSetupAction:({action,configuration,draftId})=>({...action,consentFactsDigest:`fixture:${configuration.revision}:${draftId}`})});const p=v.providers[0];assert.equal(p.configuration.actions[0].consentFactsDigest,`fixture:${p.configuration.revision}:null`);assert.equal(p.prerequisites[0].remedy.consentFactsDigest,p.configuration.actions[0].consentFactsDigest);
 }finally{await rm(home,{recursive:true,force:true});}
});

import {recipeAdapter} from '../../packages/gozar-node/adapter-runtime.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';

test('inventory reports the operational idle timeout of admitted recipe adapters',async t=>{
 const home=await mkdtemp(join(tmpdir(),'embed-idle-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const cases=[
  ['wrapped-finite',null,4000,4000],
  ['wrapped-null',8000,null,null],
  ['wrapped-zero',8000,0,0],
  ['wrapped-equal',6000,6000,6000],
  ['wrapped-unknown',undefined,undefined,undefined],
  ['declared-only-wrapped',8000,undefined,undefined],
 ];
 const adapters=[];
 for(const [id,declared,wrapped] of cases){
  const registry=await fakeRegistry({id,kinds:['durable'],reach:'internet',dir:home});
  const entry=registry.manifest.providers[0];
  const location=join(home,entry.definition);
  const outer=JSON.parse(await readFile(location,'utf8'));
  const recipe=join(home,'providers',id,outer.wraps);
  const inner=JSON.parse(await readFile(recipe,'utf8'));
  if(wrapped===undefined)delete inner.definition.idleTimeoutMs;
  else inner.definition.idleTimeoutMs=wrapped;
  await writeFile(recipe,JSON.stringify(inner));
  // Keep the registry input schema-valid; this models the presentation field supplied by a trusted wrapper.
  adapters.push(recipeAdapter({definition:location,externalOwned:true,extend:({definition})=>
   declared===undefined?{}:{definition:{...definition,idleTimeoutMs:declared}}}));
 }
 const native={id:'native-idle',definition:{id:'native-idle',supportedKinds:['session'],
  idleTimeoutMs:0,capabilities:{reach:'lan',transport:'https'},facts:[],disclosure:{revision:'v'}},
 detect:async()=>({state:'ready',facts:{}}),properties(){return this.definition.capabilities;},setupActions:()=>[]};
 const deps={adapters:[...adapters,native],embeddingServices:createEmbeddingServices({registryId:'fixture'}),
  readContext:{configuration:async()=>null}};
 const {providers}=await listProviders({home},deps);
 const rows=new Map(providers.map(row=>[row.providerId,row]));
 for(const [id,,,expected] of cases){
  const facts=await adapters.find(adapter=>adapter.id===id).runtimeFacts();
  assert.equal(facts.limits.idleTimeoutMs,expected??null,id+' operational limit');
  assert.deepEqual(rows.get(id).idleTimeoutMs,expected===undefined?{known:false,reason:'not-declared'}:
   {known:true,value:facts.limits.idleTimeoutMs},id+' inventory limit');
 }
 assert.deepEqual(rows.get(native.id).idleTimeoutMs,{known:true,value:0});
});
