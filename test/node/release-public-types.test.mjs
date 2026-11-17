import test from 'node:test';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkPublicTypes,parseArgs} from '../../scripts/check-public-types.mjs';

async function fixture(t,body){
 const root=await mkdtemp(join(tmpdir(),'public-types-unit-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=join(root,'node_modules','@tnunamak','gozar');await mkdir(pkg,{recursive:true});
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@tnunamak/gozar',type:'module',exports:{'.':{types:'./index.d.ts'},'./testing':{types:'./testing.d.ts'}}}));
 await writeFile(join(pkg,'index.d.ts'),'export {};');await writeFile(join(pkg,'testing.d.ts'),'export {};');
 const compiler=join(root,'compiler');await writeFile(compiler,'#!'+process.execPath+'\n'+body);await chmod(compiler,0o700);
 return {root,pkg,compiler};
}
test('explicit CLI arguments only, no environment or default compiler',()=>{
 assert.throws(()=>parseArgs([]),/installed-root/);
 assert.throws(()=>parseArgs(['--installed-root','relative','--tsc','/compiler']),/absolute/);
 assert.throws(()=>parseArgs(['--installed-root','/prefix','--tsc','/compiler','--unknown']),/Unknown/);
 assert.deepEqual(parseArgs(['--installed-root','/prefix','--tsc','/compiler']),{installedRoot:'/prefix',tsc:'/compiler'});
});
test('missing installation, compiler and testing export fail before compilation',async t=>{
 const f=await fixture(t,'process.exit(99)');
 await assert.rejects(checkPublicTypes({installedRoot:join(f.root,'absent'),tsc:f.compiler}),/installation/);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:join(f.root,'absent')}),/compiler/);
 await writeFile(join(f.pkg,'package.json'),JSON.stringify({exports:{'.':{types:'./index.d.ts'}}}));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/testing/);
});
test('actual child failure preserves diagnostics, strict config and owned cleanup',async t=>{
 // This process fixture is NOT a TypeScript compiler or type qualification.
 const f=await fixture(t,`const fs=require('node:fs');const p=require('node:path');
 const config=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 fs.writeFileSync(p.join(process.cwd(),'..','observed.json'),JSON.stringify({config,args:process.argv.slice(2),source:fs.readFileSync('consumer.ts','utf8')}));
 process.stdout.write('synthetic stdout');process.stderr.write('synthetic TS failure');process.exit(7);`);
 const sentinel=join(f.root,'keep');await writeFile(sentinel,'untouched');
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler});
 assert.equal(result.code,7);assert.equal(result.stdout,'synthetic stdout');assert.equal(result.stderr,'synthetic TS failure');assert.equal(result.timedOut,false);
 const observed=JSON.parse(await readFile(join(f.root,'observed.json'),'utf8'));
 assert.equal(observed.config.compilerOptions.strict,true);assert.equal(observed.config.compilerOptions.skipLibCheck,false);
 assert.deepEqual(observed.config.compilerOptions.types,[]);assert.equal(observed.config.compilerOptions.module,'NodeNext');
 assert.match(observed.source,/@tnunamak\/gozar\/testing/);
 assert.equal(await readFile(sentinel,'utf8'),'untouched');
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('compiler deadline kills and joins child then removes owned project',async t=>{
 const f=await fixture(t,'setInterval(()=>{},1000)');
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler,timeoutMs:100});
 assert.equal(result.timedOut,true);assert.notEqual(result.code,0);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('missing package and source-linked package cannot qualify',async t=>{
 const f=await fixture(t,'process.exit(99)');
 const source=join(f.root,'source');await rename(f.pkg,source);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/installed package/);
 await symlink(source,f.pkg,'dir');
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/materialized/);
});
test('spawn failure also cleans only its owned project',async t=>{
 const f=await fixture(t,'');
 await writeFile(f.compiler,'#!/nonexistent-gozar-unit-interpreter\n');
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/could not start/);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
});
test('escaped declaration export cannot qualify',async t=>{
 const f=await fixture(t,'process.exit(99)');
 await writeFile(join(f.root,'outside.d.ts'),'export {};');
 await writeFile(join(f.pkg,'package.json'),JSON.stringify({exports:{'.':{types:'./../../../outside.d.ts'},'./testing':{types:'./testing.d.ts'}}}));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/escaping/);
});

test('deadline settles even after compiler exit when a detached descendant holds its pipes',{skip:process.platform==='win32'},async t=>{
 const server=createServer();
 let ownedSocket;
 const connected=new Promise(resolve=>server.once('connection',socket=>{ownedSocket=socket;resolve(socket);}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>{ownedSocket?.destroy();return new Promise(resolve=>server.close(resolve));});
 const descendant="const socket=require('node:net').connect("+server.address().port+",'127.0.0.1',()=>process.send({pid:process.pid}));setInterval(()=>{},1000)";
 const f=await fixture(t,`const fs=require('node:fs');const p=require('node:path');const {spawn}=require('node:child_process');
 const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:['ignore',1,2,'ipc']});
 if(child.pid)fs.writeFileSync(p.join(process.cwd(),'..','escaped.json'),JSON.stringify({pid:child.pid}));
 child.once('message',()=>{
  process.stdout.write('compiler exited with inherited pipes');
  child.disconnect();
  process.exit(0);
 });`);
 const sentinel=join(f.root,'keep');await writeFile(sentinel,'untouched');
 let pid,deadline;
 let socketClosed;
 connected.then(socket=>{socketClosed=new Promise(resolve=>socket.once('close',resolve));socket.resume();});
 const pending=checkPublicTypes({installedRoot:f.root,tsc:f.compiler,timeoutMs:1000});
 // Attach rejection handling immediately; the finally block still joins it.
 const settled=pending.then(result=>({result}),error=>({error}));
 try{
  const answer=await Promise.race([
   settled,
   new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('checkPublicTypes did not settle within its outer deadline')),3000);}),
  ]);
  if(answer.error)throw answer.error;
  const result=answer.result;
  assert.equal(result.timedOut,true);
  assert.equal(result.code,0); // exit succeeded; pipe close is a different event.
  assert.equal(result.signal,null);
  assert.equal(result.outputTruncated,true);
  assert.equal(result.descendantCleanup,'unverified');
  assert.match(result.stdout,/compiler exited with inherited pipes/);
  assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
  assert.equal(await readFile(sentinel,'utf8'),'untouched');
  assert.ok(await readFile(f.compiler,'utf8'));
  assert.ok(await readFile(join(f.pkg,'index.d.ts'),'utf8'));
 }finally{
  clearTimeout(deadline);
  // The compiler records only its own child's group leader immediately on spawn.
  // Never enumerate or signal unrelated processes/groups.
  try{({pid}=JSON.parse(await readFile(join(f.root,'escaped.json'),'utf8')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(pid!==undefined){
   assert.ok(Number.isSafeInteger(pid)&&pid>1&&pid!==process.pid);
   try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  // Killing the exact inherited-pipe holder lets even the unfixed check close.
  // Bound cleanup too: never leave the test runner waiting on this regression.
  let cleanupTimer;
  try{
   await Promise.race([Promise.all([settled,...(pid!==undefined?[connected.then(()=>socketClosed)]:[])]),new Promise((_,reject)=>{
    cleanupTimer=setTimeout(()=>reject(new Error('Owned compiler/pipe cleanup could not be confirmed')),2000);
   })]);
  }finally{clearTimeout(cleanupTimer);}
 }
});
