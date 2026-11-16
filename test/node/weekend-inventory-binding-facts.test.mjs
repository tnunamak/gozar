import test from 'node:test';
import assert from 'node:assert/strict';
import {bindingFor, cleanupRecovery} from '../../packages/gozar-node/embedding-projections.mjs';

const unknown = {known:false, reason:'effective-target-not-observed'};

test('requested target and default port never become observed proof', () => {
  const request = {target:'http://127.0.0.1:80', requestedTarget:'http://[::1]:80', targetPort:80};
  assert.deepEqual(bindingFor(request), {authority:'unknown', target:unknown, remedy:null});
  assert.deepEqual(bindingFor({...request, observedTarget:{known:false, reason:'not-observed'}}).target,
    {known:false, reason:'not-observed'});
});

test('known observations require exact true and a nonblank primitive string', () => {
  for (const value of ['', ' \t\n', null, undefined, 80, false, {}, ['http://localhost']]) {
    assert.deepEqual(bindingFor({observedTarget:{known:true, value}}).target, unknown);
  }
  for (const known of [false, 1, 'true', null, undefined]) {
    assert.deepEqual(bindingFor({observedTarget:{known, value:'http://localhost'}}).target, unknown);
  }
});

test('explicit reasons survive while malformed reasons become a stable unknown', () => {
  const reason = '  no current adapter observation  ';
  assert.deepEqual(bindingFor({observedTarget:{known:false, reason}}).target, {known:false, reason});
  assert.deepEqual(bindingFor({observedTarget:{known:true, value:' ', reason}}).target, {known:false, reason});
  for (const reason of ['', ' \t\n', null, undefined, 1, {}, false]) {
    assert.deepEqual(bindingFor({observedTarget:{known:false, reason}}).target, unknown);
  }
});

test('explicit default ports and IPv6 are preserved exactly, not URL-normalized', () => {
  for (const value of ['http://localhost:80', 'https://example.invalid:443',
    'http://[::1]', 'http://[::1]:80', '  http://[::1]:8080  ']) {
    const observedTarget = Object.freeze({known:true, value});
    assert.deepEqual(bindingFor({observedTarget, requestedTarget:'http://different.invalid'}).target,
      {known:true, value});
  }
});

test('explicit observed authority is retained, never inferred from requested ownership', () => {
  for (const authority of ['adapter', 'owner', 'unknown']) {
    assert.deepEqual(bindingFor({authority}), {authority, target:unknown, remedy:null});
  }
  for (const authority of ['', 'gozar-owned', null, 1]) {
    assert.equal(bindingFor({authority, ownership:'owner'}).authority, 'unknown');
  }
});

test('the existing generic cleanup remedy is passed through complete and unchanged', () => {
  const remedy = cleanupRecovery({state:'unconfirmed'}, {kind:'session', id:'synthetic', generation:1}).nextAction;
  assert.ok(remedy);
  const before = structuredClone(remedy);
  Object.freeze(remedy);
  const result = bindingFor({remedy, observedTarget:{known:false, reason:'not-observed'}});
  assert.strictEqual(result.remedy, remedy);
  assert.deepEqual(result.remedy, before);
  assert.equal(bindingFor().remedy, null);
});
