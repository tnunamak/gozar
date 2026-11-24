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
