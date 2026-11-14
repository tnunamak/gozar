import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
async function exercise(t,transport,{buffered=false,processRuntime=false,denyCode,retainOnClose=false}={}){
 let harness;t.after(()=>harness?.close());
 const home=await scratch(t),owner='fixture-owner',ledger=new Map();let serial=0,allowClose=!retainOnClose;
 const effects=[
  {kind:'process-runtime',operation:'detect',handle:async()=>({available:true})},
  {kind:'process-runtime',operation:'open',handle:async input=>{const handle=`process-${++serial}`;ledger.set(handle,{url:input.origin,target:input.target});return {handle};}},
  {kind:'process-runtime',operation:'read',handle:async({handle})=>({present:ledger.has(handle)})},
  {kind:'process-runtime',operation:'close',handle:async({handle})=>{ledger.delete(handle);return {closed:true};}},
  {kind:'recipe',operation:'probe',handle:async()=>({ok:false})},
  {kind:'sdk-listener',operation:'detect',handle:async()=>({available:true})},
  {kind:'sdk-listener',operation:'open',handle:async({options})=>{if(denyCode)return {error:{code:denyCode,message:'synthetic-canary'}};const handle=`owned-${++serial}`,url=options.proto==='tls'?`tls://${options.domain}:443`:options.proto==='tcp'?'tcp://isolated.invalid:12345':`https://${options.domain}`;ledger.set(handle,{url,target:options.addr});return {handle,url};}},
  {kind:'sdk-listener',operation:'read',handle:async({handle})=>ledger.has(handle)?{present:true,url:ledger.get(handle).url}:{present:false}},
  {kind:'sdk-listener',operation:'close',handle:async({handle})=>{if(allowClose)ledger.delete(handle);return {closed:true};}},
  {kind:'network',operation:'fetch',handle:async request=>{
    const parsed=new URL(request.url),resource=[...ledger.values()].find(r=>r.url===parsed.origin);assert.ok(resource);
    const response=await fetch('http://'+resource.target+parsed.pathname+parsed.search,{method:request.method,headers:request.headers});
    const chunks=[];let last=Date.now();for await(const chunk of response.body){const at=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:buffered?0:at-last});last=at;}
    return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }},
  {kind:'network',operation:'exchange',handle:async request=>{
   const resource=[...ledger.values()].find(r=>r.url===request.endpoint);assert.ok(resource);
   const target=new URL('tcp://'+resource.target);
   return new Promise((resolve,reject)=>{let bytes=Buffer.alloc(0),certificate;const connected=()=>{if(request.transport==='tls')certificate=new X509Certificate(socket.getPeerCertificate().raw).toString();socket.end(Buffer.from(request.bytes,'base64'));};
    const options={host:target.hostname,port:Number(target.port)};const socket=request.transport==='tls'?tls.connect({...options,rejectUnauthorized:false},connected):net.connect(options,connected);
    socket.setTimeout(2000,()=>socket.destroy(new Error('fixture deadline')));socket.on('data',chunk=>bytes=Buffer.concat([bytes,chunk]));socket.on('error',reject);socket.on('end',()=>resolve({bytes:bytes.toString('base64'),...(certificate?{certificate}:{})}));
   });
  }},
 ];
 harness=await createTestingGozar({effects});const api=harness.gozar;
 const inventory=await api.listProviders({home,owner});const provider=inventory.providers.find(p=>p.transport===transport&&p.availability.attached.state!=='unsupported'&&p.configuration.inputRequirements.some(i=>i.kind==='https-origin')===processRuntime);assert.ok(provider);
 let config=provider.configuration;
 for(const requirement of config.inputRequirements){const action=config.actions.find(a=>a.id===requirement.actionId);let input;
  if(requirement.secret){const {handle}=await api.storeSecret({home,owner,providerId:provider.providerId,inputId:requirement.id,scopeId:config.scopeId,expectedConfigurationRevision:config.revision,bytes:new TextEncoder().encode('synthetic-canary')});input={secretHandle:handle};}else if(requirement.kind==='text'){const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));input={value:String(port)};}else input={value:requirement.kind==='https-origin'?'https://fixture.example.invalid':'fixture.example.invalid'};
  config=(await api.runSetupAction({home,owner,providerId:provider.providerId,expectedConfigurationRevision:config.revision,actionId:action.id,...input,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
 }
 const q=query({home,owner,operationId:'journaled-before-call',providerId:provider.providerId,usage:{kind:'attached'},target:'127.0.0.1:1',requirements:{reach:provider.reach,transport,payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const candidate=(await api.catalogRoutes(q)).candidates[0];assert.equal(candidate.eligible,true);assert.ok(candidate.candidateToken);
 assert.equal(candidate.consentFactsDigest,candidate.consent.consentFactsDigest);assert.deepEqual(candidate.consent.scope,candidate.review.canonicalInput.scope);assert.deepEqual(candidate.consent.disclosures,candidate.review.canonicalInput.typedDisclosures);
 const request={...q,wait:'verified',approval:{kind:'route',consentFactsDigest:candidate.consentFactsDigest,candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision}};
 if(denyCode){let error;try{await api.expose(request);}catch(cause){error=cause;}assert.ok(error);const saved=JSON.parse(await readFile(`${home}/attached/${error.route.handle.id}/state.json`,'utf8'));const evidence={phase:saved.phase,cleanup:saved.lastView.cleanup,receipt:saved.receipt!==null,state:saved.lastView.state,reported:error.route.state};t.diagnostic(JSON.stringify(evidence));assert.equal(error.code,'setup_required');assert.equal(error.nextAction.id,config.inputRequirements.find(i=>i.secret).actionId);assert.equal(error.nextAction.consent.scope.kind,'setup');assert.equal(error.route.cleanup.state,'confirmed',JSON.stringify(evidence));assert.doesNotMatch(JSON.stringify(error),/synthetic-canary/);assert.equal(error.cause,undefined);assert.equal(ledger.size,0);return;}
 if(buffered){await assert.rejects(api.expose(request),{code:'verification_failed'});assert.equal(ledger.size,0);return;}
 const route=await api.expose(request);
 assert.equal(route.operationId,q.operationId);
 assert.deepEqual((await api.expose(request)).handle,route.handle);assert.equal(serial,1);
 await assert.rejects(api.expose({...request,target:'127.0.0.1:2'}),{code:'operation_conflict'});assert.equal(serial,1);
 const listed=await api.listRoutes({home,owner});assert.equal(listed.routes.length,1);assert.equal(listed.routes[0].operationId,q.operationId);assert.deepEqual(listed.routes[0].handle,route.handle);
 assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,q.target);assert.equal(ledger.size,1);
 assert.ok(route.facts.some(f=>f.group==='proof'&&f.value?.includes?.('Synthetic provider effects')));
 const before=route.verification.observedAt;
 if(transport!=='https')assert.equal((await api.routeStatus({home,handle:route.handle})).verification.observedAt,before);
 if(transport!=='https'){await assert.rejects(api.reviewRouteConsent({home,handle:route.handle}),{code:'proof_refresh_unsupported'});assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);}
 if(retainOnClose){const uncertain=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(uncertain.cleanup.state,'unconfirmed');assert.equal(uncertain.published,null);assert.ok(uncertain.cleanup.nextAction);assert.equal(ledger.size,1);allowClose=true;}
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');assert.equal(ledger.size,0);
 const replay=await api.expose(request);assert.equal(replay.state,'released',JSON.stringify({state:replay.state,cleanup:replay.cleanup,failure:await readFile(`${home}/attached/${route.handle.id}/failure.json`,'utf8').catch(()=>null)}));assert.equal(serial,1);
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 assert.doesNotMatch(JSON.stringify(harness.events),/synthetic-canary/);
 assert.ok(harness.events.some(e=>e.kind==='network'&&e.operation===(transport==='https'?'fetch':'exchange')));
}
for(const transport of ['https'])test(`public testing harness runs shipped ${transport} adapter through controller and witnessed proof`,t=>exercise(t,transport));
test('public initial streaming proof cannot be bypassed by fresh status while frames are buffered',t=>exercise(t,'https',{buffered:true}));
test('public testing harness runs shipped process adapter through the same generic lifecycle',t=>exercise(t,'https',{processRuntime:true}));
test('a wrong or revoked credential returns its scoped configure action without raw SDK error bytes',t=>exercise(t,'https',{denyCode:'ERR_NGROK_105'}));
test('public close acknowledgement cannot hide a still-present resource and retry uses the retained exact handle',t=>exercise(t,'https',{retainOnClose:true}));
test('shipped non-HTTP choices are detect-only and mint no executable token',async t=>{const home=await scratch(t);const harness=await createTestingGozar({effects:[]});t.after(harness.close);for(const transport of ['tcp','tls']){const catalog=await harness.gozar.catalogRoutes(query({home,usage:{kind:'attached'},requirements:{reach:'internet',transport,payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}}));for(const c of catalog.candidates.filter(c=>c.properties.transport===transport)){assert.equal(c.availability.attached.state,'detect-only');assert.equal(c.candidateToken,null);}}});
