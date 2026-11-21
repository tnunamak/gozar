import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import {lstat,mkdtemp,readFile,realpath,rm,unlink,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {test} from 'node:test';
import {allocateRuntimeSocket,retryPendingRuntimeSockets} from '../../packages/gozar-node/runtime-sockets.mjs';

const unixOnly={skip:process.platform==='win32'};

async function fixture(t){
 const home=await mkdtemp(join(await realpath('/tmp'),'gz-custody-'));
 const server=net.createServer();
 let endpoint;
 t.after(async()=>{
  // The test alone owns the directory and listener. Never ask the production
  // helper to use an identity it could not prove. Remove the controlled leaf
  // before manual close so close cannot delete a replacement file.
  try{
   if(endpoint)await unlink(endpoint.path).catch(error=>{if(error.code!=='ENOENT')throw error;});
   if(server.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }finally{
   await rm(home,{force:true,recursive:true});
  }
 });
 endpoint=await allocateRuntimeSocket(home);
 return {endpoint,server};
}

test('real listener retirement retains a replaced socket leaf byte for byte',unixOnly,async t=>{
 const {endpoint,server}=await fixture(t);
 await endpoint.bind(server);
 assert.equal((await lstat(endpoint.path)).isSocket(),true);
 await unlink(endpoint.path);
 const sentinel=Buffer.from('plain owned sentinel\n');
 await writeFile(endpoint.path,sentinel,{flag:'wx'});
 const debt={state:'unconfirmed',reason:'entry-mismatch',listenerRetired:false,directoryAbsent:false};
 for(let attempt=0;attempt<2;attempt++){
  assert.deepEqual(await endpoint.retire(),debt);
  assert.equal(server.listening,true);
  assert.deepEqual(await readFile(endpoint.path),sentinel);
 }
});

test('real listener whose endpoint identity was never captured remains unconfirmed',unixOnly,async t=>{
 const {endpoint,server}=await fixture(t);
 const observe=fs.lstat;
 let missed=0;
 t.mock.method(fs,'lstat',async(path,...args)=>{
  if(path===endpoint.path&&missed===0){
   missed++;
   throw Object.assign(new Error('one synthetic metadata miss'),{code:'ENOENT'});
  }
  return observe(path,...args);
 });
 syncBuiltinESMExports();
 try{
  await assert.rejects(endpoint.bind(server),{code:'invalid_input'});
 }finally{
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
 assert.equal(missed,1);
 assert.equal(server.listening,true);
 assert.equal((await lstat(endpoint.path)).isSocket(),true);
 const debt={state:'unconfirmed',reason:'identity-unavailable',listenerRetired:false,directoryAbsent:false};
 assert.deepEqual(await endpoint.retire(),debt);
 assert.deepEqual(await endpoint.retire(),debt);
 const pending=await retryPendingRuntimeSockets();
 assert.ok(pending.some(result=>result.state==='unconfirmed'&&
  result.reason==='identity-unavailable'&&!result.listenerRetired&&!result.directoryAbsent));
 assert.equal(server.listening,true);
 assert.equal((await lstat(endpoint.path)).isSocket(),true);
});
