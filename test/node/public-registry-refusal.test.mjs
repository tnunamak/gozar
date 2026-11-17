import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
const fact=id=>({id,label:id,value:null,known:false,reason:'not-observed',group:'fixture',affectsConsent:true,source:`local-observation:/${id}`,asOf:null});
// A controller that refuses a changed registry has run no provider code. Its refusal must be a durable, enumerable record:
// the retained directory may not make every later listRoutes fail, and the configuration reference it held must be released.
test('a controller start refused for a changed registry leaves an enumerable, confirmed record and closes without provider effects',async t=>{
 const home=await scratch(t),id='refused-registry',owner='refusal-owner';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached'],reach:'this-device',protocols:[],facts:[fact('base')]});
 const folder=join(registry.root,'providers',id);
 const api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,owner,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const path=join(folder,'definition.json'),data=JSON.parse(await readFile(path,'utf8'));data.adapter.facts.push(fact('added'));await writeFile(path,JSON.stringify(data));
 await assert.rejects(api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}}),{code:'artifact_integrity_failed'});
 const events=await readFile(join(folder,'events.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
 assert.doesNotMatch(events,/"start"/);
 const base=(await api.listProviders({home,owner})).providers[0].configuration;
 const draft=await api.beginConfigurationDraft({home,owner,providerId:id,expectedConfigurationRevision:base.revision});
 await api.commitConfigurationDraft({home,owner,providerId:id,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision}); // throws configuration_in_use while a reference is held
 const listed=(await api.listRoutes({home,owner})).routes;
 assert.equal(listed.length,1);
 assert.equal(listed[0].cleanup.state,'confirmed','the controller ran no provider code and released the reference it held');
 assert.equal(listed[0].handle.kind,'attached');
 const closed=await api.closeRoute({home,handle:listed[0].handle,mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');
 assert.deepEqual((await api.listRoutes({home,owner})).routes.map(route=>route.cleanup.state),['confirmed']);
 assert.doesNotMatch(await readFile(join(folder,'events.jsonl'),'utf8').catch(()=>''),/"start"/);
});
// An approval refused before any controller exists changed nothing, so its reserved operation settles as released rather than as cleanup debt.
for(const kind of ['attached'])test(`a ${kind} request refused for a stale consent digest settles its operation with confirmed cleanup`,async t=>{
 const home=await scratch(t),id='refused-consent',owner='refusal-owner';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:[kind],reach:'this-device',protocols:[],facts:[fact('base')]});
 const folder=join(registry.root,'providers',id);
 const api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,owner,usage:kind==='session'?{kind:'session',lifetimeMs:60000}:{kind},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const request={...q,operationId:'refused-'+kind,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:'consent-v1:'+'0'.repeat(64)}};
 await assert.rejects(api.expose(request),{code:'consent_mismatch'});
 assert.doesNotMatch(await readFile(join(folder,'events.jsonl'),'utf8').catch(()=>''),/"start"/);
 const listed=(await api.listRoutes({home,owner})).routes;
 assert.deepEqual(listed.map(route=>route.cleanup.state),['confirmed'],'a refusal before any effect owes no cleanup');
 assert.equal((await api.closeRoute({home,handle:listed[0].handle,mode:'remove'})).cleanup.state,'confirmed');
 assert.deepEqual((await api.listRoutes({home,owner})).routes.map(route=>route.cleanup.state),['confirmed']);
});

// The data-only change a host sees when a registry deployment adds one declared fact: the old approval is refused, and its reserved operation settles.
test('a request with an operation id refused for a changed registry settles with a confirmed, enumerable record',async t=>{
 const home=await scratch(t),id='refused-operation',owner='refusal-owner';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached'],reach:'this-device',protocols:[],facts:[fact('base')]});
 const folder=join(registry.root,'providers',id);
 const api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,owner,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const path=join(folder,'definition.json'),data=JSON.parse(await readFile(path,'utf8'));data.adapter.facts.push(fact('added'));await writeFile(path,JSON.stringify(data));
 await assert.rejects(api.expose({...q,operationId:'refused-registry-op',wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}}),{code:'artifact_integrity_failed'});
 assert.doesNotMatch(await readFile(join(folder,'events.jsonl'),'utf8').catch(()=>''),/"start"/);
 const listed=(await api.listRoutes({home,owner})).routes;
 assert.deepEqual(listed.map(route=>route.cleanup.state),['confirmed']);
 assert.equal((await api.closeRoute({home,handle:listed[0].handle,mode:'remove'})).cleanup.state,'confirmed');
});
