import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
async function exercise(t,{partialWrite=false,adoptExisting=false}={}){
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
 const choices=(await api.listProviders({home,owner})).providers.filter(p=>p.availability.durable.state==='available');assert.equal(choices.length,2);
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
  await api.suspendRoute({home,handle:route.handle});
  const resumed=await api.ensureRoute({...q,operationId:undefined});assert.equal(resumed.handle.generation,route.handle.generation+1);
  const afterResume=writes;assert.deepEqual((await api.ensureRoute(request)).handle,resumed.handle);assert.equal(writes,afterResume,'replay reconciles the existing generation without another allocation');
  const recovery=(await api.listRoutes({home,owner})).routes.filter(row=>row.handle.kind==='durable'&&row.handle.id===resumed.handle.id);assert.equal(recovery.length,1);assert.deepEqual(recovery[0].handle,resumed.handle);assert.equal(recovery[0].published,null);
  assert.equal((await api.closeRoute({home,handle:resumed.handle,mode:'remove'})).cleanup.state,'confirmed');
  assert.deepEqual(config,foreign);assert.equal((await api.ensureRoute(request)).state,'released');
 }
 assert.ok(harness.events.some(e=>e.kind==='local-api'&&e.operation==='request'));
}
test('shipped durable modules parse source observations, conditionally write, prove and remove only their rule',t=>exercise(t));
test('known partial durable write stays owned and can be recovered after a failed provider response',t=>exercise(t,{partialWrite:true}));
test('public adoption binds current configuration and proof before claiming an existing rule',t=>exercise(t,{adoptExisting:true}));
