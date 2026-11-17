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
