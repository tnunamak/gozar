// A candidate's ports and needs are those of the usage the app asked for. A durable route takes its slot from the
// durable engine's list, which differs from the ports a session tries, so an app that shows `address.ports` and
// `display.needs` for a durable query must see the durable list. One test per durable provider in the registry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { definitionErrors, loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { propertiesFor } from '../../packages/gozar-node/route-view.mjs';
import { createRouteApi, fakeReadContext } from '../../packages/gozar-node/testing.mjs';
import { query, scratch } from './route-schema-check.mjs';

// What each durable facet observes on an idle node, so its slot list can be read with no provider call.
const IDLE = {
  'tailscale-funnel': { dnsName: 'node.example.ts.net', funnelPorts: [443, 8443, 10000], config: {} },
  'tailscale-private': { dnsName: 'node.example.ts.net', funnelPorts: [], config: {} },
};

const adapters = await loadAdapters();
const durable = adapters.filter(adapter => adapter.durable && adapter.definition.ownership !== 'external-owned');

test('the registry has durable providers, and each one has an idle observation here', () => {
  assert.ok(durable.length >= 2);
  assert.deepEqual(durable.map(adapter => adapter.id).filter(id => !IDLE[id]), [], 'add an idle observation for each new durable provider');
});

// A reach no Gozar-owned durable provider has keeps the candidate ineligible, so the catalog makes no provider call.
const catalogQuery = (home, providerId, usage) => query({ home, providerId, usage,
  requirements: { reach: 'this-device', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });

for (const adapter of durable) {
  test(`${adapter.id}: a durable candidate lists the ports the durable engine tries, in its order, and its needs name them`, async t => {
    const home = await scratch(t);
    const tried = adapter.durable.slots(IDLE[adapter.id]).map(item => item.slot);
    assert.ok(tried.length > 0 && tried.every(Number.isInteger), 'this facet\'s slots are ports');
    const api = createRouteApi({ readContext: fakeReadContext({ home }) });
    const [candidate] = (await api.catalogRoutes(catalogQuery(home, adapter.id, { kind: 'durable', routeId: 'ports-check' }))).candidates;
    assert.equal(candidate.providerId, adapter.id);
    assert.deepEqual(candidate.properties.address.ports, tried);
    for (const port of tried) assert.match(candidate.display.needs, new RegExp(`\\b${port}\\b`), `durable needs name port ${port}`);
    assert.equal('portsByKind' in candidate.properties.address, false, 'the candidate shape is unchanged');
    const view = await propertiesFor(adapter.id, { adapters }, 'durable');
    assert.deepEqual(view.properties.address.ports, tried, 'a durable RouteView reports the same ports');
  });

  test(`${adapter.id}: a session candidate keeps the session ports, and its needs name them`, async t => {
    const home = await scratch(t);
    const api = createRouteApi({ readContext: fakeReadContext({ home }) });
    const [candidate] = (await api.catalogRoutes(catalogQuery(home, adapter.id, { kind: 'session', lifetimeMs: 60_000 }))).candidates;
    const session = adapter.definition.capabilities.address.ports;
    assert.deepEqual(candidate.properties.address.ports, session);
    for (const port of session) assert.match(candidate.display.needs, new RegExp(`\\b${port}\\b`), `session needs name port ${port}`);
    assert.deepEqual((await propertiesFor(adapter.id, { adapters }, 'session')).properties.address.ports, session);
  });
}

test('a byUsage entry is only for a usage kind the provider supports, and holds only needs and ports', () => {
  const definition = structuredClone(durable[0].definition);
  assert.deepEqual(definitionErrors(definition), []);
  assert.deepEqual(definitionErrors({ ...definition, byUsage: { attached: { ports: [443] } } }), ['byUsage.attached is not a supported kind']);
  assert.notDeepEqual(definitionErrors({ ...definition, byUsage: { durable: { reach: 'internet' } } }), []);
});
