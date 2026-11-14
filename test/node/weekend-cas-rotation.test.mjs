import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';

// Bounded services-level crash boundary, not the public two-host G3 journey.
test('discard persists reference removal before fallible backend deletion and retries cleanup', async () => {
  const scratch = join(homedir(), '.cache', 'gozar-regressions');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(scratch, 'discard-'));
  const entries = new Map();
  let deletes = 0;
  let failSecond = true;
  const secretBackend = {
    async put({ bytes }) {
      const handle = randomUUID();
      entries.set(handle, new Uint8Array(bytes));
      return { handle };
    },
    async withSecret({ handle }, use) {
      assert.ok(entries.has(handle), 'referenced credential must exist');
      return use(entries.get(handle));
    },
    async presence({ handle }) { return { known: true, value: entries.has(handle) }; },
    async delete({ handle }) {
      deletes++;
      if (failSecond && deletes === 2) throw new Error('injected offline backend failure');
      entries.delete(handle);
      return { deleted: true };
    },
  };
  const options = { registryId: randomUUID(), secretBackend };
  const first = createEmbeddingServices(options);
  const owner = randomUUID();
  const providerId = randomUUID();
  const scope = { home, owner, providerId };
  try {
    const applied = await first.readConfiguration(scope);
    const draft = await first.beginConfigurationDraft({
      ...scope, expectedConfigurationRevision: applied.revision,
    });
    let configuration = draft.configuration;
    for (const inputId of ['first', 'second']) {
      const request = { ...scope, draftId: draft.draftId,
        expectedConfigurationRevision: configuration.revision };
      const stored = await first.storeSecret({
        ...request, scopeId: configuration.scopeId, inputId,
        bytes: new TextEncoder().encode('synthetic-test-value'),
      });
      const changed = await first.mutateConfiguration(request,
        async tx => tx.bindSecret(inputId, stored.handle));
      configuration = changed.configuration;
    }
    await assert.rejects(first.discardConfigurationDraft({ ...scope, draftId: draft.draftId }),
      error => error.code === 'secret_backend_unavailable');
    assert.equal(deletes, 2, 'fault occurs after first successful backend removal');
    assert.equal(entries.size, 1);
    const restarted = createEmbeddingServices(options);
    await assert.rejects(restarted.readConfigurationDraft({ ...scope, draftId: draft.draftId }),
      error => error.code === 'configuration_stale',
      'persisted metadata cannot retain references to the removed credential');
    failSecond = false;
    assert.deepEqual(await restarted.discardConfigurationDraft({ ...scope, draftId: draft.draftId }),
      { discarded: false });
    assert.equal(entries.size, 0, 'retry must remove orphaned backend handle');
    const after = await restarted.readConfiguration(scope);
    assert.equal(after.revision, applied.revision);
    assert.deepEqual(after.credentials, applied.credentials);
    const beforeRepeat = deletes;
    assert.deepEqual(await restarted.discardConfigurationDraft({ ...scope, draftId: draft.draftId }),
      { discarded: false });
    assert.equal(deletes, beforeRepeat, 'fully reconciled discard does no backend work');
  } finally {
    for (const value of entries.values()) value.fill(0);
    entries.clear();
    await rm(home, { recursive: true, force: true });
  }
});
