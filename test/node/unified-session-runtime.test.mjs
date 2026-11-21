// All five recipe providers (localhost-run, tunnl-gg, lan, tailscale-funnel, tailscale-private) run sessions on the SAME
// generic session runtime as own-address, so a host that declared `acknowledgeOrigin` gets the awaited exact-origin
// boundary for each of them. There is no other session execution path.
//
// RED on exact 828 (legacy daemon): every one of the five is advertised `unsupported / origin-acknowledgment-unsupported`
// under a declared handler and `expose` refuses with `unsupported` before any effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch } from './route-schema-check.mjs';
import { ExactAttemptHost } from './consumer-host-fixture.mjs';
import { funnelEffects } from './consumer-host-fixture.mjs';
import { providerWorld, PROVIDERS } from './session-provider-fixtures.mjs';

const FIVE = PROVIDERS;

async function inventories(t, effects) {
  const closing = []; t.after(() => Promise.all(closing.map(harness => harness.close())));
  const home = await scratch(t), owner = 'consumer-owner';
  const host = new ExactAttemptHost({ home, owner });
  const declared = await createTestingGozar({ effects, acknowledgeOrigin: host.acknowledgeOrigin });
  const plain = await createTestingGozar({ effects });
  closing.push(declared, plain);
  const read = async harness => (await harness.gozar.listProviders({ home, owner, refresh: true })).providers;
  return { declared: await read(declared), plain: await read(plain) };
}

test('under a declared acknowledgment every one of the five providers keeps its 0.5.1 session availability', async t => {
  const { declared, plain } = await inventories(t, funnelEffects().effects);
  for (const providerId of FIVE) {
    const withHandler = declared.find(row => row.providerId === providerId), without = plain.find(row => row.providerId === providerId);
    assert.ok(withHandler && without, `${providerId} is in the inventory`);
    assert.deepEqual(withHandler.availability.session, without.availability.session, `${providerId}: a declared handler changes nothing about session availability`);
    assert.notEqual(withHandler.availability.session.reason, 'origin-acknowledgment-unsupported', `${providerId}: never advertised as unable to acknowledge`);
  }
  for (const row of declared) assert.notEqual(row.availability.session?.reason, 'origin-acknowledgment-unsupported', `${row.providerId}`);
});

for (const providerId of PROVIDERS) {
  test(`${providerId}: allocate -> announce the exact origin -> acknowledgment -> proof for that Host only -> publish; cleanup removes exactly the owned resource`, async t => {
    const w = await providerWorld(t, providerId);
    const ready = await w.approvedRequest();
    const route = await w.expose(ready);
    assert.equal(route.verification.status, 'verified');
    assert.equal(route.published, route.origin);
    const order = w.events.map(event => event.at);
    assert.deepEqual(order.slice(0, 2), ['allocate', 'ack'], `allocation precedes the single acknowledgment: ${order}`);
    assert.equal(order.filter(at => at === 'ack').length, 1, 'exactly one acknowledgment');
    assert.ok(order.indexOf('proof') > order.indexOf('ack'), 'no proof request before the acknowledgment');
    const announced = new URL(route.origin).host;
    assert.equal(new URL(w.events.find(event => event.at === 'ack').origin).host, announced, 'the acknowledged origin is the published origin');
    assert.ok(w.events.filter(event => event.at === 'proof').every(event => event.host === announced), 'every proof request carries only the announced Host');
    assert.equal(w.host.accepted.length, 1);
    assert.equal(w.host.refused.length, 0);
    assert.equal(w.ownedNow(), 1, 'exactly one owned resource is live');
    const closed = await w.host.close(w.api, route.handle);
    assert.equal(closed.cleanup.state, 'confirmed');
    assert.equal(w.ownedNow(), 0, 'the owned resource is gone');
    assert.equal(w.events.filter(event => event.at === 'remove').length, 1, 'removed exactly once');
  });
}
