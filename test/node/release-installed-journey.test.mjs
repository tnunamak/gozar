import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
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
test('a runtime dependency refuses before output or subprocess creation',async t=>{
 const f=await fixture(t,{dependencies:{'synthetic-runtime':'1'}});
 const stub=processStub(f);
 await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),/must be standalone/);
 assert.equal(stub.calls.length,0);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
});

test('an archive missing a required example refuses before any subprocess',async t=>{
 const f=await fixture(t),stub=processStub(f);
 delete f.files['examples/provider-lifecycle-fixture.mjs'];
 const bytes=tar(f.files);
 await writeFile(f.input.tarball,bytes);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 await assert.rejects(runInstalledJourney({...f.input,sha256},{run:stub.run}),/Missing installed example examples\/provider-lifecycle-fixture\.mjs/);
 assert.equal(stub.calls.length,0);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
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
test('a synchronous launch failure reports not-started cleanup and the original error',async()=>{
 const error=Object.assign(new Error('synthetic executable missing'),{code:'ENOENT'});
 const result=await runProcess('fixture-only',[],{timeoutMs:1000},{spawnProcess:()=>{throw error;}});
 assert.deepEqual(result.error,{name:'Error',message:'synthetic executable missing',code:'ENOENT'});
 assert.deepEqual(result.cleanup,{scope:'not-started',state:'confirmed'});
 assert.equal(result.status,null);
 assert.equal(result.stdout,'');
});

test('a direct child closed by signal retains the signal and captured diagnostics',async()=>{
 const child=new EventEmitter();
 child.stdout=new EventEmitter();
 child.stderr=new EventEmitter();
 const pending=runProcess('fixture-only',[],{timeoutMs:1000},{spawnProcess:()=>child});
 child.stderr.emit('data',Buffer.from('synthetic diagnostic'));
 child.emit('close',null,'SIGTERM');
 const result=await pending;
 assert.equal(result.status,null);
 assert.equal(result.signal,'SIGTERM');
 assert.equal(result.stderr,'synthetic diagnostic');
 assert.equal(result.timedOut,false);
 assert.equal(result.cleanup.state,'confirmed');
});

test('process error waits for close and retains both pre-error and trailing output',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
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

// Host command: node --test test/node/release-installed-journey.test.mjs
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('runner did not settle')),ms);})]);}
 finally{clearTimeout(timer);}
}
function groupExists(pid){
 try{process.kill(-pid,0);return true;}
 catch(error){if(error.code==='ESRCH')return false;throw error;}
}
async function retireGroup(child){
 if(!child?.pid)return;
 const signal=name=>{try{process.kill(-child.pid,name);}catch(error){if(error.code!=='ESRCH')throw error;}};
 if(groupExists(child.pid))signal('SIGTERM');
 for(let i=0;i<20&&groupExists(child.pid);i++)await delay(25);
 if(groupExists(child.pid))signal('SIGKILL');
 for(let i=0;i<120&&groupExists(child.pid);i++)await delay(25);
 assert.equal(groupExists(child.pid),false,'owned fixture group was not observed gone');
}
for(const mode of ['timeout','overflow'])test('real inherited-pipe descendant is retired on '+mode,
 {skip:process.platform==='win32'},async()=>{
 let child,requestedDetached;
 // The wrapper starts a real subprocess, not a simulated child. Force fixture
 // isolation even against the pre-fix runner so failed assertions can retire it.
 const spawnOwned=(command,args,options)=>{
  requestedDetached=options.detached;return child=spawn(command,args,{...options,detached:true});
 };
 const descendant="process.stdout.write('OWNED_READY\\n');process.send('ready');setInterval(()=>{},1000);";
 const source=`
  const {spawn}=require('node:child_process');
  const descendant=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',process.stdout,process.stderr,'ipc']});
  process.on('SIGTERM',()=>{descendant.kill('SIGTERM');descendant.once('close',()=>process.exit(0));});
  descendant.once('message',()=>{${mode==='overflow'?"process.stdout.write(Buffer.alloc(20*1024*1024,120));":""}});
  setInterval(()=>{},1000);
 `;
 try{
  const result=await bounded(runProcess(process.execPath,['-e',source],{timeoutMs:1500},{spawnProcess:spawnOwned}),5000);
  assert.equal(requestedDetached,true);
  assert.ok(result.stdout.startsWith('OWNED_READY\n'));
  assert.equal(result[mode==='timeout'?'timedOut':'overflow'],true);
  assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=16*1024*1024);
  assert.equal(result.cleanup.scope,'process-group');
  assert.equal(result.cleanup.state,'confirmed');
  assert.equal(groupExists(child.pid),false);
 }finally{await retireGroup(child);}
});
test('real subprocess preserves UTF-8 split across separate stdout and stderr writes',async()=>{
 const source=`
  const out=Buffer.from('A€😀Z'),err=Buffer.from('é界');
  let i=0;
  const timer=setInterval(()=>{
   if(i<out.length)process.stdout.write(out.subarray(i,i+1));
   if(i<err.length)process.stderr.write(err.subarray(i,i+1));
   if(++i>=out.length)clearInterval(timer);
  },30);
 `;
 let child;
 const spawnOwned=(command,args,options)=>(child=spawn(command,args,{...options,detached:process.platform!=='win32'}));
 try{
  const result=await bounded(runProcess(process.execPath,['-e',source],{timeoutMs:3000},{spawnProcess:spawnOwned}),5000);
  assert.equal(result.status,0);assert.equal(result.stdout,'A€😀Z');assert.equal(result.stderr,'é界');
  assert.equal(result.timedOut,false);assert.equal(result.overflow,false);
 }finally{
  if(process.platform!=='win32')await retireGroup(child);
  else if(child&&child.exitCode===null&&child.signalCode===null){
   const closed=new Promise(resolve=>child.once('close',resolve));
   child.kill('SIGKILL');await bounded(closed,3000);
  }
 }
});
test('missing close is bounded and explicitly retains uncertain cleanup',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true;
 const result=await bounded(runProcess('fixture',[],{timeoutMs:10},{spawnProcess:()=>child}),3000);
 assert.equal(result.timedOut,true);assert.equal(result.drainTimedOut,true);
 assert.equal(result.cleanup.state,'unconfirmed');assert.equal(result.status,null);
});
test('uncertain cleanup cannot become a successful installed step',async t=>{
 const f=await fixture(t);
 const result={status:0,signal:null,stdout:'partial',stderr:'',cleanup:{state:'unconfirmed',scope:'process-group'}};
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>result}),/subprocess failed/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');assert.deepEqual(report.failure.result,result);
});

test('pack receipt rejects an array with more than one package receipt',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 const first={filename:'tnunamak-gozar-1.2.3.tgz',name:'@tnunamak/gozar',version:'1.2.3'};
 assert.deepEqual(parsePackOutput(JSON.stringify([first])),first);
 assert.throws(
  ()=>parsePackOutput(JSON.stringify([first,{...first,filename:'tnunamak-gozar-1.2.4.tgz',version:'1.2.4'}])),
  {message:'Unknown or ambiguous npm pack output'}
 );
});

test('pack receipt rejects a single package with the wrong package identity',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 const entry={filename:'sample-widget-1.2.3.tgz',name:'@sample/widget',version:'1.2.3'};
 assert.throws(
  ()=>parsePackOutput(JSON.stringify([entry])),
  {message:'Unknown or ambiguous npm pack output'}
 );
});
