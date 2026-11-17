import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {runInstalledJourney,runProcess} from '../../scripts/release-installed-journey.mjs';

function tar(files){
 const chunks=[];
 for(const [name,body] of Object.entries(files)){
  const bytes=Buffer.from(body),header=Buffer.alloc(512);
  header.write('package/'+name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
  header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);
  header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);
  header.write([...header].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
 }
 return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
async function fixture(t,metadata={}){
 const root=await mkdtemp(join(tmpdir(),'journey-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const files={'package.json':JSON.stringify({name:'@tnunamak/gozar',optionalDependencies:{'optional-test-sdk':'1'},...metadata}),
  'examples/remote-access-screen.mjs':'// screen','examples/provider-lifecycle-fixture.mjs':'// lifecycle'};
 const bytes=tar(files),archive=join(root,'input.tgz');await writeFile(archive,bytes);
 return {root,files,input:{tarball:archive,sha256:createHash('sha256').update(bytes).digest('hex'),
  sourceSha:'a'.repeat(40),outputDirectory:join(root,'out')}};
}
const evidence={fixtureOnly:true,providerId:'fixture-generated',events:['setup','start','proof','stop','cleanup'],
 proof:{status:'verified'},cleanup:{state:'confirmed'},resourceLedger:{ownedAfter:[],foreignPreserved:true},statusPreservedProofTime:true};
function processStub(f,{fault,mutate=false,outcome=evidence}={}){
 const calls=[];
 const run=async(command,args,options)=>{
  calls.push({command,args,options});
  if(fault&&calls.length===fault)return {status:17,signal:null,stdout:'exact stdout',stderr:'exact failure'};
  if(command==='npm'){
   const pkg=join(options.cwd,'node_modules','@tnunamak','gozar');
   for(const [name,body] of Object.entries(f.files)){
    const path=join(pkg,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,body);
   }
   if(mutate)await writeFile(join(pkg,'examples/remote-access-screen.mjs'),'changed');
   return {status:0,stdout:'installed',stderr:''};
  }
  return {status:0,stdout:args.includes('--fakes')?'Remote access\nHost inputs: {}\nChoice: Fixture\n':JSON.stringify(outcome),stderr:''};
 };
 return {run,calls};
}
test('digest refusal starts zero subprocesses',async t=>{
 const f=await fixture(t),stub=processStub(f);
 await assert.rejects(runInstalledJourney({...f.input,sha256:'0'.repeat(64)},{run:stub.run}),/digest/i);
 assert.equal(stub.calls.length,0);
});
test('offline archive journey verifies installed bytes and strict lifecycle evidence',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const result=await runInstalledJourney(f.input,{run:stub.run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 assert.equal(result.status,'passed');assert.equal(result.sha256,f.input.sha256);
 assert.equal(stub.calls.length,3);
 assert.equal(stub.calls[0].command,'npm');
 for(const flag of ['--offline','--ignore-scripts','--omit=optional'])assert.ok(stub.calls[0].args.includes(flag));
 assert.ok(stub.calls[1].args[0].includes('/node_modules/@tnunamak/gozar/examples/'));
 assert.ok(stub.calls[2].args[0].includes('/node_modules/@tnunamak/gozar/examples/'));
 assert.deepEqual(result.lifecycle,evidence);
});
for(const fault of [1,2,3])test('preserves exact subprocess failure '+fault,async t=>{
 const f=await fixture(t),stub=processStub(f,{fault});
 await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),error=>{
  assert.equal(error.result.status,17);assert.equal(error.result.stderr,'exact failure');return true;
 });
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');assert.equal(stub.calls.length,fault);
});
test('changed installed member refuses before consumer execution',async t=>{
 const f=await fixture(t),stub=processStub(f,{mutate:true});
 await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),/installed bytes/i);
 assert.equal(stub.calls.length,1);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
});
for(const outcome of [{...evidence,cleanup:{state:'unconfirmed'}},{...evidence,proof:{status:'unverified'}},{unknown:true}]){
 test('unknown or cleanup-debt outcome fails closed',async t=>{
  const f=await fixture(t),stub=processStub(f,{outcome});
  await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),/outcome/i);
  const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
  t.after(()=>rm(report.scratch,{recursive:true,force:true}));
  assert.deepEqual(report.lifecycle,outcome);assert.equal(report.status,'failed');
 });
}

test('optional SDK presence refuses before examples',async t=>{
 const f=await fixture(t),stub=processStub(f);
 await assert.rejects(runInstalledJourney(f.input,{run:async(command,args,options)=>{
  const result=await stub.run(command,args,options);
  if(command==='npm')await mkdir(join(options.cwd,'node_modules','optional-test-sdk'));
  return result;
 }}),/Optional SDK installed/);
 assert.equal(stub.calls.length,1);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
});

const posixGroups=process.platform==='linux'||process.platform==='darwin';
const absent=pid=>{
 try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('runProcess timeout owns descendants and settles with confirmed cleanup',{skip:!posixGroups,timeout:10000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'journey-process-')),pidFile=join(root,'owned.json');
 let owned,deadline;
 // The parent reaps its child on TERM. Both share the dedicated process group
 // created by runProcess. The descendant inherits the parent's output pipes.
 const program=`
  const {spawn}=require('node:child_process');
  const {writeFileSync}=require('node:fs');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});
  child.once('spawn',()=>writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,child:child.pid})));
  process.on('SIGTERM',()=>{child.once('exit',()=>process.exit(0));child.kill('SIGTERM');});
  setInterval(()=>{},1000);
 `;
 const running=runProcess(process.execPath,['-e',program,pidFile],{timeoutMs:1500});
 try{
  const until=Date.now()+1200;
  while(Date.now()<until){try{owned=JSON.parse(await readFile(pidFile,'utf8'));break;}catch{await pause(20);}}
  assert.ok(Number.isInteger(owned?.parent)&&Number.isInteger(owned?.child),'fixture reports owned PIDs before timeout');
  const result=await Promise.race([running,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('runProcess did not settle')),4000);})]);
  assert.equal(result.timedOut,true);
  assert.ok(result.status!==0||result.signal||result.timedOut);
  assert.equal(result.cleanup.state,'confirmed');
  assert.equal(absent(owned.parent),true);
  assert.equal(absent(owned.child),true);
 }finally{
  clearTimeout(deadline);
  // Never match process names. These PIDs came only from this private fixture.
  if(!owned){try{owned=JSON.parse(await readFile(pidFile,'utf8'));}catch{}}
  if(owned){
   for(const pid of [owned.child,owned.parent]){
    try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
   }
   await pause(100);
   for(const pid of [owned.child,owned.parent]){
    try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
   }
  }
  await rm(root,{recursive:true,force:true});
 }
});
test('runProcess preserves normal output and exit status',async()=>{
 const result=await runProcess(process.execPath,['-e',"process.stdout.write('out');process.stderr.write('err');process.exitCode=7"],{timeoutMs:3000});
 assert.deepEqual(result,{status:7,signal:null,stdout:'out',stderr:'err',timedOut:false,overflow:false});
});

test('runProcess overflow remains bounded and fails closed',{timeout:8000},async()=>{
 const result=await runProcess(process.execPath,['-e',"const b=Buffer.alloc(1024*1024,120);function emit(){if(process.stdout.write(b))setImmediate(emit);else process.stdout.once('drain',emit);}emit();"],{timeoutMs:4000});
 assert.equal(result.overflow,true);
 assert.ok(result.status!==0||result.signal||result.overflow);
 assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=16*1024*1024);
 assert.ok(['confirmed','unconfirmed'].includes(result.cleanup.state));
});

test('runProcess preserves split UTF-8 JSON on stdout and stderr',async()=>{
 const value=JSON.stringify({message:'price € and emoji 🦊'})+'\n';
 const script=`
  const bytes=Buffer.from(${JSON.stringify(value)});
  (async()=>{
   for(const byte of bytes){
    await new Promise(resolve=>process.stdout.write(Buffer.from([byte]),resolve));
    await new Promise(resolve=>process.stderr.write(Buffer.from([byte]),resolve));
    await new Promise(resolve=>setTimeout(resolve,10));
   }
  })().catch(error=>{console.error(error);process.exitCode=1;});
 `;
 const result=await runProcess(process.execPath,['-e',script],{cwd:process.cwd(),env:process.env,timeoutMs:10000});
 assert.equal(result.status,0);assert.equal(result.signal,null);
 assert.equal(result.timedOut,false);assert.equal(result.overflow,false);
 assert.equal(result.stdout,value);assert.equal(result.stderr,value);
 assert.deepEqual(JSON.parse(result.stdout),{message:'price € and emoji 🦊'});
});
for(const extra of [0,1])test('runProcess aggregate byte budget at cap plus '+extra,async()=>{
 const cap=16*1024*1024;
 // Two-byte characters: string length must not substitute for byte length.
 const half='é'.repeat(cap/4);
 const script=`
  const half='é'.repeat(${cap/4});
  (async()=>{
   await new Promise(resolve=>process.stdout.write(half,resolve));
   await new Promise(resolve=>process.stderr.write(half,resolve));
   ${extra ? "process.stderr.write('x');setInterval(()=>{},1000);" : ''}
  })().catch(error=>{console.error(error);process.exitCode=1;});
 `;
 const result=await runProcess(process.execPath,['-e',script],{cwd:process.cwd(),env:process.env,timeoutMs:10000});
 assert.equal(result.timedOut,false);
 assert.equal(result.overflow,extra===1);
 assert.equal(result.stdout,half);assert.equal(result.stderr,half);
 assert.equal(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr),cap);
 if(extra===0){assert.equal(result.status,0);assert.equal(result.signal,null);}
});

test('records optional dependencies and only declared optional peers, including actual ngrok SDK',async t=>{
 const manifest=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 const f=await fixture(t,{peerDependencies:{...manifest.peerDependencies,'required-peer':'1'},peerDependenciesMeta:{...manifest.peerDependenciesMeta,'required-peer':{optional:false},'undeclared-peer':{optional:true}}});
 const result=await runInstalledJourney(f.input,{run:processStub(f).run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 assert.deepEqual(result.optionalDependenciesAbsent,['optional-test-sdk','@ngrok/ngrok']);
 assert.equal(result.sourceShaProvenance,'caller-supplied, not authenticated by archive');
});
for(const nested of [false,true])test('refuses optional ngrok peer at '+(nested?'nested':'root')+' dependency depth',async t=>{
 const f=await fixture(t,{peerDependencies:{'@ngrok/ngrok':'1.7.0'},peerDependenciesMeta:{'@ngrok/ngrok':{optional:true}}}),stub=processStub(f);
 await assert.rejects(runInstalledJourney(f.input,{run:async(...args)=>{
  const result=await stub.run(...args);
  if(args[0]==='npm')await mkdir(join(args[2].cwd,'node_modules',...(nested?['other','node_modules']:[]),'@ngrok','ngrok'),{recursive:true});
  return result;
 }}),/Optional SDK installed/);
 assert.equal(stub.calls.length,1);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');
});
test('process error waits for close and retains both pre-error and trailing output',async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.unref=()=>{};
 let settled=false;
 const pending=runProcess('fixture',[],{timeoutMs:1000},{spawnProcess:()=>child}).then(value=>{settled=true;return value;});
 child.stdout.emit('data','before');child.emit('error',Object.assign(new Error('spawn failed'),{code:'ENOENT'}));
 await Promise.resolve();assert.equal(settled,false);
 child.stdout.emit('data',' after');child.stderr.emit('data','diagnostic');child.emit('close',0,null);
 const result=await pending;
 assert.equal(result.stdout,'before after');assert.equal(result.stderr,'diagnostic');
 assert.deepEqual(result.error,{name:'Error',message:'spawn failed',code:'ENOENT'});
});
test('process error with even zero exit retains a failed step receipt and output files',async t=>{
 const f=await fixture(t);const result={status:0,signal:null,stdout:'partial stdout',stderr:'partial stderr',error:{name:'Error',message:'spawn failed',code:'ENOENT'}};
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>result}),/subprocess failed/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.deepEqual(report.steps[0].result,result);assert.deepEqual(report.failure.result,result);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stdout'),'utf8'),result.stdout);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stderr'),'utf8'),result.stderr);
});
for(const events of [
 ['start','proof','stop','cleanup'],['setup','start','proof','stop'],['setup','proof','start','stop','cleanup'],
 ['setup','start','stop','proof','cleanup'],['setup','start','proof','cleanup','stop'],
 ['setup','start','proof','stop','cleanup','unknown'],['setup','setup','start','proof','stop','cleanup'],
 ['setup,start','proof','stop','cleanup'],
])test('rejects incomplete or unordered phases '+events.join(','),async t=>{
 const f=await fixture(t);
 await assert.rejects(runInstalledJourney(f.input,{run:processStub(f,{outcome:{...evidence,events}}).run}),/outcome/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');
});
test('permits repeated genuine proof phase before stop',async t=>{
 const f=await fixture(t),outcome={...evidence,events:['setup','start','proof','proof','stop','cleanup']};
 const result=await runInstalledJourney(f.input,{run:processStub(f,{outcome}).run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));assert.equal(result.status,'passed');
});
for(const change of [{resourceLedger:{ownedAfter:['owned'],foreignPreserved:true}},{resourceLedger:{ownedAfter:[],foreignPreserved:false}},{statusPreservedProofTime:false}])
test('complete phase labels cannot replace independent ledger and proof-time checks '+JSON.stringify(change),async t=>{
 const f=await fixture(t);
 await assert.rejects(runInstalledJourney(f.input,{run:processStub(f,{outcome:{...evidence,...change}}).run}),/outcome/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));assert.equal(report.status,'failed');
});

test('optional names are deduped and strict optional true excludes required and undeclared peers',async t=>{
 const f=await fixture(t,{optionalDependencies:{'@ngrok/ngrok':'1'},peerDependencies:{'@ngrok/ngrok':'1','required-peer':'1','truthy-peer':'1'},peerDependenciesMeta:{'@ngrok/ngrok':{optional:true},'truthy-peer':{optional:'true'},'undeclared-peer':{optional:true}}});
 const result=await runInstalledJourney(f.input,{run:processStub(f).run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 assert.deepEqual(result.optionalDependenciesAbsent,['@ngrok/ngrok']);
});
for(const failure of [{timedOut:true},{overflow:true},{signal:'SIGTERM'},{cleanup:{state:'unconfirmed',scope:'owned-process-group'}}])
test('zero exit cannot hide process failure '+JSON.stringify(failure),async t=>{
 const f=await fixture(t),result={status:0,signal:null,stdout:'retained out',stderr:'retained err',...failure};
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>result}),/subprocess failed/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');assert.deepEqual(report.failure.result,result);
 assert.deepEqual(report.steps[0].result,result);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stdout'),'utf8'),result.stdout);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stderr'),'utf8'),result.stderr);
});
test('spawn error without close settles after bounded drain with diagnostics',{timeout:5000},async()=>{
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.unref=()=>{};
 const pending=runProcess('fixture',[],{timeoutMs:10000},{spawnProcess:()=>child});
 child.emit('error',Object.assign(new Error('spawn failed'),{code:'ENOENT'}));
 child.stdout.write('late out');child.stderr.write('late err');
 const result=await pending;
 assert.equal(result.error.code,'ENOENT');assert.equal(result.stdout,'late out');assert.equal(result.stderr,'late err');
 assert.equal(result.cleanup.state,'unconfirmed');assert.equal(child.stdout.destroyed,true);assert.equal(child.stderr.destroyed,true);
});
test('observed group absence latches before escalation even while inherited pipes stay open',{skip:!posixGroups,timeout:5000},async()=>{
 const child=new EventEmitter();child.pid=123456789;child.stdout=new PassThrough();child.stderr=new PassThrough();child.unref=()=>{};
 child.kill=()=>assert.fail('must not signal a retired process');
 const original=process.kill,calls=[];
 process.kill=(pid,signal)=>{
  calls.push({pid,signal});
  assert.equal(pid,-child.pid);assert.equal(signal,0,'absence observation must precede all escalation');
  if(calls.length===1)throw Object.assign(new Error('absent'),{code:'ESRCH'});
  return true; // A reused number must not be observed or signalled again.
 };
 try{
  const result=await runProcess('fixture',[],{timeoutMs:10},{spawnProcess:()=>child});
  assert.equal(calls.length,1);assert.equal(result.timedOut,true);
  assert.equal(result.cleanup.state,'unconfirmed','open inherited pipes are not proof of escaped descendant absence');
 }finally{process.kill=original;}
});

test('injected spawn error and late pipes reach the failed journey receipt even after close zero',async t=>{
 const f=await fixture(t);
 const run=(command,args,options)=>runProcess(command,args,options,{spawnProcess:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.unref=()=>{};
  queueMicrotask(()=>{
   child.stdout.write('before ');
   child.emit('error',Object.assign(new Error('synthetic spawn error'),{code:'ENOENT'}));
   child.stdout.write('after');child.stderr.write('trailing diagnostic');
   child.emit('close',0,null);
  });
  return child;
 }});
 await assert.rejects(runInstalledJourney(f.input,{run}),/subprocess failed/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.steps.length,1);assert.equal(report.status,'failed');
 assert.equal(report.steps[0].result.status,0);
 assert.equal(report.steps[0].result.error.code,'ENOENT');
 assert.equal(report.steps[0].result.stdout,'before after');assert.equal(report.steps[0].result.stderr,'trailing diagnostic');
 assert.deepEqual(report.failure.result,report.steps[0].result);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stdout'),'utf8'),'before after');
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stderr'),'utf8'),'trailing diagnostic');
 assert.ok((await readFile(join(report.scratch,'artifact.tgz'))).length>0,'failure keeps original archive evidence');
});
