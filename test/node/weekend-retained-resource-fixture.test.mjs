import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import net from 'node:net';
import {createRetainedResourceFixture} from './retained-resource-fixture.mjs';

// Owning adapter-boundary infrastructure validation, NOT public recovery acceptance.
const CHILD = `
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const adapter=(await import(pathToFileURL(process.argv[2]).href)).default;
let prepared;
const ctx={generation:1,operationId:'fixture-operation',assertGeneration:async()=>{}};
process.on('message',async message=>{
 try{
  let value;
  if(message.op==='create'){
   const attempt={id:randomBytes(12).toString('hex'),nonce:randomBytes(32).toString('hex'),deadlineMs:Date.now()+10000,signal:new AbortController().signal};
   prepared=await adapter.prepareProof(ctx,message.request,attempt);
   const plan=await adapter.plan(ctx,message.request);
   const receipt=await adapter.create(ctx,{...plan,effects:[{target:prepared.target}]});
   const proof=await prepared.verify({origin:receipt.origin,receipt,attempt});
   // Only binding metadata crosses IPC, never the challenge nonce.
   value={receipt,proof,preparedTarget:prepared.target,attemptId:attempt.id,deadlineMs:attempt.deadlineMs};
  }else if(message.op==='observe')value=await adapter.observe(ctx,message.request);
  else if(message.op==='remove')value=await adapter.remove(ctx,message.receipt,null);
  else if(message.op==='close'){await prepared?.close();process.send({id:message.id,value:true},()=>process.disconnect());return;}
  else throw new Error('unknown child operation');
  process.send({id:message.id,value});
 }catch{process.send({id:message.id,error:'child fixture operation failed'});}
});
`;
async function start(fixture,children) {
 const script=join(fixture.registry.root,'saved-child.mjs');
 await writeFile(script,CHILD,{mode:0o600});
 const child=fork(script,[fixture.modulePath],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 // Mark errors handled even when setup fails before callers await exit.
 ended.catch(()=>{});
 const entry={child,ended};children.push(entry);let serial=0;
 entry.call=(op,data={})=>new Promise((resolve,reject)=>{
   const id=++serial;
   const done=(error,value)=>{clearTimeout(timer);child.off('message',receive);child.off('close',closed);error?reject(error):resolve(value);};
   const receive=message=>{if(message.id===id)done(message.error?new Error(message.error):null,message.value);};
   const closed=()=>done(new Error('saved child exited before reply'));
   const timer=setTimeout(()=>done(new Error('saved child response deadline')),5000);
   child.on('message',receive);child.once('close',closed);
   child.send({id,op,...data},error=>{if(error)done(new Error('saved child IPC failed'));});
 });
 return entry;
}
async function stop(entry,signal='SIGTERM') {
 if(entry.child.exitCode===null&&entry.child.signalCode===null)entry.child.kill(signal);
 let timer;
 try{return await Promise.race([entry.ended,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('saved child did not exit')),3000);})]);}
 finally{clearTimeout(timer);}
}
async function echo(target) {
 const [host,port]=target.split(':');
 return new Promise((resolve,reject)=>{
  let result='';const socket=net.connect({host,port:Number(port)});
  socket.setTimeout(1000,()=>socket.destroy(new Error('echo deadline')));
  socket.on('error',reject);socket.on('connect',()=>socket.end('ordinary-app'));
  socket.on('data',chunk=>result+=chunk);socket.on('end',()=>{socket.destroy();resolve(result);});
 });
}
async function exercise(wrongNonce) {
 const fixture=await createRetainedResourceFixture(),children=[];let success=false;
 try{
  fixture.controls.wrongNonce(wrongNonce);
  const request={target:fixture.appTarget,origin:null,usage:{kind:'attached'},requirements:{},configurationRef:null};
  const first=await start(fixture,children);
  const created=await first.call('create',{request});
  assert.equal(created.proof.status,wrongNonce?'unverified':'verified');
  assert.equal(created.proof.attemptId,created.attemptId);
  assert.equal(created.proof.endpoint,created.receipt.origin);
  assert.ok(Date.parse(created.proof.validUntil)<=created.deadlineMs);
  assert.ok(await fixture.isListening(created.receipt.origin));
  assert.equal(await echo(fixture.appTarget),'ordinary-app');
  assert.equal(await echo(fixture.foreignTarget),'ordinary-app');
  const ended=await stop(first,'SIGKILL');
  assert.equal(ended.signal,'SIGKILL');
  assert.equal(await fixture.isListening(created.preparedTarget),false,'dead child proof socket must refuse');
  assert.ok(await fixture.isListening(created.receipt.origin),'parent resource survives actual saved child death');
  const next=await start(fixture,children);
  const observed=await next.call('observe',{request});
  assert.equal(observed.present,true,'fresh module must observe parent, not its empty Map');
  assert.equal(observed.identity,created.receipt.identity);
  for(const receipt of [{...created.receipt,generation:2},{...created.receipt,identity:'foreign'},{...created.receipt,adapterId:'foreign'},{...created.receipt,origin:'tcp://127.0.0.1:1'}]){
   assert.equal((await next.call('remove',{receipt})).removed,false);
   assert.ok(await fixture.isListening(created.receipt.origin));
  }
  fixture.controls.refuseRemoval(true);
  for(let i=0;i<2;i++){
   assert.equal((await next.call('remove',{receipt:created.receipt})).removed,false);
   assert.equal((await next.call('observe',{request})).present,true);
   assert.ok(await fixture.isListening(created.receipt.origin));
  }
  assert.equal(fixture.observations().physicalRemovals,0);
  fixture.controls.refuseRemoval(false);
  assert.equal((await next.call('remove',{receipt:created.receipt})).removed,true);
  assert.equal((await next.call('observe',{request})).present,false);
  assert.equal(await fixture.isListening(created.receipt.origin),false,'kernel refusal, not counter-only evidence');
  const observations=fixture.observations();
  assert.equal(observations.allocations,1,'reload/retry never allocates again');
  assert.equal(observations.physicalRemovals,1);
  assert.equal(observations.attemptedRemovals,7);
  assert.equal(await echo(fixture.appTarget),'ordinary-app');
  assert.equal(await echo(fixture.foreignTarget),'ordinary-app');
  await next.call('close');let exitTimer;
  try{assert.equal((await Promise.race([next.ended,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(new Error('fresh child shutdown deadline')),3000);})])).code,0);}
  finally{clearTimeout(exitTimer);}
  success=true;
 }finally{
  // Never delete evidence or close the provider behind a still-running owned child.
  for(const entry of children)await stop(entry);
  await fixture.close({preserveEvidence:!success});
 }
}
test('parent-owned resource survives controller death; exact fresh-module cleanup closes it',()=>exercise(false));
test('wrong nonce remains unverified despite live parent resource',()=>exercise(true));
