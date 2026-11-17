import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseRecordedConfigurationUse} from '../../packages/gozar-node/runtime-configuration-use.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

const scope = () => ({home: '/synthetic-unused-home', providerId: 'fixture-provider',
  owner: 'fixture-owner', handle: {kind: 'attached', id: 'fixture-route', generation: 1}});
for (const [label, services] of [
  ['missing', undefined], ['empty', {}], ['null method', {releaseConfigurationUse: null}],
  ['string method', {releaseConfigurationUse: 'not callable'}],
  ['object method', {releaseConfigurationUse: {}}],
]) {
  test('recorded release refuses ' + label + ' service with typed error', async () => {
    await assert.rejects(releaseRecordedConfigurationUse(scope(), {embeddingServices: services}),
      error => error.code === 'secret_backend_unavailable' && error.nextAction === null);
  });
}

test('matching service receives exact scope once with receiver and awaited completion', async () => {
  const request = {...scope(), registryId: 'fixture-registry'};
  let calls = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const services = {async releaseConfigurationUse(value) {
    assert.equal(this, services);
    assert.deepEqual(value, scope());
    assert.equal(value.handle, request.handle);
    calls++;
    await wait;
  }};
  let settled = false;
  const pending = releaseRecordedConfigurationUse(request,
    {registryId: 'fixture-registry', embeddingServices: services}).then(() => { settled = true; });
  assert.equal(calls, 1);
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await pending;
  assert.equal(settled, true);
  assert.equal(calls, 1);
});

test('real awaited dependency rejection retains exact error identity', async () => {
  const failure = Object.assign(new Error('synthetic persistence rejection'), {code: 'fixture_write_failed'});
  let calls = 0;
  const services = {async releaseConfigurationUse(value) {
    assert.equal(this, services);
    assert.deepEqual(value, scope());
    calls++;
    await Promise.resolve();
    throw failure;
  }};
  await assert.rejects(releaseRecordedConfigurationUse(scope(), {embeddingServices: services}),
    error => error === failure);
  assert.equal(calls, 1);
});

test('real metadata release preserves second hold, foreign registry and owner until exact release', async t => {
  const home = await mkdtemp(join(tmpdir(), 'gozar-recorded-reference-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  let credentialCalls = 0;
  const deny = () => { credentialCalls++; throw new Error('no credential operation allowed'); };
  const secretBackend = new Proxy({}, {get() { return deny; }});
  const first = createEmbeddingServices({registryId: 'registry-first', secretBackend});
  const foreign = createEmbeddingServices({registryId: 'registry-foreign', secretBackend});
  const one = {kind: 'attached', id: 'one', generation: 1};
  const two = {kind: 'attached', id: 'two', generation: 1};
  const a = {home, providerId: 'fixture-provider', owner: 'owner-a'};
  const b = {...a, owner: 'owner-b'};
  async function reserve(services, request, handles) {
    const configuration = await services.readConfiguration(request);
    for (const handle of handles)
      await services.registerConfigurationUse({...request, revision: configuration.revision, handle});
    const draft = await services.beginConfigurationDraft({...request,
      expectedConfigurationRevision: configuration.revision});
    return {...request, draftId: draft.draftId,
      expectedConfigurationRevision: draft.configuration.revision};
  }
  const draftA = await reserve(first, a, [one, two]);
  const draftB = await reserve(first, b, [one]);
  const draftForeign = await reserve(foreign, a, [one]);
  const held = (services, draft) => assert.rejects(services.commitConfigurationDraft(draft),
    {code: 'configuration_in_use'});
  const runtime = {registryId: 'registry-first', embeddingServices: first};
  await releaseRecordedConfigurationUse({...a, registryId: 'registry-first', handle: one}, runtime);
  await held(first, draftA);
  await held(first, draftB);
  await held(foreign, draftForeign);
  await releaseRecordedConfigurationUse({...a, registryId: 'registry-first', handle: two}, runtime);
  assert.equal(typeof (await first.commitConfigurationDraft(draftA)).revision, 'string');
  await held(first, draftB);
  await held(foreign, draftForeign);
  await releaseRecordedConfigurationUse({...b, registryId: 'registry-first', handle: one}, runtime);
  await first.commitConfigurationDraft(draftB);
  // Runtime belongs to first registry; helper must select the recorded foreign registry.
  await releaseRecordedConfigurationUse({...a, registryId: 'registry-foreign', handle: one}, runtime);
  await foreign.commitConfigurationDraft(draftForeign);
  assert.equal(credentialCalls, 0);
});
