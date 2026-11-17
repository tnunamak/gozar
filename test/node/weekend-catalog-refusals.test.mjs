// Partial provider-neutral boundary coverage; public configured-audience qualification is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAdapter} from '../../packages/gozar-node/route-catalog.mjs';

for (const [code, reason, state] of [
  ['secret_backend_locked', 'secret_backend_locked', 'unknown'],
  ['ENOENT', 'software_missing', 'missing'],
  ['host_policy_denied', 'host_policy_denied', 'denied'],
  ['unsupported', 'read_operation_unsupported', 'unsupported'],
  ['provider_unavailable', 'provider_unavailable', 'unknown']
]) {
  test(`catalog detection preserves sanitized ${reason}, including swallowed effects`, async () => {
    for (const swallow of [false, true]) {
      const adapter = {
        id: 'runtime-unknown-provider',
        definition: {capabilities: {}},
        detect: async context => {
          try { await context.dispatchEffect({kind: 'synthetic', operation: 'read'}); }
          catch (error) { if (!swallow) throw error; }
          return {state: 'unknown', facts: {detected: null}};
        },
        properties: () => ({}),
        setupActions: () => []
      };
      const result = await inspectAdapter(adapter, {
        dispatchEffect: async () => { throw Object.assign(new Error('PRIVATE_PROVIDER_OUTPUT'), {code, nextAction: {label: 'PRIVATE_INPUT'}}); }
      }, 'linux');
      assert.equal(result.state, 'unknown');
      assert.equal(result.failure.reason, reason);
      assert.equal(result.failure.state, state);
      assert.equal(result.failure.observation.known, false);
      assert.equal(result.failure.observation.reason, reason);
      assert.ok(result.failure.remedy.instructions);
      assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_OUTPUT'), false);
      assert.equal(JSON.stringify(result).includes('PRIVATE_INPUT'), false);
    }
  });
}
test('unknown thrown diagnostics never become raw catalog reason or action', async () => {
  const result = await inspectAdapter({
    id: 'another-runtime-provider', definition: {capabilities: {}},
    detect: async () => { throw Object.assign(new Error('PRIVATE_PROVIDER_OUTPUT'), {code: 'PRIVATE_INPUT'}); }
  }, {}, 'linux');
  assert.equal(result.failure.reason, 'observation_unavailable');
  assert.equal(result.failure.observation.known, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('successful read-only observation remains ready without a refusal', async () => {
  const result = await inspectAdapter({
    id: 'third-runtime-provider', definition: {capabilities: {}},
    detect: async context => {
      await context.dispatchEffect({kind: 'synthetic', operation: 'read'});
      return {state: 'ready', facts: {detected: true}};
    },
    properties: () => ({}), setupActions: () => []
  }, {dispatchEffect: async () => ({ok: true})}, 'linux');
  assert.equal(result.state, 'ready');
  assert.equal(result.failure, null);
});
