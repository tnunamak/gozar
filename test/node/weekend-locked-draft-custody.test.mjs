import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {clearInputActions} from '../../packages/gozar-node/embedding-setup.mjs';

// Conservative boundary: service snapshots and clear-action discovery only.
// This does not qualify the public factory's adapter/input projection.
test('partial conservative custody: locked staged replacement retains presence and revision across restart', async t => {
  const home = await mkdtemp(join(tmpdir(), 'gozar-custody-'));
  await chmod(home, 0o700);
  t.after(() => rm(home, {recursive: true, force: true}));
  const canary = 'synthetic-' + randomUUID();
  const records = new Map();
  let mode = 'ready', reads = 0;
  const secretBackend = {
    async put({bytes}) {
      const handle = 'opaque-' + randomUUID();
      records.set(handle, new Uint8Array(bytes));
      return {handle};
    },
    async withSecret({handle}, use) {
      reads++;
      if (!records.has(handle)) throw Object.assign(new Error('missing'), {code: 'missing'});
      return use(new Uint8Array(records.get(handle)));
    },
    async presence({handle}) {
      if (mode === 'locked') throw Object.assign(new Error('locked'), {code: 'secret_backend_locked'});
      if (mode === 'unavailable') throw Object.assign(new Error('unavailable'), {code: 'host_offline'});
      return {known: true, value: mode !== 'missing' && records.has(handle)};
    },
    async delete({handle}) { return {deleted: records.delete(handle)}; },
  };
  const registryId = 'registry-' + randomUUID(), providerId = 'provider-' + randomUUID();
  const owner = 'owner-' + randomUUID();
  const request = {home, owner, providerId};
  const open = () => createEmbeddingServices({registryId, secretBackend});
  let services = open();
  const initial = await services.readConfiguration(request);
  const old = await services.storeSecret({...request, inputId: 'credential',
    scopeId: initial.scopeId, expectedConfigurationRevision: initial.revision,
    bytes: new TextEncoder().encode(canary + '-applied')});
  const applied = await services.mutateConfiguration({...request,
    expectedConfigurationRevision: initial.revision},
    tx => tx.bindSecret('credential', old.handle));
  const draft = await services.beginConfigurationDraft({...request,
    expectedConfigurationRevision: applied.configuration.revision});
  const scoped = {...request, draftId: draft.draftId};
  const replacement = await services.storeSecret({...scoped, inputId: 'credential',
    scopeId: draft.scopeId, expectedConfigurationRevision: draft.configuration.revision,
    bytes: new TextEncoder().encode(canary + '-draft')});
  await services.mutateConfiguration({...scoped,
    expectedConfigurationRevision: draft.configuration.revision},
    tx => tx.bindSecret('credential', replacement.handle));
  const ready = await services.readConfigurationDraft(scoped);
  const statePath = join(home, 'embedding-state.json');
  const diskBefore = await readFile(statePath, 'utf8');
  const rawReads = reads;
  services = open();
  const observed = [];
  for (const [nextMode, expected] of [
    ['locked', {known: false, reason: 'secret_backend_locked'}],
    ['unavailable', {known: false, reason: 'secret_backend_unavailable'}],
    ['missing', {known: true, value: false}],
    ['ready', {known: true, value: true}],
  ]) {
    mode = nextMode;
    const view = await services.readConfigurationDraft(scoped);
    observed.push(view);
    assert.deepEqual(view.configuration.credentials.credential, expected);
    assert.equal(view.configuration.revision, ready.configuration.revision);
    assert.equal(view.baseRevision, ready.baseRevision);
    assert.deepEqual(clearInputActions(view.configuration), clearInputActions(ready.configuration));
    assert.equal(await readFile(statePath, 'utf8'), diskBefore);
    assert.equal(reads, rawReads, 'presence projection must not resolve raw bytes');
  }
  const appliedAfter = await services.readConfiguration(request);
  assert.equal(appliedAfter.revision, applied.configuration.revision);
  assert.deepEqual(appliedAfter.credentials, applied.configuration.credentials);
  await assert.rejects(services.discardSecret({home, handle: replacement.handle}),
    error => error.code === 'secret_in_use');
  await services.mutateConfiguration({...scoped,
    expectedConfigurationRevision: ready.configuration.revision},
    tx => tx.clearInput('credential'));
  const cleared = await services.readConfigurationDraft(scoped);
  assert.equal(Object.hasOwn(cleared.configuration.credentials, 'credential'), false);
  assert.deepEqual(clearInputActions(cleared.configuration), []);
  assert.deepEqual(await services.discardSecret({home, handle: replacement.handle}), {discarded: true});
  assert.equal(records.has(replacement.handle), false);
  assert.equal(records.has(old.handle), true, 'draft discard must preserve applied secret');
  assert.deepEqual(await services.discardConfigurationDraft(scoped), {discarded: true});
  assert.equal(JSON.stringify([...observed, appliedAfter, cleared]).includes(canary), false);
  async function scan(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else assert.equal((await readFile(path, 'utf8')).includes(canary), false);
    }
  }
  await scan(home);
});
