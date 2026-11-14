import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveLockedCredentials } from '../../packages/gozar-node/embedding-projections.mjs';
import { bindConfiguration } from '../../packages/gozar-node/adapter-configuration.mjs';

test('locked staged credentials survive projection without exposing extra custody fields', () => {
  const canary = 'synthetic-custody-canary';
  const snapshot = { revision: 'draft-2', scopeId: 'draft-scope', credentials: {
    replacement: { known: false, reason: 'secret_backend_locked', diagnostic: canary },
    absent: { known: true, value: false },
  }};
  const projected = { revision: snapshot.revision, scopeId: snapshot.scopeId,
    credentials: { absent: { known: true, value: false } }, actions: [] };
  const before = structuredClone({ snapshot, projected });
  const result = preserveLockedCredentials(projected, snapshot);
  assert.deepEqual(result.credentials.replacement, { known: false, reason: 'secret_backend_locked' });
  assert.deepEqual(result.credentials.absent, { known: true, value: false });
  assert.equal(result.revision, snapshot.revision);
  assert.equal(result.scopeId, snapshot.scopeId);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
  assert.deepEqual({ snapshot, projected }, before);
  const reloaded = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(preserveLockedCredentials(projected, reloaded), result);
  const unlocked = { ...snapshot, credentials: { replacement: { known: true, value: true } } };
  const applied = { revision: 'applied-1', credentials: { replacement: { known: true, value: true } } };
  assert.strictEqual(preserveLockedCredentials(applied, unlocked), applied);
  assert.deepEqual(applied.credentials.replacement, { known: true, value: true });
});

test('bound provider callback lock is not turned into missing or file-backed custody', async () => {
  const locked = Object.assign(new Error('synthetic lock'), { code: 'secret_backend_locked' });
  let isLocked = true, reads = 0;
  const context = bindConfiguration({
    // The callback, not the local path, is authoritative when supplied.
    home: '/path-that-must-not-be-used-for-custody',
    providerConfiguration: async providerId => {
      reads++;
      assert.equal(providerId, 'fixture');
      if (isLocked) throw locked;
      return { replacement: 'synthetic-unlocked-value' };
    },
  }, 'fixture');
  await assert.rejects(context.configuration(null), error => error === locked);
  isLocked = false;
  assert.deepEqual(await context.configuration(null), { replacement: 'synthetic-unlocked-value' });
  isLocked = true;
  await assert.rejects(context.configuration(undefined), error => error === locked);
  assert.equal(reads, 3);
});
