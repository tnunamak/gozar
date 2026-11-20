// 0.5.2 single-flight by request admission: concurrent explicit-refresh reads share one probe per provider
// even when a serialized configuration read staggers their arrival at the cache past the probe's completion.
// Public-factory setup: the real route API, the real embedding services, a configuration read that is
// serialized and slow (as the real per-home transaction is), and counting stub adapters with a slow detect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { scratch, stubAdapter } from './route-schema-check.mjs';

async function world(t, { providers = 6, detectMs = 5, readMs = 12 } = {}) {
  const adapters = Array.from({ length: providers }, (_, i) => {
    const adapter = stubAdapter(`cohort-${i}`);
    const detect = adapter.detect;
    adapter.detect = async () => { const out = await detect.call(adapter); await sleep(detectMs); return out; };
    return adapter;
  });
  const real = createEmbeddingServices({ registryId: await registryIdentity({ adapters }) });
  let chain = Promise.resolve();
  const embeddingServices = { ...real,
    // One serialized, slow read at a time: later requests reach the cache after earlier probes finished.
    readConfiguration: request => { const turn = chain.then(async () => { await sleep(readMs); return real.readConfiguration(request); }); chain = turn.catch(() => {}); return turn; } };
  const api = createRouteApi({ adapters, embeddingServices, detectionTtlMs: 60_000 });
  return { api, adapters, home: await scratch(t) };
}
const probes = w => w.adapters.map(adapter => adapter.calls.detect);

test('red: three concurrent refresh reads run exactly one probe per provider, and a later refresh runs a new one each', async t => {
  const w = await world(t);
  const replies = await Promise.all([1, 2, 3].map(() => w.api.listProviders({ home: w.home, owner: 'cohort-owner', refresh: true })));
  assert.deepEqual(probes(w), w.adapters.map(() => 1), 'three overlapping refreshes: ONE probe per provider');
  for (const reply of replies) for (const row of reply.providers) assert.equal(row.detection.fresh, true);
  const checked = replies.map(reply => reply.providers.map(row => row.detection.checkedAt).join());
  assert.equal(new Set(checked).size, 1, 'all three responses carry the same observation');
  await w.api.listProviders({ home: w.home, owner: 'cohort-owner', refresh: true });
  assert.deepEqual(probes(w), w.adapters.map(() => 2), 'a non-overlapping explicit refresh runs a new probe per provider');
});

test('a different owner scope never shares a cohort probe', async t => {
  const w = await world(t, { providers: 2 });
  await Promise.all(['owner-a', 'owner-b'].map(owner => w.api.listProviders({ home: w.home, owner, refresh: true })));
  assert.deepEqual(probes(w), [2, 2], 'distinct owners probe separately');
});
