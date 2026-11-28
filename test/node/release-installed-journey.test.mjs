import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,sep} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {runInstalledJourney,runProcess} from '../../scripts/release-installed-journey.mjs';
import {parseArgs as parsePublicTypesArgs} from '../../scripts/check-public-types.mjs';
import {assembleEvidence,SURVEY_REVISION} from '../../scripts/release-survey-evidence.mjs';

function surveyFixture(definition, extra = {}) {
 const json=JSON.stringify;
 return {
  surveyRevision:SURVEY_REVISION,survey:{revision:SURVEY_REVISION,files:{}},
  candidate:{revision:'a'.repeat(40),files:{
   'adapters/manifest.json':json({providers:[{id:'fixture',module:'fixture.mjs',definition:'fixture.json'}]}),
   'runtime/adapter.schema.json':'{}',
   'adapters/fixture.json':json(definition),
   'docs/release-0.4-interface-coverage.md':'Fixture coverage',
   ...extra,
  }},
 };
}

test('survey evidence rejects a missing provider module rather than reporting a partial inventory',()=>{
 assert.throws(()=>assembleEvidence(surveyFixture({})),/^Error: Unreadable required source: adapters\/fixture\.mjs$/);
});

test('survey evidence refuses directly cyclic provider wrappers',()=>{
 const input=surveyFixture({wraps:'wrapped.json'},{
  'adapters/fixture.mjs':'// fixture','adapters/wrapped.json':'{"wraps":"fixture.json"}',
 });
 assert.throws(()=>assembleEvidence(input),/^Error: Cyclic provider definition wrapping$/);
});

async function noticesFixture(t) {
 const root=await mkdtemp(join(tmpdir(),'notices-cli-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const scripts=join(root,'scripts'), bin=join(root,'bin'), crate=join(root,'fixture-crate');
 await Promise.all([scripts,bin,crate].map(path=>mkdir(path,{recursive:true})));
 const collector=join(scripts,'collect-third-party-notices.mjs');
 await writeFile(collector,await readFile(new URL('../../scripts/collect-third-party-notices.mjs',import.meta.url)));
 const marker=join(root,'cargo-called'), metadata=join(root,'metadata.json');
 await writeFile(join(bin,'cargo'),'#!/bin/sh\n[ "$*" = "metadata --locked --format-version=1" ] || exit 9\nprintf "called\\n" >> "$GOZAR_FIXTURE_MARKER"\n/bin/cat "$GOZAR_FIXTURE_METADATA"\n',{mode:0o700});
 await writeFile(join(root,'Cargo.lock'),'synthetic locked closure\n');
 const licence='fixture notice bytes\n';
 await writeFile(join(crate,'LICENSE'),licence);
 const base={source:'registry+https://registry.invalid/',version:'0.1.0',manifest_path:join(crate,'Cargo.toml')};
 const run=entry=>spawnSync(process.execPath,[entry],{cwd:root,encoding:'utf8',timeout:5000,
  env:{PATH:bin,GOZAR_FIXTURE_MARKER:marker,GOZAR_FIXTURE_METADATA:metadata}});
 return {root,collector,marker,metadata,base,licence,run};
}

test('notice collector import is inert; direct entry writes both declared license forms once',async t=>{
 const f=await noticesFixture(t);
 await writeFile(f.metadata,JSON.stringify({packages:[
  {...f.base,name:'declared-string',license:'MIT'},
  {...f.base,name:'declared-file',license:null,license_file:'LICENSE'},
 ]}));
 const importer=join(f.root,'import-collector.mjs');
 await writeFile(importer,"import { licenseLabel } from './scripts/collect-third-party-notices.mjs';\nif (typeof licenseLabel !== 'function') process.exitCode = 2;\n");
 const imported=f.run(importer);
 assert.ifError(imported.error); assert.equal(imported.status,0,imported.stderr);
 const manifest=join(f.root,'third-party','manifest.json');
 await assert.rejects(readFile(f.marker),{code:'ENOENT'});
 await assert.rejects(readFile(manifest),{code:'ENOENT'});
 const direct=f.run(f.collector);
 assert.ifError(direct.error); assert.equal(direct.status,0,direct.stderr);
 assert.equal(await readFile(f.marker,'utf8'),'called\n');
 const {packages}=JSON.parse(await readFile(manifest,'utf8'));
 assert.deepEqual(packages.map(({name,license})=>[name,license]),[
  ['declared-file','license-file: LICENSE'],['declared-string','MIT'],
 ]);
 for(const pkg of packages) {
  assert.equal(pkg.files.length,1);
  assert.equal(await readFile(join(f.root,pkg.files[0].path),'utf8'),f.licence);
 }
});

test('notice collector refuses a crate with no declared license and writes no manifest',async t=>{
 const f=await noticesFixture(t);
 await writeFile(f.metadata,JSON.stringify({packages:[
  {...f.base,name:'declared-first',license:'MIT'},
  {...f.base,name:'missing-declaration',license:null,license_file:null},
 ]}));
 const direct=f.run(f.collector);
 assert.ifError(direct.error); assert.equal(direct.status,1);
 assert.match(direct.stderr,/No license declared for missing-declaration/);
 await assert.rejects(readFile(join(f.root,'third-party','manifest.json')),{code:'ENOENT'});
 await assert.rejects(readFile(join(f.root,'third-party','rust','declared-first-0.1.0','LICENSE')),{code:'ENOENT'});
});

for(const licenseFile of ['licenses/MIT.txt','COPYRIGHT']) test('notice collector includes the exact declared file '+licenseFile,async t=>{
 const f=await noticesFixture(t),crate=dirname(f.base.manifest_path),text='declared file evidence\n';
 await mkdir(dirname(join(crate,licenseFile)),{recursive:true});
 await writeFile(join(crate,licenseFile),text);
 await writeFile(f.metadata,JSON.stringify({packages:[{...f.base,name:'declared-file',license:null,license_file:licenseFile}]}));
 const result=f.run(f.collector);
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
 const {packages}=JSON.parse(await readFile(join(f.root,'third-party','manifest.json'),'utf8'));
 const declared=packages[0].files.find(file=>file.path==='third-party/rust/declared-file-0.1.0/'+licenseFile);
 assert.ok(declared,'the manifest points to the actual declared file, not only the unrelated root LICENSE');
 assert.equal(await readFile(join(f.root,declared.path),'utf8'),text);
 assert.equal(declared.sha256,createHash('sha256').update(text).digest('hex'));
});

for(const kind of ['declared','conventional']) test('notice collector refuses an outside '+kind+' symlink',async t=>{
 const f=await noticesFixture(t),crate=dirname(f.base.manifest_path);
 const outside=join(f.root,'outside-notice');await writeFile(outside,'outside fixture evidence');
 const name=kind==='declared'?'legal/license.md':'NOTICE';
 await mkdir(dirname(join(crate,name)),{recursive:true});
 await symlink(outside,join(crate,name));
 await writeFile(f.metadata,JSON.stringify({packages:[{...f.base,name:'symlink-fixture',license:'MIT',...(kind==='declared'?{license_file:name}:{})}]}));
 const result=f.run(f.collector);assert.ifError(result.error);assert.equal(result.status,1);
 assert.match(result.stderr,/Resolved license file is outside/);
 await assert.rejects(readFile(join(f.root,'third-party','manifest.json')),{code:'ENOENT'});
});

test('notice collector rejects a declared directory as non-regular notice content',async t=>{
 const f=await noticesFixture(t),crate=dirname(f.base.manifest_path);
 await mkdir(join(crate,'legal'),{recursive:true});
 await writeFile(f.metadata,JSON.stringify({packages:[{...f.base,name:'declared-file',license:null,license_file:'legal'}]}));
 const result=f.run(f.collector);
 assert.ifError(result.error);assert.equal(result.status,1);
 assert.match(result.stderr,/License target is not a regular file/);
 await assert.rejects(readFile(join(f.root,'third-party','manifest.json')),{code:'ENOENT'});
});

test('notice collector refuses a missing declared file even when a root LICENSE exists',async t=>{
 const f=await noticesFixture(t);
 await writeFile(f.metadata,JSON.stringify({packages:[{...f.base,name:'declared-file',license:null,license_file:'licenses/missing.txt'}]}));
 const result=f.run(f.collector);
 assert.ifError(result.error);assert.equal(result.status,1);
 assert.match(result.stderr,/ENOENT/);
 await assert.rejects(readFile(join(f.root,'third-party','manifest.json')),{code:'ENOENT'});
});

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
for (const [name, alter] of [
  ['another source revision', gate => ({ ...gate, sourceSha: 'b'.repeat(40) })],
  ['a suite that ran zero tests', gate => ({ ...gate, rust: { exitCode: 0, failed: 0, passed: 0 } })],
]) test('release handoff refuses a host receipt for '+name+' before packaging', async t=>{
  const { prepareReleaseHandoff } = await import('../../scripts/prepare-release-handoff.mjs');
  const f = await fixture(t);
  const root = join(f.root,'source'), gateReceipt = join(f.root,'gate.json');
  await mkdir(root);
  const success = { exitCode: 0, failed: 0, passed: 1 };
  const gate = { schemaVersion: 1, kind: 'gozar-offline-host-gate', status: 'passed',
    sourceSha: f.input.sourceSha, node: success, rust: success };
  await writeFile(gateReceipt,JSON.stringify(alter(gate)));
  const calls=[];
  const run = (...args) => { calls.push(args); throw new Error('fixture must not launch'); };
  await assert.rejects(prepareReleaseHandoff({ root, gateReceipt,
    sourceSha: f.input.sourceSha, outputDirectory: f.input.outputDirectory },{run}),
    /Unknown, mismatched or unsuccessful host gate receipt/);
  assert.deepEqual(calls,[]);
  await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('the notice collector imports as a library without invoking the release command', async () => {
  const { collectThirdPartyNotices, licenseLabel } = await import('../../scripts/collect-third-party-notices.mjs');
  assert.equal(typeof collectThirdPartyNotices, 'function');
  assert.equal(licenseLabel({ name: 'fixture', license_file: 'docs/LICENSE' }), 'license-file: LICENSE');
});

test('release pack metadata identifies a missing or incomplete JSON receipt',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 for(const text of ['', '[{']){
  assert.throws(()=>parsePackOutput(text),error=>
   error.message==='Unknown or ambiguous npm pack output: expected valid JSON'&&
   error.cause instanceof SyntaxError);
 }
});

test('release pack metadata reports ambiguity instead of selecting a result',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 const pack={name:'@tnunamak/gozar',version:'0.0.0-fixture',filename:'gozar-fixture.tgz'};
 assert.deepEqual(parsePackOutput(JSON.stringify([pack])),pack);
 assert.throws(()=>parsePackOutput(JSON.stringify([pack,{...pack,version:'0.0.1-fixture'}])),/Unknown or ambiguous npm pack output/);
});

test('release pack metadata does not accept an unrelated package result',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 assert.throws(()=>parsePackOutput(JSON.stringify([{name:'fixture-other',version:'0.0.0-fixture',filename:'fixture-other.tgz'}])),/Unknown or ambiguous npm pack output/);
});

test('release pack metadata rejects an empty or whitespace-only package version',async()=>{
 const {parsePackOutput}=await import('../../scripts/prepare-release-handoff.mjs');
 const pack={name:'@tnunamak/gozar',filename:'gozar-fixture.tgz'};
 for(const version of ['', '  \t'])assert.throws(
  ()=>parsePackOutput(JSON.stringify([{...pack,version}])),
  {message:'Unknown or ambiguous npm pack output'}
 );
});

for (const [label, alter, expected] of [
 ['checksum', bytes => { bytes[4] ^= 1; return bytes; }, /Invalid tar checksum/],
 ['truncation', bytes => bytes.subarray(0, 520), /Truncated archive/],
]) test('valid outer digest does not hide tar '+label, async t=>{
 const f=await fixture(t),raw=gunzipSync(await readFile(f.input.tarball));
 const damaged=gzipSync(alter(raw));
 await writeFile(f.input.tarball,damaged);
 const input={...f.input,sha256:createHash('sha256').update(damaged).digest('hex')};
 const {run,calls}=processStub(f);
 await assert.rejects(runInstalledJourney(input,{run}),expected);
 assert.deepEqual(calls,[]);
 await assert.rejects(readFile(input.outputDirectory),{code:'ENOENT'});
});

for (const [label, bytes, expectError] of [
 ['not a gzip archive', () => Buffer.from('not a compressed archive'), {code:'Z_DATA_ERROR'}],
 ['invalid package manifest JSON', f => tar({...f.files, 'package.json':'{'}), SyntaxError],
]) test('a matching digest does not accept '+label, async t=>{
 const f=await fixture(t),stub=processStub(f),damaged=bytes(f);
 await writeFile(f.input.tarball,damaged);
 const input={...f.input,sha256:createHash('sha256').update(damaged).digest('hex')};
 await assert.rejects(runInstalledJourney(input,{run:stub.run}),expectError);
 assert.deepEqual(stub.calls,[]);
 await assert.rejects(readFile(input.outputDirectory),{code:'ENOENT'});
});

test('digest refusal starts zero subprocesses',async t=>{
 const f=await fixture(t),stub=processStub(f);
 await assert.rejects(runInstalledJourney({...f.input,sha256:'0'.repeat(64)},{run:stub.run}),/digest/i);
 assert.equal(stub.calls.length,0);
});

test('a missing archive retains ENOENT and creates no output or subprocess',async t=>{
 const f=await fixture(t);const {run,calls}=processStub(f);
 await rm(f.input.tarball);
 await assert.rejects(runInstalledJourney(f.input,{run}),{code:'ENOENT'});
 assert.equal(calls.length,0);
 await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('archive digest mismatch refuses before creating output or starting npm',async t=>{
 const f=await fixture(t);
 const {run,calls}=processStub(f);
 const wrong=(f.input.sha256[0]==='0'?'1':'0')+f.input.sha256.slice(1);
 await assert.rejects(runInstalledJourney({...f.input,sha256:wrong},{run}),/Archive digest mismatch/);
 assert.deepEqual(calls,[]);
 await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('a truncated source revision refuses even when the archive digest is correct',async t=>{
 const f=await fixture(t);
 const {run,calls}=processStub(f);
 await assert.rejects(runInstalledJourney({...f.input,sourceSha:f.input.sourceSha.slice(0,12)},{run}),
  /Explicit tarball, sha256, source SHA and output directory required/);
 assert.deepEqual(calls,[]);
 await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('an archive symlink is not treated as the verified regular file',async t=>{
 const f=await fixture(t);const {run,calls}=processStub(f);
 const linked=join(f.root,'linked.tgz');
 await symlink(f.input.tarball,linked,'file');
 await assert.rejects(runInstalledJourney({...f.input,tarball:linked},{run}),/Archive must be a regular file/);
 assert.equal(calls.length,0);
 await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('invalid source revision is rejected before creating output',async t=>{
 const f=await fixture(t),stub=processStub(f);
 await assert.rejects(runInstalledJourney({...f.input,sourceSha:'short'},{run:stub.run}),/source SHA/);
 assert.deepEqual(stub.calls,[]);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
});

test('single-element arrays are not valid release inputs, even before archive I/O',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const missing=join(f.root,'not-present.tgz');
 for(const [field,valid] of [['sha256',f.input.sha256],['sourceSha',f.input.sourceSha],['tarball',f.input.tarball],['outputDirectory',f.input.outputDirectory]]){
  await assert.rejects(runInstalledJourney({...f.input,tarball:missing,[field]:[valid]},{run:stub.run}),
   {message:'Explicit tarball, sha256, source SHA and output directory required'},field);
 }
 assert.deepEqual(stub.calls,[]);
 await assert.rejects(readFile(f.input.outputDirectory),{code:'ENOENT'});
});

test('a non-string source revision is rejected before staging an otherwise valid archive',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  return stub.run(command,args,options);
 };
 await assert.rejects(runInstalledJourney({...f.input,sourceSha:[f.input.sourceSha]},{run}),/source SHA/);
 assert.deepEqual(stub.calls,[]);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
});

test('a verified archive for a different package never reaches npm',async t=>{
 const f=await fixture(t,{name:'@example/other-package'}),stub=processStub(f);
 await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),/must be standalone @tnunamak\/gozar/);
 assert.deepEqual(stub.calls,[]);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
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

test('an existing output directory is preserved and no process starts',async t=>{
 const f=await fixture(t),stub=processStub(f);
 await mkdir(f.input.outputDirectory);
 const marker=join(f.input.outputDirectory,'result.json');
 await writeFile(marker,'previous synthetic receipt\n');
 await assert.rejects(runInstalledJourney(f.input,{run:stub.run}),{code:'EEXIST'});
 assert.equal(stub.calls.length,0);
 assert.equal(await readFile(marker,'utf8'),'previous synthetic receipt\n');
});

test('unknown fake screen output is recorded and stops before lifecycle',async t=>{
 const f=await fixture(t),stub=processStub(f),calls=[];
 const run=(command,args,options)=>{
  calls.push(command);
  return args.includes('--fakes')
   ? Promise.resolve({status:0,stdout:'Unrecognized fixture screen\n',stderr:''})
   : stub.run(command,args,options);
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),/Unknown screen outcome/);
 const receipt=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(receipt.scratch,{recursive:true,force:true}));
 assert.equal(receipt.status,'failed');
 assert.deepEqual(receipt.steps.map(step=>step.name),['install','screen']);
 assert.equal(receipt.failure.message,'Unknown screen outcome');
 assert.equal(calls.length,2);
 assert.equal(await readFile(join(f.input.outputDirectory,'screen.stdout'),'utf8'),'Unrecognized fixture screen\n');
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

test('installed journey gives npm and both examples only the scratch-local execution settings',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const result=await runInstalledJourney(f.input,{run:async(command,args,options)=>{
  if(!stub.calls.length)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  if(command==='npm'){
   assert.equal(await readFile(options.env.npm_config_userconfig,'utf8'),'');
   assert.equal(await readFile(options.env.npm_config_globalconfig,'utf8'),'');
  }
  return stub.run(command,args,options);
 }});
 const root=result.scratch;
 for(const {options} of stub.calls){
  assert.equal(options.cwd,root);
  assert.deepEqual(options.env,{PATH:process.env.PATH,HOME:join(root,'home'),TMPDIR:root,
   npm_config_cache:join(root,'cache'),npm_config_userconfig:join(root,'empty.npmrc'),
   npm_config_globalconfig:join(root,'empty-global.npmrc'),npm_config_offline:'true',
   npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false'});
 }
});

test('installed journey distinguishes the verified archive digest from the supplied revision in its receipt',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const sourceSha='d'.repeat(40);
 const result=await runInstalledJourney({...f.input,sourceSha},{run:stub.run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 const receipt=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 assert.equal(receipt.sha256,createHash('sha256').update(await readFile(f.input.tarball)).digest('hex'));
 assert.equal(receipt.sourceSha,sourceSha);
 assert.equal(receipt.sourceShaProvenance,'caller-supplied, not authenticated by archive');
});

test('installed journey installs the verified private archive copy',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const bytes=await readFile(f.input.tarball);
 const result=await runInstalledJourney(f.input,{run:async(command,args,options)=>{
  if(command==='npm'){
   const archive=args.at(-1);
   assert.equal(archive,join(options.cwd,'artifact.tgz'));
   assert.notEqual(archive,f.input.tarball);
   assert.deepEqual(await readFile(archive),bytes);
  }
  return stub.run(command,args,options);
 }});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 assert.equal(result.status,'passed');
});

test('installed journey receipt records byte lengths and hashes for installed members',async t=>{
 const f=await fixture(t),stub=processStub(f);
 f.files['examples/remote-access-screen.mjs']='// café';
 const bytes=tar(f.files);
 await writeFile(f.input.tarball,bytes);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const result=await runInstalledJourney({...f.input,sha256},{run:stub.run});
 t.after(()=>rm(result.scratch,{recursive:true,force:true}));
 const receipt=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 const expected=Object.entries(f.files).map(([path,body])=>({
  path,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')
 }));
 const byPath=(a,b)=>a.path.localeCompare(b.path);
 assert.deepEqual([...receipt.members].sort(byPath),expected.sort(byPath));
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
for(const [kind,reason] of [
 ['an extra regular file','Archive and installed bytes differ'],
 ['a symlink replacing a member','Installed package contains symlink'],
])test('installed byte verification refuses '+kind+' before consumers run',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const run=async(command,args,options)=>{
  t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  const result=await stub.run(command,args,options);
  if(command==='npm'){
   const pkg=join(options.cwd,'node_modules','@tnunamak','gozar');
   if(kind==='an extra regular file')await writeFile(join(pkg,'extra.txt'),'not in the archive');
   else{
    const screen=join(pkg,'examples','remote-access-screen.mjs');
    const sameBytes=join(options.cwd,'same-bytes.mjs');
    await writeFile(sameBytes,f.files['examples/remote-access-screen.mjs']);
    await rm(screen);
    await symlink(sameBytes,screen,'file');
   }
  }
  return result;
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),{message:reason});
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.equal(report.failure.message,reason);
 assert.deepEqual(stub.calls.map(call=>call.command),['npm']);
 assert.deepEqual(report.steps.map(step=>step.name),['install']);
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

test('install success with no installed package keeps a failed receipt and starts no examples',async t=>{
 const f=await fixture(t),calls=[];
 await assert.rejects(runInstalledJourney(f.input,{run:async(command)=>{
  calls.push(command);return {status:0,stdout:'fixture install completed',stderr:''};
 }}),{code:'ENOENT'});
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.deepEqual(calls,['npm']);
 assert.equal(report.status,'failed');
 assert.equal(report.failure.code,'ENOENT');
 assert.deepEqual(report.steps.map(({name})=>name),['install']);
});

test('truncated lifecycle JSON keeps the output and failed receipt',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const stdout='{"fixtureOnly":true';
 await assert.rejects(runInstalledJourney(f.input,{run:async(...args)=>{
  const result=await stub.run(...args);
  return stub.calls.length===3?{...result,stdout}:result;
 }}),SyntaxError);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(report.status,'failed');
 assert.equal(report.failure.name,'SyntaxError');
 assert.equal(Object.hasOwn(report,'lifecycle'),false);
 assert.deepEqual(report.steps.map(({name})=>name),['install','screen','lifecycle']);
 assert.equal(await readFile(join(f.input.outputDirectory,'lifecycle.stdout'),'utf8'),stdout);
});

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

test('a synchronous launch refusal without an error code records null',async()=>{
 const error=new TypeError('synthetic launch refusal');
 const result=await runProcess('fixture-only',[],{timeoutMs:1000},{spawnProcess:()=>{throw error;}});
 assert.deepEqual(result.error,{name:'TypeError',message:'synthetic launch refusal',code:null});
 assert.deepEqual(result.cleanup,{scope:'not-started',state:'confirmed'});
 assert.deepEqual([result.status,result.signal,result.stdout,result.stderr],[null,null,'','']);
});

test('an ordinary nonzero close keeps its exit code and separate output streams',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.kill=()=>assert.fail('ordinary close must not signal the fixture');
 const pending=runProcess('fixture-only',[],{timeoutMs:1000},{spawnProcess:()=>child});
 child.stdout.emit('data','one');child.stderr.emit('data','two');
 child.emit('close',7,null);
 const result=await pending;
 assert.deepEqual([result.status,result.signal,result.stdout,result.stderr],[7,null,'one','two']);
 assert.deepEqual([result.timedOut,result.overflow,result.drainTimedOut],[false,false,false]);
 assert.deepEqual([result.cleanup.scope,result.cleanup.state],['child-only','confirmed']);
 assert.equal(result.error,undefined);
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
test('a synchronous spawn refusal records that no child started',async()=>{
 const failure=Object.assign(new Error('synthetic spawn refusal'),{code:'ENOENT'});
 const result=await runProcess('fixture',[],{timeoutMs:1000},{spawnProcess:()=>{throw failure;}});
 assert.equal(result.status,null);
 assert.deepEqual(result.error,{name:'Error',message:'synthetic spawn refusal',code:'ENOENT'});
 assert.deepEqual(result.cleanup,{scope:'not-started',state:'confirmed'});
 assert.equal(result.timedOut,false);
});

test('a signal exit keeps the failure and output received while draining',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.kill=()=>assert.fail('the fixture never enables process signaling');
 const pending=runProcess('fixture',[],{timeoutMs:1000},{spawnProcess:()=>child});
 child.emit('exit',null,'SIGTERM');
 child.stderr.emit('data','synthetic final diagnostic');
 child.emit('close',null,'SIGTERM');
 const result=await pending;
 assert.equal(result.status,null);
 assert.equal(result.signal,'SIGTERM');
 assert.equal(result.stderr,'synthetic final diagnostic');
 assert.equal(result.drainTimedOut,false);
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
test('a synthetic signalled close stays distinct from a numeric exit', async()=>{
 const child=new EventEmitter();
 child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const result=runProcess('synthetic',[],{timeoutMs:1000},{spawnProcess:()=>child});
 child.emit('close',null,'SIGINT');
 const receipt=await result;
 assert.equal(receipt.status,null);
 assert.equal(receipt.signal,'SIGINT');
 assert.equal(receipt.timedOut,false);
 assert.equal(receipt.cleanup.state,'confirmed');
});
test('output after a synthetic close cannot change bytes retained in the receipt', async()=>{
 const child=new EventEmitter();
 child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const result=runProcess('synthetic',[],{timeoutMs:1000},{spawnProcess:()=>child});
 child.stdout.emit('data',Buffer.from('done'));
 child.emit('close',0,null);
 child.stderr.emit('data',Buffer.from('late'));
 const receipt=await result;
 assert.equal(receipt.stdout,'done');
 assert.equal(receipt.stderr,'');
 assert.equal(receipt.observedBytes,4);
 assert.equal(receipt.outputBytes,4);
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
test('fake process output at the exact shared byte cap is not overflow',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const signals=[];child.kill=signal=>signals.push(signal);
 const pending=runProcess('fixture',[],{timeoutMs:2000},{spawnProcess:()=>child});
 const cap=16*1024*1024;
 child.stdout.emit('data',Buffer.alloc(cap-2,120));
 child.stderr.emit('data','é');
 child.emit('close',0,null);
 const result=await pending;
 assert.equal(result.overflow,false);assert.equal(result.outputBytes,cap);
 assert.equal(result.observedBytes,cap);assert.equal(result.stderr,'é');
 assert.deepEqual(signals,[]);
});
test('fake process output beyond the shared cap counts but does not retain the extra bytes',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const signals=[];child.kill=signal=>signals.push(signal);
 const pending=runProcess('fixture',[],{timeoutMs:2000},{spawnProcess:()=>child});
 const cap=16*1024*1024;
 child.stdout.emit('data',Buffer.alloc(cap-1,120));
 child.stderr.emit('data','AB');
 child.stderr.emit('data','C');
 child.emit('close',null,'SIGTERM');
 const result=await pending;
 assert.equal(result.overflow,true);assert.equal(result.outputBytes,cap);
 assert.equal(result.observedBytes,cap+2);assert.equal(result.stderr,'A');
 assert.equal(result.signal,'SIGTERM');assert.deepEqual(signals,['SIGTERM']);
});
test('decoded diagnostics share the byte cap when invalid UTF-8 expands',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const signals=[];child.kill=signal=>signals.push(signal);
 const pending=runProcess('fixture',[],{timeoutMs:2000},{spawnProcess:()=>child});
 const cap=16*1024*1024, invalidBytes=Math.floor(cap/3);
 child.stdout.emit('data',Buffer.alloc(invalidBytes,255));
 child.stderr.emit('data',Buffer.from([65,255,66]));
 child.emit('close',0,null);
 const result=await pending;
 assert.equal(result.status,0);assert.equal(result.overflow,false);assert.equal(result.timedOut,false);
 assert.equal(result.outputBytes,invalidBytes+3);assert.equal(result.observedBytes,invalidBytes+3);
 assert.equal(result.stderr,'A');
 assert.equal(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr),cap);
 assert.deepEqual(signals,[]);
});
test('decoded diagnostics drop a cap-split character that cannot fit',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 const signals=[];child.kill=signal=>signals.push(signal);
 const pending=runProcess('fixture',[],{timeoutMs:2000},{spawnProcess:()=>child});
 const cap=16*1024*1024;
 child.stdout.emit('data',Buffer.alloc(cap-2,120));
 child.stderr.emit('data',Buffer.from([0xe2]));
 child.stderr.emit('data',Buffer.from([0x82,0xac]));
 child.emit('close',null,'SIGTERM');
 const result=await pending;
 assert.equal(result.overflow,true);assert.equal(result.outputBytes,cap);assert.equal(result.observedBytes,cap+1);
 assert.equal(Buffer.byteLength(result.stdout),cap-2);assert.equal(result.stderr,'');
 assert.equal(result.signal,'SIGTERM');assert.deepEqual(signals,['SIGTERM']);
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

test('public-types argv preserves both invented absolute values in either flag order',()=>{
 const installedRoot=join(sep,'synthetic-install'),tsc=join(sep,'synthetic-compiler');
 const expected={installedRoot,tsc};
 assert.deepEqual(parsePublicTypesArgs(['--installed-root',installedRoot,'--tsc',tsc]),expected);
 assert.deepEqual(parsePublicTypesArgs(['--tsc',tsc,'--installed-root',installedRoot]),expected);
});

test('public-types argv distinguishes missing values, duplicate options and relative values',()=>{
 const installedRoot=join(sep,'synthetic-install'),tsc=join(sep,'synthetic-compiler');
 assert.throws(()=>parsePublicTypesArgs(['--installed-root','--tsc',tsc]),{message:'Missing value for --installed-root'});
 assert.throws(()=>parsePublicTypesArgs(['--tsc',tsc]),{message:'Required: --installed-root ABS_INSTALL_PREFIX --tsc ABS_COMPILER'});
 assert.throws(()=>parsePublicTypesArgs(['--installed-root',installedRoot,'--tsc',tsc,'--tsc',tsc]),{message:'Unknown or duplicate argument: --tsc'});
 assert.throws(()=>parsePublicTypesArgs(['--installed-root',installedRoot,'--tsc','synthetic-compiler']),{message:'Both paths must be absolute'});
});

for(const [label,screen] of [
 ['wrong heading','Unexpected screen\nHost inputs: {}\nChoice: Fixture\n'],
 ['missing choice','Remote access\nHost inputs: {}\n'],
])test('installed screen '+label+' fails before lifecycle starts',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  const result=await stub.run(command,args,options);
  return args.includes('--fakes')?{...result,stdout:screen}:result;
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),{message:'Unknown screen outcome'});
 assert.equal(stub.calls.length,2);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.deepEqual(report.steps.map(step=>step.name),['install','screen']);
 assert.equal(report.failure.message,'Unknown screen outcome');
 assert.equal(await readFile(join(f.input.outputDirectory,'screen.stdout'),'utf8'),screen);
});

for (const state of ['overflow', 'drainTimedOut']) {
 test('a zero-exit installed step with '+state+' still stops before running any example',async t=>{
  const f=await fixture(t);
  const result={status:0,signal:null,[state]:true,stdout:'partial receipt stdout',stderr:'partial receipt stderr'};
  let calls=0;
  await assert.rejects(runInstalledJourney(f.input,{run:async()=>{calls++;return result;}}),
   /Installed journey subprocess failed: install/);
  const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
  t.after(()=>rm(report.scratch,{recursive:true,force:true}));
  assert.equal(calls,1);
  assert.equal(report.status,'failed');
  assert.deepEqual(report.steps.map(step=>step.name),['install']);
  assert.equal(report.failure.result[state],true);
  assert.equal(await readFile(join(f.input.outputDirectory,'install.stdout'),'utf8'),result.stdout);
  assert.equal(await readFile(join(f.input.outputDirectory,'install.stderr'),'utf8'),result.stderr);
 });
}

test('a zero-exit install marked timed out remains failed with its output intact',async t=>{
 const f=await fixture(t);
 let calls=0;
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>{
  calls++;
  return {status:0,signal:null,timedOut:true,stdout:'output received before deadline',stderr:'late shutdown'};
 }}),/Installed journey subprocess failed: install/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 t.after(()=>rm(report.scratch,{recursive:true,force:true}));
 assert.equal(calls,1);
 assert.equal(report.status,'failed');
 assert.equal(report.steps[0].result.timedOut,true);
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stdout'),'utf8'),'output received before deadline');
 assert.equal(await readFile(join(f.input.outputDirectory,'install.stderr'),'utf8'),'late shutdown');
});

test('the release journey CLI rejects duplicate or missing flag values before staging',async t=>{
 const f=await fixture(t);
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const cli=fileURLToPath(new URL('../../scripts/release-installed-journey.mjs',import.meta.url));
 for(const args of [
  ['--output-directory',f.input.outputDirectory,'--output-directory',f.input.outputDirectory],
  ['--output-directory',f.input.outputDirectory,'--source-sha'],
 ]){
  const out=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
  assert.equal(out.status,1);
  assert.equal(out.stdout,'');
  assert.match(out.stderr,/Unknown, repeated or missing argument/);
  await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
 }
});

test('an output file is preserved and no install starts',async t=>{
 const f=await fixture(t);
 await writeFile(f.input.outputDirectory,'fixture already present');
 let calls=0;
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>{calls++;throw new Error('install must not start');}}),
  {code:'EEXIST'});
 assert.equal(calls,0);
 assert.equal(await readFile(f.input.outputDirectory,'utf8'),'fixture already present');
});

test('a missing output parent is reported before any install starts',async t=>{
 const f=await fixture(t);
 f.input.outputDirectory=join(f.root,'missing-parent','receipt');
 let calls=0;
 await assert.rejects(runInstalledJourney(f.input,{run:async()=>{calls++;throw new Error('install must not start');}}),
  {code:'ENOENT'});
 assert.equal(calls,0);
 await assert.rejects(readFile(join(f.input.outputDirectory,'result.json')),{code:'ENOENT'});
});

test('a runner rejection records the failed launch without inventing a completed lifecycle step',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  if(stub.calls.length===2) throw Object.assign(new Error('fixture launcher unavailable'),{code:'ENOENT'});
  return stub.run(command,args,options);
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),{code:'ENOENT'});
 const out=f.input.outputDirectory;
 const report=JSON.parse(await readFile(join(out,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.equal(report.failure.code,'ENOENT');
 assert.deepEqual(report.steps.map(step=>step.name),['install','screen']);
 await assert.rejects(readFile(join(out,'lifecycle.stdout')),{code:'ENOENT'});
});

test('a lifecycle subprocess failure keeps the completed screen and the lifecycle diagnostics',async t=>{
 const f=await fixture(t),stub=processStub(f,{fault:3});
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  return stub.run(command,args,options);
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),/Installed journey subprocess failed: lifecycle/);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.deepEqual(report.steps.map(step=>[step.name,step.result.status]),[['install',0],['screen',0],['lifecycle',17]]);
 assert.equal(await readFile(join(f.input.outputDirectory,'lifecycle.stderr'),'utf8'),'exact failure');
});

test('an unexpected installed file fails the package identity check before screen execution',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  const result=await stub.run(command,args,options);
  if(command==='npm')await writeFile(join(options.cwd,'node_modules','@tnunamak','gozar','extra.txt'),'fixture extras');
  return result;
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),/Archive and installed bytes differ/);
 assert.equal(stub.calls.length,1);
 const report=JSON.parse(await readFile(join(f.input.outputDirectory,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.deepEqual(report.steps.map(step=>step.name),['install']);
});

test('malformed lifecycle JSON keeps the failed receipt and raw subprocess output',async t=>{
 const f=await fixture(t),stub=processStub(f);
 const raw='fixture interrupted before emitting JSON';
 const run=async(command,args,options)=>{
  if(stub.calls.length===0)t.after(()=>rm(options.cwd,{recursive:true,force:true}));
  const result=await stub.run(command,args,options);
  return stub.calls.length===3?{...result,stdout:raw}:result;
 };
 await assert.rejects(runInstalledJourney(f.input,{run}),SyntaxError);
 const output=f.input.outputDirectory;
 const report=JSON.parse(await readFile(join(output,'result.json'),'utf8'));
 assert.equal(report.status,'failed');
 assert.equal(report.failure.name,'SyntaxError');
 assert.deepEqual(report.steps.map(step=>step.name),['install','screen','lifecycle']);
 assert.equal(await readFile(join(output,'lifecycle.stdout'),'utf8'),raw);
});

function archiveClosureScenario() {
  const pkg = {
    exports: { '.': { import: './api.mjs', types: './api.d.ts' } },
    bin: { fixture: './bin/fixture.mjs' }, types: './api.d.ts',
    files: ['docs/current.md', 'docs/*.md'],
  };
  const manifest = { providers: [{ id: 'fixture', module: 'fixture.mjs', definition: 'fixture.json' }] };
  const notices = { packages: [{ files: [{ path: 'third-party/fixture.txt' }] }] };
  const files = new Set(['LICENSE', 'THIRD-PARTY-NOTICES.md', 'third-party/manifest.json',
    'adapters/manifest.json', 'api.mjs', 'api.d.ts', 'bin/fixture.mjs', 'docs/current.md',
    'adapters/fixture.mjs', 'adapters/fixture.json', 'adapters/fixture.definition.json',
    'third-party/fixture.txt', 'generated/fixture.wasm']);
  return { pkg, manifest, notices, files };
}

test('archive closure counts nested exports and literal docs but not package globs as members', async () => {
  const { assertReleaseClosure } = await import('../../scripts/check-package.mjs');
  const { pkg, manifest, notices, files } = archiveClosureScenario();
  const check = () => assertReleaseClosure(files, pkg, manifest, notices, ['generated/fixture.wasm']);
  assert.doesNotThrow(check);
  files.delete('api.d.ts'); files.delete('docs/current.md');
  assert.throws(check, { message: 'The package archive is missing: api.d.ts, docs/current.md' });
});

test('archive closure names missing provider definitions, notices and generated artifacts together', async () => {
  const { assertReleaseClosure } = await import('../../scripts/check-package.mjs');
  const { pkg, manifest, notices, files } = archiveClosureScenario();
  for (const path of ['adapters/fixture.definition.json', 'third-party/fixture.txt', 'generated/fixture.wasm'])
    files.delete(path);
  assert.throws(() => assertReleaseClosure(files, pkg, manifest, notices, ['generated/fixture.wasm']),
    { message: 'The package archive is missing: adapters/fixture.definition.json, third-party/fixture.txt, generated/fixture.wasm' });
});
