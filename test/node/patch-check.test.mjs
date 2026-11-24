import test from 'node:test';
import assert from 'node:assert/strict';
import {planChecks} from '../../scripts/check-patch.mjs';

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
