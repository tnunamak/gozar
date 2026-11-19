// 0.5.2 defect 1: polling reads must not run live provider probes every call. One short-TTL cached
// detection per full scope (registry, home, owner, provider, platform, configuration revision):
//   - a fresh hit serves the retained observation and runs ZERO provider probes;
//   - a cold or expired poll also runs ZERO probes (declared unknown / retained with actual checked-at)
//     while ONE same-scope background refresh converges it (single-flight under concurrency);
//   - an explicit `refresh: true` request awaits and owns the probes;
//   - the read after a setup/configuration/artifact mutation awaits one fresh detection, so a changed
//     draft or configuration is reflected immediately;
//   - consent redemption and route allocation keep revalidating live state: a provider that moved after
//     the catalog answered from cache still fails candidate_stale at redemption, and redemption probes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { redeemApproval } from '../../packages/gozar-node/attached-route.mjs';
import { action, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const settle = outcome => outcome.then(value => ({ value }), error => ({ error }));

// A factory over counting stub adapters (stubAdapter counts its own detect calls) with a fake clock.
// No injected services: the factory's own default backend and registry identity keep every surface
// (inventory, catalog, redemption) in one consistent scope.
async function cacheWorld(t, { adapters, ttlMs = 15_000 } = {}) {
  const clock = { value: 1_000_000 };
  const made = adapters ?? [stubAdapter('cache-alpha'), stubAdapter('cache-bravo', { state: 'action-required', actions: [action('set-note', 'provide-value', { valueFormat: 'text', required: true, valueLabel: 'Note' })] })];
  const api = createRouteApi({ adapters: made, now: () => clock.value, detectionTtlMs: ttlMs });
  return { api, adapters: made, clock, home: await scratch(t) };
}

const read = (world, request) => world.api.listProviders({ home: world.home, owner: 'poll-owner', ...request });
const probes = world => world.adapters.reduce((sum, adapter) => sum + adapter.calls.detect, 0);

test('repeated and concurrent polls run one probe per provider, not one per call', async t => {
  const world = await cacheWorld(t);
  const cold = await read(world);
  for (const row of cold.providers) assert.deepEqual(row.detection, { checkedAt: null, fresh: false, refreshing: true },
    'a cold poll answers a declared unknown with its actual (null) checked-at and one refresh started');
  await new Promise(resolve => setImmediate(resolve)); // let the single-flight refresh finish
  for (let i = 0; i < 4; i++) await read(world);
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => read(world)));
  for (const reply of concurrent) for (const row of reply.providers) {
    assert.equal(row.detection.fresh, true);
    assert.equal(typeof row.detection.checkedAt, 'string');
  }
  assert.equal(probes(world), world.adapters.length, 'exactly one live detection per provider across every poll');
});

test('an expired entry serves the retained observation with its actual checked-at and starts one refresh; an explicit refresh owns the probes', async t => {
  const world = await cacheWorld(t, { ttlMs: 15_000 });
  await read(world); // cold + background refresh
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes(world), world.adapters.length, 'one refresh per provider so far');
  world.clock.value += 15_001; // the fake clock moves past the TTL
  const stale = await read(world);
  for (const row of stale.providers) {
    assert.equal(row.detection.fresh, false, 'the expired row is honestly not fresh');
    assert.equal(row.detection.refreshing, true, 'one background refresh converges it');
    assert.equal(Date.parse(row.detection.checkedAt), 1_000_000, 'checked-at is the retained observation time, not the poll time');
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes(world), world.adapters.length * 2, 'the expired poll converged with exactly one refresh per provider');
  const explicit = await read(world, { refresh: true });
  for (const row of explicit.providers) assert.equal(row.detection.fresh, true);
  assert.equal(probes(world), world.adapters.length * 3, 'an explicit refresh owns the probes and awaits them');
});

test('scopes are isolated: another owner, home or platform never shares an entry', async t => {
  const world = await cacheWorld(t);
  await read(world);
  await new Promise(resolve => setImmediate(resolve));
  const other = await world.api.listProviders({ home: world.home, owner: 'another-owner' });
  for (const row of other.providers) assert.deepEqual(row.detection, { checkedAt: null, fresh: false, refreshing: true },
    'a different owner scope is cold, never another scope\'s observation');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes(world), world.adapters.length * 2, 'each scope refreshed its own entries exactly once');
});

test('red: a changed draft or configuration reflects immediately: the next read awaits one fresh detection', async t => {
  const world = await cacheWorld(t);
  const before = await read(world);
  const provider = before.providers.find(row => row.providerId === 'cache-bravo');
  assert.ok(provider, 'the action-required provider is listed');
  await new Promise(resolve => setImmediate(resolve)); // let the cold row's refresh converge
  const warm = await read(world);
  const observed = warm.providers.find(row => row.providerId === 'cache-bravo');
  assert.equal(observed.detection.fresh, true);
  // Complete its setup action through the public API: this is the mutation point.
  const setup = await world.api.runSetupAction({ home: world.home, owner: 'poll-owner', providerId: 'cache-bravo',
    expectedConfigurationRevision: observed.configuration.revision, actionId: observed.configuration.actions[0].id,
    value: 'changed-note',
    approval: { kind: 'setup', digest: observed.configuration.actions[0].digest,
      disclosureRevision: observed.configuration.actions[0].disclosure.revision,
      consentFactsDigest: observed.configuration.actions[0].consent.consentFactsDigest } });
  assert.equal(setup.state, 'complete');
  const after = await read(world);
  const moved = after.providers.find(row => row.providerId === 'cache-bravo');
  assert.equal(moved.detection.fresh, true, 'the read after the mutation awaited a fresh detection');
  assert.notEqual(moved.configuration.revision, observed.configuration.revision, 'the completed action moved the configuration revision');
  const fresh = world.adapters.find(adapter => adapter.id === 'cache-bravo');
  assert.ok(fresh.calls.detect >= 2, 'the mutation forced a new live detection, never a stale retained one');
});

test('red: cached candidates never feed authority: a provider that moved after the catalog fails candidate_stale at live redemption', async t => {
  const world = await cacheWorld(t, { adapters: [stubAdapter('cache-alpha')] });
  const q = query({ home: world.home, owner: 'poll-owner', usage: { kind: 'attached' } });
  // The route catalog always observes live (it issues consent tokens), so the candidate is eligible;
  // the inventory is the cached surface. Redemption must re-prove the provider independently regardless.
  const catalog = await world.api.catalogRoutes(q);
  const candidate = catalog.candidates[0];
  assert.equal(candidate.eligible, true);
  const detectCalls = world.adapters[0].calls.detect;
  // The provider moves after the catalog answered from cache.
  const moved = stubAdapter('cache-alpha');
  moved.plan = async (ctx, request) => ({ digest: 'plan-changed', origin: null, resourceKey: 'res-cache-alpha', effects: [], readback: null, cleanup: null, precondition: null });
  const request = { ...q, approval: { kind: 'route', candidateToken: candidate.candidateToken,
    disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest }, wait: 'verified' };
  const { createEmbeddingServices } = await import('../../packages/gozar-node/embedding-services.mjs');
  const { registryIdentity } = await import('../../packages/gozar-node/registry-identity.mjs');
  const registryId = await registryIdentity({ adapters: [moved] });
  const outcome = await settle(redeemApproval(request, { adapters: [moved], embeddingServices: createEmbeddingServices({ registryId }),
    registryId, platform: 'linux',
    readContext: { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } }));
  assert.ok(outcome.error, 'redemption revalidates live and refuses the moved provider');
  assert.equal(outcome.error.code, 'candidate_stale');
  assert.ok(moved.calls.detect >= 1, 'the redemption path itself probed the provider live');
  assert.equal(world.adapters[0].calls.detect, detectCalls, 'the cached catalog observation was not consulted at redemption');
});

test('an invalid TTL declaration is refused before anything runs', async () => {
  assert.throws(() => createRouteApi({ detectionTtlMs: 5 }), { code: 'invalid_input' });
  assert.throws(() => createRouteApi({ detectionTtlMs: 1_000_000 }), { code: 'invalid_input' });
});
