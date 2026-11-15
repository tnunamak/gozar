import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import {mkdtemp,mkdir,chmod,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {connectSessionEmbedding} from '../../packages/gozar-node/session-embedding.mjs';
import {startEmbeddingBroker,connectEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

async function bounded(promise,label,ms=5000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);
 })]);}finally{clearTimeout(timer);}
}
async function refusesConnection(path){
 let socket;
 try{
  await bounded(new Promise((resolve,reject)=>{
   socket=net.createConnection(path);
   socket.once('connect',()=>reject(new Error('broker listener remains live')));
   socket.once('error',resolve);
  }),'listener refusal');
 }finally{socket?.destroy();}
}

if(process.env.GOZAR_INITIALIZATION_CHILD==='1'){
 // Actual module import and process lifetime, not source evaluation or mocks.
 process.once('message',async config=>{
  let code='unexpected_success';
  try{
   const facade=await connectSessionEmbedding(config,{onLoss:()=>{}});
   facade?.close();
  }catch(error){
   code=error?.code==='artifact_integrity_failed'?'artifact_integrity_failed':'unexpected_error';
  }
  // Only the safe result code leaves the child. Never serialize the descriptor.
  process.send(code,()=>{process.disconnect();});
 });
}else{
 test('missing session adapter does not strand an authenticated client',async t=>{
  let root,rootIdentity,broker,client,child,childClosed=false,childDone,started=false,primary;
  const cleanup=[];
  t.after(async()=>{
   // A timeout is already a test failure; killing this exact child is cleanup,
   // never a substitute for the natural-exit assertion.
   if(child&&!childClosed){
    try{
     child.kill('SIGTERM');
     try{await bounded(childDone,'owned child termination');}
     catch{child.kill('SIGKILL');await bounded(childDone,'owned child reap');}
    }catch(error){cleanup.push(error);}
   }
   try{client?.close();}catch(error){cleanup.push(error);}
   let shutdown=!started;
   if(broker){
    try{
     await bounded(broker.close(),'parent broker shutdown');
     await assert.rejects(lstat(broker.descriptor.socketPath),{code:'ENOENT'});
     await refusesConnection(broker.descriptor.socketPath);
     shutdown=true;
    }catch(error){cleanup.push(error);}
   }else if(started)cleanup.push(new Error('broker startup ownership uncertain'));
   if(root&&rootIdentity&&shutdown&&(!child||childClosed)&&!primary&&!cleanup.length){
    try{
     const now=await lstat(root);
     assert.ok(now.isDirectory()&&!now.isSymbolicLink()&&now.dev===rootIdentity.dev&&now.ino===rootIdentity.ino);
     await rm(root,{recursive:true});
    }catch(error){cleanup.push(error);}
   }
   // Retain private root on failure for diagnosis; never print its descriptor.
   if(primary||cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],'session initialization ownership or cleanup failed');
  });
  try{
   root=await mkdtemp('/tmp/gz-init-');await chmod(root,0o700);rootIdentity=await lstat(root);
   const home=join(root,'h');await mkdir(home,{mode:0o700});
   const id='fixture-'+randomBytes(8).toString('hex');
   const registry=await fakeRegistry({id,dir:join(root,'r'),kinds:['session'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
   const registryId=await registryIdentity(registry);
   const identity={instanceId:'instance-'+randomBytes(8).toString('hex'),bootId:'boot-'+randomBytes(8).toString('hex')};
   started=true;
   broker=await startEmbeddingBroker({services:{},home,identity,onLoss:()=>{}});
   const config={adapterId:'absent-'+randomBytes(8).toString('hex'),home,embedding:{
    registry,registryId,resolver:broker.descriptor,identity,fixtureEffects:true,
    consentReview:{consentFactsDigest:'unused-in-initialization-test'},
   }};
   child=fork(fileURLToPath(import.meta.url),[],{
    execArgv:[],env:{...process.env,GOZAR_INITIALIZATION_CHILD:'1'},
    stdio:['ignore','ignore','ignore','ipc'],
   });
   childDone=new Promise(resolve=>child.once('close',(code,signal)=>{childClosed=true;resolve({code,signal});}));
   const message=new Promise((resolve,reject)=>{
    child.once('message',resolve);
    child.once('error',()=>reject(new Error('owned child process failed')));
   });
   // Observe before send so a fast child or spawn failure cannot race the test.
   const result=bounded(message,'child result');result.catch(()=>{});
   await bounded(new Promise((resolve,reject)=>child.send(config,error=>error?reject(new Error('private child input failed')):resolve())),'private child input');
   assert.equal(await result,'artifact_integrity_failed');
   const exit=await bounded(childDone,'natural child exit with live parent broker');
   assert.deepEqual(exit,{code:0,signal:null});
   assert.equal((await lstat(broker.descriptor.socketPath)).isSocket(),true);
   // Authentication performs a real ping; success rules out closing the server.
   client=await bounded(connectEmbeddingBroker({descriptor:broker.descriptor,identity}),'parent authenticated connection');
   await assert.rejects(client.dispatchEffect({}),{code:'unsupported'});
  }catch(error){primary=error;}
 });
}
