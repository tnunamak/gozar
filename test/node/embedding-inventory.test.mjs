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
 const cases=[[null,4000,known(4000),false],[8000,null,known(null),true],[8000,0,known(0)],[8000,undefined,unknown('not-declared')],[0,undefined,known(0),undefined,true]];
 const adapters=cases.map(([outer,idle,,account,native],n)=>{
  const id='unfamiliar-provider-'+n;
  const definition={id,label:'Outer name',supportedKinds:['attached','session'],idleTimeoutMs:outer,copy:{human:{name:'Outer copy'}},capabilities:{reach:'lan',transport:'https',needsAccount:account,address:{stability:'stable'}},disclosure:{revision:'v'},facts:[]};
  return {id,definition,...(native?{}:{operationalDefinition:{displayName:'Wrapped name',copy:{human:{name:'Wrapped copy',summary:'Wrapped summary'}},...(idle===undefined?{}:{idleTimeoutMs:idle})}}),detect:async()=>({state:'ready',facts:{}}),properties:()=>definition.capabilities,setupActions:()=>[]};
 });
 try {
  const {providers}=await listProviders({home},{adapters,embeddingServices:createEmbeddingServices({registryId:'metadata-fixture'}),readContext:{configuration:async()=>null}});
  for (const [n,row] of providers.entries()){
   const [,,idle,account,native]=cases[n];
   assert.deepEqual(row.idleTimeoutMs,idle);
   assert.deepEqual(row.displayName,known(native?'Outer name':'Wrapped name'));
   assert.deepEqual(row.copy.human.name,known('Outer copy'));
   assert.deepEqual(row.copy.human.summary,native?unknown('not-declared'):known('Wrapped summary'));
   assert.deepEqual(row.addressStability,known('stable'));
   assert.deepEqual(row.needsAccount,account===undefined?unknown('not-observed'):known(account));
  }
  assert.doesNotMatch(JSON.stringify(providers),/candidateToken/);
 } finally { await rm(home,{recursive:true,force:true}); }
});
