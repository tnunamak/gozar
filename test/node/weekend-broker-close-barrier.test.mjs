import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm,unlink,mkdir,rmdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startEmbeddingBroker,connectEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';

// Real authenticated Unix transport; no fake lifecycle method or resolver.
// Explicit identity bypasses services.resolveIdentity. Ping needs no service.
const identity={instanceId:'close-fixture',bootId:'close-boot'};
async function bounded(work){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error('broker close fixture timed out')),3000);
 })]);}finally{clearTimeout(timer);}
}
async function refusesConnection(socketPath){
 await bounded(new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath);
  socket.once('connect',()=>{socket.destroy();reject(new Error('listener remained available'));});
  socket.once('error',()=>{socket.destroy();resolve();});
 }));
}
test('creator close shares completion and removes real broker transport',async()=>{
 const home=await mkdtemp(join(process.env.DOT_BRIDGE_TEST_TMP??tmpdir(),'broker-close-'));
 let broker,client;let losses=0,closed=false;
 try{
  broker=await startEmbeddingBroker({services:{},home,identity,onLoss:()=>{losses++;}});
  client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});
  await assert.rejects(client.dispatchEffect({}),{code:'unsupported'});
  const first=broker.close(),second=broker.close();
  assert.strictEqual(second,first,'concurrent closes share finalization');
  await bounded(first);closed=true;
  assert.equal(losses,1);
  await assert.rejects(lstat(broker.descriptor.socketPath),{code:'ENOENT'});
  await assert.rejects(bounded(client.dispatchEffect({})),{code:'secret_backend_unavailable'});
  await refusesConnection(broker.descriptor.socketPath);
  await bounded(broker.close());assert.equal(losses,1);
 }finally{
  client?.close();
  if(broker&&!closed){await bounded(broker.close());closed=true;}
  if(!broker||closed)await rm(home,{recursive:true,force:true});
 }
});
test('failed owned-socket finalization stays rejected until obstruction is removed',async()=>{
 const home=await mkdtemp(join(process.env.DOT_BRIDGE_TEST_TMP??tmpdir(),'broker-retry-'));
 let broker,client,obstruction=false,closed=false;let losses=0;
 try{
  broker=await startEmbeddingBroker({services:{},home,identity,onLoss:()=>{losses++;}});
  client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});
  // Only replace our exact owned socket pathname. Never delete a foreign entry.
  await unlink(broker.descriptor.socketPath);
  await mkdir(broker.descriptor.socketPath);obstruction=true;
  const first=broker.close(),second=broker.close();
  assert.strictEqual(second,first);
  const error=await bounded(first.then(()=>null,e=>e));
  assert.ok(error,'directory obstruction must reject finalization');
  assert.ok(['EISDIR','EPERM'].includes(error.code),'unlink must reject directory obstruction');
  assert.equal((await lstat(broker.descriptor.socketPath)).isDirectory(),true);
  assert.equal(losses,0,'loss finalization is not notified before successful cleanup');
  await assert.rejects(bounded(client.dispatchEffect({})),{code:'secret_backend_unavailable'});
  await refusesConnection(broker.descriptor.socketPath);
  await assert.rejects(broker.registerController(),{code:'secret_backend_unavailable'});
  const repeated=await bounded(broker.close().then(()=>null,e=>e));
  assert.ok(repeated,'repeated rejected cleanup cannot become success');
  assert.equal(repeated.code,error.code);
  assert.equal(losses,0);
  await rmdir(broker.descriptor.socketPath);obstruction=false;
  await bounded(broker.close());closed=true;
  assert.equal(losses,1);
  await assert.rejects(lstat(broker.descriptor.socketPath),{code:'ENOENT'});
  await refusesConnection(broker.descriptor.socketPath);
  await bounded(broker.close());assert.equal(losses,1);
 }finally{
  client?.close();
  if(obstruction){await rmdir(broker.descriptor.socketPath);obstruction=false;}
  if(broker&&!closed){await bounded(broker.close());closed=true;}
  if(!broker||closed)await rm(home,{recursive:true,force:true});
 }
});
