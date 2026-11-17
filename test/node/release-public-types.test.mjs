import test from 'node:test';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,chmod,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {checkPublicTypes,parseArgs} from '../../scripts/check-public-types.mjs';

async function fixture(t,body,{retain=()=>false}={}){
 const root=await mkdtemp(join(tmpdir(),'public-types-unit-'));
 t.after(()=>retain()?undefined:rm(root,{recursive:true,force:true}));
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
test('compiler output flood is capped, stops the child group and still cleans up',async t=>{
 const f=await fixture(t,`process.stdout.write('x'.repeat(5_000_000));setInterval(()=>{},1000)`);
 const started=Date.now();
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler,outputCapBytes:4096});
 assert.equal(result.overflow,true);assert.ok(Buffer.byteLength(result.stdout)<=4096);assert.ok(Date.now()-started<20000);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler,outputCapBytes:0}),/output cap/);
});
test('a link at any depth inside the installed package cannot qualify, dependency typings may be linked',async t=>{
 const f=await fixture(t,'process.exit(0)');
 const source=join(f.root,'source-internal.d.ts');await writeFile(source,'export declare const leak:never;');
 await mkdir(join(f.pkg,'dist','deep'),{recursive:true});
 await symlink(source,join(f.pkg,'dist','deep','internal.d.ts'));
 await assert.rejects(checkPublicTypes({installedRoot:f.root,tsc:f.compiler}),/Source-linked installed package member: dist\/deep\/internal\.d\.ts/);
 assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
 await rm(join(f.pkg,'dist'),{recursive:true});
 // An ordinary installed dependency may be linked (package-manager layout); it is not owned-package source.
 const dependency=join(f.root,'store','left-pad');await mkdir(dependency,{recursive:true});await writeFile(join(dependency,'index.d.ts'),'export {};');
 await symlink(dependency,join(f.root,'node_modules','left-pad'),'dir');
 const ok=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler});
 assert.equal(ok.code,0);assert.equal(ok.overflow,false);
});

// This watchdog bounds the harness, not the compiler behavior being exercised.
async function bounded(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label)),30000);
 })]);}finally{clearTimeout(timer);}
}
async function openPipeScenario(t,preconnectionError=null){
 const server=createServer();
 let ownedSocket,socketClosed,retain=true,compilerChild,fireDeadline,cancelled=false;
 let observeExit;
 const exited=new Promise(resolve=>{observeExit=resolve;});
 const connected=new Promise(resolve=>server.once('connection',socket=>{
  ownedSocket=socket;socketClosed=new Promise(resolve=>socket.once('close',resolve));
  socket.resume();resolve(socket);
 }));
 await bounded(new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}),
  'Owned server did not start');
 t.after(async()=>{
  ownedSocket?.destroy();
  await bounded(new Promise(resolve=>server.close(resolve)),'Owned server did not close');
 });
 // Record a lifetime identity before releasing the child. The negative case never
 // connects, but holds the same real inherited pipes.
 const descendant="process.once('message',()=>{"+
  (preconnectionError?"process.send({ready:true});":
   "require('node:net').connect("+server.address().port+",'127.0.0.1',()=>process.send({ready:true}));")+
  "});setInterval(()=>{},1000)";
 const identityUrl=new URL('../../packages/gozar-node/process-identity.mjs',import.meta.url).href;
 const body=[
  "const fs=require('node:fs');const p=require('node:path');const {spawn}=require('node:child_process');",
  "(async()=>{",
  "const {processIdentity}=await import("+JSON.stringify(identityUrl)+");",
  "const child=spawn(process.execPath,['-e',"+JSON.stringify(descendant)+"],{detached:true,stdio:['ignore',1,2,'ipc']});",
  "child.once('message',()=>{process.stdout.write('compiler exited with inherited pipes');child.disconnect();process.exit(0);});",
  "const identity=await processIdentity(child.pid);",
  "if(!identity)throw new Error('Owned descendant has no readable lifetime identity');",
  "fs.writeFileSync(p.join(process.cwd(),'..','escaped.json'),JSON.stringify({pid:child.pid,identity}));",
  "child.send('start');",
  "})().catch(error=>{console.error(error);process.exit(1);});",
 ].join('\n');
 const f=await fixture(t,body,{retain:()=>retain});
 const sentinel=join(f.root,'keep');await writeFile(sentinel,'untouched');
 const before=await Promise.all([readFile(sentinel),readFile(f.compiler),readFile(join(f.pkg,'package.json')),
  readFile(join(f.pkg,'index.d.ts')),readFile(join(f.pkg,'testing.d.ts'))]);
 const pending=checkPublicTypes({installedRoot:f.root,tsc:f.compiler,
  scheduleCompilerDeadline:(fire,ms,child)=>{
   assert.equal(ms,30000,'the production timeout value is unchanged');
   compilerChild=child;
   child.once('exit',(code,signal)=>observeExit({code,signal}));
   fireDeadline=()=>{if(!cancelled)fire();};
   return ()=>{cancelled=true;};
  }});
 const settled=pending.then(result=>({result}),error=>({error}));
 let failure,cleanupExpired=false;
 try{
  const exit=await bounded(exited,'Compiler did not exit during setup');
  assert.deepEqual(exit,{code:0,signal:null});
  if(preconnectionError)throw preconnectionError;
  await bounded(connected,'Owned descendant did not connect');
  assert.equal(ownedSocket.destroyed,false,'the inherited-pipe holder is still connected');
  // Only now fire the compiler deadline: no startup-speed race.
  fireDeadline();
  const answer=await bounded(settled,'Compiler check did not settle after the controlled deadline');
  if(answer.error)throw answer.error;
  const result=answer.result;
  assert.equal(result.timedOut,true);
  assert.equal(result.code,0);
  assert.equal(result.signal,null);
  assert.equal(result.outputTruncated,true);
  assert.equal(result.descendantCleanup,'unverified');
  assert.match(result.stdout,/compiler exited with inherited pipes/);
  assert.equal((await readdir(f.root)).some(x=>x.startsWith('.gozar-public-types-')),false);
  assert.deepEqual(await Promise.all([readFile(sentinel),readFile(f.compiler),readFile(join(f.pkg,'package.json')),
   readFile(join(f.pkg,'index.d.ts')),readFile(join(f.pkg,'testing.d.ts'))]),before);
 }catch(error){failure=error;}
 finally{
  try{
   await bounded((async()=>{
    // Stop the owned compiler independently even when descendant evidence is missing.
    if(compilerChild&&compilerChild.exitCode===null&&compilerChild.signalCode===null)compilerChild.kill('SIGKILL');
    fireDeadline?.();
    // Retire the exact owned lifetime even if it never connected. Never wait
    // on connected after killing it, and never signal an identity mismatch.
    const {pid,identity}=JSON.parse(await readFile(join(f.root,'escaped.json'),'utf8'));
    assert.ok(Number.isSafeInteger(pid)&&pid>1&&pid!==process.pid);
    assert.equal(typeof identity,'string');assert.ok(identity);
    const actual=await processIdentity(pid);
    if(actual!==null){
     assert.equal(actual,identity,'owned descendant identity changed; retain evidence');
     try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
     const retirementEnds=Date.now()+20000;
     while(true){
      if(cleanupExpired||Date.now()>=retirementEnds)throw new Error('Owned descendant retirement remains uncertain');
      const current=await processIdentity(pid);
      if(current===null)break;
      assert.equal(current,identity,'descendant identity changed during retirement');
      await new Promise(resolve=>setTimeout(resolve,25));
     }
    }
    await settled;
    if(socketClosed)await socketClosed;
    if(cleanupExpired)throw new Error('Cleanup deadline expired; retain evidence');
    retain=false;
   })(),'Owned compiler/pipe cleanup could not be confirmed');
  }catch(error){
   cleanupExpired=true;
   if(failure)failure.cleanupError=error;else failure=error;
  }
 }
 if(failure)throw failure;
}
const identityPlatform=process.platform==='linux'||process.platform==='darwin';
test('deadline settles even after compiler exit when a detached descendant holds its pipes',{skip:!identityPlatform},
 t=>openPipeScenario(t));
test('preconnection failure retires the owned pipe holder without waiting for a connection',{skip:!identityPlatform},async t=>{
 const original=new Error('injected failure before descendant connection');
 await assert.rejects(openPipeScenario(t,original),error=>{
  assert.equal(error,original,'cleanup must preserve the original failure');
  assert.equal(error.cleanupError,undefined,'preconnection cleanup must complete independently');
  return true;
 });
});

test('output budget is shared across stdout and stderr and never splits a UTF-8 character',{skip:process.platform==='win32'},async t=>{
 // 3-byte characters, cap 4096 not a multiple of 3, two streams: total raw bytes stay within the one budget.
 const f=await fixture(t,`const c='€'.repeat(100000);process.stdout.write(c);process.stderr.write(c);setInterval(()=>{},1000)`);
 const result=await checkPublicTypes({installedRoot:f.root,tsc:f.compiler,outputCapBytes:4096,timeoutMs:5000});
 assert.equal(result.overflow,true);
 assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=4096);
 assert.equal((result.stdout+result.stderr).includes('�'),false);
});
test('overflow or timeout is a CLI failure even when the compiler exits 0',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,`process.stdout.write('x'.repeat(5000000),()=>process.exit(0))`);
 const run=spawnSync(process.execPath,['scripts/check-public-types.mjs','--installed-root',f.root,'--tsc',f.compiler],{encoding:'utf8'});
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/exceeded the cap/);
});
