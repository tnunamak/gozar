import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { Controller } from '../../packages/gozar-node/controller.mjs';
import { fixture } from './helpers.mjs';

const machineAdapter = { id: 'machine', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes: {
  create: { kind: 'local-forwarder', parser: { kind: 'json', pointer: '/origin' } },
  remove: { kind: 'local-forwarder' },
} };
const initial = { command: { type: 'start', sessionId: 'bridge', adapterId: 'machine', consent: true }, adapters: [machineAdapter], requirements: { clientReach: 'this-device' } };
const ack = (step, output, result, ok = true) => {
  const effect = output.effects[0];
  return step({ state: output.state, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok, result } });
};

test('real WASM bridge carries fixture through persist, candidate, exact approval and stop', async () => {
  const step = await loadCore();
  const intent = step(initial);
  assert.equal(intent.effects[0].kind, 'persist');
  assert.equal(intent.effects[0].operation, 'create');
  assert.equal(intent.effects[0].adapterId, 'machine');
  assert.equal(ack(step, intent, {}).effects.length, 0);
  const create = ack(step, intent, { durable: true });
  assert.equal(create.effects[0].kind, 'local-forwarder');
  const probe = ack(step, create, { origin: 'http://127.0.0.1:12345', resourceId: 'owned' });
  const candidate = ack(step, probe, { status: 200, vantage: 'local' });
  assert.equal(candidate.snapshot.phase, 'candidate-ready');
  assert.equal(candidate.snapshot.published, null);
  const stale = step({ state: candidate.state, command: { type: 'approve-origin', origin: candidate.snapshot.candidate, generation: 0 } });
  assert.equal(stale.snapshot.published, null);
  const approved = step({ state: candidate.state, command: { type: 'approve-origin', origin: candidate.snapshot.candidate, generation: candidate.snapshot.generation } });
  assert.equal(approved.snapshot.phase, 'published-ready');
  const stop = step({ state: approved.state, command: { type: 'stop' } });
  assert.equal(stop.snapshot.published, null);
  const remove = ack(step, stop, { durable: true });
  assert.equal(remove.effects[0].resourceId, 'owned');
  const failed = ack(step, remove, {}, false);
  assert.equal(failed.snapshot.phase, 'cleanup-pending');
  const retry = step({ state: failed.state, command: { type: 'reconcile' } });
  const removed = ack(step, ack(step, retry, { durable: true }), { removed: true, exitCode: 0 });
  assert.equal(removed.snapshot.phase, 'stopped');
});

test('real WASM ignores stale probe and tracks late create after stop', async () => {
  const step = await loadCore();
  const create = ack(step, step(initial), { durable: true });
  const probe = ack(step, create, { origin: 'http://127.0.0.1:12345', resourceId: 'owned' });
  const stop = step({ state: probe.state, command: { type: 'stop' } });
  const staleEffect = probe.effects[0];
  const stale = step({ state: stop.state, command: { type: 'effect-result', effectId: staleEffect.id,
    sessionId: staleEffect.sessionId, generation: staleEffect.generation, ok: true, result: { status: 200, vantage: 'local' } } });
  assert.equal(stale.snapshot.published, null);
  assert.notEqual(stale.snapshot.phase, 'candidate-ready');
  const stoppedCreating = step({ state: create.state, command: { type: 'stop' } });
  const late = ack(step, { ...create, state: stoppedCreating.state }, { origin: 'http://127.0.0.1:12345', resourceId: 'late-owned' });
  assert.equal(late.snapshot.resources[0].cleanup, 'pending');
  assert.equal(late.effects[0].operation, 'remove');
});

test('controller stop fences a slow effect before it finishes, and preserves failed cleanup debt', async t => {
  const step = await loadCore();
  const { journal } = await fixture(t, {});
  let completeCreate, createStarted;
  const started = new Promise(resolve => { createStarted = resolve; });
  const driver = { stopped: false, authorize() {}, closeLocal: async () => [], execute: async effect => {
    if (effect.operation === 'create' && effect.kind !== 'persist') {
      createStarted();
      return new Promise(resolve => { completeCreate = () => resolve({ type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation,
        ok: true, result: { origin: 'http://127.0.0.1:12345', resourceId: 'late' } }); });
    }
    return { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation,
      ok: effect.kind === 'persist', result: effect.kind === 'persist' ? { durable: true } : {} };
  } };
  const controller = new Controller({ step, journal, adapters: [machineAdapter], requirements: { clientReach: 'this-device' }, sessionId: 'test', driver });
  const start = controller.command({ type: 'start', adapterId: 'machine', consent: true });
  await started;
  const stopping = await controller.command({ type: 'stop' });
  assert.equal(stopping.snapshot.phase, 'stopping');
  assert.equal(stopping.snapshot.published, null);
  completeCreate();
  await start;
  assert.equal(controller.last.snapshot.phase, 'cleanup-pending');
  assert.equal(controller.last.snapshot.resources[0].cleanup, 'pending');
  assert.equal(controller.last.snapshot.published, null);
  assert.equal(driver.stopped, true);
});
