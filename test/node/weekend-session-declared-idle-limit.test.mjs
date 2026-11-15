import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller} from '../../packages/gozar-node/controller.mjs';
import {publicReply} from '../../packages/gozar-node/daemon.mjs';
import {projectSession, unknownProperties} from '../../packages/gozar-node/route-view.mjs';

// Metadata-only controls: no fake verified result, process, clock, or provider probe.
function reply(value, {selected = 'chosen', admitted = true, planVersion = 1} = {}) {
  const controller = new Controller({step: () => assert.fail('projection must not step'),
    journal: {}, adapters: [
      {id:'decoy', planVersion:1, admission:{state:'admitted'}, idleTimeoutMs:999},
      {id:'chosen', planVersion, admission:{state:admitted ? 'admitted' : 'blocked'}, idleTimeoutMs:value}],
    driver:{proofGeneration:-1}});
  controller.state = {selected, generation:2};
  controller.last = {state:controller.state, snapshot:{phase:'starting', generation:2, limitations:[]}};
  return publicReply(controller.present(), '/synthetic-metadata-only');
}
const options = {handle:{kind:'session', id:'metadata', generation:2}, properties:unknownProperties(), now:1000};

test('selected admitted operational declaration crosses Controller and public projection', () => {
  for (const value of [0, 121000, Number.MAX_SAFE_INTEGER]) {
    const raw = reply(value);
    assert.equal(raw.limits.idleTimeoutMs, value);
    const route = projectSession(raw, options);
    assert.deepEqual(route.limits, {recommendedPollIntervalMs:5000, idleTimeoutMs:value});
    assert.equal(route.verification.status, 'unverified');
    assert.equal(route.published, null);
  }
});

test('missing, invalid, unselected and unadmitted declarations remain unknown', () => {
  for (const value of [undefined, null, -1, 1.5, Infinity, NaN, '121000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(projectSession(reply(value), options).limits.idleTimeoutMs, null);
  }
  for (const extra of [{selected:'missing'}, {selected:null}, {admitted:false}, {planVersion:0}]) {
    assert.equal(projectSession(reply(121000, extra), options).limits.idleTimeoutMs, null);
  }
});

test('explicit caller limits keep precedence and metadata does not set session expiry', () => {
  const raw = reply(121000);
  assert.deepEqual(projectSession(raw, {...options, limits:{idleTimeoutMs:0, recommendedPollIntervalMs:17}}).limits,
    {idleTimeoutMs:0, recommendedPollIntervalMs:17});
  assert.deepEqual(projectSession(raw, {...options, limits:{recommendedPollIntervalMs:17}}).limits,
    {idleTimeoutMs:121000, recommendedPollIntervalMs:17});
  const baseline = projectSession({...raw, limits:undefined}, options);
  const declared = projectSession(raw, options);
  assert.deepEqual(declared.expiresAt, baseline.expiresAt);
  assert.deepEqual(declared.handle, baseline.handle);
  assert.deepEqual(declared.verification, baseline.verification);
});
