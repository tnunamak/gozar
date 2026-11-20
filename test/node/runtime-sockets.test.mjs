import assert from 'node:assert/strict';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {allocateRuntimeSocket,resolveRuntimeSocket,withRuntimeSockets} from '../../packages/gozar-node/runtime-sockets.mjs';
import {connectEmbeddingBroker,startEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';

const unixOnly={skip:process.platform==='win32'};
async function fixture(t){
 const root=await mkdtemp(join(await realpath('/tmp'),'gz-fixture-'));
 t.after(()=>rm(root,{force:true,recursive:true}));
 return root;
}
const gone=path=>assert.rejects(lstat(path),{code:'ENOENT'});

test('real resolver uses short distinct endpoints for long and multibyte durable homes',unixOnly,async t=>{
 const root=await fixture(t);
 const runtime=root;
 const homes=[join(root,'macOS-style-'+'a'.repeat(140)),join(root,'家'.repeat(45))];
 const socketPaths=await Promise.all(homes.map(async(home,index)=>{
  await mkdir(home,{mode:0o700});
  const identity={bootId:'boot-'+index,instanceId:'fixture-'+index};
  const broker=await withRuntimeSockets(runtime,()=>startEmbeddingBroker({home,identity,services:{}}));
  const path=broker.descriptor.socketPath;
  try{
   assert.ok(Buffer.byteLength(path,'utf8')<=103);
   assert.ok(!path.startsWith(home+'/'));
   assert.equal((await lstat(dirname(path))).mode&0o777,0o700);
   const client=await connectEmbeddingBroker({descriptor:broker.descriptor,identity});
   client.close();
   return path;
  }finally{
   await broker.close();
   await gone(dirname(path));
   assert.equal((await lstat(home)).isDirectory(),true);
  }
 }));
 assert.notEqual(socketPaths[0],socketPaths[1]);
});

test('explicit unusable or over-budget parents fail instead of falling back',unixOnly,async t=>{
 const root=await fixture(t);
 const long=join(root,'é'.repeat(50));
 await mkdir(long,{mode:0o700});
 const file=join(root,'not-a-directory');
 await writeFile(file,'fixture');
 const alias=join(root,'alias');
 await symlink(root,alias);
 for(const path of [long,file,alias,'relative']){
  await assert.rejects(allocateRuntimeSocket(path),{code:'invalid_input'});
 }
});

test('public broker startup failure unwinds and retains the original bind error',unixOnly,async t=>{
 const root=await fixture(t);
 const home=join(root,'home');
 await mkdir(home,{mode:0o700});
 const identity={bootId:'startup-fixture',instanceId:'startup-fixture'};
 const primary=Object.assign(new Error('synthetic listen failure'),{code:'EIO'});
 const cleanupFailure=Object.assign(new Error('synthetic cleanup failure'),{code:'EACCES'});
 const rmdir=fs.rmdir;
 let allocated,cleanupCalls=0,shouldFailCleanup=false;
 t.mock.method(net.Server.prototype,'listen',function(path){
  allocated=dirname(path);
  queueMicrotask(()=>this.emit('error',primary));
  return this;
 });
 t.mock.method(fs,'rmdir',async function(path){
  if(path!==allocated)return rmdir(path);
  ++cleanupCalls;
  if(shouldFailCleanup)throw cleanupFailure;
  return rmdir(path);
 });
 syncBuiltinESMExports();
 try{
  const start=()=>withRuntimeSockets(root,()=>startEmbeddingBroker({home,identity,services:{}}));
  await assert.rejects(start(),error=>error===primary);
  assert.equal(cleanupCalls,1);
  await gone(allocated);
  shouldFailCleanup=true;
  await assert.rejects(start(),error=>error===primary);
  assert.equal(cleanupCalls,2);
  assert.deepEqual(await readdir(allocated),[]);
 }finally{
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});

test('empty-endpoint cleanup preserves a substituted directory',unixOnly,async t=>{
 const root=await fixture(t);
 const endpoint=await allocateRuntimeSocket(root);
 const path=dirname(endpoint.path);
 await rename(path,join(root,'retained'));
 await mkdir(path,{mode:0o700});
 await endpoint.cleanup();
 assert.equal((await lstat(path)).isDirectory(),true);
});

test('empty-endpoint cleanup never removes an unexpected entry',unixOnly,async t=>{
 const root=await fixture(t);
 const endpoint=await allocateRuntimeSocket(root);
 const marker=join(dirname(endpoint.path),'fixture-owned');
 await writeFile(marker,'keep');
 await endpoint.cleanup();
 assert.equal(await readFile(marker,'utf8'),'keep');
 await rm(marker);
 await endpoint.cleanup();
 await gone(dirname(endpoint.path));
});

test('uncaptured synthetic endpoint never reports retirement as confirmed',unixOnly,async t=>{
 const root=await fixture(t);
 const endpoint=await allocateRuntimeSocket(root);
 let closeCalls=0;
 class FixtureListener extends EventEmitter{
  listening=false;
  listen(){this.listening=true;this.emit('listening');}
  unref(){}
  close(done){closeCalls++;this.listening=false;done();}
 }
 const server=new FixtureListener();
 // The synthetic listener reports ready but has no endpoint metadata.
 await assert.rejects(endpoint.bind(server),{code:'invalid_input'});
 assert.deepEqual(await endpoint.retire(),{
  state:'unconfirmed',reason:'identity-unavailable',listenerRetired:false,directoryAbsent:false,
 });
 assert.equal(closeCalls,0);
});

test('synthetic verified endpoint retires after a transient close failure',unixOnly,async t=>{
 const root=await fixture(t), endpoint=await allocateRuntimeSocket(root);
 let closeCalls=0;
 class FixtureListener extends EventEmitter{
  listening=false;
  listen(){this.listening=true;this.emit('listening');}
  unref(){}
  close(done){
   if(++closeCalls===1){done(new Error('synthetic close refusal'));return;}
   this.listening=false;done();
  }
 }
 const observe=fs.lstat, changeMode=fs.chmod;
 const stat={uid:BigInt(process.getuid()),mode:0o600n,dev:41n,ino:73n,isSocket:()=>true};
 t.mock.method(fs,'lstat',async (path,...args)=>path===endpoint.path?stat:observe(path,...args));
 t.mock.method(fs,'chmod',async (path,...args)=>{if(path!==endpoint.path)await changeMode(path,...args);});
 syncBuiltinESMExports();
 try {
  const descriptor=await endpoint.bind(new FixtureListener());
  assert.deepEqual(descriptor.socket,{dev:'41',ino:'73'});
  assert.deepEqual(await resolveRuntimeSocket({runtimeSocket:descriptor},{legacyPath:endpoint.path}),{kind:'bound',path:endpoint.path});
  await assert.rejects(resolveRuntimeSocket({runtimeSocket:null},{legacyPath:endpoint.path}),{code:'invalid_input'});
  assert.deepEqual(await resolveRuntimeSocket({},{legacyPath:endpoint.path}),{kind:'legacy',path:endpoint.path});
  assert.deepEqual(await endpoint.retire(),{
   state:'unconfirmed',reason:'server-close-failed',listenerRetired:false,directoryAbsent:false,
  });
  assert.deepEqual(await endpoint.retire(),{state:'confirmed',listenerRetired:true,directoryAbsent:true});
  assert.equal(closeCalls,2);
 }finally{
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});
