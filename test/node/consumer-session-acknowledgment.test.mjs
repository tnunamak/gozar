// Consumer acceptance repro 1a (DataConnect adoption of 0.5.2): `createTestingGozar({ acknowledgeOrigin })` plus a
// refreshed catalog advertised the tailscale-funnel session as `available / admitted`, the owner could consent to it,
// and `expose` then threw `unsupported`: "This session controller does not implement the declared origin
// acknowledgment boundary". No acknowledgment call and no proof request ever happened.
//
// Provenance: ported from the consumer's standalone repro, not from the adoption checkout itself.
//   session-acceptance.test.ts   sha256 781dd00340ebba5d6948da41fcc362c3eb674aaf9f73cb49f38e7cdedd5d1f18
// Adoption branch ra-gozar/adopt-052-1119 at 94f88e2e52456d265891a0aead8109018a5a14c2. The original asserted the
// observed refusal (its pass confirmed the blocker). The intended positive expectation is explicit here: a usage the
// public availability advertises must be executable through the declared boundary, and a usage that cannot be is
// advertised unavailable BEFORE consent. Gozar's choice: the legacy recipe session runtime cannot ask the host to
// acknowledge its origin, so under a declared handler that session is unavailable; generic-runtime sessions,
// attached and durable routes (which do ask) and every host that declares no handler are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch, query } from './route-schema-check.mjs';
import { funnelEffects, ExactAttemptHost } from './consumer-host-fixture.mjs';

const BOUNDARY = /does not implement the declared origin acknowledgment boundary/;

async function world(t, { declare }) {
  const closing = {}; t.after(() => closing.harness?.close());
  const home = await scratch(t), owner = 'consumer-owner';
  const host = new ExactAttemptHost({ home, owner });
  const fixture = funnelEffects();
  const harness = await createTestingGozar({ effects: fixture.effects, ...(declare ? { acknowledgeOrigin: host.acknowledgeOrigin } : {}) });
  closing.harness = harness;
  const api = harness.gozar;
  const sessionQuery = providerId => query({ home, owner, providerId, operationId: 'consumer-session-op', target: '127.0.0.1:9',
    usage: { kind: 'session', lifetimeMs: 60_000 }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const inventory = async () => (await api.listProviders({ home, owner, refresh: true })).providers;
  return { api, harness, home, owner, host, fixture, sessionQuery, inventory, acknowledgments: () => host.accepted.length + host.refused.length };
}

test('under a declared acknowledgment the recipe session is advertised unavailable before any consent, and execution agrees', async t => {
  const w = await world(t, { declare: true });
  const row = (await w.inventory()).find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(row.availability.session, { state: 'unsupported', reason: 'origin-acknowledgment-unsupported' });
  assert.equal(row.availability.durable.state, 'available', 'the durable route, which does ask the host, stays available');
  assert.equal(row.availability.attached.reason, 'usage-not-supported', 'untouched kinds keep their own reason');

  const q = w.sessionQuery('tailscale-funnel');
  const catalog = await w.api.catalogRoutes(q);
  const candidate = catalog.candidates.find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(candidate.availability.session, row.availability.session, 'the catalog and the inventory agree');
  assert.equal(candidate.eligible, false, 'the owner cannot be offered it');
  assert.equal(candidate.candidateToken, null, 'no token exists, so no consent can be given');

  // Execution agrees with the advertisement and fails before any approval is redeemed or any effect runs.
  const effectsBefore = w.harness.events.length;
  await assert.rejects(w.api.expose({ ...q, wait: 'verified', approval: { kind: 'route', candidateToken: 'not-issued', disclosureRevision: 'x', consentFactsDigest: 'y' } },),
    error => { assert.equal(error.code, 'unsupported'); assert.match(error.message, BOUNDARY); return true; });
  assert.equal(w.harness.events.length, effectsBefore, 'no provider effect, so no allocation and no proof request');
  assert.equal(w.acknowledgments(), 0, 'and no acknowledgment was asked');
  assert.equal(w.fixture.state.proofFetches.length, 0);
  assert.equal(w.fixture.state.writes, 0);
});

test('contrast: with no handler declared the same session is available and a token is issued (no-handler compatibility)', async t => {
  const w = await world(t, { declare: false });
  const row = (await w.inventory()).find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(row.availability.session, { state: 'available', reason: 'admitted' });
  const candidate = (await w.api.catalogRoutes(w.sessionQuery('tailscale-funnel'))).candidates.find(item => item.providerId === 'tailscale-funnel');
  assert.equal(candidate.eligible, true);
  assert.equal(typeof candidate.candidateToken, 'string');
});

test('a declared handler does not disable sessions broadly: providers on the generic runtime keep their advertisement', async t => {
  const declared = await world(t, { declare: true });
  const plain = await world(t, { declare: false });
  const [withHandler, without] = [await declared.inventory(), await plain.inventory()];
  const unchanged = withHandler.filter(item => JSON.stringify(item.availability) === JSON.stringify(without.find(other => other.providerId === item.providerId).availability));
  assert.ok(unchanged.some(item => item.providerId === 'own-address'), 'own-address (owner-kept, generic runtime) is advertised exactly as without a handler');
  // Exactly the providers that run sessions on the legacy recipe controller differ, and only in the session kind.
  for (const item of withHandler) {
    const other = without.find(entry => entry.providerId === item.providerId);
    if (JSON.stringify(item.availability) === JSON.stringify(other.availability)) continue;
    assert.deepEqual({ ...item.availability, session: null }, { ...other.availability, session: null }, `${item.providerId}: only the session kind differs`);
    assert.equal(item.availability.session.reason, 'origin-acknowledgment-unsupported');
  }
});
