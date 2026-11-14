import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
const fact=(id,affectsConsent=true)=>({id,label:id,value:null,known:false,reason:'not-observed',group:'fixture',affectsConsent,source:`local-observation:/${id}`,asOf:null});
async function fixture(t){
 let api,route;t.after(async()=>{if(route)await api.closeRoute({home,handle:route.handle,mode:'remove'});});
 const home=await scratch(t),id='observed-consent';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached'],reach:'this-device',transport:'http',protocols:[],facts:[fact('decision'),fact('display',false)],setupActions:[{id:'value',kind:'provide-value',valueFormat:'text',label:'Input',digest:'value-1',disclosure:{revision:'fixture-1',text:'Fixture',links:[]}}]});
 const folder=join(registry.root,'providers',id),observations=join(folder,'observations.json'),rowsFile=join(folder,'consent-rows.json');
 const rows=[fact('decision'),fact('display',false)];await writeFile(rowsFile,JSON.stringify(rows));
 await writeFile(observations,JSON.stringify({decision:false,display:'first'}));
 const module=join(folder,'index.mjs');await writeFile(module,(await readFile(module,'utf8')).replace('facts:{fake:true,','facts:{...JSON.parse(readFileSync(new URL("./observations.json",import.meta.url))),fake:true,').replace('  definition,','  get definition(){return {...definition,facts:JSON.parse(readFileSync(new URL("./consent-rows.json",import.meta.url)))};},'));
 api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const initial=(await api.listProviders({home,owner:q.owner})).providers[0].configuration;
 const action=initial.actions[0];
 await api.runSetupAction({home,owner:q.owner,providerId:id,expectedConfigurationRevision:initial.revision,actionId:action.id,value:'initial',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 const approval=c=>({kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest});
 const setRows=async value=>{await writeFile(rowsFile,JSON.stringify(value));const path=join(folder,'definition.json'),data=JSON.parse(await readFile(path,'utf8'));data.adapter.facts=value;await writeFile(path,JSON.stringify(data));api=createGozar({manifest:registry.manifest,root:registry.root});};
 return {home,id,api,q,approval,rows,setRows,observe:value=>writeFile(observations,JSON.stringify(value)),start:async choice=>(route=await api.expose({...q,wait:'verified',approval:approval(choice)})),events:async()=>readFile(join(folder,'events.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})};
}
test('actual candidate token rejects a changed local consent value before create while display changes remain admissible',async t=>{
 const f=await fixture(t),choice=(await f.api.catalogRoutes(f.q)).candidates[0];
 assert.equal(choice.consent.facts[0].known,true);assert.equal(choice.consent.facts[0].value,false);
 await f.observe({decision:0,display:'second'});
 await assert.rejects(f.start(choice),{code:'consent_mismatch'});assert.doesNotMatch(await f.events(),/"start"/);
 const current=(await f.api.catalogRoutes(f.q)).candidates[0];await f.observe({decision:0,display:'third'});
 const route=await f.start(current);assert.equal(route.verification.status,'verified');
});
for(const change of ['added','removed','classification'])test(`a current public token rejects ${change} consent rows with zero start effects`,async t=>{
 const f=await fixture(t),choice=(await f.api.catalogRoutes(f.q)).candidates[0];
 await f.setRows(change==='added'?[...f.rows,fact('another-decision')]:change==='removed'?f.rows.filter(row=>row.id!=='decision'):f.rows.map(row=>row.id==='decision'?{...row,affectsConsent:false}:row));
 await assert.rejects(f.start(choice),error=>['candidate_stale','consent_mismatch'].includes(error.code));assert.doesNotMatch(await f.events(),/"start"/);
});
test('runtime drift withdraws and requires the exact current snapshot before same-generation safe reproof',async t=>{
 const f=await fixture(t),choice=(await f.api.catalogRoutes(f.q)).candidates[0],route=await f.start(choice);
 assert.equal(choice.consentFactsDigest,choice.consent.consentFactsDigest);
 const same=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});assert.deepEqual(same.facts,choice.consent.facts);assert.deepEqual(same.disclosures,choice.consent.disclosures);assert.deepEqual({...same.scope,reviewHandle:undefined,handleGeneration:undefined},{...choice.consent.scope,reviewHandle:undefined,handleGeneration:undefined});
 await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:same.approvalToken,consentFactsDigest:same.consentFactsDigest});
 await f.observe({decision:true,display:'second'});
 const withdrawn=await f.api.routeStatus({home:f.home,handle:route.handle});assert.equal(withdrawn.published,null);assert.ok(withdrawn.consentChange);assert.equal(withdrawn.facts.find(row=>row.id==='decision').value,true);
 const review=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});assert.equal(review.facts.find(row=>row.id==='decision').value,true);assert.deepEqual(review.subject,route.verification.subject);
 review.facts[0].value='caller mutation';
 await f.observe({decision:'',display:'third'});
 await assert.rejects(f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest}),{code:'consent_mismatch'});
 assert.equal((await f.api.routeStatus({home:f.home,handle:route.handle})).published,null);
 const fresh=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});assert.equal(fresh.facts.find(row=>row.id==='decision').value,'');
 const restored=await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest});assert.equal(restored.verification.status,'verified');assert.deepEqual(restored.handle,route.handle);
 assert.equal((await f.events()).split('"start"').length-1,1);
});
test('persisted draft read offers the current action-scoped observed facts and stale approval mutates nothing',async t=>{
 const f=await fixture(t),saved=(await f.api.listProviders({home:f.home,owner:f.q.owner})).providers[0].configuration;
 const draft=await f.api.beginConfigurationDraft({home:f.home,owner:f.q.owner,providerId:f.id,expectedConfigurationRevision:saved.revision});
 const action=draft.configuration.actions[0],request={home:f.home,owner:f.q.owner,providerId:f.id,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:action.id,value:'staged',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}};
 await f.observe({decision:true,display:'changed'});await assert.rejects(f.api.runSetupAction(request),{code:'consent_mismatch'});
 const restored=await f.api.readConfigurationDraft({home:f.home,owner:f.q.owner,providerId:f.id,draftId:draft.draftId});assert.equal(restored.configuration.revision,draft.configuration.revision);assert.equal(restored.configuration.values.value,'initial');
 const fresh=restored.configuration.actions.find(row=>row.id===action.id);assert.equal(fresh.consent.scope.draftId,draft.draftId);assert.equal(fresh.consent.facts.find(row=>row.id==='decision').value,true);
 const result=await f.api.runSetupAction({...request,approval:{...request.approval,consentFactsDigest:fresh.consent.consentFactsDigest}});assert.equal(result.configuration.values.value,'staged');
 assert.equal(result.configuration.actions[0].consent.scope.configurationRevision,result.configurationRevision);
});
