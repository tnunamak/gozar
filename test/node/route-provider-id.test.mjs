// The provider id, the static needs line, ports and proof: what an app lists, chooses and explains from Gozar data alone.
// Every provider here is a real registered adapter with a fake read context, so nothing reaches a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogRoutes } from '../../packages/gozar-node/route-catalog.mjs';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { consentBinding, redeemConsentToken } from '../../packages/gozar-node/consent-token.mjs';
import { redeemApproval } from '../../packages/gozar-node/attached-route.mjs';
import { setRoutePreferences, getRoutePreferences } from '../../packages/gozar-node/route-preferences.mjs';
import { projectExternal, projectSession, releasedView } from '../../packages/gozar-node/route-view.mjs';
import { assertShape, codeOf, query, scratch } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}adapters/manifest.json`, 'utf8'));
const adapters = await loadAdapters();
const ids = manifest.providers.map(provider => provider.id);
const readContext = { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified', checkedAt: null }) };
const catalog = (q, over = {}) => catalogRoutes(q, { adapters, platform: 'linux', readContext, ...over });
const withHome = async (t, over = {}) => query({ home: await scratch(t), ...over });
const wrapped = id => JSON.parse(readFileSync(`${root}adapters/${id}.definition.json`, 'utf8')).definition;

test('red: a providerId selects exactly that one candidate, and the catalog holds nothing else', async t => {
  const all = await catalog(await withHome(t));
  assert.deepEqual(all.candidates.map(c => c.providerId).sort(), [...ids].sort(), 'without providerId every registered adapter is listed');
  for (const id of ['tailscale-funnel', 'lan']) {
    const one = await catalog(await withHome(t, { providerId: id }));
    assertShape('Catalog', one);
    assert.deepEqual(one.candidates.map(c => c.providerId), [id]);
    assert.equal(one.candidates[0].rank, 1);
  }
});

test('red: an unknown providerId is route_not_found, and the message lists every id in registry order', async t => {
  const q = await withHome(t, { providerId: 'no-such-provider' });
  await assert.rejects(catalog(q), error => {
    assert.equal(error.code, 'route_not_found');
    assert.equal(error.message, `Unknown route id "no-such-provider". Offered: ${ids.join(', ')}`);
    return true;
  });
  // A display label is not an id.
  assert.equal(await codeOf(catalog(await withHome(t, { providerId: adapters[0].definition.label }))), 'route_not_found');
});

test('red: providerId together with route is invalid_input, and an empty providerId is too', async t => {
  assert.equal(await codeOf(catalog(await withHome(t, { providerId: ids[0], route: 'work' }))), 'invalid_input');
  assert.equal(await codeOf(catalog(await withHome(t, { providerId: '' }))), 'invalid_input');
});

test('red: Funnel shows its ordered ports and a public proof with the tls and nonce checks', async t => {
  const { candidates: [funnel] } = await catalog(await withHome(t, { providerId: 'tailscale-funnel' }));
  assert.deepEqual(funnel.properties.address.ports, [8443, 10000]);
  assert.equal(funnel.properties.proof.vantage, 'public');
  for (const check of ['tls', 'nonce']) assert.ok(funnel.properties.proof.checks.includes(check), check);
  assert.equal(funnel.eligible, true, 'a ready candidate is unchanged by the new fields');
});

test('ports and proof of every shipped candidate equal the mapping of its plan definition (the contract rule, written out independently)', async t => {
  const { candidates } = await catalog(await withHome(t));
  for (const candidate of candidates) {
    const plan = wrapped(candidate.providerId);
    const expectedPorts = plan.bindings?.port?.candidates ?? null;
    const v = plan.validation ?? {};
    const checks = [v.tls !== undefined && 'tls', v.instanceNonce !== undefined && 'nonce', v.sse !== undefined && 'sse'].filter(Boolean);
    const vantage = ['public', 'tailnet', 'lan', 'this-device', 'none'].includes(v.vantage) ? v.vantage : checks.length ? 'this-device' : 'none';
    assert.deepEqual(candidate.properties.address.ports, expectedPorts, `${candidate.providerId} ports`);
    assert.deepEqual(candidate.properties.proof, { vantage, checks }, `${candidate.providerId} proof`);
  }
});

test('every candidate carries a providerId equal to its registry id and a non-empty needs line, whether or not setup is ready', async t => {
  const q = await withHome(t);
  const probes = { ...readContext, probe: async () => ({ ok: false }) };
  for (const context of [readContext, probes]) {
    const { candidates } = await catalog(q, { readContext: context });
    assert.deepEqual(candidates.map(c => c.providerId), ids);
    for (const candidate of candidates) {
      assertShape('Candidate', candidate);
      assert.match(candidate.display.needs, /^\S.*\.$/, candidate.providerId);
      assert.equal(candidate.display.needs, adapters.find(a => a.id === candidate.providerId).definition.needs);
    }
  }
});

test('red: setRoutePreferences takes providerIds, getRoutePreferences returns them as stored, and the catalog ranks by them', async t => {
  const profileHome = await scratch(t);
  const stored = await setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: ['lan', 'tailscale-private'], onUnavailable: 'ask' });
  assert.deepEqual(stored.adapterPreference, ['lan', 'tailscale-private']);
  assert.deepEqual((await getRoutePreferences({ profileHome })).adapterPreference, ['lan', 'tailscale-private']);
  const { candidates } = await catalog(await withHome(t), { profileHome });
  assert.deepEqual(candidates.slice(0, 2).map(c => c.providerId), ['lan', 'tailscale-private']);
});

test('the consent token still redeems: issued through a providerId query it spends only with that providerId, and without one it is unchanged', async t => {
  const home = await scratch(t);
  const viaId = await withHome(t, { home, providerId: 'tailscale-funnel' });
  const plain = await withHome(t, { home });
  const issueFor = async q => {
    const { candidates } = await catalog(q);
    const candidate = candidates.find(c => c.providerId === 'tailscale-funnel');
    return { token: candidate.candidateToken, revision: candidate.disclosure.revision };
  };
  const spend = (q, issued) => redeemConsentToken({ home, token: issued.token, binding: consentBinding(q, home, issued.revision) });

  const a = await issueFor(viaId);
  assert.ok(a.token);
  assert.equal((await spend(viaId, a)).adapterId, 'tailscale-funnel');

  const b = await issueFor(viaId);
  assert.equal(await codeOf(spend(plain, b)), 'consent_mismatch', 'a token for a chosen id is not spent by a request that names none');
  const c = await issueFor(plain);
  assert.equal(await codeOf(spend(viaId, c)), 'consent_mismatch', 'and the other way round');
  const d = await issueFor(plain);
  assert.equal((await spend(plain, d)).adapterId, 'tailscale-funnel', 'a token issued without providerId redeems as before');
  assert.equal(consentBinding(plain, home, 'r').providerId, undefined, 'the binding of a request without providerId has no new key, so its digest is unchanged');
});

test('the plan digest the token carries is the same with and without providerId (redeemed through the real approval path)', async t => {
  const home = await scratch(t);
  const viaId = await withHome(t, { home, providerId: 'tailscale-funnel' });
  const { candidates: [candidate] } = await catalog(viaId);
  const request = { ...viaId, approval: { candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision }, wait: 'allocated' };
  const { grant, plan } = await redeemApproval(request, { adapters, readContext, platform: 'linux' });
  assert.equal(grant.adapterId, 'tailscale-funnel');
  assert.equal(plan.digest, grant.planDigest);

  const plain = await withHome(t, { home });
  const issued = (await catalog(plain)).candidates.find(c => c.providerId === 'tailscale-funnel');
  const again = await redeemApproval({ ...plain, approval: { candidateToken: issued.candidateToken, disclosureRevision: issued.disclosure.revision }, wait: 'allocated' }, { adapters, readContext, platform: 'linux' });
  assert.equal(again.grant.planDigest, grant.planDigest);
});

test('a durable catalog asks the engine for plan facts with the loaded adapters as an optional second seam', async t => {
  const seen = [];
  const durablePlanFacts = async facts => { seen.push(facts); return { planDigest: 'digest-x', observedResource: 'resource-x' }; };
  const q = await withHome(t, { usage: { kind: 'durable', routeId: 'example-main' }, providerId: 'tailscale-funnel' });
  await catalog(q, { durablePlanFacts });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].adapters, adapters);
  assert.equal(seen[0].adapterId, 'tailscale-funnel');
});

test('RouteView.verification says where the last check ran from and what it passed', () => {
  const handle = { kind: 'external', id: 'https://example.test', generation: 0 };
  const verified = projectExternal({ origin: 'https://example.test', verification: { status: 'verified', checkedAt: '2026-11-12T12:00:00.000Z' } }, { handle });
  assert.deepEqual(verified.verification, { status: 'verified', checkedAt: '2026-11-12T12:00:00.000Z', vantage: 'this-device', checks: ['nonce', 'tls'] });
  const failed = projectExternal({ origin: 'https://example.test', verification: { status: 'failed', checkedAt: '2026-11-12T12:00:00.000Z' } }, { handle });
  assert.deepEqual(failed.verification, { status: 'unverified', checkedAt: '2026-11-12T12:00:00.000Z', vantage: 'this-device', checks: [] });
  const props = { ...adapters.find(a => a.id === 'tailscale-funnel').definition.capabilities };
  const session = projectSession({ snapshot: { phase: 'published-ready', published: 'https://example.test' } }, { handle: { kind: 'session', id: 's', generation: 0 }, properties: props, now: 1_000 });
  assert.deepEqual(session.verification.checks, ['tls', 'nonce', 'sse']);
  assert.equal(session.verification.vantage, 'this-device');
  const starting = projectSession({ snapshot: { phase: 'starting' } }, { handle: { kind: 'session', id: 's', generation: 0 }, properties: props });
  assert.deepEqual(starting.verification, { status: 'unverified', checkedAt: null, vantage: 'none', checks: [] });
  for (const view of [verified, failed, session, starting, releasedView(null, handle)]) assertShape('RouteView', view);
});
