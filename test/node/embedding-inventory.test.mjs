import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
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

test('inventory observes effective provider metadata without consent tokens', async()=>{
 const home=await mkdtemp(join(tmpdir(),'metadata-inventory-'));
 const known=value=>({known:true,value});
 const unknown=reason=>({known:false,reason});
 const cases=new Map([
  ['wrapped-ephemeral',{outer:null,wrappedIdle:4000,idle:known(4000),account:false,stability:'ephemeral',address:known('ephemeral')}],
  ['wrapped-unlimited',{outer:8000,wrappedIdle:null,idle:known(null),account:true,stability:'stable',address:known('stable')}],
  ['wrapped-zero',{outer:8000,wrappedIdle:0,idle:known(0),stability:'stable',address:known('stable')}],
  ['wrapped-unobserved',{outer:8000,idle:unknown('not-declared'),address:unknown('not-observed')}],
  ['wrapped-invalid',{outer:8000,idle:unknown('not-declared'),stability:'invalid',address:unknown('not-observed')}],
  ['native-zero',{outer:0,idle:known(0),stability:'stable',address:known('stable'),native:true}],
 ]);
 const adapters=[...cases].map(([id,entry])=>{
  const {outer,wrappedIdle,account,stability,native}=entry;
  const definition={id,label:'Outer name',supportedKinds:['attached','session'],idleTimeoutMs:outer,copy:{human:{name:'Outer copy'}},capabilities:{reach:'lan',transport:'https',needsAccount:account,address:{stability:'stable'}},disclosure:{revision:'v'},facts:[]};
  return {id,definition,...(native?{}:{operationalDefinition:{displayName:'Wrapped name',copy:{human:{name:'Wrapped copy',summary:'Wrapped summary'}},...(wrappedIdle===undefined?{}:{idleTimeoutMs:wrappedIdle})}}),detect:async()=>({state:'ready',facts:{}}),properties:()=>({...definition.capabilities,...(stability===undefined?{address:undefined}:{address:{stability}})}),setupActions:()=>[]};
 });
 try {
  const {providers}=await listProviders({home},{adapters,embeddingServices:createEmbeddingServices({registryId:'metadata-fixture'}),readContext:{configuration:async()=>null}});
  assert.deepEqual(providers.map(row=>row.providerId).sort(),[...cases.keys()].sort());
  for (const row of providers){
   const expected=cases.get(row.providerId);
   assert.ok(expected);
   const {idle,account,native,address}=expected;
   assert.deepEqual(row.idleTimeoutMs,idle);
   assert.deepEqual(row.displayName,known(native?'Outer name':'Wrapped name'));
   assert.deepEqual(row.copy.human.name,known('Outer copy'));
   assert.deepEqual(row.copy.human.summary,native?unknown('not-declared'):known('Wrapped summary'));
   assert.deepEqual(row.addressStability,address);
   assert.deepEqual(row.needsAccount,account===undefined?unknown('not-observed'):known(account));
  }
  assert.doesNotMatch(JSON.stringify(providers),/candidateToken/);
 } finally { await rm(home,{recursive:true,force:true}); }
});
