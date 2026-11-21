import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteApi, fakeReadContext } from '../../packages/gozar-node/testing.mjs';
import { listProviders } from '../../packages/gozar-node/embedding-inventory.mjs';
import { createDetectionCache } from '../../packages/gozar-node/detection-cache.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { scratch, stubAdapter } from './route-schema-check.mjs';

const OWNER = 'presentation-fixture';
const ID = 'presentation';
const COLD = { checkedAt: null, fresh: false, refreshing: false };
const first = async result => (await result).providers[0];
function latch() {
  let open;
  const reached = new Promise(resolve => { open = resolve; });
  return { reached, open };
}

async function fixture(t) {
  const home = await scratch(t);
  let at = Date.parse('2026-11-20T00:00:00Z'), rev, setupCalls = 0, detections = 0, hold, readLatch;
  const subject = stubAdapter(ID);
  const originalDetect = subject.detect.bind(subject);
  const adapter = {
    ...subject,
    definition: { ...subject.definition, facts: [{ id: 'fixture-observation', label: 'Fixture observation',
      group: 'proof', affectsConsent: false, source: 'local-observation:/observation' }] },
    async detect(ctx) {
      const n = ++detections, barrier = hold;
      if (barrier) {
        barrier.entered.open();
        await barrier.release.reached;
      }
      const result = await originalDetect(ctx);
      return { ...result, facts: { ...result.facts, observation: 'observation-' + n } };
    },
    async setup() { setupCalls++; throw new Error('The list must not invoke setup'); },
  };
  const registryId = await registryIdentity({ adapters: [adapter] });
  const real = createEmbeddingServices({ registryId });
  const embeddingServices = {
    ...real,
    async readConfiguration(request) {
      const saved = await real.readConfiguration(request);
      readLatch?.open();
      return rev === undefined ? saved : { ...saved, revision: rev };
    },
  };
  const readContext = fakeReadContext({ home, now: () => at });
  const detection = createDetectionCache({ now: () => at, ttlMs: 1_000 });
  const deps = { adapters: [adapter], registryId, embeddingServices, readContext, platform: 'linux', detection };
  const request = { home, owner: OWNER };
  const api = createRouteApi({ ...deps, detectionTtlMs: 1_000 });
  t.after(() => hold?.release.open());
  return {
    api: refresh => first(api.listProviders({ ...request, refresh })),
    list: (refresh = false) => first(listProviders({ ...request, refresh }, deps)),
    setClock: ms => { at += ms; },
    counts: () => ({ detections, setupCalls }),
    fact: row => row.facts.find(fact => fact.id === 'fixture-observation'),
    holdNext() {
      hold = { entered: latch(), release: latch() };
      return hold;
    },
    nextConfigurationRead() { readLatch = latch(); return readLatch.reached; },
    mutate() {
      rev = 'fixture-mutation-v2';
      detection.invalidate({ registryId, home, owner: OWNER, providerId: ID });
    },
  };
}

test('passive presentation is not a probe, even when cold or expired', async t => {
  const f = await fixture(t);
  async function noProbe(read) {
    const before = f.counts();
    const row = await read();
    assert.deepEqual(f.counts(), before, 'passive presentation must run no probe or setup');
    return row;
  }
  const cold = await noProbe(() => f.list());
  assert.deepEqual(cold.detection, COLD);
  assert.equal(f.fact(cold)?.known, false, 'cold facts stay unknown');
  const live = await f.list(true);
  assert.equal(live.detection.fresh, true);
  assert.equal(f.fact(live)?.value, 'observation-1');
  const warm = await noProbe(() => f.list());
  assert.deepEqual(warm.detection, live.detection);
  assert.equal(warm.configuration.revision, live.configuration.revision);
  f.setClock(1_001);
  const expired = await noProbe(() => f.list());
  assert.deepEqual(expired.detection, { ...warm.detection, fresh: false });
  assert.equal(f.fact(expired)?.value, f.fact(warm)?.value);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });

  // Causal negative: the same read invariant must reject a polling wrapper that
  // changes only the authority to probe. No production source is modified.
  await assert.rejects(noProbe(() => f.list(true)), /passive presentation must run no probe or setup/);
  assert.deepEqual(f.counts(), { detections: 2, setupCalls: 0 });
});

test('simultaneous explicit public refreshes share one observation without setup', async t => {
  const f = await fixture(t);
  const barrier = f.holdNext();
  const one = f.api(true);
  let two;
  try {
    await Promise.race([barrier.entered.reached, one.then(() => assert.fail('refresh returned before its probe'))]);
    const secondRead = f.nextConfigurationRead();
    two = f.api(true);
    await Promise.race([secondRead, two.then(() => assert.fail('second refresh returned before reading configuration'))]);
    assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  } finally {
    barrier.release.open();
    // Both reads are joined even if a causal assertion fails.
    await Promise.allSettled(two ? [one, two] : [one]);
  }
  const replies = await Promise.all([one, two]);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  assert.equal(replies[0].detection.fresh, true);
  assert.deepEqual(replies[0].detection, replies[1].detection);
  assert.equal(f.fact(replies[0])?.value, f.fact(replies[1])?.value);
});

test('an admitted refresh displaced by mutation cannot serve or retain the discarded observation', async t => {
  const f = await fixture(t);
  const before = await f.list();
  const barrier = f.holdNext();
  const old = f.list(true);
  try {
    await Promise.race([barrier.entered.reached, old.then(() => assert.fail('refresh returned before its probe'))]);
    assert.deepEqual((await f.list()).detection, { ...COLD, refreshing: true });
    f.mutate();
    const next = await f.list();
    assert.notEqual(next.configuration.revision, before.configuration.revision);
    assert.deepEqual(next.detection, COLD);
    assert.equal(f.fact(next)?.known, false);
  } finally {
    barrier.release.open();
    await Promise.allSettled([old]);
  }
  const discarded = await old;
  assert.deepEqual(discarded.detection, COLD);
  assert.equal(f.fact(discarded)?.known, false);
  assert.equal(f.fact(await f.list())?.known, false);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  const refreshed = await f.list(true);
  assert.equal(refreshed.configuration.revision, 'fixture-mutation-v2');
  assert.equal(f.fact(refreshed)?.value, 'observation-2');
  assert.deepEqual(f.counts(), { detections: 2, setupCalls: 0 });
});
