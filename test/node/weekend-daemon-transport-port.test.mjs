import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,chmod,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {serve,control} from '../../packages/gozar-node/daemon.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';
import {loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {startEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';
import {currentRouteReview} from '../../packages/gozar-node/route-consent.mjs';

async function bounded(work,label,ms=10000){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);
 })]);}finally{clearTimeout(timer);}
}
async function refuses(port){
 return bounded(new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.once('connect',()=>{socket.destroy();resolve(false);});
  socket.once('error',error=>{socket.destroy();error.code==='ECONNREFUSED'?resolve(true):reject(error);});
  socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('timeout is not listener absence'));});
 }),'listener absence',2000);
}
async function getBody(port){
 return bounded(new Promise((resolve,reject)=>{
  const request=http.get({host:'127.0.0.1',port,path:'/'},response=>{
   let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy(new Error('oversized response'));});
   response.once('end',()=>resolve({status:response.statusCode,body}));
   response.once('error',reject);
  });
  request.once('error',reject);request.setTimeout(2000,()=>request.destroy(new Error('byte exchange timed out')));
 }),'owned byte exchange',3000);
}

// Observe real listener creation/closure, not source text or driver private flags.
// Installed only around serve/start in a serial test after the unrelated app/broker exist.
function observeListeners(){
 const original=net.Server.prototype.listen,records=[];
 net.Server.prototype.listen=function(...args){
  const record={server:this,address:null};records.push(record);
  this.once('listening',()=>{const address=this.address();if(address&&typeof address==='object')record.address={...address};});
  return original.apply(this,args);
 };
 return {records,restore(){net.Server.prototype.listen=original;}};
}

async function fixture(mode,body){
 const root=await mkdtemp('/tmp/gz-native-');await chmod(root,0o700);
 const sockets=new Set(),calls=[],bodyText='foreign-'+randomBytes(8).toString('hex');
 let broker,native,observation,phase='foreign app',original;
 const cleanupErrors=[];
 const app=http.createServer((_request,response)=>response.end(bodyText));
 app.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 try{
  await bounded(new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);}),phase);
  const appPort=app.address().port;
  const home=join(root,'h');await mkdir(home,{mode:0o700});
  const directory=join(home,'port-'+appPort);await mkdir(directory,{mode:0o700});
  const id='fixture-'+randomBytes(8).toString('hex'),sessionId=randomBytes(8).toString('hex');
  const handle={kind:'session',id:'port-'+appPort+':'+sessionId,generation:1};
  phase='authenticated registry';
  const registry=await fakeRegistry({id,dir:join(root,'r'),kinds:['session'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
  const definitionPath=join(registry.root,'providers',id,'definition.json');
  const definition=JSON.parse(await readFile(definitionPath,'utf8'));
  definition.adapter.effectOperations=mode==='missing-declaration'
   ?[{kind:'spawn',operation:'run'}]:[{kind:'local-forwarder',operation:'authorize'}];
  await writeFile(definitionPath,JSON.stringify(definition));
  const registryId=await registryIdentity(registry);
  const adapter=(await loadAdapters(registry)).find(row=>row.id===id);assert.ok(adapter);
  const identity={instanceId:'instance-'+randomBytes(8).toString('hex'),bootId:'boot-'+randomBytes(8).toString('hex')};
  const services=await createEmbeddingServices({registryId,identity});
  const request={schemaVersion:1,home,owner:'native-transport-owner',target:'127.0.0.1:'+appPort,
   usage:{kind:'session',lifetimeMs:60000},
   requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const dispatchEffect=async incoming=>{
   calls.push(structuredClone(incoming));
   assert.equal(incoming.kind,'local-forwarder');assert.equal(incoming.operation,'authorize');
   const input=incoming.input;
   assert.deepEqual(Object.keys(input).sort(),['sessionId','generation','selectedAddress','targetHost','targetPort','nowMs'].sort());
   assert.equal(input.sessionId,sessionId);assert.ok(Number.isSafeInteger(input.generation)&&input.generation>=1);
   assert.equal(input.selectedAddress,'192.0.2.55');assert.equal(input.targetHost,'127.0.0.1');
   assert.ok(Number.isSafeInteger(input.targetPort)&&input.targetPort>0);
   assert.notEqual(input.targetPort,appPort,'driver forwards to actual owned proof gate');
   assert.ok(Number.isSafeInteger(input.nowMs));
   return {...input,fixture:true,authorityRef:'SYNTHETIC-ONLY',firewallApproved:true,
    interfaces:{fixture0:[{address:input.selectedAddress,internal:false}]},
    observedAtMs:input.nowMs,expiresAtMs:mode==='stale'?input.nowMs-1:input.nowMs+5000};
  };
  const {review}=await currentRouteReview(request,adapter,{embeddingServices:services,registryId,platform:process.platform,dispatchEffect});
  broker=await startEmbeddingBroker({services,home,identity,...(mode==='missing-mapping'?{}:{dispatchEffect})});
  const descriptor=await broker.registerController({identity});
  const plan=JSON.parse(await readFile(new URL('../../adapters/lan.definition.json',import.meta.url),'utf8')).definition;
  plan.id=id; // Keep the complete admitted plan, only bind its fixture registry identity.
  assert.equal(plan.planVersion,1);assert.equal(plan.recipes.create.kind,'local-forwarder');
  const config={home,owner:request.owner,sessionId,targetPort:appPort,adapterId:id,adapters:[plan],
   requirements:{clientReach:'lan',https:false,sse:false,streamableHttp:false,oauthDcr:false},
   bindAddresses:['192.0.2.55'],firewallApproved:true,lifetimeMs:60000,
   consent:false,approveOrigin:false,operational:true,probeWaitMs:500,
   embedding:{registry,resolver:descriptor,identity,registryId,request,consentReview:review,handle,fixtureEffects:true}};
  await writeFile(join(directory,'bootstrap.json'),JSON.stringify(config),{mode:0o600});
  phase='serve real-core initialization';
  observation=observeListeners();
  if(mode!=='valid'){
   let failure;
   try{native=await bounded(serve(directory),phase);}catch(error){failure=error;}
   assert.ok(failure,'invalid fixture authority must reject initialization');
   if(mode!=='stale')assert.equal(failure.code,'unsupported');
   else assert.match(failure.message,/authority.*stale|stale.*authority/);
   assert.equal(calls.length,mode==='stale'?1:0,'declaration/mapping absence is not an authorized callback');
   const tcp=observation.records.filter(record=>record.address);
   assert.equal(tcp.length,1,'only the earlier proof gate may bind; no provider fallback');
   for(const record of tcp){
    assert.equal(record.address.address,'127.0.0.1');
    assert.equal(record.server.listening,false,'initialization failure closes proof gate');
    assert.equal(await refuses(record.address.port),true);
   }
   assert.equal((await getBody(appPort)).body,bodyText);
  }else{
   native=await bounded(serve(directory),phase);
   assert.equal(native.controller.sessionId,sessionId,'initial config must bind actual native session identity');
   assert.ok(native.controller.driver.fixtureLocalTransport,'authenticated port reaches actual controller driver');
   phase='real core allocation';
   // Unavailable peer proof stays unverified; this test does not manufacture a receipt.
   await bounded(native.controller.command({type:'start',adapterId:id,consent:true}),phase);
   const driver=native.controller.driver;
   assert.equal(driver.forwarders.size,0,'no real-interface/native fallback');
   assert.equal(driver.fixtureForwarders.size,1);
   const [resourceId,listener]=[...driver.fixtureForwarders][0];
   const resource=driver.journal.value.owned[resourceId];
   assert.equal(resource.syntheticTransport.fixture,true);
   assert.equal(resource.syntheticTransport.bindAddress,'127.0.0.1');
   assert.equal(listener.address().address,'127.0.0.1');
   assert.equal(listener.address().port,resource.syntheticTransport.port);
   assert.ok(calls.length>=2,'host preparation and allocation both reauthorize');
   phase='actual forwarder bytes';
   assert.deepEqual(await getBody(listener.address().port),{status:200,body:bodyText});
   assert.equal((await getBody(appPort)).body,bodyText);
   const count=calls.length;
   phase='authenticated consent review';
   await bounded(control(directory,{type:'review-consent'}),phase);
   await assert.rejects(driver.fixtureSelection(driver.generation),{code:'consent_mismatch'});
   assert.equal(calls.length,count,'review rejection must not dispatch another callback');
   await body?.({native,broker,driver,resource,appPort,bodyText});
   const port=listener.address().port;
   phase='actual native cleanup';
   const stopped=await bounded(native.controller.shutdown(),phase);
   assert.equal(stopped.snapshot.phase,'stopped');
   assert.equal(stopped.localCleanupFailures.length,0);
   assert.equal(await refuses(port),true);
   assert.equal((await getBody(appPort)).body,bodyText,'foreign app survives native cleanup');
  }
 }catch(error){original=new Error('native fixture phase: '+phase,{cause:error});}
 finally{
  observation?.restore();
  if(native){
   try{await bounded(native.terminate(),'native terminate');}catch(error){cleanupErrors.push(error);}
   try{await bounded(native.gate?.close(),'gate close');}catch(error){cleanupErrors.push(error);}
   process.removeListener('SIGTERM',native.terminate);process.removeListener('SIGINT',native.terminate);
  }
  if(broker)try{await bounded(broker.close(),'broker close');}catch(error){cleanupErrors.push(error);}
  for(const socket of sockets)socket.destroy();
  try{await bounded(new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())),'foreign app close');}catch(error){cleanupErrors.push(error);}
  if(!cleanupErrors.length)await rm(root,{recursive:true});
 }
 if(original||cleanupErrors.length)throw new AggregateError([...(original?[original]:[]),...cleanupErrors],'native transport integration/cleanup failed');
}

test('native serve uses authenticated synthetic transport for actual loopback bytes and review fencing',async()=>fixture('valid'));
for(const mode of ['missing-declaration','missing-mapping','stale'])
 test('native serve rejects '+mode+' before provider bind and closes proof gate',async()=>fixture(mode));
