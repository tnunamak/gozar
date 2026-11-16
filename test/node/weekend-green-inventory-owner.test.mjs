import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listProviders} from '../../packages/gozar-node/embedding-inventory.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

for(const [requestedOwner,dependencyOwner] of [['owner-A','owner-B'],['owner-B','owner-A'],[undefined,'owner-B'],[undefined,undefined]]){
 test('inventory configuration owner: '+(requestedOwner??'omitted')+' versus '+dependencyOwner,async t=>{
  const home=await mkdtemp(join(tmpdir(),'inventory-owner-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const service=createEmbeddingServices({registryId:'fixture'});
  const ids=['unfamiliar-owner-a','unfamiliar-owner-b'];
  // Seed only ordinary text through the real public service, never a hand-made
  // configuration file, credential binding, scope hash or revision.
  const configurations=new Map();
  const key=(id,owner)=>JSON.stringify([id,owner??null]);
  for(const id of ids)for(const owner of ['owner-A','owner-B',undefined]){
   const input={home,providerId:id,...(owner===undefined?{}:{owner})};
   const prior=await service.readConfiguration(input);
   const result=await service.mutateConfiguration({...input,expectedConfigurationRevision:prior.revision},
    tx=>tx.bindText('fixture-owner',owner??'unnamed'));
   configurations.set(key(id,owner),result.configuration);
  }
  const resolved=[],saved=[],observed=[];
  const embeddingServices={
   async resolveConfiguration(input){
    resolved.push({...input});
    return service.resolveConfiguration(input);
   },
   async readConfiguration(input){
    const value=await service.readConfiguration(input);
    saved.push({input:{...input},value});
    return value;
   },
  };
  const adapters=ids.map((id,n)=>({
   id,definition:{id,label:id,supportedKinds:n?['durable']:['attached','session'],
    capabilities:{reach:n?'tailnet':'lan',transport:'https'},disclosure:{revision:'v'},facts:[]},
   async detect(context){
    const value=await context.providerConfiguration(id);
    observed.push({id,home:context.home,platform:context.platform,value});
    return {state:'ready',facts:{}};
   },
   properties(){return this.definition.capabilities;},
   setupActions:()=>[],
  }));
  const request={home,...(requestedOwner===undefined?{}:{owner:requestedOwner})};
  const view=await listProviders(request,{adapters,embeddingServices,owner:dependencyOwner,
   platform:'linux',readContext:{configuration:async()=>null}});
  const effectiveOwner=requestedOwner===undefined?dependencyOwner:requestedOwner;
  assert.deepEqual(resolved.sort((a,b)=>a.providerId.localeCompare(b.providerId)),
   ids.map(providerId=>({home,owner:effectiveOwner,providerId})));
  assert.equal(observed.length,ids.length);assert.equal(saved.length,ids.length);
  assert.deepEqual(view.providers.map(p=>p.providerId),ids);
  for(const [n,provider] of view.providers.entries()){
   const read=observed.find(row=>row.id===provider.providerId);
   assert.deepEqual(read,{id:provider.providerId,home,platform:'linux',value:{'fixture-owner':effectiveOwner??'unnamed'}});
   const capture=saved.find(row=>row.input.providerId===provider.providerId);
   assert.deepEqual(capture.input,{...request,owner:effectiveOwner,providerId:provider.providerId});
   // Inspection and the emitted configuration must use the same canonical scope.
   const expected=configurations.get(key(provider.providerId,effectiveOwner));
   assert.equal(capture.value.scopeId,expected.scopeId);
   assert.equal(capture.value.revision,expected.revision);
   assert.equal(provider.configuration.scopeId,expected.scopeId);
   assert.equal(provider.configuration.revision,expected.revision);
   if(requestedOwner!==undefined)
    assert.notEqual(provider.configuration.scopeId,configurations.get(key(provider.providerId,dependencyOwner)).scopeId);
   assert.deepEqual(Object.keys(provider.availability),['session','attached','durable']);
   for(const kind of ['session','attached','durable'])
    assert.equal(provider.availability[kind].state,adapters[n].definition.supportedKinds.includes(kind)?'available':'unsupported');
   assert.deepEqual(provider.facts,[]);
  }
  assert.deepEqual(view.providers.map(p=>p.reach),['lan','tailnet']);
  assert.deepEqual(view.providers.map(p=>p.transport),['https','https']);
  assert.equal(JSON.stringify(view).includes('candidateToken'),false);
 });
}
