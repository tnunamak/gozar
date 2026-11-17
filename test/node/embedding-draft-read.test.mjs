import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {runEmbeddingSetup,readConfigurationDraft} from '../../packages/gozar-node/embedding-setup.mjs';
test('draft mutation returns next scoped actions and restarted reader preserves current revision without writing',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-draft-read-'));const services=createEmbeddingServices({registryId:'fixture'});
 const actions=['first','second'].map(id=>({id,kind:'provide-value',valueFormat:'text',label:id,digest:`digest-${id}`,disclosure:{revision:'v'}}));
 const adapter={id:'opaque',definition:{supportedKinds:['attached'],capabilities:{},disclosure:{revision:'v'}},detect:async()=>({state:'ready',facts:{}}),properties:()=>({}),setupActions:()=>actions};
 const deps={embeddingServices:services,adapters:[adapter],readContext:{configuration:async()=>null},decorateSetupAction:({action,configuration,draftId})=>({...action,consent:{scope:{kind:'setup',configurationRevision:configuration.revision,draftId},consentFactsDigest:`scope:${configuration.revision}`}}),validateSetupApproval:async({request,configuration})=>{assert.equal(request.approval.consentFactsDigest,`scope:${configuration.revision}`);}};
 try{const r={home,providerId:'opaque',owner:'host'};const c=await services.readConfiguration(r);const draft=await services.beginConfigurationDraft({...r,expectedConfigurationRevision:c.revision});const request={...r,draftId:draft.draftId};const initial=await readConfigurationDraft(request,deps);
 const approve=action=>({kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest});
 const result=await runEmbeddingSetup({...request,expectedConfigurationRevision:initial.configuration.revision,actionId:'first',value:'one',approval:approve(initial.configuration.actions.find(a=>a.id==='first'))},deps);
 assert.equal(result.configuration.revision,result.configurationRevision);assert.equal(result.configuration.scopeId,result.scopeId);assert.notEqual(result.configurationRevision,initial.configuration.revision);
 const next=result.configuration.actions.find(a=>a.id==='second');assert.equal(next.consent.scope.draftId,draft.draftId);assert.equal(next.consent.scope.configurationRevision,result.configurationRevision);
 const final=await runEmbeddingSetup({...request,expectedConfigurationRevision:result.configurationRevision,actionId:'second',value:'two',approval:approve(next)},deps);
 const path=join(home,'embedding-state.json');const before=await readFile(path,'utf8');const metadata=await stat(path);
 const restarted={...deps,embeddingServices:createEmbeddingServices({registryId:'fixture'})};const restored=await readConfigurationDraft(request,restarted);assert.equal(restored.configuration.revision,final.configurationRevision);assert.deepEqual(restored.configuration.values,{first:'one',second:'two'});assert.equal(restored.baseRevision,c.revision);assert.equal(await readFile(path,'utf8'),before);assert.equal((await stat(path)).mtimeMs,metadata.mtimeMs);
 await assert.rejects(readConfigurationDraft({...request,providerId:'foreign'},restarted),{code:'configuration_stale'});await assert.rejects(readConfigurationDraft({...request,owner:'foreign'},restarted),{code:'configuration_stale'});await assert.rejects(readConfigurationDraft({...request,draftId:'unknown'},restarted),{code:'configuration_stale'});
 assert.deepEqual((await services.readConfiguration(r)).values,{});
 }finally{await rm(home,{recursive:true,force:true});}
});
