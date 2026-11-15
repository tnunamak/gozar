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
// Process identity, listener refusal and route-resource cleanup are distinct proofs.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const probeListener=path=>new Promise((resolve,reject)=>{
 const socket=net.createConnection(path);let settled=false;
 const finish=(error,present)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(present);};
 const timer=setTimeout(()=>finish(new Error('kernel probe timed out')),250);
 socket.once('connect',()=>finish(null,true));
 socket.once('error',error=>{
  if(['ECONNREFUSED','ENOENT'].includes(error.code))finish(null,false);
  else finish(new Error('kernel probe failed with non-absence error'));
 });
});
const unavailable=async(path,record,phase)=>{
 const deadline=Date.now()+2000;
 for(;;){
  assert.notEqual(await processIdentity(record.pid),record.startIdentity,phase+': recorded controller still present');
  if(!await probeListener(path))return;
  if(Date.now()>=deadline)throw new Error(phase+': control still listening after bounded convergence');
  await sleep(25);
 }
};
const stopOwned=async(record,path,phase)=>{
 assert.ok(record?.startIdentity,phase+': missing owned birth identity');
 const stopped=await stopController(record,{graceMs:1000,killWaitMs:1000,pollMs:25});
 assert.ok(['gone','stopped','killed'].includes(stopped.state),phase+': controller stop '+stopped.state);
 await unavailable(path,record,phase);
};
test('retained startup recovery checkpoints physical removal before fallible reference release',async()=>{
 const home=await mkdtemp(join(tmpdir(),'gr-'));await chmod(home,0o700);
 const fixture=await createRetainedResourceFixture();
 let api,handle,record,directory,done=false,failRelease=true,started=false;
 const errors=[];let phase='setup';
 const capture=(label,error)=>errors.push(new Error(label,{cause:error}));
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
  record=Object.freeze(await json(join(directory,'control.json')));
  assert.ok(record.startIdentity);assert.equal(await processIdentity(record.pid),record.startIdentity);
  const resource=fixture.observations().resources[0];assert.ok(resource);
  assert.equal(await fixture.isListening(resource.receipt.origin),true);
  assert.equal(await fixture.isListening(fixture.foreignTarget),true);
  const beforeReview=await json(join(directory,'state.json'));
  await assert.rejects(api.reviewRouteConsent({home,owner:q.owner,handle}),{code:initial.code});
  await assert.rejects(api.approveRouteConsent({home,owner:q.owner,handle}),{code:initial.code});
  const afterReview=await json(join(directory,'state.json'));
  assert.equal(afterReview.phase,beforeReview.phase);assert.equal(afterReview.lastView.published,null);
  phase='initial owned stop and kernel absence';
  await stopOwned(record,join(directory,'control.sock'),phase);
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
  phase='admitted physical removal and metadata failure';
  fixture.controls.refuseRemoval(false);
  await assert.rejects(api.closeRoute(close),{code:'cleanup_debt'});
  const removed=fixture.observations(),checkpoint=await json(join(directory,'state.json'));
  assert.equal(removed.physicalRemovals,1);assert.equal(await fixture.isListening(resource.receipt.origin),false);
  assert.deepEqual(checkpoint.resourceRemoval.receipt,state.receipt);
  assert.equal(checkpoint.resourceRemoval.removed,true);
  assert.equal(checkpoint.lastView.cleanup.state,'unconfirmed');
  await assert.rejects(commit(),{code:'configuration_in_use'});
  phase='fresh factory metadata retry';
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
 }catch(error){capture('primary: '+phase,error);}
 finally{
  // Only a captured, identity-checked controller may be signalled.
  let controllerSafe=!started;
  if(record){
   try{await stopOwned(record,join(directory,'control.sock'),'finalizer owned stop and kernel absence');controllerSafe=true;}
   catch(error){capture('cleanup controller',error);}
  }else if(started){capture('cleanup controller',new Error('exact controller identity unavailable; retained evidence'));}
  failRelease=false;fixture.controls.refuseRemoval(false);
  if(api&&handle&&controllerSafe){
   try{
    const closed=await api.closeRoute({home,owner:'retained-owner',handle,mode:'remove'});
    assert.equal(closed.cleanup.state,'confirmed','finalizer route cleanup');
   }catch(error){capture('cleanup route and broker obligations',error);}
  }else if(started){capture('cleanup route',new Error('owned route cleanup could not be attempted safely'));}
  if(controllerSafe){
   try{await fixture.close({preserveEvidence:!done||errors.length>0});}
   catch(error){capture('cleanup fixture resources',error);}
  }
  if(done&&errors.length===0){
   try{await rm(home,{recursive:true,force:false});}
   catch(error){capture('cleanup owned root',error);}
  }
 }
 if(errors.length)throw new AggregateError(errors,'retained startup recovery failed; phase-labelled causes retained');
});
