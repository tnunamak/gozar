// Session lifecycle on the one generic session runtime, for every recipe provider: a host acknowledgment that is refused, wrong,
// malformed or held fails the start closed with exact cleanup and no proof request; an owned process that ends on its own is
// withdrawn; an unreadable provider is cleanup debt that a later close can settle. Ported from the earlier-controller suites
// (automatic-stop, public-proof-boundary); the matrix in the delivery report maps each old test to a test here or says why it was dropped.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { status, stop } from '@tnunamak/gozar';
import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { providerWorld, PROVIDERS } from './session-provider-fixtures.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = promise => promise.then(value => ({ value }), error => ({ error }));
async function until(check, what, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(50)) { const value = await check(); if (value) return value; }
  assert.fail(`timed out: ${what}`);
}
const controllerOf = async w => JSON.parse(await readFile(join(w.home, `port-${w.target.split(':')[1]}`, 'control.json'), 'utf8').catch(() => 'null'));
const controllerAlive = async w => { const identity = await controllerOf(w); return Boolean(identity?.pid) && await processIdentity(identity.pid) === identity.startIdentity; };

const ACKNOWLEDGMENTS = {
  'a foreign-origin acknowledgment': request => ({ acknowledged: true, origin: 'https://foreign.example', handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId }),
  'a refused acknowledgment': () => ({ acknowledged: false }),
  'a throwing host': () => { throw new Error('host refused'); },
  'an acknowledgment for another attempt': request => ({ acknowledged: true, origin: request.origin, handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: 'another-attempt' }),
};

for (const providerId of PROVIDERS) {
  for (const [name, acknowledge] of Object.entries(ACKNOWLEDGMENTS)) {
    test(`${providerId}: ${name} fails the start closed: no proof request, the owned resource removed once, cleanup confirmed`, async t => {
      const w = await providerWorld(t, providerId, { acknowledge });
      const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
      assert.equal(failure?.code, 'verification_failed', failure?.message);
      assert.equal(w.events.filter(event => event.at === 'proof').length, 0, 'no verification request leaves Gozar without an exact acknowledgment');
      assert.equal(w.events.filter(event => event.at === 'allocate').length, 1);
      assert.equal(w.events.filter(event => event.at === 'remove').length, 1, 'removed exactly once');
      assert.equal(w.ownedNow(), 0);
      assert.equal(failure.route?.cleanup?.state, 'confirmed');
      assert.equal(failure.route?.published, null);
    });
  }
  test(`${providerId}: a held acknowledgment that times out publishes nothing, and its late answer revives nothing`, async t => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const w = await providerWorld(t, providerId, { acknowledge: () => held, originAckTimeoutMs: 400 });
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.equal(failure?.code, 'verification_failed', failure?.message);
    assert.equal(w.events.filter(event => event.at === 'proof').length, 0);
    assert.equal(w.ownedNow(), 0);
    assert.equal(failure.route?.cleanup?.state, 'confirmed');
    release({ acknowledged: true, origin: failure.route?.origin, handle: { id: 'x', generation: 1 }, attemptId: 'late' });
    await wait(300);
    assert.equal(w.events.filter(event => event.at === 'proof').length, 0, 'a late acknowledgment changes nothing');
  });
}

const keyLeases = async w => (await readdir(join(w.home, 'identities')).catch(() => [])).filter(name => name.startsWith('.active-route-') && name.endsWith('.json'));
const gone = async w => { for (const end = Date.now() + 20_000; Date.now() < end; await wait(50)) if (!await controllerAlive(w)) return true; return false; };

for (const providerId of ['localhost-run', 'tailscale-funnel']) {
  test(`${providerId}: an owned process that ends on its own withdraws the route, ends the controller and leaves nothing owned`, async t => {
    const w = await providerWorld(t, providerId);
    const route = await w.expose(await w.approvedRequest());
    assert.equal(route.verification.status, 'verified');
    assert.equal(await controllerAlive(w), true, 'the session controller is serving');
    [...w.owned.values()][0].child.kill('SIGTERM');
    assert.equal(await gone(w), true, 'the controller ends itself once the route is withdrawn and removed');
    const view = await w.api.routeStatus({ home: w.home, handle: route.handle });
    assert.equal(view.published, null, 'nothing is advertised after the provider process is gone');
    assert.equal(w.ownedNow(), 0);
    assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed', 'a later close of the same handle is idempotent');
    assert.equal(w.events.filter(event => event.at === 'remove').length, 1, 'the owned resource ended exactly once');
  });
}

test('tailscale-funnel: when the provider cannot be read after the process ends, the controller stays as the cleanup channel and a later close settles it', async t => {
  const w = await providerWorld(t, 'tailscale-funnel');
  const route = await w.expose(await w.approvedRequest());
  await w.fake.update(state => { state.failServeStatus = true; });
  [...w.owned.values()][0].child.kill('SIGTERM');
  const view = await until(async () => { const reading = await w.api.routeStatus({ home: w.home, handle: route.handle }).catch(() => null); return reading && reading.cleanup?.state !== 'none' && reading; }, 'cleanup debt is recorded');
  assert.notEqual(view.cleanup.state, 'confirmed');
  assert.equal(view.published, null);
  assert.equal(await controllerAlive(w), true, 'unresolved cleanup keeps the authenticated controller');
  await w.fake.update(state => { state.failServeStatus = false; });
  const closed = await w.host.close(w.api, route.handle);
  assert.equal(closed.cleanup.state, 'confirmed', JSON.stringify(closed.cleanup));
  assert.equal(await gone(w), true);
  assert.equal(w.ownedNow(), 0);
});

test('tunnl-gg: a session that reaches its lifetime ends by itself, releases the installation key, and the same key serves the next session', async t => {
  const w = await providerWorld(t, 'tunnl-gg', { lifetimeMs: 14_000 });
  const route = await w.expose(await w.approvedRequest());
  assert.equal(route.verification.status, 'verified');
  assert.equal((await keyLeases(w)).length, 1, 'the key-bound relay is held by exactly this session');
  assert.equal(await gone(w), true, 'the controller ends at the host deadline');
  assert.equal(w.ownedNow(), 0);
  assert.deepEqual(await keyLeases(w), [], 'the key lease is released with the confirmed removal');
  const other = await w.another();
  const next = await w.expose(await w.approvedRequest({ ...other, usage: { kind: 'session', lifetimeMs: 60_000 } }));
  assert.equal(next.verification.status, 'verified');
  assert.equal((await w.host.close(w.api, next.handle)).cleanup.state, 'confirmed');
});

test('tunnl-gg: an expiry that arrives while the start is still being proved drains the start, removes the relay and leaves no lease', async t => {
  const w = await providerWorld(t, 'tunnl-gg', { lifetimeMs: 3_000, hold: async () => { await wait(4_000); } });
  const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
  assert.ok(failure, 'a start that outlives its lifetime does not publish');
  assert.equal(failure.route?.published ?? null, null);
  assert.equal(await gone(w), true);
  assert.equal(w.ownedNow(), 0);
  assert.deepEqual(await keyLeases(w), []);
});

test('tunnl-gg: one installation key admits one live session; the second names the holder and its stop command, and the key frees when the first closes', async t => {
  const w = await providerWorld(t, 'tunnl-gg');
  const one = await w.expose(await w.approvedRequest());
  const other = await w.another();
  const failure = await w.expose(await w.approvedRequest(other)).then(() => null, error => error);
  assert.equal(failure?.code, 'route_conflict', failure?.message);
  const ownerPort = w.target.split(':')[1];
  assert.match(failure.message, new RegExp(`port ${ownerPort}`));
  assert.ok(failure.message.includes(cliCommand('stop', Number(ownerPort), w.home)), failure.message);
  assert.equal(w.ownedNow(), 1, 'the first session is untouched');
  assert.equal(failure.route?.cleanup?.state ?? 'confirmed', 'confirmed', 'the refused start owns nothing');
  assert.equal((await w.host.close(w.api, one.handle)).cleanup.state, 'confirmed');
  // A new operation: the same operation id would replay the refused start, not make a new one.
  const retried = await w.expose(await w.approvedRequest({ ...other, operationId: `${other.operationId}-again` }));
  assert.equal(retried.verification.status, 'verified');
  assert.equal((await w.host.close(w.api, retried.handle)).cleanup.state, 'confirmed');
});

test('the in-process status and stop helpers list and close a running session by its port, through the same runtime', async t => {
  const w = await providerWorld(t, 'localhost-run');
  const route = await w.expose(await w.approvedRequest());
  const port = Number(w.target.split(':')[1]);
  const listed = await status({ home: w.home, port });
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].port, port);
  assert.equal(listed.sessions[0].origin, route.published);
  assert.equal(listed.sessions[0].cleanup, 'none');
  assert.equal(listed.sessions[0].earlierVersion, undefined, 'a session this runtime started is current, not history');
  assert.deepEqual((await status({ home: w.home, port: port + 1 })).sessions, []);
  const stopped = await stop({ home: w.home, port });
  assert.equal(stopped.session.cleanup.state, 'confirmed', JSON.stringify(stopped));
  assert.equal(w.ownedNow(), 0);
  assert.equal(await gone(w), true);
  assert.equal((await stop({ home: w.home, port })).session.cleanup.state, 'confirmed', 'a second stop of a confirmed session is idempotent');
});

// The stop-at-pending-probe hypothesis: the pure core can leave `candidate-ready` with the proof never run, so a stop needs no proof.
// Nothing is ever fed to the core as a probe result that was not observed: the journal of such a session records a stopped core, no accepted
// receipt and nothing owned, and the cleanup came from the recorded owned resource.
const journalOf = async w => JSON.parse(await readFile(join(w.home, `port-${w.target.split(':')[1]}`, 'session.json'), 'utf8'));
for (const providerId of PROVIDERS) {
  test(`${providerId}: a stop while the core's proof is still pending removes the owned resource from its record without any proof or probe result`, async t => {
    const w = await providerWorld(t, providerId, { acknowledge: () => { throw new Error('host refused'); } });
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.equal(failure?.code, 'verification_failed', failure?.message);
    assert.equal(w.events.filter(event => event.at === 'proof' || event.at === 'proof-answer').length, 0, 'no proof request was made on any path');
    const journal = await journalOf(w);
    assert.equal(journal.snapshot.phase, 'stopped');
    assert.deepEqual(Object.keys(journal.owned ?? {}), [], 'what the record named as owned is gone');
    assert.equal(journal.validation ?? null, null, 'no accepted probe receipt exists for a proof that never ran');
    assert.equal(journal.snapshot.published ?? null, null);
    assert.equal(w.events.filter(event => event.at === 'remove').length, 1, 'the owned resource ended exactly once');
    assert.equal(w.ownedNow(), 0);
  });
}

test('dead fixture session settles exact close on disk and allows a new session on the same port', async t => {
  const w = await providerWorld(t, 'tailscale-funnel');
  // Recovery runs the persisted recipe in this process, outside the live
  // controller's fixture dispatcher. It must find this world's inert CLI.
  const savedPath=process.env.PATH;
  process.env.PATH=w.fake.bin+':'+savedPath;
  try {
  const route = await w.expose(await w.approvedRequest());
  const directory = join(w.home, `port-${w.target.split(':')[1]}`);
  const identity = await controllerOf(w);
  assert.ok(identity?.pid && identity.startIdentity);
  assert.equal(await processIdentity(identity.pid), identity.startIdentity, 'signal only this fixture-owned controller');
  process.kill(identity.pid, 'SIGKILL');
  await until(async () => await processIdentity(identity.pid) !== identity.startIdentity, 'owned controller stopped');
  await w.fake.update(state => { state.failServeStatus = true; });
  try {
    const refusal = await w.host.close(w.api, route.handle).catch(error => error.route);
    assert.notEqual(refusal?.cleanup?.state, 'confirmed', 'an unreadable provider is not successful removal');
    const retained = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.notEqual(retained.phase, 'released');
    assert.deepEqual(retained.handle, route.handle);
  } finally {
    await w.fake.update(state => { state.failServeStatus = false; });
  }
  const result = await w.host.close(w.api, route.handle);
  assert.equal(result.cleanup.state, 'confirmed', JSON.stringify(result.cleanup));
  const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(persisted.phase, 'released');
  assert.deepEqual(persisted.handle, route.handle);
  assert.equal(persisted.lastView.cleanup.state, 'confirmed');
  await assert.rejects(readFile(join(directory, 'control.json'), 'utf8'), { code: 'ENOENT' });

  const next = await w.expose(await w.approvedRequest({ operationId: 'replacement-on-the-same-port' }));
  assert.notEqual(next.handle.id, route.handle.id);
  assert.equal(next.verification.status, 'verified');
  assert.equal((await w.host.close(w.api, next.handle)).cleanup.state, 'confirmed');
  } finally { process.env.PATH=savedPath; }
});
