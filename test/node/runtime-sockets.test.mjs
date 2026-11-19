import assert from 'node:assert/strict';
import net from 'node:net';
import {lstat,mkdir,mkdtemp,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {allocateRuntimeSocket,withRuntimeSockets} from '../../packages/gozar-node/runtime-sockets.mjs';
import {connectEmbeddingBroker,startEmbeddingBroker} from '../../packages/gozar-node/embedding-broker.mjs';

const unixOnly={skip:process.platform==='win32'};
async function fixture(t){
 const root=await mkdtemp(join(await realpath('/tmp'),'gz-fixture-'));
 t.after(()=>rm(root,{force:true,recursive:true}));
 return root;
}
const listen=(server,path)=>new Promise((resolve,reject)=>{
 server.once('error',reject);server.listen(path,resolve);
});
const close=server=>new Promise(resolve=>server.close(resolve));
const gone=path=>assert.rejects(lstat(path),{code:'ENOENT'});

test('real resolver uses short distinct endpoints for long and multibyte durable homes',unixOnly,async t=>{
 const root=await fixture(t);
 const runtime=await realpath(join(root,'..'));
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

test('failed isolated bind preserves fixture-owned entries and permits exact empty cleanup',unixOnly,async t=>{
 const root=await fixture(t);
 const endpoint=await allocateRuntimeSocket(root);
 t.after(endpoint.cleanup);
 const existing=net.createServer();
 await listen(existing,endpoint.path);
 try{
  const other=net.createServer();
  await assert.rejects(listen(other,endpoint.path),{code:'EADDRINUSE'});
  const marker=join(dirname(endpoint.path),'unrelated-fixture');
  await writeFile(marker,'keep');
  await endpoint.cleanup();
  assert.equal(await readFile(marker,'utf8'),'keep');
  await gone(join(dirname(endpoint.path),'never-created'));
  await rm(marker);
 }finally{
  await close(existing);
 }
 await endpoint.cleanup();
 await gone(dirname(endpoint.path));
});
