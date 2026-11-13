import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalog, catalogRoutes, preferenceRefFor } from '../../packages/gozar-node/route-catalog.mjs';
import { normalizeError } from '../../packages/gozar-node/error-normalizer.mjs';
import { action, assertShape, codeOf, fixtures, properties, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const durableFacts = async ({ adapterId }) => ({ planDigest: `durable-${adapterId}`, observedResource: `durable-res-${adapterId}` });
function deps(adapters, over = {}) {
  const tokens = tokenStubs();
  return { adapters, platform: 'linux', preferenceRecord: { schemaVersion: 1, revision: 0, adapterPreference: [], onUnavailable: 'ask' }, issue: tokens.issue,
    consentBinding: tokens.consentBinding, durablePlanFacts: durableFacts, readContext: { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) },
    now: () => Date.parse('2026-11-12T12:00:00Z'), tokens, ...over };
}
const withHome = async (t, over = {}) => query({ home: await scratch(t), ...over });
const pinned = world => ({ rules: world });

test('every catalog and candidate validates against the frozen schema', async t => {
  const q = await withHome(t);
  const catalog = await catalogRoutes(q, deps([stubAdapter('alpha'), stubAdapter('bravo', { state: 'action-required', actions: [action('login')] })]));
  assertShape('Catalog', catalog);
  for (const candidate of catalog.candidates) assertShape('Candidate', candidate);
  assert.deepEqual(catalog.candidates.map(c => c.rank), [1, 2]);
});

test('red: no eligible candidate yields noMatch with the unmet requirement names', async t => {
  const q = await withHome(t, { requirements: { ...query().requirements, reach: 'lan' } });
  const catalog = await catalogRoutes(q, deps([stubAdapter('alpha'), stubAdapter('bravo')]));
  assertShape('Catalog', catalog);
  assert.equal(catalog.candidates.some(c => c.eligible), false);
  assert.deepEqual(catalog.noMatch, { code: 'requirements_unsatisfied', requirements: ['reach'] });
  assert.ok(catalog.candidates.every(c => c.candidateToken === null && c.unmet[0].requirement === 'reach'));
});

test('red: strict privacy (endpoint-only) excludes a provider-terminated TLS candidate and keeps an endpoint-terminated one', async t => {
  const q = await withHome(t, { requirements: { ...query().requirements, payloadAccess: 'endpoint-only' } });
  const provider = properties({ traffic: { tlsTermination: 'provider', providerCanReadPayload: true, readers: ['provider'], metadataVisibleTo: ['provider'], evidenceRef: 'evidence-synthetic-2' } });
  const catalog = await catalogRoutes(q, deps([stubAdapter('edge', { caps: provider }), stubAdapter('passthrough')]));
  assertShape('Catalog', catalog);
  const edge = catalog.candidates.find(c => c.display.label === 'Route edge'), through = catalog.candidates.find(c => c.display.label === 'Route passthrough');
  assert.equal(edge.eligible, false);
  assert.ok(edge.unmet.some(u => u.requirement === 'payloadAccess'));
  assert.equal(edge.candidateToken, null);
  assert.equal(through.eligible, true);
});

test('red: a detect-only adapter (no supported kind) is never eligible and gets no token', async t => {
  const q = await withHome(t);
  const catalog = await catalogRoutes(q, deps([stubAdapter('probe-only', { kinds: [] })]));
  assertShape('Catalog', catalog);
  const [only] = catalog.candidates;
  assert.equal(only.eligible, false);
  assert.deepEqual(only.unmet.map(u => u.requirement), ['usage']);
  assert.equal(only.candidateToken, null);
  assert.equal(catalog.noMatch.code, 'requirements_unsatisfied');
});

test('on macOS the core does not block candidates: they are detected, planned and issued a token', async t => {
  const q = await withHome(t);
  const adapters = [stubAdapter('alpha')];
  const d = deps(adapters, { platform: 'darwin' });
  const catalog = await catalogRoutes(q, d);
  assertShape('Catalog', catalog);
  assert.equal(catalog.candidates[0].eligible, true);
  assert.ok(catalog.candidates[0].candidateToken);
  assert.ok(adapters[0].calls.detect > 0);
});

test('red: on an unsupported platform (win32) every candidate is unsupported, nothing is detected and no token is issued', async t => {
  const q = await withHome(t);
  const adapters = [stubAdapter('alpha'), stubAdapter('bravo')];
  const d = deps(adapters, { platform: 'win32' });
  const catalog = await catalogRoutes(q, d);
  assertShape('Catalog', catalog);
  for (const candidate of catalog.candidates) {
    assert.equal(candidate.eligible, false);
    assert.equal(candidate.setup.state, 'unsupported');
    assert.deepEqual(candidate.unmet, [{ requirement: 'platform', actual: 'win32', reasonCode: 'unsupported_platform' }]);
    assert.equal(candidate.candidateToken, null);
  }
  assert.equal(d.tokens.live.size, 0);
  assert.ok(adapters.every(a => a.calls.detect === 0 && a.calls.plan === 0));
});

test('red: inspection makes zero provider mutations (only detect, plan and observe are called)', async t => {
  const q = await withHome(t);
  const world = { rules: [] };
  const adapters = [stubAdapter('alpha', { world }), stubAdapter('bravo', { world, state: 'action-required', actions: [action('login')] })];
  await catalogRoutes(q, deps(adapters));
  await catalogRoutes({ ...q, usage: { kind: 'durable', routeId: 'route-1' } }, deps(adapters));
  for (const a of adapters) assert.deepEqual([a.calls.create, a.calls.remove, a.calls.setup], [0, 0, 0]);
  assert.deepEqual(world.rules, []);
});

test('red: a needs-setup candidate gets no token, and a ready one is bound to plan digest and observed resource', async t => {
  const q = await withHome(t, { requirements: { ...query().requirements, setup: 'allow' } });
  const d = deps([stubAdapter('ready-one'), stubAdapter('needs-login', { state: 'action-required', actions: [action('login')] })]);
  const catalog = await catalogRoutes(q, d);
  assertShape('Catalog', catalog);
  const ready = catalog.candidates.find(c => c.display.label === 'Route ready-one'), needs = catalog.candidates.find(c => c.display.label === 'Route needs-login');
  assert.equal(needs.setup.state, 'action-required');
  assert.equal(needs.eligible, true);
  assert.equal(needs.candidateToken, null);
  assert.equal(needs.expiresAt, null);
  assert.equal(needs.setup.actions[0].id, 'login');
  assert.match(ready.candidateToken, /^tok_/);
  assert.deepEqual(d.tokens.live.get(ready.candidateToken).grant, { adapterId: 'ready-one', planDigest: 'plan-ready-one-127.0.0.1:8799', observedResource: 'res-ready-one' });
  assert.equal(d.tokens.live.size, 1);
});

test('without setup allowed an action-required candidate is ineligible with a setup reason', async t => {
  const q = await withHome(t);
  const catalog = await catalogRoutes(q, deps([stubAdapter('needs-login', { state: 'action-required', actions: [action('login')] })]));
  assert.deepEqual(catalog.candidates[0].unmet, [{ requirement: 'setup', actual: 'action-required', reasonCode: 'not_met' }]);
});

test('ranking follows the preference list, then registry order; ranks are 1-based and unique', async t => {
  const q = await withHome(t);
  const adapters = [stubAdapter('alpha'), stubAdapter('bravo'), stubAdapter('charlie')];
  const catalog = await catalogRoutes(q, deps(adapters, { preferenceRecord: { schemaVersion: 1, revision: 3, adapterPreference: [preferenceRefFor('charlie'), preferenceRefFor('bravo')], onUnavailable: 'ask' } }));
  assert.deepEqual(catalog.candidates.map(c => c.display.label), ['Route charlie', 'Route bravo', 'Route alpha']);
  assert.deepEqual(catalog.candidates.map(c => c.rank), [1, 2, 3]);
  assert.equal(catalog.preferenceRevision, 3);
});

test('a durable usage takes plan facts from the durable engine, and a durable pin outranks the preference list', async t => {
  const q = await withHome(t, { usage: { kind: 'durable', routeId: 'route-1' } });
  const d = deps([stubAdapter('alpha'), stubAdapter('bravo')], { pinnedAdapterId: async () => 'bravo',
    preferenceRecord: { schemaVersion: 1, revision: 1, adapterPreference: [preferenceRefFor('alpha')], onUnavailable: 'ask' } });
  const catalog = await catalogRoutes(q, d);
  assertShape('Catalog', catalog);
  assert.equal(catalog.candidates[0].display.label, 'Route bravo');
  assert.deepEqual(d.tokens.live.get(catalog.candidates[0].candidateToken).grant, { adapterId: 'bravo', planDigest: 'durable-bravo', observedResource: 'durable-res-bravo' });
  assert.ok(d.adapters.every(a => a.calls.plan === 0));
});

test('catalogRevision changes when provider-side setup state changes, and not otherwise', async t => {
  const q = await withHome(t);
  const a = await catalogRoutes(q, deps([stubAdapter('alpha')]));
  const b = await catalogRoutes(q, deps([stubAdapter('alpha')]));
  const c = await catalogRoutes(q, deps([stubAdapter('alpha', { state: 'action-required', actions: [action('login')] })]));
  assert.equal(a.catalogRevision, b.catalogRevision);
  assert.notEqual(a.catalogRevision, c.catalogRevision);
});

test('a throwing detect is an unknown state, not a thrown catalog error', async t => {
  const q = await withHome(t);
  const broken = stubAdapter('broken'); broken.detect = async () => { throw new Error('probe exploded: secret-looking-value'); };
  const catalog = await catalogRoutes(q, deps([broken]));
  assertShape('Catalog', catalog);
  assert.equal(catalog.candidates[0].setup.state, 'unknown');
  assert.equal(catalog.candidates[0].eligible, false);
  assert.doesNotMatch(JSON.stringify(catalog), /secret-looking-value/);
});

test('buildCatalog returns the seam shape (candidates only)', async t => {
  const q = await withHome(t);
  const result = await buildCatalog(q, { adapters: [stubAdapter('alpha')], preferences: [], issue: tokenStubs().issue, consentBinding: tokenStubs().consentBinding, durablePlanFacts: durableFacts, platform: 'linux',
    readContext: { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } });
  assert.deepEqual(Object.keys(result), ['candidates']);
});

test('invalid queries and unknown named routes fail with frozen codes', async t => {
  const q = await withHome(t);
  assert.equal(await codeOf(catalogRoutes({ ...q, requirements: { ...q.requirements, reach: 'moon' } }, deps([]))), 'invalid_input');
  assert.equal(await codeOf(catalogRoutes({ ...q, route: 'no-such-route' }, deps([stubAdapter('alpha')], { readContext: undefined }))), 'route_not_found');
});

test('red: the durable engine answering provider_unsupported makes the candidate unusable for usage, not unknown', async t => {
  const q = await withHome(t, { usage: { kind: 'durable', routeId: 'coordinator' } });
  const engine = async () => { throw Object.assign(new Error('This adapter has no durable recipe'), { code: 'provider_unsupported' }); };
  const catalog = await catalogRoutes(q, deps([stubAdapter('alpha')], { durablePlanFacts: engine }));
  const [candidate] = catalog.candidates;
  assert.deepEqual(candidate.unmet, [{ requirement: 'usage', actual: 'durable', reasonCode: 'not_met' }]);
  assert.equal(candidate.setup.state, 'ready');
  assert.equal(candidate.candidateToken, null);
});

test('the legacy→frozen error map matches the fixture normalization', () => {
  for (const [source, rule] of Object.entries(fixtures.errorNormalization)) {
    assert.ok(fixtures.frozenErrorCodes.includes(rule.target), `${source} maps to an unfrozen code`);
    const mapped = normalizeError(Object.assign(new Error('x'), { code: source })).code;
    if (!fixtures.frozenErrorCodes.includes(source) || source === rule.target) assert.equal(mapped, rule.target, `${source} should normalise to ${rule.target}`);
  }
  assert.equal(normalizeError(Object.assign(new Error('x'), { code: 'definitely_unmapped' })).code, 'internal_error');
});

// A provider's cost summary is a sentence with its own full stop, and the description that quotes it adds one. A user
// reads this text in the consent step, so no shipped provider may print a doubled full stop there.
test('red: no shipped provider prints a doubled full stop in its description or disclosure', async t => {
  const { loadAdapters } = await import('../../packages/gozar-node/adapter-runtime.mjs');
  const adapters = await loadAdapters();
  assert.ok(adapters.length >= 10, 'the gate reads the real registry');
  const catalog = await catalogRoutes(await withHome(t), deps(adapters));
  assert.equal(catalog.candidates.length, adapters.length);
  for (const candidate of catalog.candidates) {
    for (const [name, text] of [['description', candidate.display.description], ['disclosure', candidate.disclosure.text]]) {
      assert.ok(!/\.\.|\.\s+\./.test(text), `${candidate.display.label} ${name}: ${text}`);
      assert.match(text, /[^.]\.$|[.!?]$/, `${candidate.display.label} ${name} ends in one sentence stop`);
    }
  }
  const funnel = catalog.candidates.find(item => item.display.label === 'Tailscale Funnel');
  assert.ok(funnel.display.description.endsWith('non-configurable bandwidth limits.'), funnel.display.description);
});
