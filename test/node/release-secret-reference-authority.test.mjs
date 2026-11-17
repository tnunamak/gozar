import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch} from './route-schema-check.mjs';

const action={id:'credential',kind:'provide-secret',label:'Credential',secretLabel:'Credential',digest:'credential-1',disclosure:{revision:'credential-1',text:'Fixture',links:[]}};
const approval=a=>({kind:'setup',digest:a.digest,disclosureRevision:a.disclosure.revision,consentFactsDigest:a.consent.consentFactsDigest});
function backend(){
 const records=new Map();
 return {
  async put({scopeId,bytes}){const handle=randomUUID();records.set(handle,{scopeId,bytes:new Uint8Array(bytes)});return {handle};},
  async presence({scopeId,handle}){return {known:true,value:records.get(handle)?.scopeId===scopeId};},
  async withSecret({scopeId,handle},use){const record=records.get(handle);assert.equal(record?.scopeId,scopeId);return use(new Uint8Array(record.bytes));},
  async delete({scopeId,handle}){records.delete(handle);return {deleted:true};},
 };
}
async function world(t){
 const home=await scratch(t),providerId='authority',owner='authority-owner';
 const registry=await fakeRegistry({dir:home+'/registry',id:providerId,kinds:['attached'],reach:'this-device',setupActions:[action]});t.after(registry.cleanup);
 const api=createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend(),hostCapabilities:Object.fromEntries(['secrets.backend','runtime.attached','runtime.durable'].map(id=>[id,{known:true,value:true}]))});
 const read=async()=>(await api.listProviders({home,owner})).providers.find(p=>p.providerId===providerId).configuration;
 const bind=async(configuration,canary,draftId)=>{
  const secret=configuration.actions.find(a=>a.kind==='provide-secret'),field=configuration.inputRequirements.find(f=>f.actionId===secret.id&&f.secret);
  const request={home,owner,providerId,draftId,scopeId:configuration.scopeId,expectedConfigurationRevision:configuration.revision};
  const stored=await api.storeSecret({...request,inputId:field.id,bytes:new TextEncoder().encode(canary)});
  const run=handle=>api.runSetupAction({...request,actionId:secret.id,approval:approval(secret),secretHandle:handle});
  return {stored,run,request};
 };
 return {api,home,owner,providerId,read,bind};
}
test('the exact current binding keeps authority after the configuration revision moves; a replaced handle does not',async t=>{
 const w=await world(t);
 const initial=await w.read(),first=await w.bind(initial,'first-canary');
 const bound=await first.run(first.stored.handle);
 const draft=await w.api.beginConfigurationDraft({home:w.home,owner:w.owner,providerId:w.providerId,expectedConfigurationRevision:bound.configuration.revision});
 // The draft carries the applied binding at a newer revision than the one that stored the handle.
 assert.notEqual(draft.configuration.revision,bound.configuration.revision);
 const again=await w.bind(draft.configuration,'unused-draft-canary',draft.draftId);
 const rerun=await again.run(first.stored.handle);
 assert.ok(rerun.configuration);
 // Rebind the draft to a replacement; the replaced handle is no longer the current binding or the intake of this revision.
 const replacement=await w.bind((await w.api.readConfigurationDraft({home:w.home,owner:w.owner,providerId:w.providerId,draftId:draft.draftId})).configuration,'replacement-canary',draft.draftId);
 await replacement.run(replacement.stored.handle);
 const after=await w.api.readConfigurationDraft({home:w.home,owner:w.owner,providerId:w.providerId,draftId:draft.draftId});
 const stale=await w.bind(after.configuration,'ignored',draft.draftId);
 await assert.rejects(stale.run(first.stored.handle),error=>error.code==='invalid_input');
});
test('a handle from another scope input or an unknown handle never gains authority',async t=>{
 const w=await world(t);
 const initial=await w.read(),first=await w.bind(initial,'canary');
 await assert.rejects(first.run(randomUUID()),error=>error.code==='invalid_input');
 await assert.rejects(first.run('not-a-handle'),error=>['invalid_input','setup_required'].includes(error.code));
});
