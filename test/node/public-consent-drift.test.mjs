import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fork} from 'node:child_process';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,attachedScratch,query,assertShape} from './route-schema-check.mjs';
const fact=(id,affectsConsent=true)=>({id,label:id,value:null,known:false,reason:'not-observed',group:'fixture',affectsConsent,source:`local-observation:/${id}`,asOf:null});
async function fixture(t,options={}){
 let api,route;if(!options.home)t.after(async()=>{if(route)await api.closeRoute({home,handle:route.handle,mode:'remove'});});
 const home=options.home??await (options.attachedCleanup?attachedScratch(t):scratch(t)),id='observed-consent';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:[options.kind??'attached'],reach:'this-device',transport:options.proofProtocol==='echo'?'tcp':'http',proofProtocol:options.proofProtocol??'http',protocols:[],facts:[fact('decision'),fact('display',false)],setupActions:[{id:'value',kind:'provide-value',valueFormat:'text',label:'Input',digest:'value-1',disclosure:{revision:'fixture-1',text:'Fixture',links:[]}}]});
 const folder=join(registry.root,'providers',id),observations=join(folder,'observations.json'),rowsFile=join(folder,'consent-rows.json');
 const rows=[fact('decision'),fact('display',false)];await writeFile(rowsFile,JSON.stringify(rows));
 await writeFile(observations,JSON.stringify({decision:false,display:'first'}));
 const module=join(folder,'index.mjs');await writeFile(module,(await readFile(module,'utf8')).replace('facts:{fake:true,','facts:{...JSON.parse(readFileSync(new URL("./observations.json",import.meta.url))),fake:true,').replace('  definition,','  get definition(){return {...definition,facts:JSON.parse(readFileSync(new URL("./consent-rows.json",import.meta.url)))};},'));
 if(options.kind==='session')await writeFile(module,(await readFile(module,'utf8')).replace("definition.supportedKinds.includes('attached')",'true'));
 // Fixture-owned observations change at runtime; module/definition bytes do not.
 const costFile=join(folder,'runtime-cost.json');
 if(options.runtimeCost){
   const dataPath=join(folder,'definition.json'),data=JSON.parse(await readFile(dataPath,'utf8'));
   data.adapter.capabilities.cost={kind:'paid',summary:'Fixture price',amount:0,currency:'USD',period:'hour'};
   await writeFile(dataPath,JSON.stringify(data));
   await writeFile(costFile,JSON.stringify(data.adapter.capabilities.cost));
   await writeFile(join(folder,'runtime-facts.json'),'[]');
   let source=await readFile(module,'utf8');
   source=source.replace('export default {','const runtimeCapabilities=()=>({...definition.capabilities,cost:JSON.parse(readFileSync(new URL("./runtime-cost.json",import.meta.url)))});\nexport default {')
     .replace('...definition,facts:',options.immutableDeclaration?'...definition,facts:':'...definition,capabilities:runtimeCapabilities(),facts:')
     .split('structuredClone(definition.capabilities)').join('structuredClone(runtimeCapabilities())')
     .replace('ingress: null, limits:', 'facts:JSON.parse(readFileSync(new URL("./runtime-facts.json",import.meta.url))),ingress: null, limits:');
   await writeFile(module,source);
 }
 api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,...(options.owner?{owner:options.owner}:{}),usage:{kind:options.kind??'attached',...(options.kind==='session'?{lifetimeMs:60000}:{})},requirements:{reach:'this-device',transport:options.proofProtocol==='echo'?'tcp':'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 if(options.operationId)q.operationId=options.operationId;
 const initial=(await api.listProviders({home,owner:q.owner})).providers[0].configuration;
 const action=initial.actions[0];
 await api.runSetupAction({home,owner:q.owner,providerId:id,expectedConfigurationRevision:initial.revision,actionId:action.id,value:'initial',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 const approval=c=>({kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest});
 const setRows=async value=>{await writeFile(rowsFile,JSON.stringify(value));const path=join(folder,'definition.json'),data=JSON.parse(await readFile(path,'utf8'));data.adapter.facts=value;await writeFile(path,JSON.stringify(data));api=createGozar({manifest:registry.manifest,root:registry.root});};
 const setCost=async value=>{assert.ok(options.runtimeCost);await writeFile(costFile,JSON.stringify(value));};
 const identity=async()=>Promise.all([readFile(module,'utf8'),readFile(join(folder,'definition.json'),'utf8')]);
 const stop=async()=>{const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');route=null;return stopped;};
 return {home,id,api,q,config:{manifest:registry.manifest,root:registry.root},approval,rows,setRows,setCost,setRawCost:value=>writeFile(costFile,value),setRuntimeFacts:value=>writeFile(join(folder,'runtime-facts.json'),JSON.stringify(value)),identity,stop,observe:value=>writeFile(observations,JSON.stringify(value)),start:async choice=>(route=await api.expose({...q,wait:'verified',approval:approval(choice)})),events:async()=>readFile(join(folder,'events.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})};
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

for(const kind of ['attached','session'])test(`invalid runtime cost withdraws ${kind} publication before status refuses and retains exact cleanup authority`,async t=>{
 const f=await fixture(t,{runtimeCost:true,kind});
 const choice=(await f.api.catalogRoutes(f.q)).candidates[0],route=await f.start(choice);
 assert.equal(route.verification.status,'verified');assert.equal(route.published,route.origin);
 const foreign=join(f.home,'foreign-neighbor.json');await writeFile(foreign,'foreign sentinel');
 const prior=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
 await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:prior.approvalToken,consentFactsDigest:prior.consentFactsDigest});
 await f.setCost({...choice.properties.cost,currency:null});
 await assert.rejects(f.api.routeStatus({home:f.home,handle:route.handle}),{code:'invalid_input'});
 const [withdrawn]=(await f.api.listRoutes({home:f.home,owner:f.q.owner})).routes;
 assert.equal(withdrawn.published,null,'a status refusal must withdraw the live controller before list observes it');
 assert.equal(withdrawn.verification.status,'unverified');assert.deepEqual(withdrawn.handle,route.handle);
 assertShape('RouteView',withdrawn);assert.deepEqual(withdrawn.properties.cost,choice.properties.cost);
 assert.equal(await startCount(f),1);
 await assert.rejects(f.api.reviewRouteConsent({home:f.home,handle:route.handle}),{code:'invalid_input'});
 await assert.rejects(f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:prior.approvalToken,consentFactsDigest:prior.consentFactsDigest}));
 assert.equal((await f.api.listRoutes({home:f.home,owner:f.q.owner})).routes[0].published,null);
 await f.setCost(choice.properties.cost);
 assert.equal((await f.api.routeStatus({home:f.home,handle:route.handle})).published,null,'valid facts alone cannot restore publication');
 const fresh=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
 const restored=await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest});
 assert.equal(restored.verification.status,'verified');assert.deepEqual(restored.handle,route.handle);
 assert.equal(await startCount(f),1);
 await f.stop();assert.equal((await f.events()).split('"cleanup"').length-1,1);
 assert.equal(await readFile(foreign,'utf8'),'foreign sentinel');
});

test('invalid runtime JSON and consent facts retain valid historical disclosures and require new review',async t=>{
 const f=await fixture(t,{runtimeCost:true});
 const choice=(await f.api.catalogRoutes(f.q)).candidates[0],route=await f.start(choice);
 for(const invalid of ['json','consent']){
   if(invalid==='json')await f.setRawCost('{');
   else await f.setRuntimeFacts([{...fact('invalid'),known:true,value:{value:'runtime-secret-canary'}}]);
   await assert.rejects(f.api.routeStatus({home:f.home,handle:route.handle}),undefined,invalid);
   const listed=await f.api.listRoutes({home:f.home,owner:f.q.owner}),withdrawn=listed.routes[0];
   assertShape('RouteView',withdrawn);assert.equal(withdrawn.published,null);assert.equal(withdrawn.verification.status,'unverified');
   assert.deepEqual(withdrawn.properties.cost,choice.properties.cost);
   assert.doesNotMatch(JSON.stringify(listed),/runtime-secret-canary/);
   await f.setCost(choice.properties.cost);await f.setRuntimeFacts([]);
   assert.equal((await f.api.routeStatus({home:f.home,handle:route.handle})).published,null);
   const review=await f.api.reviewRouteConsent({home:f.home,handle:route.handle});
   assert.equal((await f.api.approveRouteConsent({home:f.home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest})).verification.status,'verified');
 }
 assert.equal(await startCount(f),1);await f.stop();
});

const boundedRecovery = (promise,label,ms=10000) => {
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);
 })]).finally(()=>clearTimeout(timer));
};
function recoveryReader(){
 const child=fork(new URL('./runtime-cost-recovery-worker.mjs',import.meta.url),[],{stdio:['ignore','inherit','inherit','ipc']});
 const replies=new Map();
 let sequence=0,fatal=null,closed=false,finish;
 const exited=new Promise(resolve=>{finish=resolve;});
 const ready=new Promise((resolve,reject)=>{replies.set('ready',{resolve,reject});});
 ready.catch(()=>{});
 const fail=error=>{fatal=error;for(const reply of replies.values())reply.reject(error);replies.clear();};
 child.on('error',fail);
 child.on('close',(code,signal)=>{
  closed=true;
  const result={code,signal,error:fatal};
  if(replies.size)fail(new Error('Reader closed before reply: '+code+'/'+signal));
  finish(result);
 });
 child.on('message',message=>{
  const key=message.type==='ready'?'ready':message.id,reply=replies.get(key);
  if(!reply){fail(new Error('Unexpected reader message '+JSON.stringify(message)));return;}
  replies.delete(key);
  if(message.type==='failure')reply.reject(Object.assign(new Error(message.message),{code:message.code}));
  else reply.resolve(message);
 });
 const send=message=>new Promise((resolve,reject)=>{
  if(closed||fatal){reject(fatal??new Error('Reader already closed'));return;}
  child.send(message,error=>error?reject(error):resolve());
 });
 return {
  async ready(){
   const message=await boundedRecovery(ready,'reader ready');
   assert.equal(message.pid,child.pid);assert.notEqual(message.pid,process.pid);
  },
  async read(f,route){
   if(fatal)throw fatal;
   const id=++sequence;
   const reply=new Promise((resolve,reject)=>replies.set(id,{resolve,reject}));
   reply.catch(()=>{});
   try{
    await boundedRecovery(send({type:'read',id,config:f.config,home:f.home,owner:f.q.owner,handle:route.handle,operationId:f.q.operationId}),'reader send');
    const result=await boundedRecovery(reply,'reader observation');
    assert.equal(result.type,'read');assert.equal(result.pid,child.pid);
    assert.equal(result.bootstrap.home,f.home);assert.equal(result.bootstrap.owner,f.q.owner);
    assert.equal(result.bootstrap.operationId,f.q.operationId);
    assert.deepEqual(result.stateHandle,route.handle);
    if(route.handle.kind==='session')assert.deepEqual(result.bootstrap.handle,route.handle);
    else assert.equal(result.bootstrap.id,route.handle.id);
    assert.deepEqual(result.operation,{owner:f.q.owner,operationId:f.q.operationId,handle:route.handle});
    return result;
   }finally{replies.delete(id);}
  },
  async stop(){
   if(!closed)await boundedRecovery(send({type:'stop'}),'reader stop request');
   const result=await boundedRecovery(exited,'reader exit');
   if(result.error)throw result.error;
   assert.equal(result.code,0);assert.equal(result.signal,null);
   if(fatal)throw fatal;
  },
  async forceCleanup(){
   if(!closed)child.kill('SIGKILL'); // Only exact owned helper, never creator/controller.
   await boundedRecovery(exited,'owned reader forced cleanup');
  },
 };
}
function exactRecoveryView(view,route,cost,published){
 assert.ok(view,'an explicit retained view is required');
 assert.deepEqual(view.handle,route.handle);assert.equal(view.operationId,route.operationId);
 assert.equal(view.published,published);
 assert.equal(view.verification.status,published===null?'unverified':'verified');
 assert.deepEqual(view.properties.cost,cost);assertShape('RouteView',view);
}
async function recoveryWatch(api,f,route,cost,invalid){
 const abort=new AbortController();
 const iterator=api.watchRoutes({home:f.home,handle:route.handle,signal:abort.signal,intervalMs:1})[Symbol.asyncIterator]();
 try{
  if(invalid){
   // Existing contract: invalid facts reject; NOT withdrawal evidence.
   await assert.rejects(boundedRecovery(iterator.next(),'invalid watch rejection'),{code:'invalid_input'});
  }else{
   const event=await boundedRecovery(iterator.next(),'restored-valid watch snapshot');
   assert.equal(event.done,false,'ended watch is not withdrawal evidence');
   assert.equal(event.value.type,'snapshot');
   exactRecoveryView(event.value.route,route,cost,null);
  }
 }finally{
  abort.abort();
  assert.equal(typeof iterator.return,'function');
  await boundedRecovery(iterator.return(),'exact watch cancellation');
 }
}
async function recoveryLedger(f,stopped=false){
 const events=(await f.events()).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 for(const [event,count] of [['start',1],['stop',stopped?1:0],['cleanup',stopped?1:0]])
  assert.equal(events.filter(row=>row.event===event).length,count,'provider ledger '+event);
}
async function recoveryListed(api,f,route,cost,published){
 const listed=await api.listRoutes({home:f.home,owner:f.q.owner});
 assert.equal(listed.routes.length,1,'withdrawal must retain exactly one route');
 exactRecoveryView(listed.routes[0],route,cost,published);
}
function recoveryRead(result,route,cost,published){
 assert.equal(result.listed.routes.length,1,'fresh reader must retain exactly one route');
 exactRecoveryView(result.listed.routes[0],route,cost,published);
 exactRecoveryView(result.persisted,route,cost,published);
}

for(const kind of ['attached','session'])test('invalid Cost retained withdrawal and restored-valid watch with independent live-host reader for '+kind,{timeout:90000},async t=>{
 const home=await mkdtemp(join(tmpdir(),'gozar-cost-reader-'));
 let f,route,reader,stopped=false,readerStopped=false,primary,finished=false;
 try{
  f=await fixture(t,{home,runtimeCost:true,immutableDeclaration:true,kind,owner:'recovery-'+kind,operationId:'cost-recovery-'+kind});
  const choice=(await f.api.catalogRoutes(f.q)).candidates[0],cost=choice.properties.cost;
  route=await f.start(choice);
  assert.equal(route.operationId,f.q.operationId);
  assert.equal(typeof route.origin,'string');
  assert.equal(route.verification.status,'verified');
  assert.equal(route.published,route.origin);
  exactRecoveryView(route,route,cost,route.origin);
  const foreign=join(home,'recovery-foreign.json');await writeFile(foreign,'foreign sentinel');
  const prior=await f.api.reviewRouteConsent({home,handle:route.handle});
  await f.api.approveRouteConsent({home,handle:route.handle,approvalToken:prior.approvalToken,consentFactsDigest:prior.consentFactsDigest});
  reader=recoveryReader();await reader.ready();
  recoveryRead(await reader.read(f,route),route,cost,route.origin);
  await recoveryLedger(f);
  await f.setCost({...cost,currency:null});
  await assert.rejects(f.api.routeStatus({home,handle:route.handle}),{code:'invalid_input'});
  const freshFactory=createGozar(f.config);
  for(const api of [f.api,freshFactory])await recoveryListed(api,f,route,cost,null);
  const invalid=await reader.read(f,route);
  recoveryRead(invalid,route,cost,null);
  assert.equal(invalid.persisted.consentChange.reason,'runtime-observation-invalid');
  assert.equal(invalid.listed.routes[0].consentChange.reason,'runtime-observation-invalid');
  for(const api of [f.api,freshFactory])await recoveryWatch(api,f,route,cost,true);
  await recoveryLedger(f);
  await assert.rejects(f.api.reviewRouteConsent({home,handle:route.handle}),{code:'invalid_input'});
  await assert.rejects(f.api.approveRouteConsent({home,handle:route.handle,approvalToken:prior.approvalToken,consentFactsDigest:prior.consentFactsDigest}));
  await f.setCost(cost);
  exactRecoveryView(await f.api.routeStatus({home,handle:route.handle}),route,cost,null);
  for(const api of [f.api,freshFactory]){
   await recoveryListed(api,f,route,cost,null);
   await recoveryWatch(api,f,route,cost,false);
  }
  recoveryRead(await reader.read(f,route),route,cost,null);
  await recoveryLedger(f);
  const fresh=await f.api.reviewRouteConsent({home,handle:route.handle});
  const restored=await f.api.approveRouteConsent({home,handle:route.handle,approvalToken:fresh.approvalToken,consentFactsDigest:fresh.consentFactsDigest});
  exactRecoveryView(restored,route,cost,route.origin);
  recoveryRead(await reader.read(f,route),route,cost,route.origin);
  await recoveryLedger(f);
  await reader.stop();readerStopped=true;
  await boundedRecovery(f.stop(),'exact original route cleanup');stopped=true;
  await recoveryLedger(f,true);
  assert.equal(await readFile(foreign,'utf8'),'foreign sentinel');
  finished=true;
 }catch(error){primary=error;if(!route&&error.route?.handle)route=error.route;}
 finally{
  const failures=[];
  if(reader&&!readerStopped){
   try{await reader.stop();readerStopped=true;}
   catch(error){failures.push(error);try{await reader.forceCleanup();}catch(cleanup){failures.push(cleanup);}}
  }
  if(f&&route&&!stopped){
   try{
    const closed=await boundedRecovery(f.api.closeRoute({home,handle:route.handle,mode:'remove'}),'failure exact route cleanup');
    assert.equal(closed.cleanup.state,'confirmed');stopped=true;
   }catch(error){failures.push(error);}
  }
  if(finished&&!failures.length)await rm(home,{recursive:true,force:true});
  else t.diagnostic('Retained evidence at '+home+'; exact handle '+JSON.stringify(route?.handle??null)+'; route cleanup '+stopped);
  if(failures.length)throw new AggregateError(primary?[primary,...failures]:failures,'Reader/route cleanup debt');
 }
 if(primary)throw primary;
});

test('initial effective properties may differ from static capability cost without bypassing later consent drift', async t => {
 const f=await fixture(t,{runtimeCost:true,immutableDeclaration:true,attachedCleanup:true,owner:'initial-properties-owner'});
 const initialCost={kind:'paid',summary:'Fixture price',amount:5,currency:'USD',period:'hour'};
 await f.setCost(initialCost);
 const choice=(await f.api.catalogRoutes(f.q)).candidates[0];
 assert.deepEqual(choice.consent.disclosures.cost,initialCost);
 const route=await f.start(choice);
 assert.equal(route.verification.status,'verified');
 assert.equal(await startCount(f),1);
 await f.setCost({...initialCost,amount:6});
 const changed=await f.api.routeStatus({home:f.home,handle:route.handle});
 assert.equal(changed.published,null);
 assert.ok(changed.consentChange,'real effective-property drift still withdraws publication');
 assert.equal(await startCount(f),1,'consent drift cannot allocate a replacement');
});
