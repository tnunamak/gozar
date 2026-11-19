import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {scratch} from './route-schema-check.mjs';

const action={id:'credential',kind:'provide-secret',label:'Credential',secretLabel:'Credential',digest:'credential-1',disclosure:{revision:'credential-1',text:'Fixture',links:[]}};
const approval=a=>({kind:'setup',digest:a.digest,disclosureRevision:a.disclosure.revision,consentFactsDigest:a.consent.consentFactsDigest});
function backendFixture(){
 const records=new Map();let mode='ready',attempts=0;const used=[];
 const check=()=>{if(mode==='locked'||mode==='unavailable')throw Object.assign(new Error(mode),{code:'secret_backend_'+mode});};
 return {
  mode:value=>{mode=value;attempts=0;used.length=0;},attempts:()=>attempts,used,has:handle=>records.has(handle),
  async put({scopeId,bytes}){check();const handle=randomUUID();records.set(handle,{scopeId,bytes:new Uint8Array(bytes)});return {handle};},
  async presence({scopeId,handle}){if(mode==='locked'||mode==='unavailable')return {known:false,reason:'secret_backend_'+mode};return {known:true,value:mode!=='missing'&&records.get(handle)?.scopeId===scopeId};},
  async withSecret({scopeId,handle},use){attempts++;check();assert.notEqual(mode,'missing');const record=records.get(handle);assert.equal(record?.scopeId,scopeId);used.push(new TextDecoder().decode(record.bytes));return use(new Uint8Array(record.bytes));},
  async delete({scopeId,handle}){check();if(records.get(handle)?.scopeId!==scopeId)return {deleted:false};records.delete(handle);return {deleted:true};},
 };
}
test('public persisted rotation observes presence before resolving either applied or staged bytes',async t=>{
 const home=await scratch(t),providerId='rotation',owner='rotation-owner',backend=backendFixture();
 const registry=await fakeRegistry({dir:home+'/registry',id:providerId,kinds:['attached'],reach:'this-device',setupActions:[action]});t.after(registry.cleanup);
 const options={manifest:registry.manifest,root:registry.root,secretBackend:backend,hostCapabilities:Object.fromEntries(['secrets.backend','runtime.attached','runtime.durable'].map(id=>[id,{known:true,value:true}]))};
 let api=createGozar(options);
 const inventory=()=>api.listProviders({home,owner,refresh:true});
 const initial=(await inventory()).providers.find(p=>p.providerId===providerId).configuration;
 const bind=async(configuration,scopeId,canary,draftId)=>{
  const secret=configuration.actions.find(a=>a.kind==='provide-secret');
  assert.ok(secret);const field=configuration.inputRequirements.find(f=>f.actionId===secret.id&&f.secret);assert.ok(field);
  const request={home,owner,providerId,draftId,scopeId,expectedConfigurationRevision:configuration.revision};
  const stored=await api.storeSecret({...request,inputId:field.id,bytes:new TextEncoder().encode(canary)});
  const result=await api.runSetupAction({...request,actionId:secret.id,approval:approval(secret),secretHandle:stored.handle});
  return {configuration:result.configuration,handle:stored.handle,inputId:field.id};
 };
 const old=await bind(initial,initial.scopeId,'old-rotation-canary');
 let draft=await api.beginConfigurationDraft({home,owner,providerId,expectedConfigurationRevision:old.configuration.revision,refresh:true});
 const replacement=await bind(draft.configuration,draft.scopeId,'new-rotation-canary',draft.draftId);
 api=createGozar(options); // No in-memory draft carried into the reader.
 const request={home,owner,providerId,draftId:draft.draftId};
 const ready=await api.readConfigurationDraft({...request,refresh:true});
 const before=await readFile(home+'/embedding-state.json','utf8');
 for(const mode of ['locked','unavailable','missing','ready']){
  backend.mode(mode);
  const observed=await api.readConfigurationDraft({...request,refresh:true});
  assert.equal(observed.scopeId,ready.scopeId);assert.equal(observed.baseRevision,ready.baseRevision);
  assert.equal(observed.configuration.revision,ready.configuration.revision);
  assert.deepEqual(observed.configuration.inputRequirements,ready.configuration.inputRequirements);
  const credential=observed.configuration.credentials[replacement.inputId];
  if(mode==='locked'||mode==='unavailable'){
   assert.deepEqual(credential,{known:false,reason:'secret_backend_'+mode});
   assert.equal(backend.attempts(),0,'unknown presence must prevent even an attempted raw read');
   assert.ok(observed.configuration.actions.some(a=>a.kind==='provide-secret'));
  }else{
   assert.deepEqual(credential,{known:true,value:mode==='ready'});
   if(mode==='missing'){assert.equal(backend.attempts(),0);assert.ok(observed.configuration.actions.some(a=>a.kind==='provide-secret'));}
   else{assert.ok(backend.attempts()>0);assert.ok(backend.used.includes('new-rotation-canary'));assert.ok(!backend.used.includes('old-rotation-canary'));}
  }
  assert.ok(observed.configuration.actions.some(a=>a.kind==='clear-input'&&a.inputId===replacement.inputId));
  const clearShape=c=>c.actions.filter(a=>a.kind==='clear-input').map(({id,kind,inputId,digest,disclosure})=>({id,kind,inputId,digest,disclosure}));
  assert.deepEqual(clearShape(observed.configuration),clearShape(ready.configuration));
  assert.equal(observed.draftId,ready.draftId);
  const encoded=JSON.stringify(observed);
  for(const canary of ['old-rotation-canary','new-rotation-canary'])assert.ok(!encoded.includes(canary));
  assert.equal(await readFile(home+'/embedding-state.json','utf8'),before);
  backend.mode(mode);
  const listed=await inventory(),applied=listed.providers.find(p=>p.providerId===providerId).configuration;
  assert.equal(applied.revision,old.configuration.revision);assert.equal(applied.scopeId,initial.scopeId);
  if(mode!=='ready')assert.equal(backend.attempts(),0);
  else assert.ok(backend.used.includes('old-rotation-canary'));
  for(const canary of ['old-rotation-canary','new-rotation-canary'])assert.ok(!JSON.stringify(listed).includes(canary));
 }
 backend.mode('ready');
 const back=await api.readConfigurationDraft({...request,refresh:true}),clear=back.configuration.actions.find(a=>a.kind==='clear-input'&&a.inputId===replacement.inputId);
 const cleared=await api.clearConfigurationInput({...request,inputId:replacement.inputId,expectedConfigurationRevision:back.configuration.revision,approval:approval(clear)});
 assert.equal(cleared.credentials[replacement.inputId].value,false);
 await api.discardConfigurationDraft(request);
 assert.equal(backend.has(replacement.handle),false);assert.equal(backend.has(old.handle),true);
});
test('both service resolution entrypoints refuse unknown presence before raw reads',async t=>{
 const home=await scratch(t),backend=backendFixture(),services=createEmbeddingServices({registryId:'rotation-service',secretBackend:backend});
 const request={home,providerId:'provider',owner:'owner'};
 const initial=await services.readConfiguration(request);
 const stored=await services.storeSecret({...request,scopeId:initial.scopeId,inputId:'credential',expectedConfigurationRevision:initial.revision,bytes:new TextEncoder().encode('service-canary')});
 const bound=await services.mutateConfiguration({...request,expectedConfigurationRevision:initial.revision},tx=>tx.bindSecret('credential',stored.handle));
 const current={...request,expectedConfigurationRevision:bound.configuration.revision};
 const before=await readFile(home+'/embedding-state.json','utf8');
 for(const mode of ['locked','unavailable','missing','ready']){
  backend.mode(mode);
  for(const resolve of [()=>services.resolveConfiguration(current),()=>services.mutateConfiguration(current,tx=>tx.resolveConfiguration(),{mutatesConfiguration:false}).then(r=>r.result)]){
   if(mode==='locked'||mode==='unavailable')await assert.rejects(resolve,{code:'secret_backend_'+mode});
   else assert.deepEqual(await resolve(),mode==='missing'?null:{credential:'service-canary'});
  }
  if(mode!=='ready')assert.equal(backend.attempts(),0);else assert.equal(backend.attempts(),2);
  assert.equal(await readFile(home+'/embedding-state.json','utf8'),before);
 }
});
