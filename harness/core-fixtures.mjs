import assert from 'node:assert/strict';
import { loadCore } from '../packages/gozar-node/core.mjs';

export const fakeAdapter = (overrides = {}) => ({
  id: 'fixture', audience: 'public', ownership: 'owned', capabilities: { https: true, sse: true, streamableHttp: true },
  recipes: {
    detect: { kind: 'spawn', program: 'fixture-only', args: [], parser: { kind: 'contains', value: 'fixture-present' } },
    create: { kind: 'spawn', program: 'fixture-only', args: [], parser: { kind: 'url' } },
    remove: { kind: 'spawn', program: 'fixture-only', args: ['{resourceId}'] },
  }, ...overrides,
});
export const completion = (effect, result, ok = true) => ({ type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok, result });

// Real core, synthetic host completions. This never executes a provider recipe.
export async function runFakeEffects() {
  const step = await loadCore(); const trace = [];
  const run = input => { const output = step(input); trace.push({ command: input.command, effects: output.effects, snapshot: output.snapshot }); return output; };
  const initial = command => run({ command: { sessionId: 'fixture-session', ...command }, adapters: [fakeAdapter()], requirements: { clientReach: 'internet', httpsRequired: true, sse: true, streamableHttp: true } });
  const ack = (output, result, overrides = {}) => run({ state: output.state, command: { ...completion(output.effects[0], result), ...overrides } });
  let out = initial({ type: 'start', adapterId: 'fixture', consent: true });
  assert.equal(out.effects[0].kind, 'persist');
  const failedDurability = ack(out, {});
  assert.equal(failedDurability.snapshot.phase, 'failed'); assert.equal(failedDurability.effects.length, 0);
  const wrongSession = ack(out, { durable: true }, { sessionId: 'unrelated' });
  assert.deepEqual(wrongSession.state.pending, out.state.pending);
  const wrongGeneration = ack(out, { durable: true }, { generation: out.effects[0].generation + 1 });
  assert.deepEqual(wrongGeneration.state.pending, out.state.pending);
  out = ack(out, { durable: true }); assert.equal(out.effects[0].operation, 'create');
  const create = out.effects[0];
  const stoppedBeforeCreate = run({ state: out.state, command: { type: 'stop' } });
  const late = run({ state: stoppedBeforeCreate.state, command: completion(create, { stdout: 'https://fixture.invalid', resourceId: 'fixture-owned' }) });
  assert.equal(late.effects[0].kind, 'persist');
  let cleanup = ack(late, { durable: true }); assert.equal(cleanup.effects[0].operation, 'remove');
  assert.ok(JSON.stringify(cleanup.effects[0]).includes('fixture-owned'));
  cleanup = ack(cleanup, { removed: true, exitCode: 0 });
  assert.equal(cleanup.snapshot.phase, 'stopped'); assert.ok(cleanup.snapshot.resources.every(resource => resource.cleanup === 'removed'));
  out = ack(out, { stdout: 'https://fixture.invalid', resourceId: 'fixture-owned', exitCode: 0 });
  const local = ack(out, { status: 200, vantage: 'local', streaming: true });
  assert.equal(local.snapshot.phase, 'validating', 'local fetch must not satisfy public vantage');
  const missingTransport = ack(out, { status: 200, vantage: 'public', streaming: true });
  assert.equal(missingTransport.snapshot.phase, 'validating', 'SSE evidence alone cannot prove streamable HTTP');
  const missingStreaming = ack(out, { status: 200, vantage: 'public', streamableHttp: true });
  assert.equal(missingStreaming.snapshot.phase, 'validating', 'HTTP evidence alone cannot prove streaming');
  const candidate = ack(out, { status: 200, vantage: 'public', streaming: true, streamableHttp: true });
  assert.equal(candidate.snapshot.phase, 'candidate-ready'); assert.equal(candidate.snapshot.published, null);
  for (const approval of [{ origin: 'https://other.invalid', generation: candidate.snapshot.generation }, { origin: candidate.snapshot.candidate, generation: candidate.snapshot.generation + 1 }]) {
    const rejected = run({ state: candidate.state, command: { type: 'approve-origin', ...approval } });
    assert.equal(rejected.snapshot.published, null);
  }
  const published = run({ state: candidate.state, command: { type: 'approve-origin', origin: candidate.snapshot.candidate, generation: candidate.snapshot.generation } });
  assert.equal(published.snapshot.published, 'https://fixture.invalid');
  let oauth = run({ command: { type: 'start', sessionId: 'oauth-fixture', adapterId: 'fixture', consent: true }, adapters: [fakeAdapter({ capabilities: { https: true, sse: true, streamableHttp: true, oauthDcr: true } })], requirements: { clientReach: 'internet', sse: true, streamableHttp: true, oauthDcr: true } });
  oauth = ack(oauth, { durable: true });
  oauth = ack(oauth, { stdout: 'https://fixture.invalid', resourceId: 'oauth-fixture-owned' });
  const noDcr = ack(oauth, { status: 200, vantage: 'public', streaming: true, streamableHttp: true });
  assert.equal(noDcr.snapshot.phase, 'validating', 'transport proof cannot prove OAuth DCR');
  const withDcr = ack(oauth, { status: 200, vantage: 'public', streaming: true, streamableHttp: true, oauthDcr: true });
  assert.equal(withDcr.snapshot.phase, 'candidate-ready');
  const external = run({ command: { type: 'start', adapterId: 'foreign', consent: true }, adapters: [fakeAdapter({ id: 'foreign', ownership: 'external-owned', endpoint: 'https://external.invalid' })], requirements: { clientReach: 'internet' } });
  assert.ok(external.effects.every(effect => !['create', 'remove', 'persist'].includes(effect.operation)));
  const stopExternal = run({ state: external.state, command: { type: 'stop' } }); assert.equal(stopExternal.effects.length, 0);
  return { evidence: 'fake-effects-only', realRoute: false, outsideProof: false, trace };
}
