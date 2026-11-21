import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import net from 'node:net';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';
import {stopController} from '../../packages/gozar-node/controller-start.mjs';
import {scratch,query} from './route-schema-check.mjs';

async function sessionFixture(t, {refuseRemoval=false}={}){
 let harness;const resources=new Map();t.after(async()=>{try{await harness?.close();}catch(error){if(!refuseRemoval)throw error;}finally{for(const {child}of resources.values())child.kill();}});
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
  {kind:'spawn',operation:'close',handle:async({handle})=>{if(refuseRemoval)return {closed:false};resources.get(handle)?.child.kill();return {closed:true};}},
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
 const route=await api.expose(request);
 return {harness,api,home,route,request,q,resources,serial:()=>serial};
}

test('harness close disposes only its broker when owned provider removal is unconfirmed',async t=>{
 const other=await sessionFixture(t), home=await scratch(t);
 const registry=await fakeRegistry({dir:join(home,'registry'),id:'broker-debt',kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});
 const harness=await createTestingGozar({manifest:registry.manifest,root:registry.root,
  identity:{instanceId:'debt-fixture-instance',bootId:'debt-fixture-boot'},
  hostCapabilities:{'runtime.attached':{known:true,value:true},'runtime.durable':{known:true,value:true}},effects:[
  {kind:'process-runtime',operation:'open',handle:async()=>({handle:'owned-debt-transport'})},
  {kind:'process-runtime',operation:'read',handle:async()=>({present:true})},
  {kind:'process-runtime',operation:'close',handle:async()=>({closed:false})},
 ]});
 const q=query({home,target:'127.0.0.1:18765',providerId:'broker-debt',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await harness.gozar.catalogRoutes(q)).candidates[0];
 assert.equal(choice.eligible,true,JSON.stringify(choice,(key,value)=>/token|digest/i.test(key)?undefined:value));
 const failure=await harness.gozar.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}}).catch(error=>error);
 const debt={home,harness,route:failure.route};
 assert.equal(debt.route?.cleanup.state,'unconfirmed',`the declared transport refuses removal: ${failure.code} ${failure.message}`);
 try {
 const brokers=async home=>(await readdir(home)).filter(name=>name.startsWith('resolver-')&&name.endsWith('.sock'));
 assert.equal((await brokers(debt.home)).length,1);
 const otherBrokers=await brokers(other.home);assert.equal(otherBrokers.length,1);
 const serverFor=home=>process._getActiveHandles().find(handle=>handle instanceof net.Server&&typeof handle.address()==='string'&&handle.address().startsWith(home+'/resolver-'));
 const debtServer=serverFor(debt.home),otherServer=serverFor(other.home);
 assert.ok(debtServer?.listening);assert.ok(otherServer?.listening);
 const closing=debt.harness.close();
 await assert.rejects(closing,error=>{
   assert.deepEqual(error.route?.handle,debt.route.handle);
   assert.equal(error.route?.cleanup.state,'unconfirmed');
   return true;
 });
 assert.equal(debt.harness.close(),closing);
 assert.deepEqual(await brokers(debt.home),[]);
 assert.equal(debtServer.listening,false,'disposal closes the listening handle, not only its pathname');
 assert.equal(otherServer.listening,true,'a different harness still owns its broker');
 assert.deepEqual(await brokers(other.home),otherBrokers);
 assert.equal((await other.api.closeRoute({home:other.home,handle:other.route.handle,mode:'remove'})).cleanup.state,'confirmed');
 } finally {
  await harness.close().catch(()=>{});
  const control=JSON.parse(await readFile(join(home,'port-18765','control.json'),'utf8').catch(()=>'null'));
  if(control)assert.notEqual((await stopController(control)).state,'unconfirmed');
  await registry.cleanup();
 }
});

test('public process effects preserve the session parser, witnessed proof and exact PID cleanup',async t=>{
 const {api,home,route,request,q,resources,serial}=await sessionFixture(t);
 assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,q.target);assert.ok(route.verification.subject.bootId);assert.equal(route.operationId,q.operationId);
 assert.deepEqual((await api.expose(request)).handle,route.handle);assert.equal(serial(),1);
 const review=await api.reviewRouteConsent({home,handle:route.handle});assert.equal(review.scope.reviewHandle,route.handle.id);assert.deepEqual(review.subject,route.verification.subject);
 assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
 const refreshed=await api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});assert.equal(refreshed.verification.status,'verified');assert.deepEqual(refreshed.handle,route.handle);assert.equal(serial(),1);
 const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');
 for(const {child}of resources.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
 assert.equal((await api.expose(request)).state,'released');assert.equal(serial(),1);
});
