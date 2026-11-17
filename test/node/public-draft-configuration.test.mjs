import test from 'node:test';
import assert from 'node:assert/strict';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch} from './route-schema-check.mjs';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function assertSnapshot(snapshot){const facts=snapshot.facts.map(({asOf,...row})=>row);const json=JSON.stringify(canonical({version:'consent-v1',scope:snapshot.scope,typedDisclosures:snapshot.disclosures,facts}));assert.equal(snapshot.consentFactsDigest,'consent-v1:'+createHash('sha256').update(json).digest('hex'));}
test('public draft read and setup results carry fresh offered consent after reload',async t=>{
 const home=await scratch(t), registry=await fakeRegistry({dir:home+'/registry',id:'draft-public',kinds:['attached'],reach:'this-device',setupActions:[{id:'value',kind:'provide-value',valueFormat:'text',label:'Input',digest:'value-1',disclosure:{revision:'value-1',text:'Fixture',links:[]}}]});t.after(registry.cleanup);
 const opts={manifest:registry.manifest,root:registry.root}, api=createGozar(opts),providerId='draft-public';
 const initial=(await api.listProviders({home})).providers[0].configuration;
 const draft=await api.beginConfigurationDraft({home,providerId,expectedConfigurationRevision:initial.revision});
 const action=draft.configuration.actions.find(a=>a.kind==='provide-value');assert.equal(action.consent.scope.draftId,draft.draftId);
 assertSnapshot(action.consent);assert.equal(action.consent.disclosures.action.digest,action.digest);
 const result=await api.runSetupAction({home,providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:action.id,value:'hello',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 assert.equal(result.configuration.revision,result.configurationRevision);assert.notEqual(result.configurationRevision,draft.configuration.revision);
 const restored=await createGozar(opts).readConfigurationDraft({home,providerId,draftId:draft.draftId});assert.deepEqual(restored.configuration,result.configuration);
 for(const offered of restored.configuration.actions)assertSnapshot(offered.consent);
 const clear=restored.configuration.actions.find(a=>a.kind==='clear-input');assert.ok(clear.consent);
 const cleared=await api.clearConfigurationInput({home,providerId,draftId:draft.draftId,inputId:clear.inputId,expectedConfigurationRevision:restored.configuration.revision,approval:{kind:'setup',digest:clear.digest,disclosureRevision:clear.disclosure.revision,consentFactsDigest:clear.consent.consentFactsDigest}});
 assert.equal(cleared.values.value,undefined);
 await assert.rejects(api.readConfigurationDraft({home,providerId:'foreign',draftId:draft.draftId}));
});

test('public setup freshly approves a retained secret after unrelated draft edits and commit',async t=>{
 const {createRouteApi}=await import('../../packages/gozar-node/route-api.mjs');
 const {createEmbeddingServices}=await import('../../packages/gozar-node/embedding-services.mjs');
 const {readFile}=await import('node:fs/promises');
 const home=await scratch(t),providerId='retained-public';
 const registry=await fakeRegistry({dir:home+'/registry',id:providerId,kinds:['attached'],reach:'this-device',setupActions:[
  {id:'credential',kind:'provide-secret',label:'Credential',digest:'secret-1',disclosure:{revision:'secret-1',text:'Fixture credential',links:[]}},
  {id:'label',kind:'provide-value',valueFormat:'text',label:'Label',digest:'label-1',disclosure:{revision:'label-1',text:'Fixture label',links:[]}},
 ]});t.after(registry.cleanup);
 const entries=new Map();let reads=0,deletes=0;
 const secretBackend={
  async put({bytes}){const handle='fixture-public-secret';entries.set(handle,new Uint8Array(bytes));return {handle};},
  async presence({handle}){return {known:true,value:entries.has(handle)};},
  async withSecret({handle},use){reads++;assert.ok(entries.has(handle));return use(new Uint8Array(entries.get(handle)));},
  async delete({handle}){deletes++;entries.delete(handle);return {deleted:true};},
 };
 const embeddingServices=createEmbeddingServices({registryId:'retained-public-registry',secretBackend});
 // Use the real route API factory, real consent decoration/validation and real
 // embedding transactions. Only the local provider and byte backend are fakes.
 const options={manifest:registry.manifest,root:registry.root,embeddingServices};
 let api=createRouteApi(options);const base={home,owner:'public-owner',providerId};
 let current=(await api.listProviders(base)).providers[0].configuration;
 let draft=await api.beginConfigurationDraft({...base,expectedConfigurationRevision:current.revision});
 const stored=await embeddingServices.storeSecret({...base,draftId:draft.draftId,scopeId:draft.configuration.scopeId,inputId:'credential',expectedConfigurationRevision:draft.configuration.revision,bytes:new TextEncoder().encode('invented-public-secret')});
 const intake=JSON.parse(await readFile(home+'/embedding-state.json','utf8')).secrets[stored.handle];
 const approve=action=>({kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest});
 const run=async(configuration,draftId,id,extra)=>{
  const action=configuration.actions.find(a=>a.id===id&&a.kind!=='clear-input');assert.ok(action);
  assertSnapshot(action.consent);assert.equal(action.consent.scope.draftId,draftId??null);
  return api.runSetupAction({...base,...(draftId?{draftId}:{}),expectedConfigurationRevision:configuration.revision,actionId:action.id,...extra,approval:approve(action)});
 };
 let result=await run(draft.configuration,draft.draftId,'credential',{secretHandle:stored.handle});
 const priorAction=result.configuration.actions.find(a=>a.id==='credential'&&a.kind==='provide-secret');assert.ok(priorAction);
 result=await run(result.configuration,draft.draftId,'label',{value:'unrelated edit'});
 api=createRouteApi(options);
 draft=await api.readConfigurationDraft({...base,draftId:draft.draftId});
 await assert.rejects(api.runSetupAction({...base,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:priorAction.id,secretHandle:stored.handle,approval:approve(priorAction)}),e=>e.code==='consent_mismatch');
 const beforeDraft=reads;
 result=await run(draft.configuration,draft.draftId,'credential',{secretHandle:stored.handle});
 assert.ok(reads>beforeDraft,'public revalidation must consume the real secret transaction');
 current=await api.commitConfigurationDraft({...base,draftId:draft.draftId,expectedConfigurationRevision:result.configurationRevision});
 const beforeCommitted=reads;
 result=await run(current,null,'credential',{secretHandle:stored.handle});
 assert.ok(reads>beforeCommitted,'committed public revalidation must reach the backend');
 assert.deepEqual(JSON.parse(await readFile(home+'/embedding-state.json','utf8')).secrets[stored.handle],intake);
 await assert.rejects(embeddingServices.discardSecret({home,handle:stored.handle}),e=>e.code==='secret_in_use');
 assert.equal(deletes,0);
 draft=await api.beginConfigurationDraft({...base,expectedConfigurationRevision:result.configurationRevision});
 const clear=draft.configuration.actions.find(a=>a.kind==='clear-input'&&a.inputId==='credential');assert.ok(clear);
 const cleared=await api.clearConfigurationInput({...base,draftId:draft.draftId,inputId:'credential',expectedConfigurationRevision:draft.configuration.revision,approval:approve(clear)});
 await assert.rejects(embeddingServices.discardSecret({home,handle:stored.handle}),e=>e.code==='secret_in_use');
 await api.commitConfigurationDraft({...base,draftId:draft.draftId,expectedConfigurationRevision:cleared.revision});
 assert.deepEqual(await embeddingServices.discardSecret({home,handle:stored.handle}),{discarded:true});
 assert.equal(deletes,1);
});
