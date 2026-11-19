import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,cp,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {context,identity,nodeGate,rustGate,discoverTests,consumerReceipt,publicationEnv,qualify,publish,pollIntegrity} from '../../scripts/trusted-release.mjs';

const sha='a'.repeat(40),hash=b=>createHash('sha256').update(b).digest('hex');
const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'tnunamak/gozar',GITHUB_SHA:sha,
 GITHUB_WORKFLOW_REF:'tnunamak/gozar/.github/workflows/npm-publish.yml@refs/heads/main',GITHUB_WORKFLOW_SHA:sha,
 ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture-only'};
const pkg={name:'@tnunamak/gozar',version:'0.5.1',repository:{type:'git',url:'https://github.com/tnunamak/gozar.git'},
 publishConfig:{access:'public'},peerDependencies:{'@ngrok/ngrok':'1.7.0'},peerDependenciesMeta:{'@ngrok/ngrok':{optional:true}}};
const ok=stdout=>({status:0,signal:null,stdout,stderr:'',cleanup:{state:'confirmed'}});
const tap='TAP version 13\nok 1 - fixture\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
const rust='running 1 test\ntest fixture ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
const lifecycle={fixtureOnly:true,providerId:'fixture-test',proof:{status:'verified'},cleanup:{state:'confirmed'},
 resourceLedger:{foreignPreserved:true,ownedAfter:[]},statusPreservedProofTime:true,events:['setup','start','proof','stop','cleanup']};
const response=(status,value)=>({status,json:async()=>value});
function archive(files){
 const parts=[];
 for(const [path,body] of files){
  const h=Buffer.alloc(512);
  h.write('package/'+path,0);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
  h.write(body.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);
  h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);h.write('00',263);
  const sum=[...h].reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  parts.push(h,body,Buffer.alloc((512-body.length%512)%512));
 }
 return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
}
async function fixture(t,options={}){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'gzt-')),root=join(dir,'source'),outputDirectory=join(dir,'evidence'),scratch=[];
 await mkdir(root);await mkdir(join(root,'test/node/deep'),{recursive:true});await mkdir(join(root,'test/adapters'),{recursive:true});
 await writeFile(join(root,'test/node/deep/a.test.mjs'),'');await writeFile(join(root,'test/adapters/z.test.mjs'),'');
 const local=structuredClone(options.localPackage??pkg);if(options.version)local.version=options.version;
 await writeFile(join(root,'package.json'),JSON.stringify(local));
 const e={...env,HOME:join(dir,'home'),TMPDIR:dir,CARGO_TARGET_DIR:join(dir,'target'),PATH:process.env.PATH};
 await mkdir(e.HOME);
 const packed=options.archivePackage??local;
 const files=new Map([['package.json',Buffer.from(JSON.stringify(packed))],
  ['examples/remote-access-screen.mjs',Buffer.from('// fixture')],
  ['examples/provider-lifecycle-fixture.mjs',Buffer.from('// fixture')]]);
 const bytes=archive(files),calls=[];
 const run=async(command,args,settings)=>{
  calls.push({command,args:[...args]});
  if(command==='git')return ok(args[0]==='rev-parse'?(options.head??sha)+'\n':'');
  if(args[0]==='--version')return ok(command==='npm'?'11.15.0\n':command==='rustc'?'rustc 1.90.0 (fixture)\n':'v22.16.0\n');
  if(command==='bash')return ok('');
  if(args[0]==='--test')return options.nodeResult??ok(tap);
  if(command==='cargo')return options.rustResult??ok(rust);
  if(command==='tar')return ok(files.get('package.json').toString());
  if(command==='npm'&&args[0]==='pack'){
   await writeFile(join(args.at(-1),'gozar.tgz'),bytes);
   return ok(JSON.stringify([{name:local.name,version:local.version,filename:'gozar.tgz'}]));
  }
  if(command==='npm'&&args[0]==='install'){
   scratch.push(settings.cwd);
   const installed=join(settings.cwd,'node_modules/@tnunamak/gozar');
   for(const [name,body] of files){const p=join(installed,name);await mkdir(p.slice(0,p.lastIndexOf('/')),{recursive:true});await writeFile(p,body);}
   return ok('');
  }
  if(command==='npm'&&args[0]==='publish'){
   assert.deepEqual(await readFile(args[1]),bytes);
   assert.equal(settings.env.NODE_AUTH_TOKEN,undefined);
   assert.equal(settings.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'fixture-only');
   return options.publishResult??ok('published');
  }
  if(args[0]?.endsWith('remote-access-screen.mjs'))return ok('Remote access\nHost inputs:\nChoice: fixture\n');
  if(args[0]?.endsWith('provider-lifecycle-fixture.mjs'))return ok(JSON.stringify(options.lifecycle??lifecycle));
  throw new Error('Unexpected command '+command+' '+args.join(' '));
 };
 t.after(async()=>{for(const path of scratch)await rm(path,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});});
 return {root,outputDirectory,env:e,run,calls,bytes,pkg:local};
}
// Text contract for this workflow's two fixed jobs, not a general YAML parser.
function workflowBoundary(yaml){
 const [global,jobs]=yaml.split('\njobs:\n');
 assert.ok(jobs,'explicit jobs block');
 const [qualify,publication]=jobs.split('\n  publish:\n');
 assert.match(global,/^permissions: \{\}$/m);
 assert.match(qualify,/^  qualify:\n    permissions:\n      contents: read$/m);
 assert.doesNotMatch(qualify,/^    environment:/m);
 assert.match(publication,/^    needs: qualify$/m);
 assert.match(publication,/^    if: \$\{\{ inputs\.publish == true \}\}$/m);
 assert.match(publication,/^    permissions:\n      contents: read\n      id-token: write$/m);
 assert.match(publication,/^    environment: npm-publish$/m);
 assert.equal((yaml.match(/^\s*id-token:\s*write\s*$/gm)??[]).length,1);
}
test('only explicitly authorized publication job can request workflow OIDC',async()=>{
 const yaml=await readFile(new URL('../../.github/workflows/npm-publish.yml',import.meta.url),'utf8');
 workflowBoundary(yaml);
 // Move the grant out of publish; each negative must be caught, not just a duplicate grant.
 const withoutPublishGrant=yaml.replace('      id-token: write\n','');
 for(const mutant of [
  withoutPublishGrant.replace('permissions: {}','permissions:\n  id-token: write'),
  withoutPublishGrant.replace('      contents: read\n','      contents: read\n      id-token: write\n'),
  yaml.replace('    if: ${{ inputs.publish == true }}\n',''),
 ])assert.throws(()=>workflowBoundary(mutant));
});
test('context refuses wrong event/ref/repository/SHA/workflow and non-hosted runners',()=>{
 assert.equal(context(env),sha);
 for(const [key,value] of Object.entries({GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/v1',GITHUB_REPOSITORY:'fork/gozar',
  GITHUB_SHA:'bad',GITHUB_WORKFLOW_SHA:'b'.repeat(40),GITHUB_WORKFLOW_REF:'tnunamak/gozar/.github/workflows/other.yml@refs/heads/main',
  RUNNER_ENVIRONMENT:'self-hosted'}))assert.throws(()=>context({...env,[key]:value}));
});
test('identity and OIDC reject incompatible package, version, repository and fallback credentials',()=>{
 identity(pkg);
 for(const next of [{...pkg,name:'evil'},{...pkg,version:'../1'},{...pkg,repository:{type:'git',url:'https://example.invalid'}}])
  assert.throws(()=>identity(pkg,next));
 assert.throws(()=>publicationEnv({...env,ACTIONS_ID_TOKEN_REQUEST_TOKEN:''}));
 for(const key of ['NPM_TOKEN','NODE_AUTH_TOKEN','npm_config__authToken','NPM_CONFIG_USERCONFIG'])
  assert.throws(()=>publicationEnv({...env,[key]:'fixture'}));
});
test('gate parsers require measured, nonempty, unskipped, uncancelled consistent success',()=>{
 assert.deepEqual(nodeGate(ok(tap)),{exitCode:0,failed:0,passed:1});
 assert.deepEqual(rustGate(ok(rust)),{exitCode:0,failed:0,passed:1});
 for(const result of [ok(''),{...ok(tap),status:1},{...ok(tap),timedOut:true},{...ok(tap),cleanup:{state:'unconfirmed'}},
  ok(tap.replace('# pass 1','# pass 0')),ok(tap.replace('# skipped 0','# skipped 1')),
  ok(tap.replace('# cancelled 0','# cancelled 1')),ok(tap.replace('ok 1','not ok 1')),
  ok(tap.replace('ok 1 - fixture','ok 1 - fixture # SKIP')),ok(tap+'# pass 1\n')])assert.throws(()=>nodeGate(result));
 for(const result of [ok(''),ok(rust.replace('1 passed','0 passed')),ok(rust.replace('0 ignored','1 ignored')),
  {...ok(rust),signal:'SIGTERM'},ok(rust.replace('0 failed','1 failed'))])assert.throws(()=>rustGate(result));
});
test('qualification recursively sorts all tests, builds before gates, packs once and finalizes measured evidence',async t=>{
 const f=await fixture(t);
 assert.deepEqual(await discoverTests(f.root),['test/adapters/z.test.mjs','test/node/deep/a.test.mjs']);
 const m=await qualify(f,{run:f.run});
 assert.equal(m.status,'qualified-artifact');
 assert.equal(f.calls.filter(c=>c.args[0]==='pack').length,1);
 assert.ok(f.calls.findIndex(c=>c.command==='bash')<f.calls.findIndex(c=>c.args[0]==='--test'));
 assert.deepEqual(f.calls.find(c=>c.args[0]==='--test').args.slice(3),await discoverTests(f.root));
 assert.ok(f.calls.find(c=>c.command==='cargo').args.includes('--offline'));
 const receipt=JSON.parse(await readFile(m.consumerReceipt,'utf8'));
 assert.equal(receipt.proofVerified,true);assert.equal(receipt.foreignAppPreserved,true);
 assert.equal(receipt.journeys.lifecycle.exitCode,0);
 assert.equal(f.calls.some(c=>c.args[0]==='publish'),false);
});
for(const [label,options] of [
 ['wrong checkout',{head:'b'.repeat(40)}],
 ['wrong package',{localPackage:{...pkg,name:'other'}}],['wrong repository',{localPackage:{...pkg,repository:{type:'git',url:'https://example.invalid'}}}],['archive identity',{archivePackage:{...pkg,version:'0.5.2'}}],
 ['failed gate',{nodeResult:{...ok(tap),status:1}}],['empty gate',{rustResult:ok(rust.replace('1 passed','0 passed'))}],
 ['skipped gate',{nodeResult:ok(tap.replace('# skipped 0','# skipped 1'))}],
 ['proof',{lifecycle:{...lifecycle,proof:{status:'pending'}}}],
 ['cleanup',{lifecycle:{...lifecycle,cleanup:{state:'pending'}}}],
 ['foreign retention',{lifecycle:{...lifecycle,resourceLedger:{foreignPreserved:false,ownedAfter:[]}}}]
])test('qualification refuses '+label,async t=>{
 const f=await fixture(t,options);await assert.rejects(qualify(f,{run:f.run}));
 assert.equal(f.calls.some(c=>c.args[0]==='publish'),false);
});
test('publication sends checked archive once and tolerates delayed visibility',async t=>{
 const f=await fixture(t);await qualify(f,{run:f.run});let reads=0,time=0;
 const integrity='sha512-'+createHash('sha512').update(f.bytes).digest('base64');
 const result=await publish(f,{run:f.run,fetchImpl:async()=>++reads<4?response(404):response(200,{...pkg,dist:{integrity}}),
  now:()=>time,sleep:async ms=>{time+=ms;}});
 assert.equal(result.integrity,integrity);assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
 await assert.rejects(publish(f,{run:f.run,fetchImpl:async()=>{throw new Error('must not query again');}}));
 assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
});
for(const kind of ['archive','gate','consumer','manifest','raw','prepared','existing','registry-error','registry-network','released-version','oidc'])
 test('publication refuses '+kind+' before npm publish',async t=>{
 const f=await fixture(t,kind==='released-version'?{version:'0.5.0'}:{});const m=await qualify(f,{run:f.run});
 const paths={archive:m.tarball,gate:m.gateReceipt,consumer:m.consumerReceipt,
  manifest:join(f.outputDirectory,'artifact/manifest.json'),raw:join(f.outputDirectory,'installed/result.json'),
  prepared:join(f.outputDirectory,'prepared.json')};
 if(paths[kind])await writeFile(paths[kind],'tampered');
 if(kind==='oidc')delete f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 let lookups=0;
 const errors={archive:/Archive digest changed/,gate:/Qualification receipt changed/,consumer:/Qualification receipt changed/,
  manifest:/Qualification receipt changed/,raw:/Qualification receipt changed/,prepared:/Qualification receipt changed/,
  existing:/Version already exists/, 'registry-error':/Registry lookup failed: 503/,'registry-network':/fixture network unavailable/,'released-version':/Version already exists/,oidc:/OIDC unavailable/};
 await assert.rejects(publish(f,{run:f.run,fetchImpl:async()=>{
  lookups++;
  if(kind==='existing'||kind==='released-version')return response(200,{...f.pkg,dist:{integrity:'sha512-existing'}});
  if(kind==='registry-error')return response(503);
  if(kind==='registry-network')throw new Error('fixture network unavailable');
  throw new Error('Unexpected registry access');
 }}),errors[kind]);
 assert.equal(lookups,['existing','released-version','registry-error','registry-network'].includes(kind)?1:0);
 assert.equal(f.calls.some(c=>c.args[0]==='publish'),false);
});
test('integrity polling fails mismatch and stops at timeout without retrying publish',async()=>{
 await assert.rejects(pollIntegrity(pkg,'sha512-expected',{fetchImpl:async()=>response(200,{...pkg,dist:{integrity:'sha512-wrong'}})}),/mismatch/);
 let time=0,reads=0;
 await assert.rejects(pollIntegrity(pkg,'sha512-expected',{fetchImpl:async()=>{reads++;return response(404);},
  now:()=>time,sleep:async ms=>{time+=ms;},timeoutMs:12000}),/timeout/);
 assert.equal(time,12000);assert.equal(reads,3);
});
test('ambiguous publication failure is retained and cannot publish twice',async t=>{
 const f=await fixture(t,{publishResult:{...ok(''),status:1}});await qualify(f,{run:f.run});
 await assert.rejects(publish(f,{run:f.run,fetchImpl:async()=>response(404)}));
 assert.ok((await readdir(join(f.outputDirectory,'publication'))).includes('attempt.json'));
 await assert.rejects(publish(f,{run:f.run,fetchImpl:async()=>response(404)}));
 assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
});

for(const mode of ['mismatch','timeout'])test('publication '+mode+' never issues a second publish',async t=>{
 const f=await fixture(t);await qualify(f,{run:f.run});let reads=0,time=0;
 const io={run:f.run,now:()=>time,sleep:async ms=>{time+=ms;},
  fetchImpl:async()=>++reads===1||mode==='timeout'?response(404):response(200,{...pkg,dist:{integrity:'sha512-wrong'}})};
 await assert.rejects(publish(f,io),mode==='mismatch'?/integrity mismatch/:/visibility timeout/);
 assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
 await assert.rejects(publish(f,io));
 assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
 if(mode==='timeout')assert.equal(time,180000);
});

// Model the artifact crossing to a fresh runner: copy the uploaded tree to staging,
// destroy the original, then restore under the same runner-absolute layout.
async function transferEvidence(f){
 const stage=join(f.env.TMPDIR,'transferred');
 await cp(f.outputDirectory,stage,{recursive:true});
 await rm(f.outputDirectory,{recursive:true});
 await rename(stage,f.outputDirectory);
}
test('exact cross-job artifact and receipts survive a fresh restore',async t=>{
 const f=await fixture(t);await qualify(f,{run:f.run});await transferEvidence(f);
 const integrity='sha512-'+createHash('sha512').update(f.bytes).digest('base64');
 let lookups=0;
 const r=await publish(f,{run:f.run,fetchImpl:async()=>++lookups===1?response(404):response(200,{...pkg,dist:{integrity}})});
 assert.equal(r.integrity,integrity);assert.equal(f.calls.filter(c=>c.args[0]==='publish').length,1);
});
for(const change of ['missing','source','root','path','hash path','archive missing'])
 test('restored artifact refuses '+change+' before registry or publish',async t=>{
  const f=await fixture(t),m=await qualify(f,{run:f.run});await transferEvidence(f);
  const receipt=join(f.outputDirectory,'qualification.json');
  const q=JSON.parse(await readFile(receipt,'utf8'));
  if(change==='missing')await rm(f.outputDirectory,{recursive:true});
  else if(change==='archive missing')await rm(m.tarball);
  else{
   if(change==='source')q.sourceSha='b'.repeat(40);
   if(change==='root')q.root=join(f.env.TMPDIR,'previous-runner');
   if(change==='path')q.manifestPath=join(f.root,'package.json');
   if(change==='hash path')q.hashes[join(f.root,'package.json')]='a'.repeat(64);
   await writeFile(receipt,JSON.stringify(q));
  }
  let lookups=0;
  await assert.rejects(publish(f,{run:f.run,fetchImpl:async()=>{lookups++;return response(404);}}));
  assert.equal(lookups,0);
  assert.equal(f.calls.some(c=>c.args[0]==='publish'),false);
 });
