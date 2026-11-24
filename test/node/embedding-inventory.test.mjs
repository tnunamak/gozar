import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {dirname,join} from 'node:path';import {tmpdir} from 'node:os';
import {listProviders} from '../../packages/gozar-node/embedding-inventory.mjs';import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {recipeAdapter} from '../../packages/gozar-node/adapter-runtime.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';
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

test('inventory observes effective provider metadata without consent tokens', async()=>{
 const home=await mkdtemp(join(tmpdir(),'metadata-inventory-'));
 const known=value=>({known:true,value});
 const unknown=reason=>({known:false,reason});
 const inertMarker='INERT_TEST_SENTINEL_NOT_A_CREDENTIAL';
 const cases=new Map([
  ['wrapped-ephemeral',{outer:null,wrappedIdle:4000,idle:known(4000),account:false,stability:'ephemeral',address:known('ephemeral')}],
  ['wrapped-unlimited',{outer:8000,wrappedIdle:null,idle:known(null),account:true,stability:'stable',address:known('stable')}],
  ['wrapped-zero',{outer:8000,wrappedIdle:0,idle:known(0),stability:'stable',address:known('stable')}],
  ['wrapped-unobserved',{outer:8000,idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-negative-idle',{outer:8000,wrappedIdle:-1,idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-fractional-idle',{outer:8000,wrappedIdle:1.5,idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-string-idle',{outer:8000,wrappedIdle:'10',idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-blank-name',{outer:8000,blankName:true,idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-invalid',{outer:8000,idle:unknown('not-declared'),stability:'invalid',address:unknown('not-observed')}],
  ['native-zero',{outer:0,idle:known(0),stability:'stable',address:known('stable'),native:true}],
 ]);
 const adapters=[...cases].map(([id,entry])=>{
  const {outer,wrappedIdle,account,stability,native,blankName}=entry;
  const definition={id,label:blankName?' \t ':'Outer name',supportedKinds:['attached','session'],idleTimeoutMs:outer,copy:{human:{name:'Outer copy',address:'Declared address'}},capabilities:{reach:'lan',transport:'https',needsAccount:account,candidateToken:inertMarker,address:{stability:'stable'}},disclosure:{revision:'v'},facts:[]};
  return {id,definition,...(native?{}:{operationalDefinition:{candidateToken:inertMarker,...(blankName?{}:{displayName:'Wrapped name'}),copy:{human:{name:'Wrapped copy',summary:'Wrapped summary',address:'Wrapped address',setup:'Wrapped setup'}},...(wrappedIdle===undefined?{}:{idleTimeoutMs:wrappedIdle})}}),detect:async()=>({state:'ready',facts:{}}),properties:()=>({...definition.capabilities,...(stability===undefined?{address:undefined}:{address:{stability}})}),setupActions:()=>[]};
 });
 try {
  assert.equal(adapters[0].definition.capabilities.candidateToken,inertMarker);
  assert.equal(adapters[0].properties().candidateToken,inertMarker);
  assert.equal(adapters[0].operationalDefinition.candidateToken,inertMarker);
  const inventory=await listProviders({home},{adapters,embeddingServices:createEmbeddingServices({registryId:'metadata-fixture'}),readContext:{configuration:async()=>null}});
  const {providers}=inventory;
  assert.deepEqual(providers.map(row=>row.providerId).sort(),[...cases.keys()].sort());
  for (const row of providers){
   const expected=cases.get(row.providerId);
   assert.ok(expected);
   const {idle,account,native,address,blankName}=expected;
   assert.deepEqual(row.idleTimeoutMs,idle);
   assert.deepEqual(row.displayName,blankName?unknown('not-declared'):known(native?'Outer name':'Wrapped name'));
   assert.deepEqual(row.copy.human.name,known('Outer copy'));
   assert.deepEqual(row.copy.human.summary,native?unknown('not-declared'):known('Wrapped summary'));
   assert.deepEqual(row.copy.human.address,known('Declared address'));
   assert.deepEqual(row.copy.human.setup,native?unknown('not-declared'):known('Wrapped setup'));
   assert.deepEqual(row.addressStability,address);
   assert.deepEqual(row.needsAccount,account===undefined?unknown('not-observed'):known(account));
  }
  const serialized=JSON.stringify(inventory);
  assert.doesNotMatch(serialized,/candidateToken/);
  assert.equal(serialized.includes(inertMarker),false);
 } finally { await rm(home,{recursive:true,force:true}); }
});

test('admitted recipe idle limits agree with inventory while omission remains unknown', async t=>{
 const home=await mkdtemp(join(tmpdir(),'recipe-idle-parity-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const cases=[
  ['finite',{idleTimeoutMs:4000},4000,{known:true,value:4000}],
  ['zero',{idleTimeoutMs:0},0,{known:true,value:0}],
  ['unlimited',{idleTimeoutMs:null},null,{known:true,value:null}],
  ['omitted',{},null,{known:false,reason:'not-declared'}],
 ];
 const adapters=[];
 for(const [name,fields] of cases){
  const id='idle-'+name;
  const fixture=await fakeRegistry({id,kinds:['durable'],reach:'lan',dir:home});
  const definition=join(fixture.root,fixture.manifest.providers[0].definition);
  const wrappedFile=join(dirname(definition),'wrapped.definition.json');
  const wrapped=JSON.parse(await readFile(wrappedFile,'utf8'));
  delete wrapped.definition.idleTimeoutMs;
  Object.assign(wrapped.definition,fields);
  await writeFile(wrappedFile,JSON.stringify(wrapped));
  adapters.push(recipeAdapter({definition}));
 }
 const result=await listProviders({home},{adapters,platform:'linux',
  embeddingServices:createEmbeddingServices({registryId:'recipe-idle-parity'}),readContext:{configuration:async()=>null}});
 for(const [[name,,runtimeIdle,observedIdle],adapter] of cases.map((entry,i)=>[entry,adapters[i]])){
  const runtime=await adapter.runtimeFacts();
  const row=result.providers.find(item=>item.providerId==='idle-'+name);
  assert.ok(row,name);
  assert.equal(runtime.limits.idleTimeoutMs,runtimeIdle,name);
  assert.deepEqual(row.idleTimeoutMs,observedIdle,name);
  if(row.idleTimeoutMs.known) assert.equal(row.idleTimeoutMs.value,runtime.limits.idleTimeoutMs,name);
 }
});

test('each uncached inventory read projects the current host prerequisite observation', async t=>{
 const home=await mkdtemp(join(tmpdir(),'prerequisite-observation-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const definition={id:'prerequisite-fixture',supportedKinds:['attached'],capabilities:{reach:'lan',transport:'https'},
  disclosure:{revision:'v'},prerequisites:[{id:'local-setup',label:'Local setup',observation:'detected'}]};
 let observed;
 const adapter={id:definition.id,definition,properties:()=>definition.capabilities,setupActions:()=>[],
  detect:async()=>({state:observed===true?'ready':'action-required',facts:{detected:observed}})};
 const deps={adapters:[adapter],embeddingServices:createEmbeddingServices({registryId:'prerequisite-fixture'}),
  readContext:{configuration:async()=>null}};
 for(const [fact,state] of [[true,'present'],[false,'missing'],['denied','denied'],[undefined,'unknown']]){
  observed=fact;
  const {providers:[row]}=await listProviders({home},deps);
  assert.equal(row.prerequisites.find(item=>item.id==='local-setup')?.state,state);
 }
});
