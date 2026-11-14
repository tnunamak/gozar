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

async function cleanupFixture(run) {
  const scratch = join(homedir(), '.tmp');
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(scratch, 'cleanup-authority-'));
  const entries = new Map();
  const calls = { deletes: [], presence: [] };
  const fault = { presence: 'normal', deletion: 'normal' };
  const backend = {
    async put({ bytes }) {
      const handle = randomUUID();
      entries.set(handle, new Uint8Array(bytes));
      return { handle };
    },
    async withSecret({ handle }, use) {
      assert.ok(entries.has(handle));
      return use(entries.get(handle));
    },
    async presence({ handle }) {
      calls.presence.push(handle);
      if (fault.presence === 'locked') throw { code: 'secret_backend_locked' };
      if (fault.presence === 'unavailable') throw new Error('synthetic unavailable');
      if (fault.presence === 'unknown') return { known: false, reason: 'not_observed' };
      if (fault.presence === 'invalid') return { known: true, value: 'false' };
      return { known: true, value: entries.has(handle) };
    },
    async delete({ handle }) {
      calls.deletes.push(handle);
      if (fault.deletion === 'lie') return { deleted: true };
      entries.get(handle)?.fill(0);
      entries.delete(handle);
      if (fault.deletion === 'after-delete') throw new Error('synthetic interrupted acknowledgement');
      return { deleted: true };
    },
  };
  const registryId = randomUUID();
  const service = (registry = registryId) => createEmbeddingServices({ registryId: registry, secretBackend: backend });
  const scope = { home, owner: randomUUID(), providerId: randomUUID() };
  async function stage(s, target = scope, inputId = 'staged') {
    const applied = await s.readConfiguration(target);
    const draft = await s.beginConfigurationDraft({ ...target, expectedConfigurationRevision: applied.revision });
    const request = { ...target, draftId: draft.draftId, expectedConfigurationRevision: draft.configuration.revision };
    const bytes = new TextEncoder().encode('synthetic-cleanup-fixture');
    let stored;
    try {
      stored = await s.storeSecret({ ...request, scopeId: draft.scopeId, inputId, bytes });
    } finally { bytes.fill(0); }
    const changed = await s.mutateConfiguration(request, tx => tx.bindSecret(inputId, stored.handle));
    return { applied, draft, request, handle: stored.handle, configuration: changed.configuration };
  }
  try { await run({ service, scope, stage, entries, calls, fault }); }
  finally {
    for (const bytes of entries.values()) bytes.fill(0);
    entries.clear();
    await rm(home, { recursive: true, force: true });
  }
}

const normalized = code => error =>
  error.code === code && error.message === code.replaceAll('_', ' ') && error.nextAction === null;

test('delete then throw reconciles known absence after restart without duplicate deletion', async () => {
  await cleanupFixture(async ({ service, scope, stage, entries, calls, fault }) => {
    const item = await stage(service());
    fault.deletion = 'after-delete';
    await assert.rejects(service().discardConfigurationDraft(item.request), normalized('secret_backend_unavailable'));
    assert.equal(entries.size, 0);
    assert.deepEqual(calls.deletes, [item.handle]);
    await assert.rejects(service().readConfigurationDraft(item.request), normalized('configuration_stale'));
    fault.deletion = 'normal';
    assert.deepEqual(await service().discardConfigurationDraft(item.request), { discarded: false });
    assert.deepEqual(calls.deletes, [item.handle]);
    const observed = calls.presence.length;
    assert.deepEqual(await service().discardConfigurationDraft(item.request), { discarded: false });
    assert.equal(calls.presence.length, observed, 'confirmed absent debt is durably cleared');
    assert.deepEqual(await service().readConfiguration(scope), item.applied);
  });
});

for (const mode of ['unknown', 'locked', 'unavailable', 'invalid']) {
  test('discard preserves cleanup authority on ' + mode + ' presence until recovery', async () => {
    await cleanupFixture(async ({ service, scope, stage, entries, calls, fault }) => {
      const item = await stage(service());
      fault.presence = mode;
      const expected = mode === 'locked' ? 'secret_backend_locked' : 'secret_backend_unavailable';
      await assert.rejects(service().discardConfigurationDraft(item.request), normalized(expected));
      assert.deepEqual(calls.deletes, []);
      assert.equal(entries.size, 1);
      await assert.rejects(service().readConfigurationDraft(item.request), normalized('configuration_stale'));
      await assert.rejects(service().discardConfigurationDraft(item.request), normalized(expected));
      assert.deepEqual(calls.deletes, []);
      fault.presence = 'normal';
      assert.deepEqual(await service().discardConfigurationDraft(item.request), { discarded: false });
      assert.deepEqual(calls.deletes, [item.handle], 'positive recovery removes the exact orphan once');
      assert.equal(entries.size, 0);
      const observed = calls.presence.length;
      assert.deepEqual(await service().discardConfigurationDraft(item.request), { discarded: false });
      assert.equal(calls.presence.length, observed);
      assert.deepEqual(await service().readConfiguration(scope), item.applied);
    });
  });
}

test('false deletion acknowledgement retains debt until verified physical removal', async () => {
  await cleanupFixture(async ({ service, scope, stage, entries, calls, fault }) => {
    const item = await stage(service());
    fault.deletion = 'lie';
    await assert.rejects(service().discardConfigurationDraft(item.request), normalized('secret_backend_unavailable'));
    assert.equal(entries.size, 1);
    assert.deepEqual(calls.deletes, [item.handle]);
    await assert.rejects(service().readConfigurationDraft(item.request), normalized('configuration_stale'));
    fault.deletion = 'normal';
    assert.deepEqual(await service().discardConfigurationDraft(item.request), { discarded: false });
    assert.equal(entries.size, 0);
    assert.deepEqual(calls.deletes, [item.handle, item.handle], 'one false acknowledgement then one real removal');
    const observed = calls.presence.length;
    await service().discardConfigurationDraft(item.request);
    assert.equal(calls.presence.length, observed);
    assert.equal(calls.deletes.length, 2);
    assert.deepEqual(await service().readConfiguration(scope), item.applied);
  });
});

test('discard respects applied use, inherited references and foreign cleanup authority', async () => {
  await cleanupFixture(async ({ service, scope, stage, entries, calls }) => {
    const s = service();
    const promoted = await stage(s, scope, 'live');
    const applied = await s.commitConfigurationDraft({
      ...promoted.request, expectedConfigurationRevision: promoted.configuration.revision,
    });
    const use = { route: 'synthetic-route' };
    await s.registerConfigurationUse({ ...scope, revision: applied.revision, handle: use });
    const inherited = await s.beginConfigurationDraft({ ...scope, expectedConfigurationRevision: applied.revision });
    await assert.rejects(s.commitConfigurationDraft({
      ...scope, draftId: inherited.draftId, expectedConfigurationRevision: inherited.configuration.revision,
    }), normalized('configuration_in_use'));
    // Committed credentials retain their original draft metadata. Matching metadata
    // alone must never authorize deleting a currently referenced applied credential.
    assert.deepEqual(await service().discardConfigurationDraft(promoted.request), { discarded: false });
    assert.deepEqual(await service().discardConfigurationDraft({ ...scope, draftId: inherited.draftId }), { discarded: true });
    assert.deepEqual(calls.deletes, []);
    const victim = await stage(s, scope, 'orphan');
    const otherOwner = await stage(s, { ...scope, owner: randomUUID() });
    const otherProvider = await stage(s, { ...scope, providerId: randomUUID() });
    const otherDraft = await stage(s);
    const foreign = service(randomUUID());
    const otherRegistry = await stage(foreign);
    for (const foreignService of [service(), foreign]) {
      const targets = foreignService === foreign ? [scope] : [otherOwner.request, otherProvider.request];
      for (const target of targets) {
        assert.deepEqual(await foreignService.discardConfigurationDraft({ ...target, draftId: victim.draft.draftId }), { discarded: false });
      }
    }
    assert.deepEqual(calls.deletes, [], 'foreign scope/registry cannot acquire victim cleanup authority');
    assert.deepEqual(await service().discardConfigurationDraft(victim.request), { discarded: true });
    assert.deepEqual(calls.deletes, [victim.handle]);
    assert.equal(entries.has(victim.handle), false);
    for (const protectedItem of [promoted, otherOwner, otherProvider, otherDraft, otherRegistry]) {
      assert.equal(entries.has(protectedItem.handle), true, 'unrelated and applied bytes stay present');
    }
    assert.deepEqual(await service().readConfiguration(scope), applied);
    await service().readConfigurationDraft(otherOwner.request);
    await service().readConfigurationDraft(otherProvider.request);
    await service().readConfigurationDraft(otherDraft.request);
    await foreign.readConfigurationDraft(otherRegistry.request);
    await service().releaseConfigurationUse({ ...scope, handle: use });
  });
});
