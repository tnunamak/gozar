import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';

test('public process effects preserve the session parser, witnessed proof and exact PID cleanup',async t=>{
 let harness;const resources=new Map();t.after(async()=>{await harness?.close();for(const {child}of resources.values())child.kill();});
 const home=await scratch(t);let serial=0,target;
 const effects=[
  {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.0',stderr:'',exitCode:0})},
  {kind:'spawn',operation:'run',handle:async input=>{
   if(!input.longRunning)return {stdout:'OpenSSH_9.0',stderr:'',exitCode:0};
   target=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');assert.ok(target);
   const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
   const handle=`fixture-process-${++serial}`;resources.set(handle,{child});return {handle,pid:child.pid,stdout:'https://fixture.lhr.life\n',stderr:'',exitCode:null};
  }},
  {kind:'spawn',operation:'read',handle:async({handle})=>({present:resources.get(handle)?.child.exitCode===null&&resources.get(handle)?.child.signalCode===null})},
  {kind:'spawn',operation:'close',handle:async({handle})=>{resources.get(handle)?.child.kill();return {closed:true};}},
  {kind:'network',operation:'fetch',handle:async request=>{
   assert.ok(target);const url=new URL(request.url);const response=await fetch(`http://${target}${url.pathname}`,{headers:request.headers});
   const chunks=[];let before=Date.now();for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
   return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }},
 ];
 harness=await createTestingGozar({effects});const api=harness.gozar;
 const q=query({home,providerId:'localhost-run',operationId:'session-before-call',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const candidate=(await api.catalogRoutes(q)).candidates[0];assert.equal(candidate.eligible,true);
 const request={...q,wait:'verified',approval:{kind:'route',candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest}};
 const route=await api.expose(request);assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,q.target);assert.ok(route.verification.subject.bootId);assert.equal(route.operationId,q.operationId);
 assert.deepEqual((await api.expose(request)).handle,route.handle);assert.equal(serial,1);
 const review=await api.reviewRouteConsent({home,handle:route.handle});assert.equal(review.scope.reviewHandle,route.handle.id);assert.deepEqual(review.subject,route.verification.subject);
 assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
 const refreshed=await api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});assert.equal(refreshed.verification.status,'verified');assert.deepEqual(refreshed.handle,route.handle);assert.equal(serial,1);
 const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');
 for(const {child}of resources.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
 assert.equal((await api.expose(request)).state,'released');assert.equal(serial,1);
});
