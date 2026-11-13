import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
test('configured host keychain crosses the actual detached controller without a file mirror',async t=>{
 const home=await scratch(t), canary='private-keychain-canary-72e090', stored=new Map();let reads=0;
 const backend={async put({bytes}){stored.set('owned-handle',new Uint8Array(bytes));return {handle:'owned-handle'};},async withSecret({handle},use){reads++;return use(stored.get(handle));},async presence({handle}){return {known:true,value:stored.has(handle)};},async delete({handle}){stored.delete(handle);return {deleted:true};}};
 const registry=await fakeRegistry({id:'host-custody-fixture',dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[{id:'credential',kind:'provide-secret',label:'Credential',digest:'credential-v1',disclosure:{revision:'fixture-v1',text:'Fixture custody',links:[]}}]});t.after(registry.cleanup);
 const api=createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,identity:{instanceId:'host-instance',bootId:'host-supervisor-boot'}});
 const q=query({home,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const selected=(await api.catalogRoutes(q)).candidates[0], c=selected.configuration, action=c.actions[0];
 const {handle}=await api.storeSecret({home,owner:q.owner,providerId:selected.providerId,inputId:c.inputRequirements[0].id,scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:new TextEncoder().encode(canary)});
 const setup={home,owner:q.owner,providerId:selected.providerId,actionId:action.id,expectedConfigurationRevision:c.revision,secretHandle:handle,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}};
 await api.runSetupAction(setup);
 const ready=(await api.catalogRoutes(q)).candidates[0];
 const route=await api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:ready.candidateToken,disclosureRevision:ready.disclosure.revision,consentFactsDigest:ready.consentFactsDigest}});
 t.after(()=>api.closeRoute({home,handle:route.handle,mode:'remove'}).catch(()=>{}));
 assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.instanceId,'host-instance');assert.notEqual(route.verification.subject.bootId,'host-supervisor-boot');
 assert.equal(route.verification.subject.handleGeneration,route.handle.generation);assert.equal(route.verification.subject.target,q.target);assert.ok(reads>=3);
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await scan(path);else if(entry.isFile())assert.equal((await readFile(path)).includes(Buffer.from(canary)),false,path);}}
 await scan(home);
});
