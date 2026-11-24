import assert from 'node:assert/strict';
import test from 'node:test';
import { listenerSdk } from '../../adapters/providers/_shared/listener-effects.mjs';

test('fixture listener reports unavailable runtime without attempting an allocation', async () => {
  const calls = [];
  await assert.rejects(listenerSdk({
    dispatchEffect: async ({ operation }) => {
      calls.push(operation);
      return { available: false };
    },
  }, () => assert.fail('must not load a provider SDK')), { code: 'setup_required' });
  assert.deepEqual(calls, ['detect']);
});

test('fixture listener distinguishes confirmed absence from unknown presence', async () => {
  const calls = [];
  const sdk = await listenerSdk({
    dispatchEffect: async ({ operation, input }) => {
      calls.push(operation);
      if (operation === 'detect') return { available: true };
      assert.equal(operation, 'read');
      return input.handle === 'fake-absent' ? { present: false } : {};
    },
  }, () => assert.fail('must not load a provider SDK'));
  assert.equal(await sdk.getListener('fake-absent'), null);
  await assert.rejects(sdk.getListener('fake-unknown'), { code: 'provider_unavailable' });
  assert.deepEqual(calls, ['detect', 'read', 'read']);
});
