import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
export async function exercise(t,{partialWrite=false,adoptExisting=false,resumeJournal=false,removeWhileSuspended=false}={}){
 let harness,app;t.after(async()=>{try{await harness?.close();}finally{if(app)await new Promise(resolve=>app.close(resolve));}});
 const home=await scratch(t),owner='durable-effects';
 const verifier=createServiceVerifier();app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const foreign={TCP:{'9000':{TCPForward:'127.0.0.1:9001'}}};let config=structuredClone(foreign),version=1,writes=0;
 const node={BackendState:'Running',Self:{DNSName:'fixture.node.invalid.',ID:'fixture-node',CapMap:{https:[],funnel:[],'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000':[]}},CurrentTailnet:{MagicDNSEnabled:true,MagicDNSSuffix:'node.invalid'},CertDomains:['fixture.node.invalid']};
 const effects=[
  {kind:'recipe',operation:'probe',handle:async({recipe})=>({stdout:JSON.stringify(recipe.args[0]==='serve'?config:node),stderr:'',exitCode:0})},
  {kind:'local-api',operation:'request',handle:async request=>{
   if(request.path.includes('status?'))return {status:200,headers:{},body:JSON.stringify(node)};
   assert.equal(request.path,'/localapi/v0/serve-config');
   if(request.method==='GET')return {status:200,headers:{etag:`"${version}"`},body:JSON.stringify(config)};
   assert.equal(request.method,'POST');if(request.headers['If-Match']!==`"${version}"`)return {status:412,headers:{},body:''};
   config=structuredClone(request.body);version++;writes++;if(partialWrite&&writes===1)return {status:500,headers:{},body:''};return {status:200,headers:{},body:''};
  }},
  {kind:'network',operation:'fetch',handle:async request=>{
   const url=new URL(request.url),port=url.port||'443';
   const proxy=url.protocol==='http:'?`http://${url.host}`:config.Web?.[`${url.hostname}:${port}`]?.Handlers?.['/']?.Proxy;
   assert.ok(proxy,'public proof must traverse the independently stored forwarding rule');
   return new Promise((resolve,reject)=>{const pending=http.get(proxy+url.pathname+url.search,{headers:request.headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));});pending.on('error',reject);});
  }},
 ];
 harness=await createTestingGozar({effects});const api=harness.gozar;
 const choices=(await api.listProviders({home,owner,refresh:true})).providers.filter(p=>p.availability.durable.state==='available');assert.equal(choices.length,2);
 for(const [index,provider]of choices.entries()){
  const q=query({home,owner,providerId:provider.providerId,operationId:`durable-${index}`,target:`127.0.0.1:${app.address().port}`,usage:{kind:'durable',routeId:`fixture-${index}`},requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'stable',setup:'allow',protocols:[]}});
  if(adoptExisting){config={...config,TCP:{...config.TCP,'443':{HTTPS:true}},Web:{'fixture.node.invalid:443':{Handlers:{'/':{Proxy:`http://${q.target}`}}}},AllowFunnel:{'fixture.node.invalid:443':true}};q.origin='https://fixture.node.invalid';q.intent='adopt';}
  const candidate=(await api.catalogRoutes(q)).candidates[0];assert.equal(candidate.eligible,true);assert.ok(candidate.candidateToken);
  const request={...q,approval:{kind:'route',candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest}};
  if(adoptExisting){const route=await api.adoptRoute({...request,handover:{from:'fixture-owner',generation:1}});assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,q.target);assert.equal(route.operationId,q.operationId);assert.equal(writes,0,'adoption proves and claims without rewriting the provider rule');assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');assert.deepEqual(config,foreign);return;}
  if(partialWrite){await assert.rejects(api.ensureRoute(request));const listed=await api.listRoutes({home,owner});assert.equal(listed.routes.length,1);assert.equal((await api.closeRoute({home,handle:listed.routes[0].handle,mode:'remove'})).cleanup.state,'confirmed');assert.deepEqual(config,foreign);return;}
  const route=await api.ensureRoute(request);assert.equal(route.verification.status,'verified');assert.equal(route.operationId,q.operationId);assert.equal(route.verification.subject.target,q.target);assert.equal(route.verification.subject.handleGeneration,route.handle.generation);assert.equal(route.verification.observedAt,route.verification.checkedAt);const written=writes;
  const review=await api.reviewRouteConsent({home,handle:route.handle});assert.equal(review.scope.reviewHandle,route.handle.id);assert.deepEqual(review.subject,route.verification.subject);
  assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
  await assert.rejects(api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:'changed'}),{code:'consent_mismatch'});
  const restored=await api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});assert.equal(restored.verification.status,'verified');assert.deepEqual(restored.handle,route.handle);assert.equal(writes,written);
  assert.deepEqual((await api.ensureRoute(request)).handle,route.handle);assert.equal(writes,written);
  const suspended=await api.suspendRoute({home,handle:route.handle});
  if(removeWhileSuspended){
   assert.equal(suspended.state,'suspended');assert.equal(suspended.published,null);
   assert.deepEqual(suspended.handle,route.handle);
   assert.deepEqual(config,foreign,'suspension withdraws only the owned rule');
   const afterSuspend=writes;
   const removed=await api.closeRoute({home,handle:suspended.handle,mode:'remove'});
   assert.deepEqual(removed.handle,route.handle);assert.equal(removed.cleanup.state,'confirmed');
   assert.equal(removed.published,null);
   const terminal=await api.ensureRoute(request);
   assert.equal(terminal.state,'released');assert.equal(terminal.published,null);
   assert.equal(terminal.operationId,q.operationId);assert.deepEqual(terminal.handle,route.handle);
   assert.equal(terminal.cleanup.state,'confirmed');assert.equal(writes,afterSuspend);
   assert.deepEqual(config,foreign);
   const path=join(home,'operations',createHash('sha256').update(JSON.stringify([owner,q.operationId])).digest('hex')+'.json');
   const receipt=await readFile(path,'utf8');
   const journal=JSON.parse(receipt);
   assert.equal(journal.phase,'terminal');
   assert.deepEqual(journal.view.handle,route.handle);
   assert.deepEqual(journal.view.cleanup,terminal.cleanup);

   await harness.close();
   harness=await createTestingGozar({effects});
   const fresh=harness.gozar;
   const replay=await fresh.ensureRoute(request);
   assert.equal(replay.state,'released');assert.equal(replay.published,null);
   assert.equal(replay.operationId,terminal.operationId);
   assert.deepEqual(replay.handle,terminal.handle);
   assert.deepEqual(replay.cleanup,terminal.cleanup);
   assert.equal(await readFile(path,'utf8'),receipt,'replay keeps the exact terminal journal');
   assert.equal((await fresh.listRoutes({home,owner})).routes.some(row=>
    row.handle.id===route.handle.id&&row.state!=='released'),false,'no owned route reappears');
   assert.equal(writes,afterSuspend,'reopen and replay make no further provider writes');
   assert.deepEqual(config,foreign,'unrelated forwarding remains exact');
   return;
  }
  const beforeResume=writes;
  const resumed=await api.ensureRoute({...q,operationId:undefined});assert.equal(resumed.handle.generation,route.handle.generation+1);
  assert.equal(writes,beforeResume+1,'resume restores the pinned rule exactly once');
  if(resumeJournal){
   // The committed engine record plus stale operation journal is the crash
   // boundary before operation-result persistence. Replay must not allocate.
   const name=createHash('sha256').update(JSON.stringify([owner,q.operationId])).digest('hex')+'.json';
   const journal=JSON.parse(await readFile(join(home,'operations',name),'utf8'));
   assert.deepEqual(journal.view.handle,route.handle,'journal retains the pre-resume generation');
   assert.equal(resumed.operationId,q.operationId);
   const committed=(await api.listRoutes({home,owner})).routes.filter(row=>row.handle.kind==='durable'&&row.handle.id===resumed.handle.id);
   assert.equal(committed.length,1);assert.deepEqual(committed[0].handle,resumed.handle);
   await assert.rejects(api.closeRoute({home,handle:route.handle,mode:'remove'}),{code:'route_conflict'});
   assert.equal(writes,beforeResume+1,'stale Stop must not remove the replacement');
   await assert.rejects(api.ensureRoute({...request,target:'127.0.0.1:1'}),{code:'operation_conflict'});
   assert.equal(writes,beforeResume+1,'conflicting old-operation intent must not write');
  }
  const afterResume=writes;assert.deepEqual((await api.ensureRoute(request)).handle,resumed.handle);assert.equal(writes,afterResume,'replay reconciles the existing generation without another allocation');
  const recovery=(await api.listRoutes({home,owner})).routes.filter(row=>row.handle.kind==='durable'&&row.handle.id===resumed.handle.id);assert.equal(recovery.length,1);assert.deepEqual(recovery[0].handle,resumed.handle);assert.equal(recovery[0].published,null);
  assert.equal((await api.closeRoute({home,handle:resumed.handle,mode:'remove'})).cleanup.state,'confirmed');
  const terminalName=createHash('sha256').update(JSON.stringify([owner,q.operationId])).digest('hex')+'.json';
  const terminalJournal=JSON.parse(await readFile(join(home,'operations',terminalName),'utf8'));
  assert.equal(terminalJournal.owner,owner);
  assert.equal(terminalJournal.operationId,q.operationId);
  assert.equal(terminalJournal.phase,'terminal','resumed Stop persists terminal operation evidence');
  assert.deepEqual(terminalJournal.view.handle,resumed.handle,'terminal journal follows exact committed restoration');
  assert.equal(terminalJournal.view.cleanup.state,'confirmed');
  assert.deepEqual(config,foreign);assert.equal(writes,afterResume+1,'Stop removes exactly the resumed rule');
  const terminalWrites=writes,terminal=await api.ensureRoute(request);
  assert.equal(terminal.state,'released');assert.deepEqual(terminal.handle,resumed.handle);
  assert.equal(terminal.cleanup.state,'confirmed');
  assert.equal(writes,terminalWrites,'stopped replay must remain terminal without a write');
 }
 assert.ok(harness.events.some(e=>e.kind==='local-api'&&e.operation==='request'));
}
test('shipped durable modules parse source observations, conditionally write, prove and remove only their rule',t=>exercise(t));
test('known partial durable write stays owned and can be recovered after a failed provider response',t=>exercise(t,{partialWrite:true}));
test('public adoption binds current configuration and proof before claiming an existing rule',t=>exercise(t,{adoptExisting:true}));
test('explicit removal of a suspended durable route is confirmed without another provider write',t=>exercise(t,{removeWhileSuspended:true}));
