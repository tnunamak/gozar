import assert from 'node:assert/strict';
import {lstat, mkdtemp, readFile, realpath, rmdir, unlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {allocateRuntimeSocket, resolveRuntimeSocket} from '../../packages/gozar-node/runtime-sockets.mjs';

test('private fixture descriptor agrees with independently observed listener metadata', {skip: !process.getuid}, async t => {
 const parent=await mkdtemp(join(await realpath('/tmp'),'gz-dv-'));
 const marker=join(parent,'synthetic-marker');
 let endpoint;
 t.after(async()=>{
  // This is fixture teardown only; it is not evidence for lifecycle cleanup.
  if(endpoint)await endpoint.close();
  await unlink(marker).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await rmdir(parent);
 });
 await writeFile(marker,'synthetic marker');
 endpoint=await allocateRuntimeSocket(parent);
 const descriptor=await endpoint.bind(createServer());
 const root=await lstat(dirname(descriptor.path),{bigint:true});
 const socket=await lstat(descriptor.path,{bigint:true});
 assert.equal(root.isDirectory(),true);
 assert.equal(socket.isSocket(),true);
 assert.equal(root.mode&0o7777n,0o700n);
 assert.equal(socket.mode&0o7777n,0o600n);
 assert.deepEqual(descriptor.root,{dev:String(root.dev),ino:String(root.ino)});
 assert.deepEqual(descriptor.socket,{dev:String(socket.dev),ino:String(socket.ino)});
 assert.deepEqual(await resolveRuntimeSocket({runtimeSocket:descriptor},{}),{kind:'bound',path:descriptor.path});

 const legacyPath=join(parent,'unused-legacy');
 assert.deepEqual(await resolveRuntimeSocket({},{legacyPath}),{kind:'legacy',path:legacyPath});
 for(const invalid of [undefined,null,{...descriptor,version:0},{...descriptor,path:'relative'}]){
  await assert.rejects(resolveRuntimeSocket({runtimeSocket:invalid},{legacyPath}),
   {code:'invalid_input',message:'Invalid runtime socket descriptor'});
 }
 // Only cloned serialized values are varied. The underlying fixture stays unchanged.
 const wrong=value=>String(BigInt(value)+1n);
 for(const field of ['dev','ino']){
  await assert.rejects(resolveRuntimeSocket({runtimeSocket:{...descriptor,
   socket:{...descriptor.socket,[field]:wrong(descriptor.socket[field])}}},{legacyPath}),
   {code:'invalid_input',message:'Runtime socket entry does not match its descriptor'});
 }
 await assert.rejects(resolveRuntimeSocket({runtimeSocket:{...descriptor,
  root:{...descriptor.root,ino:wrong(descriptor.root.ino)}}},{legacyPath}),
  {code:'invalid_input',message:'Runtime socket directory does not match its descriptor'});
 assert.equal(await readFile(marker,'utf8'),'synthetic marker');
 assert.deepEqual(await resolveRuntimeSocket({runtimeSocket:descriptor},{}),{kind:'bound',path:descriptor.path});
});
