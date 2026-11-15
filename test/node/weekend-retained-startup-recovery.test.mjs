import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {stopController} from '../../packages/gozar-node/controller-start.mjs';
import {processIdentity} from '../../packages/gozar-node/journal.mjs';
import {createRetainedResourceFixture} from './retained-resource-fixture.mjs';

const json=async path=>JSON.parse(await readFile(path,'utf8'));
const unavailable=async path=>new Promise((resolve,reject)=>{
 const socket=net.createConnection(path);
 const timer=setTimeout(()=>{socket.destroy();reject(new Error('control refusal timed out'));},1500);
 socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('control still listening'));});
 socket.once('error',()=>{clearTimeout(timer);socket.destroy();resolve();});
});
test('retained startup recovery checkpoints physical removal before fallible reference release',async()=>{
 const home=await mkdtemp(join(tmpdir(),'gr-'));await chmod(home,0o700);
 const fixture=await createRetainedResourceFixture();
 let api,handle,record,directory,done=false,failRelease=true,started=false;
 try{
  const q={schemaVersion:1,home,owner:'retained-owner',target:fixture.appTarget,usage:{kind:'attached'},
   requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const probe=createRouteApi({...fixture.registry});
  const offered=(await probe.catalogRoutes(q)).candidates;assert.equal(offered.length,1);
  const services=createEmbeddingServices({registryId:offered[0].consent.scope.registryId,identity:{instanceId:'retained-instance',bootId:'retained-boot'}});
  const wrapped=new Proxy(services,{get(target,name){
   const value=Reflect.get(target,name);
   if(name==='releaseConfigurationUse')return async request=>{
    if(failRelease&&handle&&JSON.stringify(request.handle)===JSON.stringify(handle))
     throw Object.assign(new Error('selected reference release failed'),{code:'configuration_in_use'});
    return value.call(target,request);
   };
   return typeof value==='function'?value.bind(target):value;
  }});
  const fresh=()=>createRouteApi({...fixture.registry,embeddingServices:wrapped});
  api=fresh();
  const candidates=(await api.catalogRoutes(q)).candidates;assert.equal(candidates.length,1);
  const candidate=candidates[0],granted={};
  for(const [name,value] of Object.entries(candidate)){
   if(['candidateToken','consentFactsDigest'].includes(name))granted[name]=value;
  }
  const approval={kind:'route',...granted,disclosureRevision:candidate.disclosure.revision};
  fixture.controls.wrongNonce(true);fixture.controls.refuseRemoval(true);
  let initial;
  started=true;
  try{const unexpected=await api.expose({...q,wait:'verified',approval});handle=unexpected.handle;}catch(error){initial=error;handle=error.route?.handle;}
  assert.ok(handle,'retain exact handle before assertions or cleanup');
  assert.ok(initial);assert.equal(initial.route.published,null);
  directory=join(home,'attached',handle.id);
  const bootstrap=await json(join(directory,'bootstrap.json')),state=await json(join(directory,'state.json'));
  assert.equal(bootstrap.home,home);assert.equal(bootstrap.owner,q.owner);
  assert.equal(bootstrap.adapterId,state.adapterId);assert.equal(bootstrap.id,handle.id);
  assert.deepEqual(state.handle,handle);
  record=await json(join(directory,'control.json'));
  assert.ok(record.startIdentity);assert.equal(await processIdentity(record.pid),record.startIdentity);
  const resource=fixture.observations().resources[0];assert.ok(resource);
  assert.equal(await fixture.isListening(resource.receipt.origin),true);
  assert.equal(await fixture.isListening(fixture.foreignTarget),true);
  const beforeReview=await json(join(directory,'state.json'));
  await assert.rejects(api.reviewRouteConsent({home,owner:q.owner,handle}),{code:initial.code});
  await assert.rejects(api.approveRouteConsent({home,owner:q.owner,handle}),{code:initial.code});
  const afterReview=await json(join(directory,'state.json'));
  assert.equal(afterReview.phase,beforeReview.phase);assert.equal(afterReview.lastView.published,null);
  const stopped=await stopController(record,{graceMs:1000,killWaitMs:1000,pollMs:25});
  assert.ok(['gone','stopped','killed'].includes(stopped.state));
  assert.notEqual(await processIdentity(record.pid),record.startIdentity);
  await unavailable(join(directory,'control.sock'));
  assert.equal(await fixture.isListening(resource.receipt.origin),true);
  const current=(await api.catalogRoutes(q)).candidates[0];
  const draft=await api.beginConfigurationDraft({home,owner:q.owner,providerId:state.adapterId,expectedConfigurationRevision:current.configuration.revision});
  const commit=()=>api.commitConfigurationDraft({home,owner:q.owner,providerId:state.adapterId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
  await assert.rejects(commit(),{code:'configuration_in_use'});
  // Public close owner is optional; factory must bind only the persisted scope.
  const close={home,handle,mode:'remove'};
  await assert.rejects(api.closeRoute({...close,handle:{...handle,generation:handle.generation+1}}));
  await assert.rejects(api.closeRoute({...close,owner:'foreign-owner'}));
  assert.equal(fixture.observations().physicalRemovals,0);
  fixture.controls.refuseRemoval(false);
  await assert.rejects(api.closeRoute(close),{code:'cleanup_debt'});
  const removed=fixture.observations(),checkpoint=await json(join(directory,'state.json'));
  assert.equal(removed.physicalRemovals,1);assert.equal(await fixture.isListening(resource.receipt.origin),false);
  assert.deepEqual(checkpoint.resourceRemoval.receipt,state.receipt);
  assert.equal(checkpoint.resourceRemoval.removed,true);
  assert.equal(checkpoint.lastView.cleanup.state,'unconfirmed');
  await assert.rejects(commit(),{code:'configuration_in_use'});
  failRelease=false;api=fresh();
  const finished=await api.closeRoute(close);assert.equal(finished.cleanup.state,'confirmed');
  await commit();
  assert.equal((await api.closeRoute(close)).cleanup.state,'confirmed');
  const final=fixture.observations();
  assert.equal(final.allocations,removed.allocations);
  assert.equal(final.attemptedRemovals,removed.attemptedRemovals);
  assert.equal(final.physicalRemovals,1);
  assert.equal(await fixture.isListening(fixture.foreignTarget),true);
  assert.equal(await fixture.isListening(fixture.appTarget),true);
  done=true;
 }finally{
  // No arbitrary PID signalling; retain evidence if exact ownership was not captured.
  if(record){
   const stopped=await stopController(record,{graceMs:1000,killWaitMs:1000,pollMs:25});
   if(!['gone','stopped','killed'].includes(stopped.state))throw new Error('retained controller cleanup uncertain');
  }
  failRelease=false;fixture.controls.refuseRemoval(false);
  if(api&&handle)await api.closeRoute({home,owner:'retained-owner',handle,mode:'remove'}).catch(()=>{done=false;});
  if(record||!started)await fixture.close({preserveEvidence:!done});
  if(done)await rm(home,{recursive:true,force:false});
 }
});
