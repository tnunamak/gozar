import test from 'node:test';
import assert from 'node:assert/strict';
import {proofObservedDuring} from '../../packages/gozar-node/attached-route.mjs';

// Pure negative controls for the shared initial/refresh timestamp boundary.
// These do not stand in for the still-required public proof mutation matrix.
test('proof observation must belong to the current verification interval', () => {
 const start=1000,end=2000;
 for(const checkedAt of [undefined,null,'invalid',new Date(999).toISOString(),new Date(2001).toISOString()]){
  assert.equal(proofObservedDuring({checkedAt},start,end),false);
 }
 assert.equal(proofObservedDuring({checkedAt:new Date(start).toISOString()},start,end),true);
 assert.equal(proofObservedDuring({checkedAt:new Date(end).toISOString()},start,end),true);
 assert.equal(proofObservedDuring({checkedAt:new Date(1500).toISOString()},start,end),true);
});
