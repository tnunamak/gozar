import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
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
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'journey-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const files={'package.json':JSON.stringify({name:'@tnunamak/gozar',optionalDependencies:{'optional-test-sdk':'1'}}),
  'examples/remote-access-screen.mjs':'// screen','examples/provider-lifecycle-fixture.mjs':'// lifecycle'};
 const bytes=tar(files),archive=join(root,'input.tgz');await writeFile(archive,bytes);
 return {root,files,input:{tarball:archive,sha256:createHash('sha256').update(bytes).digest('hex'),
  sourceSha:'a'.repeat(40),outputDirectory:join(root,'out')}};
}
const evidence={fixtureOnly:true,providerId:'fixture-generated',events:['start','proof','stop'],
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
 assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=17*1024*1024);
 assert.ok(['confirmed','unconfirmed'].includes(result.cleanup.state));
});
