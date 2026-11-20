// Proof and observation boundaries of a host that declared `acknowledgeOrigin` (runtime residuals of 0.5.2 integration).
//
//   A  A close that commits in the real asynchronous gap of an explicit check, between its last eligibility read and the
//      start of the challenge, must not be followed by a challenge. The gap is real because the status path is unlocked and
//      the close takes the home-wide reservation lock; it is closed by running the recheck and the challenge under that lock.
//   B  A check whose acknowledgment fails or is refused returns unverified AND ends the earlier proof for that exact route
//      generation: a watch must not keep reporting the earlier proof as current.
//   C  Ending one home's route forgets only that home's proof; another home with the same route ID keeps its own.
//
// The cut for A is a test-only interposition on the tombstone read (`<hash>.stopped`, the last read of statusEligible):
// when that read reports "not stopped" the interposer starts a competing close through the same public API and waits for it
// to commit if it can. Same-process lock holders exclude each other exactly like another process (the lock record names
// pid and start time and a live holder is never broken), so this is the ordering a second process would produce.
import { interposeTombstoneRead } from './tombstone-read-interposer.mjs'; // first: it wraps fs.link before the library binds it
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedFunnelWorld, approved } from './consumer-host-fixture.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('A: a close that commits after the last eligibility read of an explicit check is not followed by a challenge', async t => {
  const interposer = interposeTombstoneRead(t);
  const timeline = [];
  let closeCommitted = false, closing = null, route;
  const world = await hostedFunnelWorld(t, {
    hooks: { beforeProofFetch: async () => { timeline.push({ event: 'challenge-begins', closeCommitted }); } },
    acknowledgeOrigin: host => async request => { const reply = await host.acknowledgeOrigin(request); if (request.handle.id === route?.handle.id && host.proofCalls.size) interposer.armed = true; return reply; },
  });
  const { api, host } = world;
  route = await host.start(api, await approved(api, world.durableRequest));
  timeline.length = 0;
  interposer.onAbsent = async () => {
    timeline.push({ event: 'eligibility-passed' });
    const blocked = interposer.contention();
    closing = host.close(api, route.handle).then(result => { closeCommitted = true; timeline.push({ event: 'close-committed' }); return result; });
    // Hold the cut until the competing close has done one of two concrete things. Fenced: it reached the reservation lock and
    // opened the holder's record (it is blocked behind the check). Unfenced: it acquired and committed. Either event ends the
    // wait at once; the timer only bounds a broken fixture where neither happens, and fails it.
    let bound; const failed = new Promise((_, reject) => { bound = setTimeout(() => reject(new Error('fixture: the competing close neither reached the lock nor committed')), 20_000); });
    try { timeline.push({ event: await Promise.race([blocked, closing.then(() => 'close-committed'), failed]) }); }
    finally { clearTimeout(bound); }
  };
  // The explicit check opens the window: its acknowledgment arms the interposer.
  const checked = await host.check(api, route.handle).catch(error => ({ error }));
  assert.equal(interposer.fired, 1, 'the interposed cut was reached exactly once');
  const closed = await closing;
  assert.equal(closed.cleanup.state, 'confirmed', 'the competing close completed');
  const challenges = timeline.filter(item => item.event === 'challenge-begins');
  assert.deepEqual(challenges.filter(item => item.closeCommitted), [], 'no challenge began after the close had committed: ' + JSON.stringify(timeline));
  assert.ok(challenges.length >= 1, 'the check did run its challenge, so the assertion above is not vacuous');
  assert.ok(timeline.some(item => item.event === 'blocked-at-lock'), 'the competing close was witnessed blocked at the reservation lock while the check held the cut: ' + JSON.stringify(timeline));
  assert.ok(timeline.findIndex(item => item.event === 'challenge-begins') < timeline.findIndex(item => item.event === 'close-committed'), 'the close committed after the challenge began');
  // The host's close drops the handle's permission first (closeShared), so this check ends unverified either way; only the order is asserted.
  assert.ok(checked.verification, 'the check returned a verification');
});

test('B: a check whose acknowledgment fails ends the earlier proof for that generation, so a watch cannot report it as current', async t => {
  for (const mode of ['throws', 'refuses', 'wrong-attempt']) {
    await t.test(mode, async t => {
      let failNext = null;
      const world = await hostedFunnelWorld(t, { acknowledgeOrigin: host => async request => {
        if (failNext === 'throws') throw new Error('host is shutting down');
        if (failNext === 'refuses') return { acknowledged: false };
        if (failNext === 'wrong-attempt') return { ...(await host.acknowledgeOrigin(request)), attemptId: 'another-attempt' };
        return host.acknowledgeOrigin(request);
      } });
      const { api, host } = world;
      const route = await host.start(api, await approved(api, world.durableRequest));
      assert.equal(route.verification.status, 'verified', 'the start verifies and its proof is still inside its validity window');
      const observed = async () => {
        const controller = new AbortController();
        for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: controller.signal, intervalMs: 100 })) { controller.abort(); return event.route.verification.status; }
        return null;
      };
      assert.equal(await observed(), 'verified', 'control: the watch reports the valid start proof before the failed check');
      failNext = mode;
      const checked = await host.check(api, route.handle);
      assert.notEqual(checked.verification.status, 'verified', 'the check whose acknowledgment failed is unverified');
      failNext = null;
      assert.notEqual(await observed(), 'verified', 'the earlier proof is no longer reported as current after a failed explicit check');
      const recovered = await host.check(api, route.handle);
      assert.equal(recovered.verification.status, 'verified', 'a later explicit check proves again');
      assert.equal(await observed(), 'verified', 'and the watch then reports that new proof');
    });
  }
});

test('B: concurrent attempts keep start order: a failure of an earlier attempt does not erase the proof of a later one', async t => {
  let gate, atFirst; const held = new Promise(resolve => { gate = resolve; }); const reached = new Promise(resolve => { atFirst = resolve; });
  let calls = 0;
  const world = await hostedFunnelWorld(t, { acknowledgeOrigin: host => async request => {
    const order = ++calls;
    if (order === 2) { atFirst(); await held; throw new Error('the earlier attempt fails late'); }
    return host.acknowledgeOrigin(request);
  } });
  const { api, host } = world;
  const route = await host.start(api, await approved(api, world.durableRequest)); // call 1
  const first = api.routeStatus({ home: host.home, handle: route.handle }); // call 2, held and then failing
  host.proofCalls.set(`${route.handle.kind}:${route.handle.id}:${route.handle.generation}`, { handle: route.handle });
  await reached;
  const later = await api.routeStatus({ home: host.home, handle: route.handle }); // call 3 starts after call 2 and verifies
  assert.equal(later.verification.status, 'verified');
  gate();
  assert.notEqual((await first).verification.status, 'verified');
  const controller = new AbortController();
  let status = null;
  for await (const event of api.watchRoutes({ home: host.home, handle: route.handle, signal: controller.signal, intervalMs: 100 })) { status = event.route.verification.status; controller.abort(); }
  assert.equal(status, 'verified', 'the later attempt\'s proof stays current');
});

test('C: ending one home\'s route does not erase another home\'s valid observation of the same route ID', async t => {
  const one = await hostedFunnelWorld(t, {});
  const two = await hostedFunnelWorld(t, {});
  assert.notEqual(one.home, two.home);
  assert.equal(one.durableRequest.usage.routeId, two.durableRequest.usage.routeId, 'both homes use the same route ID');
  const routeOne = await one.host.start(one.api, await approved(one.api, one.durableRequest));
  const routeTwo = await two.host.start(two.api, await approved(two.api, two.durableRequest));
  assert.equal(routeTwo.verification.status, 'verified');
  const observe = async world => {
    const controller = new AbortController(); let status = null;
    for await (const event of world.api.watchRoutes({ home: world.home, handle: world === one ? routeOne.handle : routeTwo.handle, signal: controller.signal, intervalMs: 100 })) { status = event.route.verification.status; controller.abort(); }
    return status;
  };
  assert.equal(await observe(two), 'verified', 'control: home two observes its own valid proof');
  const closed = await one.host.close(one.api, routeOne.handle);
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(await observe(two), 'verified', 'closing home one leaves home two\'s observation intact');
  assert.equal(two.host.accepted.length, 1, 'and home two was never asked again');
});
