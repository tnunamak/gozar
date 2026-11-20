// The initial proof observation of a proof-session adapter is staged until every common guard has passed (observed inside this attempt's window,
// current attempt, resolver, owner). A malformed or stale observation must leave the controller's proof and facts as they were.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { closeAttachedRoute, controlAttached } from '../../packages/gozar-node/attached-route.mjs';
import { sessionWorld } from './session-controller-fixtures.mjs';

// `checkedAt` is the observation time the proof session reports. Removal is slow, so the controller's own view of the rejected start can be read
// while it is still the live record.
const tune = checkedAt => `
  adapter.prepareProof = async () => ({ target: '127.0.0.1:8799',
    verify: async ({ origin, attempt }) => ({ attemptId: attempt.id, endpoint: origin, status: 'verified', checkedAt: ${checkedAt}, vantage: 'this-device', checks: ['nonce'],
      validUntil: new Date(Date.now() + 15000).toISOString(), facts: [{ id: 'staged-probe-fact', affectsConsent: false }] }),
    close: async () => {} });
  const remove = adapter.remove; adapter.remove = async (...args) => { await new Promise(resolve => setTimeout(resolve, 2500)); return remove(...args); };`;

async function rejectedStartView(t, checkedAt) {
  const world = await sessionWorld(t, tune(checkedAt), { validation: 'gated' });
  const running = world.run({ startTimeoutMs: 20_000 }).then(() => null, error => error);
  let view = null;
  for (let end = Date.now() + 15_000; Date.now() < end && !view; await new Promise(resolve => setTimeout(resolve, 100))) {
    const bootstrap = JSON.parse(await readFile(join(world.directory, 'bootstrap.json'), 'utf8').catch(() => 'null'));
    if (!bootstrap?.handle) continue;
    const reply = await controlAttached(world.directory, { type: 'status', generation: bootstrap.handle.generation, handleId: bootstrap.handle.id }, 2000).catch(() => null);
    if (reply?.view && reply.view.state === 'lost') view = reply.view;
  }
  const error = await running;
  return { view, error, world };
}

for (const [label, checkedAt] of [['a malformed observation time', '"not-a-date"'], ['an observation older than the attempt', 'new Date(Date.now() - 3600000).toISOString()']]) {
  test(`${label} is refused and leaves no proof facts on the rejected start`, async t => {
    const { view, error } = await rejectedStartView(t, checkedAt);
    assert.equal(error?.code, 'verification_failed');
    assert.ok(view, 'the controller reported the rejected start while it was still removing');
    assert.equal(view.verification.status, 'unverified');
    assert.deepEqual(view.facts.filter(fact => fact.id === 'staged-probe-fact'), [], 'facts from the rejected observation were never recorded');
  });
}
