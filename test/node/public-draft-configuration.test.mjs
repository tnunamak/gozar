import test from 'node:test';
import assert from 'node:assert/strict';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch} from './route-schema-check.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function assertSnapshot(snapshot){const facts=snapshot.facts.map(({asOf,...row})=>row);const json=JSON.stringify(canonical({version:'consent-v1',scope:snapshot.scope,typedDisclosures:snapshot.disclosures,facts}));assert.equal(snapshot.consentFactsDigest,'consent-v1:'+createHash('sha256').update(json).digest('hex'));}
for (const reason of ['secret_backend_locked','secret_backend_unavailable']) test('discard retries only the exact orphan after '+reason,async t=>{
 const home=await scratch(t),providerId='draft-discard-fixture';
 const registry=await fakeRegistry({dir:join(home,'registry'),id:providerId,kinds:['attached'],reach:'this-device',
  setupActions:[{id:'secret',kind:'provide-secret',label:'Fixture secret',digest:'secret-1',secretLabel:'Fixture secret',
   disclosure:{revision:'secret-1',text:'Fixture',links:[]}}]});
 t.after(registry.cleanup);
 const values=new Map(),deletions=[],presenceChecks=[];
 let blockedHandle;
 const secretBackend={
  async put({bytes}){const handle=randomUUID();values.set(handle,new Uint8Array(bytes));return {handle};},
  async withSecret({handle},use){assert.ok(values.has(handle));return use(new Uint8Array(values.get(handle)));},
  async presence({handle}){presenceChecks.push(handle);return handle===blockedHandle?{known:false,reason}:{known:true,value:values.has(handle)};},
  async delete({handle}){deletions.push(handle);return {deleted:values.delete(handle)};},
 };
 const opts={manifest:registry.manifest,root:registry.root,secretBackend};
 const api=createGozar(opts),ref={home,providerId};
 const store=async (configuration,draftId)=>(await api.storeSecret({...ref,...(draftId?{draftId}:{}),
  expectedConfigurationRevision:configuration.revision,scopeId:configuration.scopeId,inputId:'secret',
  bytes:new Uint8Array([11,22,33])})).handle;
 const bind=async (configuration,handle,draftId)=>{
  const action=configuration.actions.find(x=>x.kind==='provide-secret');
  assert.ok(action?.consent);
  return (await api.runSetupAction({...ref,...(draftId?{draftId}:{}),expectedConfigurationRevision:configuration.revision,
   actionId:action.id,secretHandle:handle,approval:{kind:'setup',digest:action.digest,
    disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
 };
 const initial=(await api.listProviders({home})).providers.find(p=>p.providerId===providerId).configuration;
 const appliedHandle=await store(initial), applied=await bind(initial,appliedHandle);
 const begin=()=>api.beginConfigurationDraft({...ref,expectedConfigurationRevision:applied.revision});
 const sibling=await begin(),siblingHandle=await store(sibling.configuration,sibling.draftId);
 await bind(sibling.configuration,siblingHandle,sibling.draftId);
 const target=await begin(),orphan=await store(target.configuration,target.draftId);
 const absent=await store(target.configuration,target.draftId);
 values.delete(absent);
 const save=async()=>JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 const metadata=(await save()).secrets[orphan];
 assert.equal(metadata.draftId,target.draftId);
 assert.equal(metadata.inputId,'secret');
 blockedHandle=orphan;
 const discard={...ref,draftId:target.draftId};
 await assert.rejects(api.discardConfigurationDraft(discard),{code:reason});
 await assert.rejects(api.readConfigurationDraft(discard),{code:'configuration_stale'});
 assert.deepEqual((await save()).secrets[orphan],metadata);
 assert.deepEqual(deletions,[]);
 blockedHandle=undefined;
 presenceChecks.length=0;
 const fresh=createGozar(opts);
 assert.equal((await fresh.discardConfigurationDraft(discard)).discarded,false);
 assert.deepEqual(deletions,[orphan]);
 assert.equal(presenceChecks.filter(handle=>handle===absent).length,1);
 const state=await save(),scope=state.configs[applied.scopeId];
 assert.equal(state.secrets[orphan],undefined);
 assert.equal(state.secrets[absent],undefined);
 assert.equal(scope.bindings.secret,appliedHandle);
 assert.equal(scope.drafts[sibling.draftId].bindings.secret,siblingHandle);
 assert.equal(values.has(appliedHandle),true);
 assert.equal(values.has(siblingHandle),true);
});

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
