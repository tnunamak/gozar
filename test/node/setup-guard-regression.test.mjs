import test from 'node:test';
import assert from 'node:assert/strict';
import {runEmbeddingSetup, clearConfigurationInput} from '../../packages/gozar-node/embedding-setup.mjs';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {action, scratch, stubAdapter} from './route-schema-check.mjs';

const approval = a => ({kind:'setup', digest:a.digest, disclosureRevision:a.disclosure.revision, consentFactsDigest:a.consent.consentFactsDigest});

test('direct setup helpers require a callable approval validator before accessing dependencies', async () => {
 const request={providerId:'p',actionId:'a',expectedConfigurationRevision:'r',draftId:'d',inputId:'i',approval:{kind:'setup',digest:'d',disclosureRevision:'v'}};
 for (const validator of [undefined, null, 1]) {
  const deps={validateSetupApproval:validator};
  for(const key of ['embeddingServices','adapters','platform','readContext']) Object.defineProperty(deps,key,{get(){assert.fail(`accessed ${key}`);}});
  await assert.rejects(runEmbeddingSetup(request,deps),{code:'unsupported'});
  await assert.rejects(clearConfigurationInput(request,deps),{code:'unsupported'});
 }
});

test('public Win32 setup rejects valid approval before preview, with input and consent precedence', async t => {
 const home=await scratch(t), a=action('login','provide-value',{valueFormat:'text'}), adapter=stubAdapter('guard-provider',{state:'action-required',actions:[a]});
 const linux=createRouteApi({adapters:[adapter],platform:'linux'});
 const configuration=(await linux.listProviders({home})).providers[0].configuration;
 const offered=configuration.actions.find(item=>item.id===a.id); assert.ok(offered);
 const request={home,providerId:adapter.id,actionId:a.id,expectedConfigurationRevision:configuration.revision,approval:approval(offered)};
 adapter.calls.detect=0;
 const win=createRouteApi({adapters:[adapter],platform:'win32'});
 await assert.rejects(win.runSetupAction({...request,providerId:''}),{code:'invalid_input'});
 await assert.rejects(win.runSetupAction({...request,approval:undefined}),{code:'consent_required'});
 await assert.rejects(win.runSetupAction(request),{code:'unsupported'});
 assert.equal(adapter.calls.detect,0);assert.equal(adapter.calls.setup,0);
});

test('public setup uses current scoped consent and ignores an injected validator', async t => {
 const home=await scratch(t), a=action('value','provide-value',{valueFormat:'text'}), adapter=stubAdapter('public-consent',{actions:[a]});
 let bypass=0;
 const api=createRouteApi({adapters:[adapter],platform:'linux',setup:{validateSetupApproval:()=>{bypass++;}}});
 const config=(await api.listProviders({home})).providers[0].configuration;
 const offered=config.actions.find(item=>item.id===a.id), valid=approval(offered);
 const request={home,providerId:adapter.id,actionId:a.id,expectedConfigurationRevision:config.revision,value:'hello',approval:valid};
 for(const [change,code] of [
  [{approval:{...valid,consentFactsDigest:undefined}},'consent_mismatch'],
  [{approval:{...valid,consentFactsDigest:'stale'}},'consent_mismatch'],
  [{actionId:'wrong'},'candidate_stale'], [{providerId:'wrong'},'candidate_stale'],
  [{expectedConfigurationRevision:'stale'},'configuration_stale'],
  [{approval:{...valid,kind:'route'}},'consent_required'],
  [{approval:{...valid,disclosureRevision:'stale'}},'candidate_stale'],
 ]) {
  await assert.rejects(api.runSetupAction({...request,...change}),{code});
  const current=(await api.listProviders({home})).providers[0].configuration;
  assert.equal(current.revision,config.revision);assert.deepEqual(current.values,config.values);
 }
 assert.equal(bypass,0); assert.equal(adapter.calls.setup,0);
 const result=await api.runSetupAction(request);assert.equal(result.configuration.values.value,'hello');assert.equal(bypass,0);
});

test('direct validator is awaited and its asynchronous rejection is preserved', async t => {
 const home=await scratch(t), a=action('run'), adapter=stubAdapter('async-validator',{actions:[a]});
 const {createEmbeddingServices}=await import('../../packages/gozar-node/embedding-services.mjs');
 const services=createEmbeddingServices({registryId:'async-validator'});
 const config=await services.readConfiguration({home,providerId:adapter.id});
 const request={home,providerId:adapter.id,actionId:a.id,expectedConfigurationRevision:config.revision,approval:{kind:'setup',digest:a.digest,disclosureRevision:a.disclosure.revision}};
 const rejection=new Error('validator rejected');let release;const gate=new Promise(resolve=>{release=resolve;});let entered=false;
 const pending=runEmbeddingSetup(request,{embeddingServices:services,adapters:[adapter],platform:'linux',readContext:{configuration:async()=>null},validateSetupApproval:async()=>{entered=true;await gate;throw rejection;}});
 while(!entered) await new Promise(resolve=>setImmediate(resolve));
 assert.equal(adapter.calls.setup,0);release();await assert.rejects(pending,error=>error===rejection);assert.equal(adapter.calls.setup,0);
});

test('public secret action cannot read another handle and delivers no bytes', async t => {
 const home=await scratch(t), a=action('credential','provide-secret'), adapter=stubAdapter('secret-guard',{actions:[a]});
 adapter.definition.inputRequirements=[{id:'credential',actionId:a.id,secret:true}];
 const api=createRouteApi({adapters:[adapter],platform:'linux'});
 const config=(await api.listProviders({home})).providers[0].configuration, offered=config.actions.find(item=>item.id===a.id);
 const base={home,providerId:adapter.id,scopeId:config.scopeId,inputId:'credential',expectedConfigurationRevision:config.revision};
 const allowed=await api.storeSecret({...base,bytes:Buffer.from('allowed')});
 const forbidden=await api.storeSecret({...base,bytes:Buffer.from('forbidden')});
 let attempted=false,delivered=false;
 adapter.setup=async ctx=>{attempted=true;await ctx.withSecret(forbidden.handle,()=>{delivered=true;});return {state:'complete'};};
 await assert.rejects(api.runSetupAction({...base,actionId:a.id,approval:approval(offered),secretHandle:allowed.handle}),{code:'invalid_input'});
 assert.equal(attempted,true);assert.equal(delivered,false);
 await api.discardSecret({home,handle:allowed.handle});await api.discardSecret({home,handle:forbidden.handle});
});

test('public draft clear retains the applied secret until commit', async t => {
 const home=await scratch(t), a=action('credential','provide-secret'), adapter=stubAdapter('clear-guard',{actions:[a]});
 adapter.definition.inputRequirements=[{id:'credential',actionId:a.id,secret:true}];
 const api=createRouteApi({adapters:[adapter],platform:'linux'}), base={home,providerId:adapter.id};
 const config=(await api.listProviders({home})).providers[0].configuration, offered=config.actions.find(item=>item.id===a.id);
 const stored=await api.storeSecret({...base,scopeId:config.scopeId,inputId:'credential',expectedConfigurationRevision:config.revision,bytes:Buffer.from('applied')});
 const bound=await api.runSetupAction({...base,actionId:a.id,expectedConfigurationRevision:config.revision,approval:approval(offered),secretHandle:stored.handle});
 const draft=await api.beginConfigurationDraft({...base,expectedConfigurationRevision:bound.configurationRevision});
 const fresh=await api.readConfigurationDraft({...base,draftId:draft.draftId});
 const clear=fresh.configuration.actions.find(item=>item.kind==='clear-input');assert.ok(clear);
 const cleared=await api.clearConfigurationInput({...base,draftId:draft.draftId,inputId:clear.inputId,expectedConfigurationRevision:fresh.configuration.revision,approval:approval(clear)});
 await assert.rejects(api.discardSecret({home,handle:stored.handle}),{code:'secret_in_use'});
 await api.commitConfigurationDraft({...base,draftId:draft.draftId,expectedConfigurationRevision:cleared.revision});
 assert.equal((await api.discardSecret({home,handle:stored.handle})).discarded,true);
});

test('public catalog returns an opaque future token and the post-setup revision', async t => {
 const home=await scratch(t), a=action('value','provide-value',{valueFormat:'text'}), adapter=stubAdapter('catalog-guard',{actions:[a]});
 const api=createRouteApi({adapters:[adapter],platform:'linux'});
 const config=(await api.listProviders({home})).providers[0].configuration, offered=config.actions.find(item=>item.id===a.id);
 const result=await api.runSetupAction({home,providerId:adapter.id,actionId:a.id,expectedConfigurationRevision:config.revision,value:'ready',approval:approval(offered)});
 const {query}=await import('./route-schema-check.mjs');
 const before=Date.now();const catalog=await api.catalogRoutes(query({home}));
 const candidate=catalog.candidates.find(item=>item.providerId===adapter.id);
 assert.ok(typeof candidate.candidateToken==='string' && candidate.candidateToken.length>0);
 assert.equal(typeof candidate.expiresAt,'string');assert.ok(Number.isFinite(Date.parse(candidate.expiresAt)));assert.ok(Date.parse(candidate.expiresAt)>before);
 assert.equal(result.catalogRevision,catalog.catalogRevision);
});
