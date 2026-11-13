// A providerId selects by exact, case-sensitive equality with a registry id: nothing near it matches.
// Real registered adapters with a fake read context, so nothing reaches a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogRoutes, preferenceRefFor } from '../../packages/gozar-node/route-catalog.mjs';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { completeProperties } from '../../packages/gozar-node/route-view.mjs';
import { codeOf, query, scratch } from './route-schema-check.mjs';

const adapters = await loadAdapters();
const readContext = { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified', checkedAt: null }) };
const catalog = (q, over = {}) => catalogRoutes(q, { adapters, platform: 'linux', readContext, preferenceRecord: { adapterPreference: [] }, ...over });
const ID = 'tailscale-funnel';

test('red: only the exact id selects; another case, a prefix, a substring, surrounding space or the label is route_not_found', async t => {
  const home = await scratch(t);
  assert.deepEqual((await catalog(query({ home, providerId: ID }))).candidates.map(c => c.providerId), [ID], 'the exact id selects');
  const label = adapters.find(adapter => adapter.id === ID).definition.label;
  for (const near of [ID.toUpperCase(), 'Tailscale-Funnel', 'tailscale', 'tailscale-fun', 'scale-funnel', 'funnel', ` ${ID}`, `${ID} `, `\t${ID}\n`, label]) {
    assert.equal(await codeOf(catalog(query({ home, providerId: near }))), 'route_not_found', JSON.stringify(near));
  }
});

test('red: when one adapter is in the preference list by preferenceRef and by providerId, its earlier position counts', async t => {
  const home = await scratch(t);
  const adapterPreference = ['tailscale-private', preferenceRefFor(ID), 'lan', ID];
  const { candidates } = await catalog(query({ home }), { preferenceRecord: { adapterPreference } });
  assert.deepEqual(candidates.slice(0, 3).map(c => c.providerId), ['tailscale-private', ID, 'lan']);
  // The reverse: the providerId comes first and the preferenceRef later.
  const reverse = await catalog(query({ home }), { preferenceRecord: { adapterPreference: ['tailscale-private', ID, 'lan', preferenceRefFor(ID)] } });
  assert.deepEqual(reverse.candidates.slice(0, 3).map(c => c.providerId), ['tailscale-private', ID, 'lan']);
});

test('red: completeProperties fills ports and proof for a definition written before they existed, and keeps declared ones', () => {
  const old = { reach: 'internet', transport: 'https', address: { stability: 'stable', scope: 'x', conditions: [] } };
  const filled = completeProperties(old);
  assert.equal(filled.address.ports, null);
  assert.deepEqual(filled.proof, { vantage: 'none', checks: [] });
  assert.equal(filled.address.stability, 'stable');
  const declared = completeProperties({ ...old, address: { ...old.address, ports: [8443] }, proof: { vantage: 'public', checks: ['tls'] } });
  assert.deepEqual(declared.address.ports, [8443]);
  assert.deepEqual(declared.proof, { vantage: 'public', checks: ['tls'] });
});
