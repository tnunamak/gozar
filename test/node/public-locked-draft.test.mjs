import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch} from './route-schema-check.mjs';
const setup=(kind,id,extra={})=>({id,kind,label:id,digest:id+'-1',disclosure:{revision:id+'-1',text:'Fixture',links:[]},...extra});
const approval=action=>({kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest});
function memoryBackend(){
 const records=new Map();let locked=false;
 const check=()=>{if(locked)throw Object.assign(new Error('locked'),{code:'secret_backend_locked'});};
 return {lock:value=>{locked=value;},has:handle=>records.has(handle),
  async put({scopeId,bytes}){check();const handle=randomUUID();records.set(handle,{scopeId,bytes:new Uint8Array(bytes)});return {handle};},
  async withSecret({scopeId,handle},use){check();const record=records.get(handle);assert.equal(record?.scopeId,scopeId);return use(new Uint8Array(record.bytes));},
  async presence({scopeId,handle}){if(locked)return {known:false,reason:'secret_backend_locked'};return {known:true,value:records.get(handle)?.scopeId===scopeId};},
  async delete({scopeId,handle}){check();const record=records.get(handle);if(record?.scopeId!==scopeId)return {deleted:false};records.delete(handle);return {deleted:true};}};
}
test('a locked backend keeps the draft input requirements and reads each staged credential as unknown, then clear and discard work after unlock',async t=>{
 const home=await scratch(t),providerId='locked-draft',backend=memoryBackend();
 const registry=await fakeRegistry({dir:home+'/registry',id:providerId,kinds:['attached'],reach:'this-device',setupActions:[setup('provide-secret','credential',{secretLabel:'Credential'}),setup('provide-value','value',{valueFormat:'text'})]});t.after(registry.cleanup);
 const hostCapabilities=Object.fromEntries(['secrets.backend','runtime.attached','runtime.durable'].map(id=>[id,{known:true,value:true}]));
 const api=createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,hostCapabilities,identity:{instanceId:randomUUID(),bootId:randomUUID()}}),owner='locked-owner';
 const read=draft=>api.readConfigurationDraft({home,owner,providerId,draftId:draft.draftId});
 const initial=(await api.listProviders({home,owner})).providers.find(p=>p.providerId===providerId).configuration;
 let draft=await api.beginConfigurationDraft({home,owner,providerId,expectedConfigurationRevision:initial.revision});
 const secret=draft.configuration.actions.find(a=>a.kind==='provide-secret'),field=draft.configuration.inputRequirements.find(f=>f.actionId===secret.id&&f.secret);assert.ok(field);
 const stored=await api.storeSecret({home,owner,providerId,draftId:draft.draftId,inputId:field.id,scopeId:draft.scopeId,expectedConfigurationRevision:draft.configuration.revision,bytes:new TextEncoder().encode('staged-canary')});
 const bound=await api.runSetupAction({home,owner,providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:secret.id,approval:approval(secret),secretHandle:stored.handle});
 draft={...draft,configuration:bound.configuration};
 const ready=await read(draft);assert.deepEqual(ready.configuration.credentials[field.id],{known:true,value:true});
 backend.lock(true);
 const locked=await read(draft);
 assert.deepEqual(locked.configuration.inputRequirements,ready.configuration.inputRequirements,'a locked backend must not erase the declared inputs');
 assert.deepEqual(locked.configuration.credentials,{[field.id]:{known:false,reason:'secret_backend_locked'}});
 assert.equal(locked.configuration.revision,ready.configuration.revision);
 assert.ok(locked.configuration.actions.some(a=>a.kind==='clear-input'&&a.inputId===field.id));
 backend.lock(false);
 const back=await read(draft),clear=back.configuration.actions.find(a=>a.kind==='clear-input'&&a.inputId===field.id);
 const cleared=await api.clearConfigurationInput({home,owner,providerId,draftId:draft.draftId,inputId:field.id,expectedConfigurationRevision:back.configuration.revision,approval:approval(clear)});
 assert.equal(cleared.credentials[field.id].value,false);
 await api.discardConfigurationDraft({home,owner,providerId,draftId:draft.draftId});
 assert.equal(backend.has(stored.handle),false,'discarding the draft deletes its own staged bytes');
 await api.discardSecret({home,owner,handle:stored.handle});
});
