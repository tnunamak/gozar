import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,chmod,readFile,writeFile,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {connectSessionEmbedding} from '../../packages/gozar-node/session-embedding.mjs';
import {startEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

async function bounded(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),5000);
 })]);}finally{clearTimeout(timer);}
}

test('only boolean true enables authenticated session fixture capabilities',async()=>{
 // A short private Unix-socket path; never a user configuration home.
 const root=await mkdtemp('/tmp/gz-opt-');
 await chmod(root,0o700);
 const clients=new Set(),dispatches=[];
 let broker;
 try{
  const home=join(root,'h');await mkdir(home,{mode:0o700});
  const id='fixture-'+randomBytes(8).toString('hex');
  const registry=await fakeRegistry({id,kinds:['session'],reach:'this-device',dir:join(root,'r')});
  const definitionPath=join(registry.root,'providers',id,'definition.json');
  const definition=JSON.parse(await readFile(definitionPath,'utf8'));
  definition.adapter.effectOperations=[{kind:'spawn',operation:'run'}];
  await writeFile(definitionPath,JSON.stringify(definition));
  // Hash only after the real generated definition declares its effect.
  const registryId=await registryIdentity(registry);
  const identity={instanceId:'instance-'+randomBytes(8).toString('hex'),bootId:'boot-'+randomBytes(8).toString('hex')};
  const marker='local-fixture-result';
  broker=await startEmbeddingBroker({home,identity,services:{},onLoss:()=>{},
   dispatchEffect:async request=>{
    dispatches.push(structuredClone(request));
    return {stdout:marker,stderr:'',exitCode:0};
   }});
  const config=(flag,who=identity)=>({adapterId:id,home,embedding:{
   registry,registryId,resolver:broker.descriptor,identity:who,
   consentReview:{consentFactsDigest:'unused-in-capability-test'},...flag,
  }});
  const connect=async configuration=>{
   // Opt-in normalization must not rewrite the caller's saved configuration.
   Object.freeze(configuration.embedding);
   const client=await connectSessionEmbedding(configuration,{onLoss:()=>{}});
   assert.ok(client);clients.add(client);return client;
  };
  for(const [label,flag] of [
   ['omitted',{}],['false',{fixtureEffects:false}],['zero',{fixtureEffects:0}],
   ['one',{fixtureEffects:1}],['empty string',{fixtureEffects:''}],
   ['false text',{fixtureEffects:'false'}],['object',{fixtureEffects:{}}],
   ['array',{fixtureEffects:[]}],
  ]){
   const client=await connect(config(flag));
   try{
    assert.equal(Object.hasOwn(client,'spawnProcess'),false,label);
    assert.equal(Object.hasOwn(client,'fixtureVerifier'),false,label);
    assert.equal(dispatches.length,0,label);
   }finally{client.close();clients.delete(client);}
  }
  for(const who of [null,{...identity,instanceId:'wrong-instance'},{...identity,bootId:'wrong-boot'}]){
   await assert.rejects(connect(config({fixtureEffects:true},who)),{code:'secret_backend_unavailable'});
   assert.equal(dispatches.length,0);
  }
  const client=await connect(config({fixtureEffects:true}));
  try{
   assert.equal(typeof client.spawnProcess,'function');
   assert.equal(typeof client.fixtureVerifier,'function');
   // This facade dispatches an effect over the real authenticated broker. It
   // does not spawn an OS process, expose a route, or execute a provider tool.
   const child=client.spawnProcess('fixture-only-label',[]);
   let stdout='',stderr='';
   const closed=new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
    child.once('error',reject);
    child.once('close',(code)=>resolve(code));
   });
   assert.equal(await bounded(closed,'fixture close'),0);
   assert.equal(stdout,marker);
   assert.equal(stderr,'');
   assert.deepEqual(dispatches,[{kind:'spawn',operation:'run',input:{
    program:'fixture-only-label',args:[],longRunning:false,
   }}]);
  }finally{client.close();clients.delete(client);}
 }finally{
  for(const client of clients)client.close();
  if(broker){
   await bounded(broker.close(),'broker shutdown');
   // Removal is not evidence of socket shutdown: close completed first.
   await assert.rejects(lstat(broker.descriptor.socketPath),{code:'ENOENT'});
  }
  await rm(root,{recursive:true});
 }
});
