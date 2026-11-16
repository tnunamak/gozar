import test from 'node:test';
import assert from 'node:assert/strict';
import {bindingFor, cleanupRecovery} from '../../packages/gozar-node/embedding-projections.mjs';

const unknown = {known:false, reason:'effective-target-not-observed'};

test('bindingFor rejects malformed and nonprimitive known values', () => {
  for (const observedTarget of [undefined, null, {}, 0, false, 'requested',
    {known:true}, {known:true,value:null}, {known:true,value:0},
    {known:true,value:false}, {known:true,value:{}}, {known:true,value:[]},
    {known:true,value:new String('observed')}]) {
    assert.deepEqual(bindingFor({observedTarget}).target, unknown);
  }
});

test('bindingFor requires literal known true and never infers a request target', () => {
  for (const known of [undefined, false, 0, 1, 'true', null]) {
    assert.deepEqual(bindingFor({observedTarget:{known,value:'observed'},
      requestedTarget:'requested', defaultTarget:'default'}).target, unknown);
  }
  assert.deepEqual(bindingFor({requestedTarget:'requested', defaultTarget:'default'}).target, unknown);
});

test('bindingFor rejects empty and whitespace-only known strings', () => {
  for (const value of ['', ' ', '\t\r\n', '\u00a0']) {
    assert.deepEqual(bindingFor({observedTarget:{known:true,value}}).target, unknown);
  }
});

test('bindingFor validates unknown reasons without normalizing valid reasons', () => {
  for (const reason of [undefined, null, '', ' \t', 0, false, {}, [], new String('reason')]) {
    assert.deepEqual(bindingFor({observedTarget:{known:false,reason}}).target, unknown);
  }
  for (const reason of ['not-observed', '  exact reason \t']) {
    assert.deepEqual(bindingFor({observedTarget:{known:false,reason}}).target, {known:false,reason});
  }
});

test('bindingFor preserves exact observed target rather than parsing or trimming', () => {
  for (const value of ['https://example.test:443/', 'http://[::1]:80/', '  observed target \t', '0']) {
    assert.deepEqual(bindingFor({observedTarget:{known:true,value,reason:'ignored'}}).target,
      {known:true,value});
  }
});

test('bindingFor preserves authority vocabulary and the complete actual remedy', () => {
  const remedy = cleanupRecovery({state:'unconfirmed'}, {kind:'synthetic'}).nextAction;
  assert.ok(remedy);
  for (const authority of ['adapter', 'owner', 'unknown', 'invented', null]) {
    /** @type {import('../../packages/gozar-node/embedding-contract.js').RouteBinding} */
    const result = bindingFor({authority, observedTarget:{known:true,value:'observed'}, remedy});
    assert.equal(result.authority, ['adapter','owner'].includes(authority) ? authority : 'unknown');
    assert.equal(result.remedy, remedy);
    assert.deepEqual(result.remedy, remedy);
  }
  assert.equal(bindingFor().remedy, null);
});
