import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {discoverFiles, planChecks, runPatchCheck} from '../../scripts/check-patch.mjs';

test('a test-only patch selects that test and the smoke without Rust work',()=>{
 const plan=planChecks({changedPaths:['test/node/example.test.mjs'],
  files:['test/node/example.test.mjs','test/node/error-normalizer.test.mjs'],readSource:()=>''});
 assert.deepEqual([...plan.nodeTests].sort(),['test/node/error-normalizer.test.mjs','test/node/example.test.mjs']);
 assert.deepEqual(plan.rustPackages,[]);
 assert.equal(plan.buildWasm,false);
});

test('a deleted helper selects its remaining transitive consumers',()=>{
 const files=['test/node/error-normalizer.test.mjs','test/node/connected.test.mjs',
  'test/node/unrelated.test.mjs','packages/feature.mjs'];
 const sources={'test/node/connected.test.mjs':"import '../../packages/feature.mjs';",
  'packages/feature.mjs':"export { x } from './deleted.mjs';"};
 const plan=planChecks({changedPaths:['packages/deleted.mjs'],files,
  readSource:file=>sources[file]??''});
 assert.deepEqual(plan.nodeTests,['test/node/connected.test.mjs','test/node/error-normalizer.test.mjs']);
 assert.equal(plan.buildWasm,false);
});

test('a deleted JSON fixture selects both import and file-read consumers',()=>{
 const files=['test/node/error-normalizer.test.mjs','test/node/import-palette.test.mjs',
  'test/node/read-palette.test.mjs','test/node/unrelated.test.mjs'];
 const sources={
  'test/node/import-palette.test.mjs':"import palette from '../../packages/palette.json' with { type: 'json' };",
  'test/node/read-palette.test.mjs':"import {readFileSync} from 'node:fs'; const palette=JSON.parse(readFileSync(new URL('../../packages/palette.json',import.meta.url),'utf8'));",
 };
 const plan=planChecks({changedPaths:['packages/palette.json'],files,readSource:file=>sources[file]??''});
 assert.deepEqual(plan.nodeTests,['test/node/error-normalizer.test.mjs','test/node/import-palette.test.mjs','test/node/read-palette.test.mjs']);
 assert.deepEqual(plan.rustPackages,[]);
 assert.equal(plan.buildWasm,false);
});

test('an unresolved literal module URL cannot hide a consumer behind a known edge',()=>{
 const files=['test/node/error-normalizer.test.mjs','test/node/plain.test.mjs',
  'test/node/query.test.mjs','packages/feature.mjs'];
 const sources={
  'test/node/plain.test.mjs':"import '../../packages/feature.mjs';",
  'test/node/query.test.mjs':"import '../../packages/feature.mjs?fresh=1';",
 };
 const plan=planChecks({changedPaths:['packages/feature.mjs'],files,readSource:file=>sources[file]??''});
 assert.ok(plan.nodeTests.includes('test/node/query.test.mjs'));
});

test('opaque imports widen source changes and missing smoke fails closed',()=>{
 const files=['test/node/error-normalizer.test.mjs','test/node/one.test.mjs',
  'test/node/two.test.mjs','packages/feature.mjs'];
 const plan=planChecks({changedPaths:['packages/feature.mjs'],files,
  readSource:file=>file==='test/node/one.test.mjs'?'import(selectedModule)':''});
 assert.deepEqual(plan.nodeTests, files.filter(file=>file.endsWith('.test.mjs')).sort());
 assert.throws(()=>planChecks({changedPaths:['packages/feature.mjs'],
  files:files.slice(1),readSource:()=>''}),/missing required smoke/);
});

test('a Rust-core file selects its crate and invalidates generated WASM',()=>{
 const files=['test/node/error-normalizer.test.mjs','test/node/core.test.mjs'];
 const plan=planChecks({changedPaths:['crates/gozar-core/src/lib.rs'],files,readSource:()=>''});
 assert.deepEqual(plan.rustPackages,['gozar-core']);
 assert.equal(plan.buildWasm,true);
});

const cliSmoke = 'test/node/error-normalizer.test.mjs';
const cliWasm = 'scripts/build-wasm.sh';
const cliExample = 'test/node/example.test.mjs';
const cliNested = 'test/node/nested/other.test.mjs';

function cliFixture({changed = [cliExample], files = [cliSmoke, cliExample],
                     source = {}, status = {}, stdout, untracked = {status:0,stdout:''}} = {}) {
 const calls = [], messages = [], failures = [];
 let tick = 0;
 return {calls, messages, failures, invoke: (args = []) => runPatchCheck(args, {
  root: '/fixture/repo',
  discover: () => files,
  readSource: file => source[file] ?? '',
  log: line => messages.push(line),
  fail: line => failures.push(line),
  now: () => ++tick,
  run: (command, argv, {cwd,capture}) => {
   calls.push({command, argv, cwd, capture});
   if (command === 'git' && argv[0] === 'ls-files') return untracked;
   const result = {status: status[command] ?? 0};
   if (command === 'git') result.stdout = stdout ?? changed.map(file => file + '\0').join('');
   return result;
  },
 })};
}

test('patch CLI defaults to HEAD and checks the planned file plus mandatory smoke',()=>{
 const f = cliFixture();
 assert.equal(f.invoke(),0);
 assert.deepEqual(f.calls.map(({command,argv}) => [command,argv]),[
  ['git',['diff','--name-only','-z','--no-renames','HEAD','--']],
  ['git',['ls-files','--others','--exclude-standard','-z']],
  [process.execPath,['--test','--test-concurrency=1',cliSmoke,cliExample]],
 ]);
 assert.ok(f.calls.every(call=>call.cwd==='/fixture/repo'));
 assert.equal(f.calls[0].capture,true);
 assert.equal(f.calls[1].capture,true);
 assert.equal(f.calls[2].capture,false);
 assert.ok(f.messages.some(line=>line.endsWith(': 1 ms')));
});

test('patch CLI can run its full integration check on a clean checkout',()=>{
 const f=cliFixture({changed:[],files:[cliSmoke,cliExample,cliWasm]});
 assert.equal(f.invoke(['--full']),0);
 assert.deepEqual(f.calls.map(call=>call.command),['git','bash',process.execPath,'cargo']);
});

test('full mode preserves the registered Node gate families',()=>{
 const files=[cliSmoke,cliNested,'test/adapters/example.test.mjs',
  'test/acceptance/manual.test.mjs','test/e2e/manual.test.mjs'];
 const plan=planChecks({changedPaths:[],files,readSource:()=>'',full:true});
 assert.deepEqual(plan.nodeTests,[cliSmoke,cliNested,'test/adapters/example.test.mjs'].sort());
 const patch=planChecks({changedPaths:['test/acceptance/manual.test.mjs'],files,readSource:()=>''});
 assert.ok(patch.nodeTests.includes('test/acceptance/manual.test.mjs'));
});

test('a shared installed runner checks the caller worktree rather than its own directory',()=>{
 const before=process.cwd(),root=mkdtempSync(join(tmpdir(),'gozar-runner-cwd-'));
 const calls=[];
 try{
  process.chdir(root);
  const code=runPatchCheck([],{discover:()=>[cliSmoke,cliExample],readSource:()=>'',log:()=>{},fail:()=>{},
   run:(command,args,options)=>{calls.push(options.cwd);return {status:0,stdout:command==='git'&&args[0]==='diff'?cliExample+'\0':''};}});
  assert.equal(code,0);
  assert.deepEqual(calls,[root,root,root]);
 }finally{process.chdir(before);rmSync(root,{recursive:true,force:true});}
});

test('patch CLI uses an explicit base SHA and accounts for renamed or deleted sources',()=>{
 const sha='a'.repeat(40);
 const f=cliFixture({
  changed:['packages/old.mjs','packages/new.mjs'],
  files:[cliSmoke,cliExample,cliNested,'packages/bridge.mjs','packages/new.mjs'],
  source:{
   [cliExample]:"import '../../packages/bridge.mjs';",
   'packages/bridge.mjs':"export {x} from './old.mjs'; export {y} from './new.mjs';",
  },
 });
 assert.equal(f.invoke(['--base',sha]),0);
 assert.ok(f.calls[0].argv.includes('--no-renames'));
 assert.ok(f.calls[0].argv.includes(sha));
 assert.deepEqual(f.calls[2].argv.slice(2),[cliSmoke,cliExample]);
});

test('patch CLI fails before running checks when diff or selections are unavailable',()=>{
 for(const config of [{changed:[]},{stdout:'broken'},{files:[cliExample]},{status:{git:13}}]){
  const f=cliFixture(config);
  assert.equal(f.invoke(),config.status?.git ?? 1);
  assert.deepEqual(f.calls.map(x=>x.command),config.stdout||config.status ? ['git'] : ['git','git']);
  assert.equal(f.failures.length,1);
 }
 for(const args of [['--unknown'],['--base'],['--base','HEAD'],['--full','--full']]){
  const f=cliFixture();
  assert.equal(f.invoke(args),1);
  assert.deepEqual(f.calls,[]);
 }
});

test('patch CLI refuses tracked and untracked inputs before running checks',()=>{
 const f=cliFixture({files:[cliSmoke,cliExample,cliNested],untracked:{status:0,stdout:cliNested+'\0'}});
 assert.equal(f.invoke(),1);
 assert.deepEqual(f.calls.map(x=>x.argv[0]),['diff','ls-files']);
 assert.match(f.failures[0],/stage all patch inputs or use a clean checkout/i);
});

test('patch CLI refuses failed or malformed untracked enumeration before running checks',()=>{
 for(const untracked of [{status:13,stdout:''},{status:0,stdout:'unterminated'},
  {status:0,stdout:'\0'},{status:0,stdout:'one\0\0'},{status:null,signal:'SIGTERM'},{status:0}]){
  const f=cliFixture({untracked});
  assert.notEqual(f.invoke(),0);
  assert.deepEqual(f.calls.map(x=>x.argv[0]),['diff','ls-files']);
  assert.match(f.failures[0],/cannot establish untracked paths/i);
 }
});

test('patch CLI forwards test and build failures, stopping dependent checks',()=>{
 const node=cliFixture({status:{[process.execPath]:17}});
 assert.equal(node.invoke(),17);
 assert.deepEqual(node.calls.map(x=>x.command),['git','git',process.execPath]);
 const build=cliFixture({changed:['crates/gozar-core/src/lib.rs'],
  files:[cliWasm,cliSmoke],status:{bash:23}});
 assert.equal(build.invoke(),23);
 assert.deepEqual(build.calls.map(x=>x.command),['git','git','bash']);
});

test('patch CLI selects only the exact documentation checks and smoke for docs',()=>{
 const packageTest='test/node/package.test.mjs', walkTest='test/node/live-provider-walk-doc.test.mjs';
 const f=cliFixture({changed:['README.md'],
  files:[cliWasm,cliSmoke,packageTest,walkTest,'test/node/package-sibling.test.mjs',cliNested]});
 assert.equal(f.invoke(),0);
 assert.deepEqual(f.calls[2].argv,[cliWasm]);
 assert.deepEqual(f.calls[3].argv.slice(2),[cliSmoke,walkTest,packageTest]);
 const missing=cliFixture({changed:['README.md'],files:[cliSmoke,packageTest]});
 assert.equal(missing.invoke(),1);
 assert.deepEqual(missing.calls.map(x=>x.command),['git','git']);
});

test('patch CLI builds before selected core tests and does not run unrelated Node tests',()=>{
 const coreTest='test/node/core.test.mjs';
 const f=cliFixture({changed:['crates/gozar-core/src/lib.rs'],
  files:[cliWasm,cliSmoke,coreTest,cliNested]});
 assert.equal(f.invoke(),0);
 assert.deepEqual(f.calls.map(({command,argv}) => [command,argv]),[
  ['git',['diff','--name-only','-z','--no-renames','HEAD','--']],
  ['git',['ls-files','--others','--exclude-standard','-z']],
  ['bash',[cliWasm]],
  [process.execPath,['--test','--test-concurrency=1',coreTest,cliSmoke]],
  ['cargo',['test','-p','gozar-core','--locked','--offline','--','--test-threads=1']],
 ]);
});

test('patch CLI full mode builds and runs recursive Node and Rust workspace checks serially',()=>{
 const f=cliFixture({changed:[cliNested],files:[cliWasm,cliSmoke,cliNested]});
 assert.equal(f.invoke(['--full']),0);
 assert.deepEqual(f.calls.map(({command,argv}) => [command,argv]),[
  ['git',['diff','--name-only','-z','--no-renames','HEAD','--']],
  ['bash',[cliWasm]],
  [process.execPath,['--test','--test-concurrency=1',cliSmoke,cliNested]],
  ['cargo',['test','--workspace','--locked','--offline','--','--test-threads=1']],
 ]);
});

test('patch CLI discovers nested tests and only the named generated outputs',t=>{
 const root=mkdtempSync(join(tmpdir(),'patch-check-files-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const wasm='packages/gozar-core/generated/gozar_core_bg.wasm';
 for(const file of [cliNested,wasm,'.git/ignore.mjs','target/fake.test.mjs',
  'nested/node_modules/fake.test.mjs','packages/gozar-core/generated/untracked.test.mjs']){
  const target=join(root,file);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,'fixture');
 }
 assert.deepEqual(discoverFiles(root),[wasm,cliNested]);
});
