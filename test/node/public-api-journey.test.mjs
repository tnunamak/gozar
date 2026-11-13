// The consumer journey through the package root, one operation per fresh process, against fakes only:
// catalog by requirement -> candidate with token -> ensure / adopt / expose with approval -> status -> watch -> close.
// An app names a requirement and never a provider. Three of these tests are red tests: they prove the seams between the
// catalog, the consent tokens, the engine and the registry rather than any one module.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { approvalFrom, dnsName, durableWorld, fakeRegistry, journeyRoot } from './journey-world.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let world;
before(async () => { world = await journeyRoot(); });
after(() => rm(world.root, { recursive: true, force: true }));

test('journey: durable route by requirement, in separate processes, from catalog to close', async t => {
  const w = await durableWorld(world, t);
  const { result: catalog, error } = await w.api('catalogRoutes', w.query());
  assert.equal(error, undefined, JSON.stringify(error));
  assert.equal(catalog.schemaVersion, 1);
  const { approval } = approvalFrom(catalog);

  const created = await w.api('ensureRoute', { ...w.query(), approval });
  assert.equal(created.error, undefined, JSON.stringify(created.error));
  const view = created.result;
  assert.equal(view.schemaVersion, 1);
  assert.deepEqual([view.handle.kind, view.handle.id], ['durable', 'coordinator']);
  assert.equal(view.state, 'usable');
  assert.equal(view.ownership, 'gozar-owned');
  assert.match(view.origin, /^https:\/\/node\.tailnet\.test(:\d+)?$/);
  assert.equal(view.verification.status, 'verified');
  assert.equal(JSON.stringify(view).includes('tailscale-funnel'), false, 'a RouteView carries no adapter id');
  assert.equal(JSON.stringify(view.handle).includes('tailscale'), false);
  assert.ok(Object.keys(w.state.config.Web ?? {}).length === 1, 'one rule in the provider');

  const status = await w.api('routeStatus', { home: w.home, handle: view.handle });
  assert.equal(status.error, undefined, JSON.stringify(status.error));
  assert.equal(status.result.state, 'usable');
  assert.equal(status.result.origin, view.origin);

  const watched = await w.api('watchRoutes', { home: w.home, handle: view.handle, events: 1 });
  assert.equal(watched.error, undefined, JSON.stringify(watched.error));
  assert.deepEqual(watched.result.map(event => [event.type, event.sequence, event.route.state]), [['snapshot', 0, 'usable']]);

  const closed = await w.api('closeRoute', { home: w.home, handle: view.handle, mode: 'remove' });
  assert.equal(closed.error, undefined, JSON.stringify(closed.error));
  assert.equal(closed.result.state, 'released');
  assert.deepEqual(w.state.config.Web ?? {}, {}, 'the provider rule is gone');
  assert.deepEqual(await w.cliCalls(), [], 'no provider CLI call');
  const after = await w.api('routeStatus', { home: w.home, handle: view.handle });
  assert.equal(after.error?.code, 'route_not_found');
});

test('journey: adoptRoute takes over an existing rule by the same path', async t => {
  const w = await durableWorld(world, t);
  w.state.config.TCP = { 8443: { HTTPS: true } };
  w.state.config.Web = { [`${dnsName}:8443`]: { Handlers: { '/': { Proxy: `http://${w.target}` } } } };
  w.state.config.AllowFunnel = { [`${dnsName}:8443`]: true };
  w.state.etag++;
  const request = w.query({ intent: 'adopt', origin: w.origin });
  const { result: catalog, error } = await w.api('catalogRoutes', request);
  assert.equal(error, undefined, JSON.stringify(error));
  const { approval } = approvalFrom(catalog);
  const adopted = await w.api('adoptRoute', { ...request, approval, handover: { from: 'example-app', generation: 1 } });
  assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
  assert.equal(adopted.result.state, 'usable');
  assert.equal(adopted.result.origin, w.origin);
  assert.equal(adopted.result.handle.kind, 'durable');
  assert.deepEqual(w.state.writes, [], 'adoption writes nothing to the provider');
});

test('red: a token from a stale catalog fails candidate_stale and writes nothing to the provider', async t => {
  const w = await durableWorld(world, t);
  const { result: catalog } = await w.api('catalogRoutes', w.query());
  const { approval } = approvalFrom(catalog);
  // The provider's facts change after the catalog was read: a foreign rule now occupies the port the plan would have used,
  // so the route would land elsewhere than the user approved. The last port stays free, so only the stale token can stop it.
  for (const port of [443, 8443]) {
    (w.state.config.TCP ??= {})[port] = { HTTPS: true };
    (w.state.config.Web ??= {})[`${dnsName}:${port}`] = { Handlers: { '/': { Proxy: 'http://127.0.0.1:9' } } };
  }
  w.state.etag++;
  const writesBefore = w.state.writes.length, before = structuredClone(w.state.config);
  const refused = await w.api('ensureRoute', { ...w.query(), approval });
  assert.equal(refused.result, undefined, 'the route must not be created from a stale token');
  assert.equal(refused.error?.code, 'candidate_stale', JSON.stringify(refused.error));
  assert.equal(w.state.writes.length, writesBefore, 'zero provider writes');
  assert.deepEqual(w.state.config, before);
});

test('red: an unknown provider added through a test manifest is offered by the catalog and usable with no core edit', async t => {
  const w = await fakeRegistry(world, t);
  const { result: catalog, error } = await w.api('catalogRoutes', w.attached());
  assert.equal(error, undefined, JSON.stringify(error));
  assert.deepEqual(catalog.candidates.map(candidate => candidate.eligible), [true], 'only the test manifest is consulted');
  const { approval } = approvalFrom(catalog);
  const exposed = await w.api('expose', { ...w.attached(), approval, wait: 'verified' });
  assert.equal(exposed.error, undefined, JSON.stringify(exposed.error));
  const view = exposed.result;
  assert.equal(view.handle.kind, 'attached');
  assert.equal(view.state, 'usable');
  assert.equal(view.origin, 'https://example-app.fake-edge.invalid');
  assert.deepEqual(await w.writesSeen(), ['create']);

  const status = await w.api('routeStatus', { home: w.home, handle: view.handle });
  assert.equal(status.error, undefined, JSON.stringify(status.error));
  assert.equal(status.result.state, 'usable');
  const closed = await w.api('closeRoute', { home: w.home, handle: view.handle, mode: 'remove' });
  assert.equal(closed.error, undefined, JSON.stringify(closed.error));
  assert.equal(closed.result.state, 'released');
  for (let waited = 0; waited < 10_000 && !(await w.writesSeen()).includes('remove'); waited += 100) await sleep(100);
  assert.deepEqual(await w.writesSeen(), ['create', 'remove']);
});

test('journey: an attached route is requested by requirement and held by the opening process until closed', async t => {
  const w = await fakeRegistry(world, t);
  const { result: catalog } = await w.api('catalogRoutes', w.attached());
  const { approval } = approvalFrom(catalog);
  // A second request cannot reuse the one-time approval: the token is single use.
  const first = await w.api('expose', { ...w.attached(), approval, wait: 'verified' });
  assert.equal(first.error, undefined, JSON.stringify(first.error));
  const again = await w.api('expose', { ...w.attached(), approval, wait: 'verified' });
  assert.ok(['consent_unknown', 'consent_expired', 'consent_mismatch', 'candidate_stale'].includes(again.error?.code), JSON.stringify(again));
  await w.api('closeRoute', { home: w.home, handle: first.result.handle, mode: 'remove' });
});
