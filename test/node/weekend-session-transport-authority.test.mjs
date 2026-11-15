import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,chmod,readFile,writeFile,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';
import {loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {startEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';
import {currentRouteReview} from '../../packages/gozar-node/route-consent.mjs';
import {connectSessionEmbedding} from '../../packages/gozar-node/session-embedding.mjs';

async function bounded(work,label){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),5000);
 })]);}finally{clearTimeout(timer);}
}

// Real registry, services, consent review and authenticated IPC. No provider
// create/setup/proof is invoked; the sole host callback returns synthetic data.
async function fixture(options={},body){
 const {declared=true,mapped=true}=options;
 const flag=Object.hasOwn(options,'flag')?options.flag:true;
 const root=await mkdtemp('/tmp/gz-tr-');await chmod(root,0o700);
 let broker,embedding;
 const calls=[];
 let lostResolve;const lost=new Promise(resolve=>{lostResolve=resolve;});
 try{
  const home=join(root,'.tmp');await mkdir(home,{mode:0o700});
  const id='fixture-'+randomBytes(8).toString('hex');
  const registry=await fakeRegistry({id,dir:join(root,'r'),kinds:['session'],
   reach:'this-device',transport:'tcp',proofProtocol:'echo'});
  const definitionPath=join(registry.root,'providers',id,'definition.json');
  const definition=JSON.parse(await readFile(definitionPath,'utf8'));
  definition.adapter.effectOperations=declared
   ?[{kind:'local-forwarder',operation:'authorize'}]
   :[{kind:'spawn',operation:'run'}];
  await writeFile(definitionPath,JSON.stringify(definition));
  const registryId=await registryIdentity(registry);
  const adapter=(await loadAdapters(registry)).find(row=>row.id===id);
  assert.ok(adapter);
  const identity={instanceId:'instance-'+randomBytes(8).toString('hex'),
   bootId:'boot-'+randomBytes(8).toString('hex')};
  const services=await createEmbeddingServices({registryId,identity});
  const request={schemaVersion:1,home,owner:'transport-owner',target:'127.0.0.1:8799',
   usage:{kind:'session',lifetimeMs:60000},
   requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',
    address:'any',setup:'allow',protocols:[]}};
  const input=Object.freeze({sessionId:'fixture-session',generation:1,
   selectedAddress:'192.0.2.10',targetHost:'127.0.0.1',targetPort:8799,nowMs:1000});
  const observation={...input,fixture:true,authorityRef:'SYNTHETIC-ONLY',
   firewallApproved:true,interfaces:[{address:'192.0.2.10',name:'synthetic'}],
   observedAtMs:1000,expiresAtMs:5000};
  const dispatchEffect=async incoming=>{
   calls.push(structuredClone(incoming));
   assert.deepEqual(incoming,{kind:'local-forwarder',operation:'authorize',input});
   return structuredClone(observation);
  };
  const deps={embeddingServices:services,registryId,platform:process.platform,
   ...(flag===true?{dispatchEffect}: {})};
  const {review}=await currentRouteReview(request,adapter,deps);
  broker=await startEmbeddingBroker({services,home,identity,
   ...(mapped?{dispatchEffect}: {})});
  const descriptor=await broker.registerController({identity});
  const config={adapterId:id,home,embedding:{registry,resolver:descriptor,identity,
   registryId,request,consentReview:review,
   handle:{kind:'session',id:'port-8799:fixture',generation:1},
   ...(flag===undefined?{}:{fixtureEffects:flag})}};
  Object.freeze(config.embedding);
  embedding=await connectSessionEmbedding(config,{onLoss:lostResolve});
  assert.ok(embedding);
  assert.equal(calls.length,0,'setup/review must not dispatch authorize');
  await body({embedding,broker,lost,calls,input,observation});
 }finally{
  embedding?.close();
  if(broker){
   await bounded(broker.close(),'broker close');
   await assert.rejects(lstat(broker.descriptor.socketPath),{code:'ENOENT'});
  }
  // Only the private owned root is removed, after actual socket close.
  await rm(root,{recursive:true});
 }
}

test('declared fixture transport preserves authenticated input/output and current consent',async()=>{
 await fixture({},async({embedding,calls,input,observation})=>{
  const port=embedding.fixtureLocalTransport;
  assert.equal(port?.kind,'local-forwarder');
  assert.equal(port?.operation,'authorize');
  for(const context of [undefined,{}, {fixture:false},{fixture:1},{fixture:'true'}]){
   await assert.rejects(port.handle(input,context),{code:'unsupported'});
   assert.equal(calls.length,0);
  }
  const result=await bounded(port.handle(input,{fixture:true}),'authorize');
  assert.deepEqual(result,observation);
  assert.deepEqual(calls,[{kind:'local-forwarder',operation:'authorize',input}]);
  await embedding.review(); // Blocks until a separate, current approval.
  await assert.rejects(port.handle(input,{fixture:true}),{code:'consent_mismatch'});
  assert.equal(calls.length,1,'blocked review prevents the host callback');
 });
});

test('lost broker withdraws fixture port authority before another callback',async()=>{
 await fixture({},async({embedding,broker,lost,calls,input})=>{
  await embedding.fixtureLocalTransport.handle(input,{fixture:true});
  assert.equal(calls.length,1);
  await bounded(broker.close(),'broker loss close');
  await bounded(lost,'client onLoss');
  await assert.rejects(embedding.fixtureLocalTransport.handle(input,{fixture:true}),
   {code:'secret_backend_unavailable'});
  assert.equal(calls.length,1);
 });
});

test('declared port refuses an absent host mapping with no fallback',async()=>{
 await fixture({mapped:false},async({embedding,calls,input})=>{
  assert.ok(embedding.fixtureLocalTransport);
  await assert.rejects(embedding.fixtureLocalTransport.handle(input,{fixture:true}),
   {code:'unsupported'});
  assert.equal(calls.length,0);
 });
});

test('only exact true plus exact declaration exposes the port',async()=>{
 for(const flag of [undefined,false,0,1,'','false',{},[]]){
  // Use an explicit undefined property to exercise the omitted flag.
  await fixture({flag},async({embedding,calls})=>{
   assert.equal(Object.hasOwn(embedding,'fixtureLocalTransport'),false);
   assert.equal(calls.length,0);
  });
 }
 await fixture({declared:false},async({embedding,calls})=>{
  assert.equal(Object.hasOwn(embedding,'fixtureLocalTransport'),false);
  assert.equal(typeof embedding.spawnProcess,'function','ordinary fixture process facade stays');
  assert.equal(calls.length,0);
 });
});
