// 0.5.2 defect 1: polling reads must never run live provider probes. One short-TTL retained detection per
// full scope (registry, home, owner, provider, platform, draft, configuration revision):
//   - a fresh hit serves the retained projection and runs ZERO provider probes;
//   - a cold or expired poll ALSO runs ZERO probes (declared unknown, or the retained projection with its
//     actual checked-at and fresh:false); only an explicit `refresh: true` owns and awaits the probes, and
//     concurrent explicit refreshes of one scope share one probe;
//   - a mutation drops the scope (every platform and draft) and a read displaced by it is never served;
//   - the retained projection holds no raw adapter facts and never feeds setup consent;
//   - consent redemption and route allocation keep revalidating live state.
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

test('polls never probe, cold or expired; an explicit refresh owns the probes and concurrent refreshes share one', async t => {
  const world = await cacheWorld(t);
  for (let i = 0; i < 4; i++) for (const row of (await read(world)).providers)
    assert.deepEqual(row.detection, { checkedAt: null, fresh: false, refreshing: false }, 'a cold poll answers declared unknown');
  assert.equal(probes(world), 0, 'cold polls run zero live probes');
  let entered = 0, release; const gate = new Promise(resolve => { release = resolve; });
  for (const adapter of world.adapters) { const detect = adapter.detect.bind(adapter); adapter.detect = async context => { entered += 1; await gate; return detect(context); }; }
  const pending = Array.from({ length: 5 }, () => read(world, { refresh: true }));
  const refreshing = await read(world); // a poll while the refresh is in flight never probes and reports it
  for (const row of refreshing.providers) assert.equal(row.detection.refreshing, true);
  while (entered < world.adapters.length) await new Promise(resolve => setImmediate(resolve)); // every provider's one probe has started
  await new Promise(resolve => setTimeout(resolve, 100)); // let the other four refresh reads reach the shared in-flight probe
  release();
  const concurrent = await Promise.all(pending);
  for (const reply of concurrent) for (const row of reply.providers) assert.equal(row.detection.fresh, true);
  assert.equal(entered, world.adapters.length, 'five overlapping same-scope refreshes shared one probe per provider');
  for (let i = 0; i < 4; i++) for (const row of (await read(world)).providers) assert.equal(row.detection.fresh, true);
  assert.equal(probes(world), world.adapters.length, 'fresh polls ran zero further probes');
  world.clock.value += 15_001;
  for (const row of (await read(world)).providers) {
    assert.equal(row.detection.fresh, false, 'the expired row is honestly not fresh');
    assert.equal(row.detection.refreshing, false, 'an expired poll starts no background refresh');
    assert.equal(Date.parse(row.detection.checkedAt), 1_000_000, 'checked-at is the retained observation time, not the poll time');
  }
  assert.equal(probes(world), world.adapters.length, 'an expired poll runs zero probes');
  await read(world, { refresh: true });
  assert.equal(probes(world), world.adapters.length * 2, 'only the explicit refresh re-probed');
});

test('scopes are isolated: another owner never shares an entry', async t => {
  const world = await cacheWorld(t);
  await read(world, { refresh: true });
  const other = await world.api.listProviders({ home: world.home, owner: 'another-owner' });
  for (const row of other.providers) assert.deepEqual(row.detection, { checkedAt: null, fresh: false, refreshing: false },
    'a different owner scope is cold, never another scope\'s observation');
  assert.equal(probes(world), world.adapters.length, 'the other owner\'s poll probed nothing');
});


test('red: a mutation drops the scope; the next read answers declared unknown until an explicit refresh', async t => {
  const world = await cacheWorld(t);
  const refreshed = await read(world, { refresh: true });
  const observed = refreshed.providers.find(row => row.providerId === 'cache-bravo');
  assert.equal(observed.detection.fresh, true);
  const setup = await world.api.runSetupAction({ home: world.home, owner: 'poll-owner', providerId: 'cache-bravo',
    expectedConfigurationRevision: observed.configuration.revision, actionId: observed.configuration.actions[0].id,
    value: 'changed-note',
    approval: { kind: 'setup', digest: observed.configuration.actions[0].digest,
      disclosureRevision: observed.configuration.actions[0].disclosure.revision,
      consentFactsDigest: observed.configuration.actions[0].consent.consentFactsDigest } });
  assert.equal(setup.state, 'complete');
  const before = probes(world);
  const after = await read(world);
  const moved = after.providers.find(row => row.providerId === 'cache-bravo');
  assert.equal(moved.detection.checkedAt, null, 'the mutation dropped the retained observation; no stale serve');
  assert.notEqual(moved.configuration.revision, observed.configuration.revision, 'the completed action moved the configuration revision');
  assert.equal(probes(world), before, 'the read after the mutation ran zero probes');
  assert.equal((await read(world, { refresh: true })).providers.find(row => row.providerId === 'cache-bravo').detection.fresh, true);
});

test('a catalogRevision reflects the retained observations (it moves when an observation moves)', async t => {
  const world = await cacheWorld(t);
  const cold = await read(world);
  const warm = await read(world, { refresh: true });
  assert.notEqual(cold.catalogRevision, warm.catalogRevision, 'the revision is derived from the registry-ordered inspections');
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

// Unit-level: the retained projection is closed, platform never splits an invalidation, and a read displaced
// by a mutation is never served.
import { createDetectionCache } from '../../packages/gozar-node/detection-cache.mjs';
const fakeAdapter = () => ({ id: 'p', definition: { capabilities: {}, facts: [{ id: 'keep', label: 'k', source: 'local-observation:/keep' }] },
  properties: () => ({}), setupActions: () => [], });
const scopeOf = (adapter, platform = 'linux') => ({ registryId: 'r', home: '/h', owner: 'o', providerId: 'p', platform, adapter });

test('the retained projection keeps only declared scalar facts; the explicit read is live, the retained one is not', async () => {
  const cache = createDetectionCache({ now: () => 5, ttlMs: 1_000 });
  const adapter = fakeAdapter();
  const detect = async () => ({ state: 'ready', facts: { keep: 1, secret: 'must-not-be-retained' }, probed: true, failure: null });
  const read = explicit => cache.provider({ scope: scopeOf(adapter), readConfiguration: async () => ({ revision: 'v1' }), detect, explicit });
  const live = await read(true);
  assert.equal(live.inspection.live, true);
  const retained = await read(false);
  assert.equal(retained.inspection.live, false);
  assert.deepEqual(retained.inspection.facts, { keep: 1 });
  assert.ok(![...cache.entries.values()].some(entry => JSON.stringify(entry.projection).includes('must-not-be-retained')));
});

test('an invalidation that names no platform drops every platform, and the displaced awaited read is not served', async () => {
  const cache = createDetectionCache({ now: () => 5, ttlMs: 1_000 });
  const adapter = fakeAdapter();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const detect = async () => { await gate; return { state: 'ready', facts: { keep: 2 }, probed: true, failure: null }; };
  await cache.provider({ scope: scopeOf(adapter, 'darwin'), readConfiguration: async () => ({ revision: 'v1' }), detect: async () => ({ state: 'ready', facts: {}, probed: true, failure: null }), explicit: true });
  const awaited = cache.provider({ scope: scopeOf(adapter), readConfiguration: async () => ({ revision: 'v1' }), detect, explicit: true });
  await new Promise(resolve => setImmediate(resolve));
  cache.invalidate({ registryId: 'r', home: '/h', owner: 'o', providerId: 'p' }); // no platform
  assert.equal(cache.entries.size, 0, 'both platforms were dropped');
  release();
  const served = await awaited;
  assert.deepEqual(served.detection, { checkedAt: null, fresh: false, refreshing: false });
  assert.equal(served.inspection.state, 'unknown', 'the displaced read serves declared unknown, never the old generation');
  assert.equal(cache.entries.size, 0, 'and stored nothing');
});
