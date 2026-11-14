import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const repositoryRoot = new URL(import.meta.url);
repositoryRoot.pathname = repositoryRoot.pathname.replace(/test\/node\/[^/]+$/, '');
const { createEmbeddingServices } = await import(new URL('packages/gozar-node/embedding-services.mjs', repositoryRoot));

// Bounded services-level crash boundary, not the public two-host G3 journey.
test('discard persists reference removal before fallible backend deletion and retries cleanup', async () => {
  const scratch = join(homedir(), '.tmp');
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
      entries.get(handle)?.fill(0);
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
      const bytes = new TextEncoder().encode('synthetic-test-value');
      let stored;
      try { stored = await first.storeSecret({
        ...request, scopeId: configuration.scopeId, inputId, bytes,
      }); } finally { bytes.fill(0); }
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
    assert.equal(deletes, 3, 'retry deletes only the exact remaining orphan');
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

test('independent services enforce draft CAS and separate owner scope', async () => {
  const scratch = join(homedir(), '.tmp');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(scratch, 'draft-cas-'));
  let backendCalls = 0;
  const unexpected = async () => { backendCalls++; throw new Error('unexpected backend access'); };
  const options = { registryId: randomUUID(), secretBackend: {
    put: unexpected, withSecret: unexpected, presence: unexpected, delete: unexpected,
  } };
  const first = createEmbeddingServices(options);
  const second = createEmbeddingServices(options);
  const scope = { home, owner: randomUUID(), providerId: randomUUID() };
  const other = { ...scope, owner: randomUUID() };
  try {
    const applied = await first.readConfiguration(scope);
    const separate = await second.readConfiguration(other);
    assert.notEqual(applied.scopeId, separate.scopeId);
    const [left, right] = await Promise.all([
      first.beginConfigurationDraft({ ...scope, expectedConfigurationRevision: applied.revision }),
      second.beginConfigurationDraft({ ...scope, expectedConfigurationRevision: applied.revision }),
    ]);
    assert.notEqual(left.draftId, right.draftId);
    await assert.rejects(second.readConfigurationDraft({ ...other, draftId: left.draftId }),
      error => error.code === 'configuration_stale');
    const changed = await first.mutateConfiguration({
      ...scope, draftId: left.draftId, expectedConfigurationRevision: left.configuration.revision,
    }, async tx => tx.bindText('synthetic-setting', 'left'));
    await assert.rejects(second.mutateConfiguration({
      ...scope, draftId: left.draftId, expectedConfigurationRevision: left.configuration.revision,
    }, async tx => tx.bindText('synthetic-setting', 'stale')),
    error => error.code === 'configuration_stale');
    const committed = await second.commitConfigurationDraft({
      ...scope, draftId: left.draftId, expectedConfigurationRevision: changed.configuration.revision,
    });
    assert.equal(committed.values['synthetic-setting'], 'left');
    await assert.rejects(first.commitConfigurationDraft({
      ...scope, draftId: right.draftId, expectedConfigurationRevision: right.configuration.revision,
    }), error => error.code === 'configuration_stale');
    assert.deepEqual(await second.readConfiguration(other), separate);
    const restarted = createEmbeddingServices(options);
    assert.deepEqual(await restarted.discardConfigurationDraft({ ...scope, draftId: right.draftId }),
      { discarded: true });
    assert.deepEqual(await restarted.readConfiguration(scope), committed);
    assert.equal(backendCalls, 0, 'text-only CAS and owner controls require no credential work');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
