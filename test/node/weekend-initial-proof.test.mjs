import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {query} from './route-schema-check.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function latch() {
 let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve};
}
async function bounded(promise,label,ms=8000) {
 let timer;
 try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]); }
 finally { clearTimeout(timer); }
}
async function until(read,predicate,label) {
 const deadline=Date.now()+6000;
 for (;;) {
  const value=await bounded(read(),label);
  if(predicate(value))return value;
  if(Date.now()>=deadline)throw new Error(label+' not observed');
  await new Promise(r=>setTimeout(r,20));
 }
}
async function fixture(t,{buffered=false,holdIdentity=false,holdStream=false,allowRemoval=true}={}) {
 const home=await mkdtemp(join(tmpdir(),'gozar-initial-proof-')),owner='initial-proof-owner',ledger=new Map(),removed=[],fetches=[];
 const identitySeen=latch(),streamSeen=latch(),identityPermit=latch(),streamPermit=latch();
 if(!holdIdentity)identityPermit.resolve();
 if(!holdStream)streamPermit.resolve();
 let serial=0,harness,request,handle,opening,removeAllowed=allowRemoval;
 const sockets=new Set();
 const app=http.createServer((_req,res)=>res.end('owned application'));
 app.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 t.after(async()=>{
  identityPermit.resolve();streamPermit.resolve();removeAllowed=true;
  try {
   if(opening)await bounded(opening,'finish pending expose',20000).catch(()=>{});
   if(!handle&&harness)handle=(await harness.gozar.listRoutes({home,owner})).routes.find(r=>r.operationId===request?.operationId)?.handle;
   if(handle&&harness)await bounded(harness.gozar.closeRoute({home,handle,mode:'remove'}),'fixture remove',20000);
  } finally {
   try { await harness?.close(); }
   finally {
    for(const socket of sockets)socket.destroy();
    try { await new Promise(resolve=>app.close(resolve)); }
    finally { await rm(home,{recursive:true,force:true}); }
   }
  }
 });
 await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
 const effects=[
  {kind:'recipe',operation:'probe',handle:async()=>({ok:false})},
  {kind:'sdk-listener',operation:'detect',handle:async()=>({available:true})},
  {kind:'sdk-listener',operation:'open',handle:async({options})=>{
   const id='owned-'+(++serial),url='https://'+options.domain;
   assert.equal(options.proto==='tcp'||options.proto==='tls',false,'use shipped HTTPS adapter');
   ledger.set(id,{url,target:options.addr});return {handle:id,url};
  }},
  {kind:'sdk-listener',operation:'read',handle:async({handle:id})=>ledger.has(id)?{present:true,url:ledger.get(id).url}:{present:false}},
  {kind:'sdk-listener',operation:'close',handle:async({handle:id})=>{
   if(removeAllowed&&ledger.delete(id))removed.push(id);
   return {closed:!ledger.has(id)};
  }},
  {kind:'network',operation:'fetch',handle:async input=>{
   const parsed=new URL(input.url),resource=[...ledger.values()].find(r=>r.url===parsed.origin);
   assert(resource,'fetch belongs to independently recorded allocation');
   const witness={url:input.url,started:Date.now(),completed:null};fetches.push(witness);
   const response=await fetch('http://'+resource.target+parsed.pathname+parsed.search,{
    method:input.method,headers:input.headers,signal:AbortSignal.timeout(6000),
   });
   const chunks=[];let last=Date.now();
   for await(const chunk of response.body) {
    const at=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:buffered?0:at-last});last=at;
   }
   if(parsed.pathname.endsWith('/identity')) { identitySeen.resolve();await identityPermit.promise; }
   if(parsed.pathname.endsWith('/stream')) { streamSeen.resolve();await streamPermit.promise; }
   witness.completed=Date.now();
   return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }},
 ];
 harness=await createTestingGozar({effects});const api=harness.gozar;
 const inventory=await api.listProviders({home,owner});
 const provider=inventory.providers.find(p=>p.transport==='https'&&p.availability.attached.state!=='unsupported');
 assert(provider,'shipped HTTPS provider');
 let config=provider.configuration;
 for(const requirement of config.inputRequirements) {
  const action=config.actions.find(a=>a.id===requirement.actionId);let input;
  if(requirement.secret) {
   const stored=await api.storeSecret({home,owner,providerId:provider.providerId,inputId:requirement.id,scopeId:config.scopeId,expectedConfigurationRevision:config.revision,bytes:new TextEncoder().encode('synthetic-initial-proof')});
   input={secretHandle:stored.handle};
  } else input={value:'fixture.example.invalid'};
  config=(await api.runSetupAction({home,owner,providerId:provider.providerId,expectedConfigurationRevision:config.revision,actionId:action.id,...input,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
 }
 const q=query({home,owner,operationId:'initial-proof-operation',providerId:provider.providerId,usage:{kind:'attached'},target:'127.0.0.1:'+app.address().port,requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:['sse']}});
 const candidate=(await api.catalogRoutes(q)).candidates[0];
 assert.equal(candidate.eligible,true,'SSE must be admitted, not skipped');
 assert(candidate.candidateToken);
 request={...q,wait:'verified',approval:{kind:'route',consentFactsDigest:candidate.consentFactsDigest,candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision}};
 return {
  home,owner,api,request,ledger,removed,fetches,identitySeen,streamSeen,identityPermit,streamPermit,
  allowRemoval(){removeAllowed=true;},
  begin(){opening=api.expose(request).then(route=>({route}),error=>({error}));return opening;},
  async pendingHandle(){
   const row=await until(()=>api.listRoutes({home,owner}),r=>r.routes.some(x=>x.operationId===q.operationId&&x.handle),'public reservation');
   handle=row.routes.find(x=>x.operationId===q.operationId).handle;return handle;
  },
  async status(){assert(handle);return bounded(api.routeStatus({home,handle}),'public status');},
  async close(){assert(handle);return bounded(api.closeRoute({home,handle,mode:'remove'}),'public close',20000);},
  get allocated(){return serial;},
 };
}
function unpublished(view) {
 assert.equal(view.published,null);
 assert.notEqual(view.verification.status,'verified');
}
test('initial receipt and nonce/SSE holds never admit status refresh', {timeout:30000}, async t=>{
 const f=await fixture(t,{holdIdentity:true,holdStream:true});
 const pending=f.begin();
 await bounded(f.identitySeen.promise,'nonce response');
 await f.pendingHandle();
 assert.equal(f.ledger.size,1,'allocation exists before proof');
 unpublished(await f.status());
 assert.equal(f.fetches.length,1,'status did not launch another nonce');
 f.identityPermit.resolve();
 await bounded(f.streamSeen.promise,'SSE response');
 for(let i=0;i<3;i++)unpublished(await f.status());
 assert.equal(f.fetches.filter(x=>new URL(x.url).pathname.endsWith('/identity')).length,1);
 f.streamPermit.resolve();
 const {route,error}=await bounded(pending,'verified expose');
 assert.ifError(error);assert.equal(route.verification.status,'verified');assert.notEqual(route.published,null);
 assert.equal((await f.close()).cleanup.state,'confirmed');
 assert.equal(f.ledger.size,0);assert.deepEqual(f.removed,['owned-1']);
});
test('buffered initial SSE and unconfirmed removal retain original failure on status/replay', {timeout:30000}, async t=>{
 const f=await fixture(t,{buffered:true,holdStream:true,allowRemoval:false});
 const pending=f.begin();
 await bounded(f.streamSeen.promise,'buffered SSE');
 await f.pendingHandle();unpublished(await f.status());
 f.streamPermit.resolve();
 const first=await bounded(pending,'failed initial expose',15000);
 assert(first.error);assert.equal(first.error.code,'verification_failed');
 assert.equal(f.ledger.size,1,'declined cleanup must retain owned allocation');
 const calls=f.fetches.length;
 let retained;
 for(let i=0;i<3;i++){
  retained=await f.status();unpublished(retained);assert.equal(retained.cleanup.state,'unconfirmed');
 }
 assert(first.error.route,'initial failure retains the owned route');
 assert.deepEqual(retained.handle,first.error.route.handle);
 assert.equal(retained.operationId,f.request.operationId);
 assert.equal(retained.operationId,first.error.route.operationId);
 // Snapshot the latest failed view, not the earlier allocation/proof attempt.
 const failedEvidence=structuredClone(retained.verification);
 const failedHandle=structuredClone(retained.handle);
 assert.equal(f.fetches.length,calls,'settled failure did not start nonce-only refresh');
 assert.equal(f.allocated,1,'initial failure has exactly one allocation');
 const replay=await f.api.expose(f.request).then(route=>({route}),error=>({error}));
 let replayView;
 if(replay.error){
  assert.equal(replay.error.code,'verification_failed');
  assert.equal(replay.error.code,first.error.code);
  assert(replay.error.route,'rejected replay retains its failed route');
  replayView=replay.error.route;
 }else{
  assert(replay.route,'successful recovery read returns the retained view');
  replayView=replay.route;
 }
 unpublished(replayView);
 assert.equal(replayView.cleanup.state,'unconfirmed','refused provider removal remains cleanup debt');
 assert.deepEqual(replayView.handle,failedHandle,'replay preserves handle and generation');
 assert.equal(replayView.operationId,retained.operationId,'replay preserves operation identity');
 assert.deepEqual(replayView.verification,failedEvidence,'recovery does not restamp failed proof evidence');
 assert.equal(f.fetches.length,calls,'replay starts no extra nonce or SSE proof');
 assert.equal(f.allocated,1,'replay must not allocate again');
 assert.equal(f.ledger.size,1,'failed replay does not lose the refused owned allocation');
 f.allowRemoval();
 const closed=await f.close();assert.equal(closed.cleanup.state,'confirmed');
 assert.deepEqual(closed.handle,failedHandle,'cleanup applies to the exact owned generation');
 assert.equal(f.ledger.size,0);assert.deepEqual(f.removed,['owned-1']);
 const appResponse=await fetch('http://'+f.request.target,{signal:AbortSignal.timeout(6000)});
 assert.equal(appResponse.status,200);
 assert.equal(await appResponse.text(),'owned application','foreign application survives owned cleanup');
});
test('close requested during initial proof cannot publish late completion', {timeout:30000}, async t=>{
 const f=await fixture(t,{holdStream:true});
 const pending=f.begin();await bounded(f.streamSeen.promise,'pending SSE');await f.pendingHandle();
 unpublished(await f.status());
 const closing=f.close();
 // Observe public status while the independent stream remains held.
 for(let i=0;i<3;i++)unpublished(await f.status());
 f.streamPermit.resolve();
 const result=await bounded(pending,'late proof result',15000);
 if(result.route)unpublished(result.route);
 else assert.equal(result.error.code,'verification_failed');
 assert.equal((await closing).cleanup.state,'confirmed');
 assert.equal(f.ledger.size,0);assert.deepEqual(f.removed,['owned-1']);
});
test('successful status observations carry a real proof time, not a synthetic read-time stamp', {timeout:30000}, async t=>{
 const f=await fixture(t);
 const {route,error}=await bounded(f.begin(),'successful initial proof');assert.ifError(error);
 await f.pendingHandle();
 assert.equal(route.verification.status,'verified');
 const initialTime=route.verification.checkedAt;
 let previousTime=initialTime;
 assert(Number.isFinite(Date.parse(initialTime)));
 for(let i=0;i<2;i++) {
  const before=f.fetches.length,started=Date.now();
  const view=await f.status(),ended=Date.now();
  assert(Number.isFinite(Date.parse(view.verification.checkedAt)));
  if(f.fetches.length===before)assert.equal(view.verification.checkedAt,previousTime,'without a new proof keep original time');
  else {
   // Status may perform a genuine refresh. Its time must belong to that
   // witnessed proof, not be borrowed from an older observation.
   const proof=f.fetches.slice(before);
   assert(proof.every(x=>x.completed!==null));
   assert(Date.parse(view.verification.checkedAt)>=started);
   assert(Date.parse(view.verification.checkedAt)<=ended);
  }
  previousTime=view.verification.checkedAt;
 }
 assert.equal((await f.close()).cleanup.state,'confirmed');
 assert.equal(f.ledger.size,0);
});
