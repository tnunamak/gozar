// Consumer acceptance repro 1b (DataConnect adoption of 0.5.2): a host that declared `acknowledgeOrigin` runs its
// normal `watchRoutes` observer and then an explicit check. With the observer running, the check came back
// `unverified` while the same check verified without it.
//
// Provenance: ported from the consumer's standalone repros, not from the adoption checkout itself.
//   watch-acceptance.test.ts     sha256 0211ef1fae17dca1cb1a2576eed90429121007771cfde651b4aa10efba2cf48d
//   isolated-recheck.test.ts     sha256 6e845045f71cbfb14c2264e1f625e3c69e96899c9ea8430c5fe7cbdb2eeec74e
//                                (the same file plus `service.closeObservers()` and a 2 s wait before the check)
// Adoption branch ra-gozar/adopt-052-1119 at 94f88e2e52456d265891a0aead8109018a5a14c2. The host's exact-attempt
// allowance is ported in consumer-host-fixture.mjs. The original assertion that failed here was
// `checked.verification.status === 'verified'` after the start.
//
// What the public code says (settled before the fix, from the shipped docs and code):
//   * `routeStatus` is the explicit proof: "Fresh proof for one handle". Under a declared `acknowledgeOrigin`
//     every durable proof first asks the host to acknowledge that exact origin for a fresh attempt.
//   * `watchRoutes` is a polling observer; it was implemented by calling `routeStatus`, so each poll ran a proof
//     and asked for an acknowledgment of its own, outside any call the host had opened.
// Intended contract: with a declared handler, a watch observes (state, lease renewal, the latest proof still in its
// validity window) and never starts a proof or an acknowledgment. Only an explicit status or start does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedFunnelWorld, approved, handleKey } from './consumer-host-fixture.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) assert.fail(`timed out: ${label}`); await sleep(20); }
}

/** The host's `watch(handle)`: it keeps each event and reacts to a healthy route that stops being proven. */
function observe(api, host, route, controller) {
  const seen = { events: [], proofExpired: 0, error: null };
  const done = (async () => {
    try {
      for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: controller.signal, intervalMs: 250 })) {
        seen.events.push({ type: event.type, state: event.route.state, published: event.route.published, status: event.route.verification.status });
        if (event.type !== 'terminal' && (!event.route.published || event.route.verification.status !== 'verified')) seen.proofExpired++;
      }
    } catch (error) { if (!controller.signal.aborted) seen.error = error; }
  })();
  return { seen, done };
}

test('an explicit check verifies while the normal watch runs, and the watch never asks the host for anything', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  assert.equal(route.verification.status, 'verified', 'the start verifies');
  const startAttempts = host.accepted.length;
  assert.equal(startAttempts, 1);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const { seen, done } = observe(api, host, route, controller);
  await until(() => seen.events.length > 0, 5000, 'the first snapshot');
  // Let the observer poll several times, then run the explicit check while it is still polling.
  await sleep(900);
  const checked = await host.check(api, route.handle);
  assert.equal(checked.verification.status, 'verified', 'the explicit check verifies with the watch running');
  assert.ok(checked.published, 'the checked route is published');
  await sleep(600);

  controller.abort();
  await done;
  assert.equal(seen.error, null);
  assert.deepEqual(host.refused, [], 'the host refused no acknowledgment: none arrived outside its calls');
  assert.equal(host.accepted.length, startAttempts + 1, 'exactly the start and the check asked; the watch asked for nothing');
  assert.equal(new Set(host.accepted.map(item => item.attemptId)).size, host.accepted.length, 'one fresh attempt per proof');
  assert.equal(seen.proofExpired, 0, 'a healthy, recently proven route is never reported as unproven by the watch');
  assert.deepEqual(seen.events.map(event => event.type), ['snapshot'], 'the watch saw one steady snapshot');
  assert.equal(seen.events[0].status, 'verified');
  assert.equal(seen.events[0].published, route.published);
});

test('a watch poll that overlaps a held check cannot take the check\'s attempt', async t => {
  let release; const held = new Promise(resolve => { release = resolve; });
  let reached; const atProof = new Promise(resolve => { reached = resolve; });
  let hold = false;
  const world = await hostedFunnelWorld(t, { hooks: { beforeProofFetch: async () => { if (hold) { reached(); await held; } } } });
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  const controller = new AbortController();
  t.after(() => { release(); controller.abort(); });
  const { seen, done } = observe(api, host, route, controller);
  await until(() => seen.events.length > 0, 5000, 'the first snapshot');
  hold = true;
  const checking = host.check(api, route.handle);
  await atProof; // the check's attempt is acknowledged and its proof request is held
  const acceptedWhileHeld = host.accepted.length;
  await sleep(900); // the watch polls at least three times while the check is held
  assert.equal(host.accepted.length, acceptedWhileHeld, 'no further acknowledgment while the check is held');
  assert.deepEqual(host.refused, [], 'and none was refused');
  release();
  const checked = await checking;
  assert.equal(checked.verification.status, 'verified', 'the held check still verifies');
  controller.abort(); await done;
  assert.equal(seen.proofExpired, 0);
});

test('contrast: the same check with no watch running verifies (the consumer\'s isolated control)', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  const checked = await host.check(api, route.handle);
  assert.equal(checked.verification.status, 'verified');
  assert.deepEqual(host.refused, []);
});

test('negative controls from the consumer repro: foreign, stale and replayed acknowledgments are refused, and permission ends with the call', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host, listener } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  assert.equal(await listener.ask('fixture.node.invalid'), 404, 'after the start the origin is not approved');
  const acknowledged = host.accepted[0];
  assert.ok(acknowledged);
  const origin = new URL(route.origin).origin;
  const request = { attemptId: acknowledged.attemptId, handle: route.handle, operationId: 'consumer-op', providerId: world.providerId, target: world.target, origin, home: world.home, owner: world.owner };
  for (const stale of [request, { ...request, attemptId: 'another-attempt' }, { ...request, handle: { ...route.handle, generation: route.handle.generation + 1 } },
    { ...request, handle: { ...route.handle, id: 'another-handle' } }])
    await assert.rejects(host.acknowledgeOrigin(stale), /origin_acknowledgment_scope_mismatch/, 'no ack outside a host call');
  const checked = await host.check(api, route.handle);
  assert.equal(checked.verification.status, 'verified');
  assert.equal(await listener.ask('fixture.node.invalid'), 404, 'a recheck\'s permission also ends with that call');
  assert.equal(await listener.ask('other.node.invalid'), 404);
  const closed = await host.close(api, route.handle);
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(handleKey(route.handle).length > 0, true);
});

test('a watch asks nothing after cancellation, after close, and never reuses a proof across a close', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  const asked = () => host.accepted.length + host.refused.length;
  const base = asked();

  // Cancelled before the first poll: no event, no call.
  const early = new AbortController(); early.abort();
  const none = []; for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: early.signal, intervalMs: 100 })) none.push(event);
  assert.deepEqual(none, []);

  // Cancelled mid-watch: the generator ends and nothing is asked afterwards.
  const controller = new AbortController();
  const { seen, done } = observe(api, host, route, controller);
  await until(() => seen.events.length > 0, 5000, 'the first snapshot');
  controller.abort(); await done;
  const afterAbort = asked();
  await sleep(500);
  assert.equal(asked(), afterAbort, 'a cancelled watch leaves no timer that asks the host');
  assert.equal(afterAbort, base, 'and the watch asked nothing while it ran');

  // Close asks the host for nothing, and the proof remembered for the old route is not served for a closed one.
  const closed = await host.close(api, route.handle);
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(asked(), base, 'close asked no acknowledgment');
  const late = [];
  const lateStop = new AbortController(); setTimeout(() => lateStop.abort(), 600);
  let lateError = null;
  try { for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: lateStop.signal, intervalMs: 100 })) late.push(event); } catch (error) { lateError = error; }
  assert.ok(late.length > 0 || lateError, 'the late watch ended with an event or a refusal, not silence');
  for (const event of late) assert.notEqual(event.route?.verification?.status, 'verified', 'a closed route is never reported verified from a remembered proof');
  assert.equal(asked(), base, 'a late watch of a closed route asks nothing');
});

test('an observed proof is only the one the host last asked for: after its window the watch reports unproven instead of proving', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  const base = host.accepted.length;
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  Date.now = () => realNow() + 60_000; // well past the 15 s validity of the start's proof
  const controller = new AbortController();
  const events = [];
  const done = (async () => { try { for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: controller.signal, intervalMs: 100 })) events.push(event); } catch { /* aborted */ } })();
  await until(() => events.length > 0, 5000, 'a snapshot');
  controller.abort(); await done;
  assert.notEqual(events[0].route.verification.status, 'verified', 'an expired proof is not reported as current');
  assert.equal(host.accepted.length + host.refused.length, base, 'and the watch still asked the host for nothing');
});

test('a watch alone causes no provider write, no proof request and no challenge to the target', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host, fixture } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  let challenges = 0; world.listener.server.on('request', () => { challenges++; });
  const before = { writes: fixture.state.writes, proofs: fixture.state.proofFetches.length, asked: host.accepted.length + host.refused.length, challenges };
  const controller = new AbortController();
  const { seen, done } = observe(api, host, route, controller);
  await until(() => seen.events.length > 0, 5000, 'the first snapshot');
  await sleep(700);
  controller.abort(); await done;
  assert.deepEqual({ writes: fixture.state.writes, proofs: fixture.state.proofFetches.length, asked: host.accepted.length + host.refused.length, challenges }, before);
});
