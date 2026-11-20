// Consumer acceptance repro 1a (DataConnect adoption of 0.5.2): `createTestingGozar({ acknowledgeOrigin })` plus a
// refreshed catalog advertised the tailscale-funnel session as `available / admitted`, the owner could consent to it,
// and `expose` then threw `unsupported`: "This session controller does not implement the declared origin
// acknowledgment boundary". No acknowledgment call and no proof request ever happened.
//
// Provenance: ported from the consumer's standalone repro, not from the adoption checkout itself.
//   session-acceptance.test.ts   sha256 781dd00340ebba5d6948da41fcc362c3eb674aaf9f73cb49f38e7cdedd5d1f18
// Adoption branch ra-gozar/adopt-052-1119 at 94f88e2e52456d265891a0aead8109018a5a14c2. The original asserted the
// observed refusal (its pass confirmed the blocker). The intended positive expectation is asserted here: every
// session provider runs the generic session runtime, which asks the host to acknowledge the exact allocated origin,
// so a declared handler changes nothing about a provider's advertisement and nothing is ever advertised
// `origin-acknowledgment-unsupported`. Execution through the declared boundary is covered per provider in
// unified-session-runtime.test.mjs (allocate -> announce -> exact acknowledgment -> proof -> publish).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch, query } from './route-schema-check.mjs';
import { funnelEffects, ExactAttemptHost } from './consumer-host-fixture.mjs';

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
  return { api, harness, home, owner, host, fixture, sessionQuery, inventory };
}

test('under a declared acknowledgment the funnel session is advertised available, eligible and consentable (the 0.5.1 answer)', async t => {
  const w = await world(t, { declare: true });
  const row = (await w.inventory()).find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(row.availability.session, { state: 'available', reason: 'admitted' });
  assert.equal(row.availability.durable.state, 'available');
  assert.equal(row.availability.attached.reason, 'usage-not-supported', 'untouched kinds keep their own reason');
  const candidate = (await w.api.catalogRoutes(w.sessionQuery('tailscale-funnel'))).candidates.find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(candidate.availability.session, row.availability.session, 'the catalog and the inventory agree');
  assert.equal(candidate.eligible, true, 'the owner can be offered it');
  assert.equal(typeof candidate.candidateToken, 'string', 'a token exists, so consent can be given');
});

test('contrast: with no handler declared the same session is available and a token is issued (no-handler compatibility)', async t => {
  const w = await world(t, { declare: false });
  const row = (await w.inventory()).find(item => item.providerId === 'tailscale-funnel');
  assert.deepEqual(row.availability.session, { state: 'available', reason: 'admitted' });
  const candidate = (await w.api.catalogRoutes(w.sessionQuery('tailscale-funnel'))).candidates.find(item => item.providerId === 'tailscale-funnel');
  assert.equal(candidate.eligible, true);
  assert.equal(typeof candidate.candidateToken, 'string');
});

test('a declared handler changes no provider\'s availability in any kind, and no reason says acknowledgment is unsupported', async t => {
  const declared = await world(t, { declare: true });
  const plain = await world(t, { declare: false });
  const [withHandler, without] = [await declared.inventory(), await plain.inventory()];
  assert.deepEqual(withHandler.map(item => item.providerId), without.map(item => item.providerId));
  for (const item of withHandler) {
    assert.deepEqual(item.availability, without.find(other => other.providerId === item.providerId).availability, `${item.providerId}: availability is identical with and without a handler`);
    assert.notEqual(item.availability.session?.reason, 'origin-acknowledgment-unsupported', item.providerId);
  }
});
