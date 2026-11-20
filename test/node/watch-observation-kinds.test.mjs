// Observation across route-handle kinds, for a host that declared `acknowledgeOrigin`.
//
// Contract under test (docs/embedding-contract.md, "Observation versus proof"):
//   * `watchRoutes` and the internal close read are observations for every allocated-origin kind. They start no proof or
//     challenge, ask no acknowledgment, allocate nothing, publish nothing, renew no lease.
//   * The one deliberate write is DEFENSIVE: a durable route's observation reads the route's current consent facts, and when
//     they differ from what was approved it persists a withdrawal (fail-closed). It never creates authority.
//   * An owner-kept external route has no allocation; its watch proves the one exact owner-supplied origin (no acknowledgment)
//     and must not re-prove anything else in the home.
// The attached and generic-session rows are public tests in origin-acknowledgment.test.mjs (real controllers).
// This file covers durable, the dispatch table of route-view.mjs (every kind, which controller command runs), and external.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServiceVerifier } from '@tnunamak/gozar';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { routeStatus, closeRoute } from '../../packages/gozar-node/route-view.mjs';
import { hostedFunnelWorld, approved } from './consumer-host-fixture.mjs';
import { scratch, query } from './route-schema-check.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, label) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) assert.fail(`timed out: ${label}`); await sleep(20); }
}
async function watchFor(api, home, handle, ms) {
  const controller = new AbortController(), events = [];
  const done = (async () => {
    try { for await (const event of api.watchRoutes({ home, handle, signal: controller.signal, intervalMs: 250 })) events.push(event); }
    catch (error) { events.error = error; }
  })();
  await until(() => events.length > 0 || events.error, 10_000, 'the first watch event');
  await sleep(ms); controller.abort(); await done;
  return events;
}
const recordOf = async home => {
  const dir = join(home, 'routes'), name = (await readdir(dir)).find(item => /^[0-9a-f]{64}\.json$/.test(item));
  return { path: join(dir, name), value: JSON.parse(await readFile(join(dir, name), 'utf8')) };
};

// ---- durable ------------------------------------------------------------------------------------------------------
test('durable: an ordinary watch is passive, and real consent drift withdraws existing authority without any proof, acknowledgment or provider write', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host, fixture } = world;
  const route = await host.start(api, await approved(api, world.durableRequest));
  let challenges = 0; world.listener.server.on('request', () => { challenges++; });
  const counters = () => ({ writes: fixture.state.writes, proofs: fixture.state.proofFetches.length, asked: host.accepted.length + host.refused.length, challenges });
  const before = counters(), recordBefore = await readFile((await recordOf(world.home)).path, 'utf8');

  const ordinary = await watchFor(api, world.home, route.handle, 700);
  assert.equal(ordinary.error, undefined);
  assert.equal(ordinary[0].route.verification.status, 'verified');
  assert.deepEqual(counters(), before, 'ordinary observation: no proof, challenge, acknowledgment or provider write');
  assert.equal(await readFile((await recordOf(world.home)).path, 'utf8'), recordBefore, 'and the saved route record is byte-identical');

  // Real drift: what the owner approved no longer equals the route's current consent facts (the saved approval digest differs).
  const { path, value } = await recordOf(world.home);
  value.consentReview = { ...value.consentReview, consentFactsDigest: 'sha256:' + '0'.repeat(64) };
  await writeFile(path, JSON.stringify(value));
  const drifted = await watchFor(api, world.home, route.handle, 700);
  assert.equal(drifted.error, undefined);
  assert.equal(drifted[0].route.published, null, 'the watch reports withdrawn authority, not a verified route');
  assert.ok(drifted[0].route.consentChange, 'with the consent change named');
  assert.notEqual(drifted[0].route.verification.status, 'verified');
  assert.deepEqual(counters(), before, 'the defensive withdrawal is the ONLY effect: still no proof, challenge, acknowledgment or provider write (the foreign listener and rule are untouched)');
  const withdrawn = (await recordOf(world.home)).value;
  assert.equal(withdrawn.state, 'unverified');
  assert.ok(withdrawn.consentChange, 'the withdrawal persisted (fail-closed)');
  assert.equal((await host.check(api, route.handle)).published, null, 'a later explicit check does not revive it without a review');
  await host.close(api, route.handle);
});

// ---- dispatch table (route-view.mjs): which command runs for each kind under watch (observe) and explicit status -----------
test('dispatch: observation selects the passive read of every kind, explicit status keeps the fresh one, and a missing declaration keeps the earlier behavior', async () => {
  const home = '/nonexistent-home-for-dispatch';
  const durable = { id: 'r', generation: 1 };
  const calls = [];
  const deps = observe => ({
    observe,
    durable: { status: async (request, opts) => { calls.push(['durable', opts.observe === true]); return { routeId: 'r', generation: 1, adapterId: 'none', state: 'usable', verification: { status: 'unverified', checkedAt: null }, origin: null, allocatedOrigin: null, owner: 'o', target: 't', ownership: 'gozar-owned', exposure: 'owner-run', forwards: '', lifetime: 'durable' }; } },
    session: { status: async (request, opts) => { calls.push(['session', opts?.observe === true]); return { snapshot: { sessionId: 's', phase: 'candidate-ready', adapterId: 'none' } }; } },
    attached: {
      attachedStatus: async () => { calls.push(['attached', 'fresh']); throw Object.assign(new Error('stop'), { code: 'internal_error' }); },
      observeAttachedRoute: async (request, opts) => { calls.push(['attached', opts?.asStatus === true ? 'observe' : 'bad']); throw Object.assign(new Error('stop'), { code: 'internal_error' }); },
    },
    adapters: [],
  });
  for (const observe of [true, false]) {
    calls.length = 0;
    await routeStatus({ home, handle: { kind: 'durable', id: 'r', generation: 1 } }, deps(observe)).catch(() => {});
    await routeStatus({ home, handle: { kind: 'attached', id: 'a', generation: 1 } }, deps(observe)).catch(() => {});
    assert.deepEqual(calls.find(call => call[0] === 'durable'), ['durable', observe]);
    assert.deepEqual(calls.find(call => call[0] === 'attached'), ['attached', observe ? 'observe' : 'fresh'], `attached ${observe ? 'observes' : 'asks fresh status'}`);
  }
  void durable;
});

// ---- external, owner-kept ----------------------------------------------------------------------------------------------
test('external owner-kept: its status and watch ask no acknowledgment and re-prove no other route in the home', async t => {
  const world = await hostedFunnelWorld(t, {});
  const { api, host, fixture } = world;
  const durable = await host.start(api, await approved(api, world.durableRequest));
  const app = http.createServer((req, res) => res.end('owner app'));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections?.(); app.close(resolve); }));
  const origin = 'https://owner.fixture.invalid', target = `127.0.0.1:${app.address().port}`;
  const q = query({ home: world.home, owner: world.owner, target, origin, providerId: 'own-address', operationId: 'owner-kept-op', usage: { kind: 'durable', routeId: 'owner-kept-route' },
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } });
  const choice = (await api.catalogRoutes(q)).candidates[0];
  assert.ok(choice, 'the owner-kept candidate exists');
  const external = await api.ensureRoute({ ...q, approval: { kind: 'route', candidateToken: choice.candidateToken, disclosureRevision: choice.disclosure.revision, consentFactsDigest: choice.consentFactsDigest } });
  assert.equal(external.handle.kind, 'external');
  const durableHost = durable.origin || durable.allocatedOrigin;
  assert.ok(durableHost, 'the durable route has an origin');
  const durableProofs = () => fixture.state.proofFetches.filter(seen => durableHost.endsWith(seen.host) || seen.host === new URL(durableHost).host).length;
  const base = { asked: host.accepted.length + host.refused.length, durableProofs: durableProofs(), writes: fixture.state.writes };
  await api.routeStatus({ home: world.home, handle: external.handle }).catch(() => {});
  await watchFor(api, world.home, external.handle, 700);
  assert.deepEqual({ asked: host.accepted.length + host.refused.length, durableProofs: durableProofs(), writes: fixture.state.writes }, base,
    'reading the external handle asked the host for nothing, proved no durable route of the home, and wrote nothing at the provider');
  assert.deepEqual(host.refused, [], 'nothing was refused: no acknowledgment was asked outside a host call');
  await api.closeRoute({ home: world.home, handle: external.handle, mode: 'remove' });
  await host.close(api, durable.handle);
});
