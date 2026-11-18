import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
const fact=(id,affectsConsent=true)=>({id,label:id,value:null,known:false,reason:'not-observed',group:'fixture',affectsConsent,source:`local-observation:/${id}`,asOf:null});
async function fixture(t,options={}){
 let api,route;t.after(async()=>{if(route)await api.closeRoute({home,handle:route.handle,mode:'remove'});});
 const home=await scratch(t),id='observed-consent';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached'],reach:'this-device',transport:options.proofProtocol==='echo'?'tcp':'http',proofProtocol:options.proofProtocol??'http',protocols:[],facts:[fact('decision'),fact('display',false)],setupActions:[{id:'value',kind:'provide-value',valueFormat:'text',label:'Input',digest:'value-1',disclosure:{revision:'fixture-1',text:'Fixture',links:[]}}]});
 const folder=join(registry.root,'providers',id),observations=join(folder,'observations.json'),rowsFile=join(folder,'consent-rows.json');
 const rows=[fact('decision'),fact('display',false)];await writeFile(rowsFile,JSON.stringify(rows));
 await writeFile(observations,JSON.stringify({decision:false,display:'first'}));
 const module=join(folder,'index.mjs');await writeFile(module,(await readFile(module,'utf8')).replace('facts:{fake:true,','facts:{...JSON.parse(readFileSync(new URL("./observations.json",import.meta.url))),fake:true,').replace('  definition,','  get definition(){return {...definition,facts:JSON.parse(readFileSync(new URL("./consent-rows.json",import.meta.url)))};},'));
 // Fixture-owned observations change at runtime; module/definition bytes do not.
 const costFile=join(folder,'runtime-cost.json');
 if(options.runtimeCost){
   const dataPath=join(folder,'definition.json'),data=JSON.parse(await readFile(dataPath,'utf8'));
   data.adapter.capabilities.cost={kind:'paid',summary:'Fixture price',amount:0,currency:'USD',period:'hour'};
   await writeFile(dataPath,JSON.stringify(data));
   await writeFile(costFile,JSON.stringify(data.adapter.capabilities.cost));
   let source=await readFile(module,'utf8');
   source=source.replace('export default {','const runtimeCapabilities=()=>({...definition.capabilities,cost:JSON.parse(readFileSync(new URL("./runtime-cost.json",import.meta.url)))});\nexport default {')
     .replace('...definition,facts:','...definition,capabilities:runtimeCapabilities(),facts:')
     .split('structuredClone(definition.capabilities)').join('structuredClone(runtimeCapabilities())');
   await writeFile(module,source);
 }
 api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,...(options.owner?{owner:options.owner}:{}),usage:{kind:'attached'},requirements:{reach:'this-device',transport:options.proofProtocol==='echo'?'tcp':'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const initial=(await api.listProviders({home,owner:q.owner})).providers[0].configuration;
 const action=initial.actions[0];
 await api.runSetupAction({home,owner:q.owner,providerId:id,expectedConfigurationRevision:initial.revision,actionId:action.id,value:'initial',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 const approval=c=>({kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest});
 const setRows=async value=>{await writeFile(rowsFile,JSON.stringify(value));const path=join(folder,'definition.json'),data=JSON.parse(await readFile(path,'utf8'));data.adapter.facts=value;await writeFile(path,JSON.stringify(data));api=createGozar({manifest:registry.manifest,root:registry.root});};
 const setCost=async value=>{assert.ok(options.runtimeCost);await writeFile(costFile,JSON.stringify(value));};
 const identity=async()=>Promise.all([readFile(module,'utf8'),readFile(join(folder,'definition.json'),'utf8')]);
 const stop=async()=>{const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');route=null;return stopped;};
 return {home,id,api,q,approval,rows,setRows,setCost,identity,stop,observe:value=>writeFile(observations,JSON.stringify(value)),start:async choice=>(route=await api.expose({...q,wait:'verified',approval:approval(choice)})),events:async()=>readFile(join(folder,'events.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})};
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

const exactRows=(actual,expected)=>{
 assert.equal(new Set(actual.map(row=>row.id)).size,actual.length);
 assert.equal(new Set(expected.map(row=>row.id)).size,expected.length);
 const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(sorted(actual),sorted(expected));
};
const startCount=async f=>(await f.events()).split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.event==='start').length;
test('unknown attached provider preserves typed cost and provider facts through actual runtime price and decision drift',async t=>{
 const f=await fixture(t,{owner:'runtime-facts-owner',runtimeCost:true});
 const choice=(await f.api.catalogRoutes(f.q)).candidates[0];
 const seed=structuredClone(choice.consent.facts);
 assert.ok(seed.some(row=>row.affectsConsent),'explicit provider consent seed');
 assert.ok(seed.every(row=>!row.id.startsWith('gozar.route-cost.')));
 assert.deepEqual(choice.consent.disclosures.cost,{kind:'paid',summary:'Fixture price',amount:0,currency:'USD',period:'hour'});
 const identity=await f.identity(),route=await f.start(choice);
 assert.equal(route.verification.status,'verified');assert.equal(await startCount(f),1);
 const prior=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
 assert.deepEqual(prior.disclosures.cost,choice.consent.disclosures.cost);
 exactRows(prior.facts,seed);assert.deepEqual(prior.subject,route.verification.subject);
 await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:prior.approvalToken,consentFactsDigest:prior.consentFactsDigest});
 await f.setCost({kind:'paid',summary:'Fixture price',amount:7,currency:'USD',period:'hour'});
 await f.observe({decision:'new-reader',display:'changed'});
 assert.deepEqual(await f.identity(),identity,'runtime drift changes neither module nor definition identity');
 const status=await f.api.routeStatus({home:f.home,handle:route.handle});
 assert.equal(status.published,null);assert.ok(status.consentChange);
 const old=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
 await f.setCost({kind:'paid',summary:'Fixture price',amount:8,currency:'USD',period:'hour'});
 await f.observe({decision:'current-reader',display:'changed-again'});
 assert.deepEqual(await f.identity(),identity);
 await assert.rejects(f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:old.approvalToken,consentFactsDigest:old.consentFactsDigest}),{code:'consent_mismatch'});
 assert.equal(await startCount(f),1,'stale approval creates no second resource');
 const current=(await f.api.catalogRoutes(f.q)).candidates[0];
 const fresh=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
 exactRows(fresh.facts,current.consent.facts);
 assert.equal(fresh.facts.find(row=>row.id==='decision').value,'current-reader');
 assert.deepEqual(fresh.disclosures.cost,{kind:'paid',summary:'Fixture price',amount:8,currency:'USD',period:'hour'});
 assert.deepEqual(fresh.disclosures.cost,current.consent.disclosures.cost);
 assert.deepEqual(fresh.subject,route.verification.subject);
 assert.equal(fresh.scope.reviewHandle,route.handle.id);assert.equal(fresh.scope.handleGeneration,route.handle.generation);
 const restored=await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest});
 assert.equal(restored.verification.status,'verified');assert.deepEqual(restored.handle,route.handle);
 assert.deepEqual(choice.consent.facts,seed);assert.equal(await startCount(f),1);
 await assert.rejects(f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest}));
 assert.equal(await startCount(f),1);await f.stop();
 assert.equal((await f.events()).split('"cleanup"').length-1,1);
});
test('initial-only attached echo refuses runtime refresh after observation drift',async t=>{
 const f=await fixture(t,{owner:'initial-only-owner',proofProtocol:'echo'});
 const choice=(await f.api.catalogRoutes(f.q)).candidates[0],route=await f.start(choice);
 assert.equal(route.verification.status,'verified');assert.equal(await startCount(f),1);
 const identity=await f.identity();
 await f.observe({decision:true,display:'second'});
 assert.deepEqual(await f.identity(),identity);
 assert.equal((await f.api.routeStatus({home:f.home,handle:route.handle})).published,null);
 await assert.rejects(f.api.reviewRouteConsent({home:f.home,handle:route.handle}),{code:'proof_refresh_unsupported'});
 assert.equal((await f.api.routeStatus({home:f.home,handle:route.handle})).published,null);
 assert.equal(await startCount(f),1);await f.stop();
 assert.equal((await f.events()).split('"stop"').length-1,1);
 assert.equal((await f.events()).split('"cleanup"').length-1,1);
});
test('a runtime review cannot approve a newly proved resource subject',async t=>{
 const f=await fixture(t,{owner:'subject-change-owner'});
 const first=await f.start((await f.api.catalogRoutes(f.q)).candidates[0]);
 assert.equal(first.verification.status,'verified');
 const old=await f.api.reviewRouteConsent({home:f.home,handle:first.handle});
 await f.stop();
 const second=await f.start((await f.api.catalogRoutes(f.q)).candidates[0]);
 assert.equal(second.verification.status,'verified');
 assert.notDeepEqual(second.verification.subject,first.verification.subject);
 const fresh=await f.api.reviewRouteConsent({home:f.home,handle:second.handle});
 await assert.rejects(f.api.approveRouteConsent({home:f.home,handle:second.handle,approvalToken:old.approvalToken,consentFactsDigest:old.consentFactsDigest}));
 assert.equal(await startCount(f),2,'stale approval creates no third resource');
 assert.equal((await f.api.routeStatus({home:f.home,handle:second.handle})).published,null);
 const restored=await f.api.approveRouteConsent({home:f.home,handle:second.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest});
 assert.equal(restored.verification.status,'verified');assert.deepEqual(restored.handle,second.handle);
 await f.stop();
});
