import assert from 'node:assert/strict';
import test from 'node:test';
import { watchRoutes } from '../../packages/gozar-node/route-watch.mjs';
import { assertShape, fixtureValue } from './route-schema-check.mjs';

// A watch that fails to end must not hang the run: every controller aborts itself after a few seconds.
const ctl = () => { const controller = new AbortController(); setTimeout(() => controller.abort(), 4000).unref(); return controller; };
const handle = { kind: 'durable', id: 'example-main', generation: 4 };
const view = (over = {}) => ({ ...fixtureValue('RouteView', 'durable usable with ingress'), ...over });
const request = (signal, over = {}) => ({ home: '/nonexistent', handle, signal, intervalMs: 1, ...over });
/** A routeStatus that answers from a script, then repeats the last answer. */
function script(...steps) {
  let index = 0; const calls = [];
  const routeStatus = async ref => { calls.push(ref); const step = steps[Math.min(index++, steps.length - 1)]; if (step instanceof Error) throw step; return typeof step === 'function' ? step() : step; };
  return { routeStatus, calls, polls: () => index };
}
const notFound = () => Object.assign(new Error('gone'), { code: 'route_not_found' });
const collect = async iterable => { const events = []; for await (const event of iterable) events.push(event); return events; };
const deps = status => ({ routeStatus: status.routeStatus, minIntervalMs: 1 });

test('snapshot, then changed on a state change, then terminal on release; every event validates', async () => {
  const s = script(view(), view(), view({ state: 'lost' }), view({ state: 'released', ingress: null }));
  const events = await collect(watchRoutes(request(ctl().signal), deps(s)));
  assert.deepEqual(events.map(e => e.type), ['snapshot', 'changed', 'terminal']);
  assert.deepEqual(events.map(e => e.sequence), [0, 1, 2]);
  for (const event of events) assertShape('WatchEvent', event);
  assert.equal(events[2].route.state, 'released');
});

test('red: a change in the route properties is reported as changed; a mere proof refresh is not', async () => {
  const base = view();
  const refreshed = view({ ingress: { ...base.ingress, verifiedAt: '2026-11-12T12:01:00.000Z', validUntil: '2026-11-12T12:06:00.000Z' } });
  const changed = view({ properties: { ...base.properties, reach: 'tailnet' } });
  const s = script(base, refreshed, changed, view({ state: 'released' }));
  const events = await collect(watchRoutes(request(ctl().signal), deps(s)));
  assert.deepEqual(events.map(e => e.type), ['snapshot', 'changed', 'terminal']);
  assert.equal(events[1].route.properties.reach, 'tailnet');
});

test('a route that disappears ends the watch with a terminal released event', async () => {
  const s = script(view(), notFound());
  const events = await collect(watchRoutes(request(ctl().signal), deps(s)));
  assert.deepEqual(events.map(e => e.type), ['snapshot', 'terminal']);
  assertShape('WatchEvent', events[1]);
  assert.equal(events[1].route.state, 'released');
  assert.deepEqual(events[1].route.handle, handle);
});

test('red: abort ends the iteration promptly, stops polling and leaves no timer behind', async () => {
  const s = script(view());
  const controller = ctl();
  const before = process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
  const iterator = watchRoutes(request(controller.signal, { intervalMs: 60_000 }), { routeStatus: s.routeStatus, minIntervalMs: 60_000 })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.type, 'snapshot');
  const next = iterator.next();                         // now sleeping for a minute
  const started = Date.now();
  controller.abort();
  assert.deepEqual(await next, { value: undefined, done: true });
  assert.ok(Date.now() - started < 1000, 'abort must not wait for the poll interval');
  const polls = s.polls();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(s.polls(), polls, 'no poll after abort');
  assert.equal(process.getActiveResourcesInfo().filter(name => name === 'Timeout').length, before, 'the sleep timer is cleared');
});

test('abort while a poll is in flight also ends at once', async () => {
  const controller = ctl();
  const hang = { routeStatus: () => new Promise(() => {}) };
  const iterator = watchRoutes(request(controller.signal), deps(hang))[Symbol.asyncIterator]();
  const next = iterator.next();
  controller.abort();
  assert.equal((await next).done, true);
});

test('an already-aborted signal yields nothing and never polls', async () => {
  const s = script(view()); const controller = ctl(); controller.abort();
  assert.deepEqual(await collect(watchRoutes(request(controller.signal), deps(s))), []);
  assert.equal(s.polls(), 0);
});

test('provider_unavailable keeps the watch alive as state unknown; busy is retried; other errors surface with frozen codes', async () => {
  const unavailable = Object.assign(new Error('down'), { code: 'provider_unavailable' }), busy = Object.assign(new Error('busy'), { code: 'busy' });
  const controller = ctl();
  const s = script(view(), unavailable, busy, view());
  const events = [];
  for await (const event of watchRoutes(request(controller.signal), deps(s))) { events.push(event); if (events.length === 3) controller.abort(); }
  assert.deepEqual(events.map(e => [e.type, e.route.state]), [['snapshot', 'usable'], ['changed', 'unknown'], ['changed', 'usable']]);
  assert.equal(events[1].route.routeState, 'unknown');
  assert.equal(events[1].route.published, null);
  assert.equal(events[1].route.verification.status, 'unverified');
  for (const event of events) assertShape('WatchEvent', event);
  const failing = script(Object.assign(new Error('x'), { code: 'weird_legacy_code' }));
  await assert.rejects(collect(watchRoutes(request(ctl().signal), deps(failing))), error => error.code === 'internal_error');
});

test('the poll interval follows limits.recommendedPollIntervalMs unless the request overrides it, and asks only for the handle', async () => {
  const s = script(view({ limits: { recommendedPollIntervalMs: 40, idleTimeoutMs: null } }));
  const controller = ctl(); const stamps = [];
  const started = Date.now();
  const status = async ref => { stamps.push(Date.now() - started); if (stamps.length === 3) controller.abort(); return s.routeStatus(ref); };
  await collect(watchRoutes({ home: '/nonexistent', handle, signal: controller.signal }, { routeStatus: status, minIntervalMs: 1 }));
  assert.ok(stamps[1] - stamps[0] >= 30 && stamps[2] - stamps[1] >= 30, `polls were ${stamps}`);
  assert.deepEqual(s.calls[0], { home: '/nonexistent', handle });
});

test('bad requests are invalid_input before any poll', () => {
  assert.throws(() => watchRoutes({ home: '/x', handle, signal: undefined }), error => error.code === 'invalid_input');
  assert.throws(() => watchRoutes({ home: '/x', handle: { kind: 'nope' }, signal: ctl().signal }), error => error.code === 'invalid_input');
  assert.throws(() => watchRoutes({ home: '/x', handle, signal: ctl().signal, intervalMs: -1 }), error => error.code === 'invalid_input');
});
