// A session start honours `wait`, fails with a contract code, leaves no controller behind unless it must retain one for cleanup
// debt, and reports its target the way a durable route does. Every provider's session runs the generic session controller; here
// a stub adapter inside a real detached controller process stands in for the provider, so start, close and the failure record
// are the real code. (Replaces the earlier version of this file, whose fake daemon spoke the removed controller's protocol.)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { closeAttachedRoute } from '../../packages/gozar-node/attached-route.mjs';
import { acquireInstallKeyLease } from '../../packages/gozar-node/key-route-lease.mjs';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { providerWorld } from './session-provider-fixtures.mjs';
import { attachedScratch } from './route-schema-check.mjs';
import { gone, sessionWorld } from './session-controller-fixtures.mjs';

test('a conflicting unbootstrapped session start carries confirmed cleanup for only its refused handle', async t => {
  const w = await sessionWorld(t);
  const retained = await w.run();
  try {
    await assert.rejects(w.run(), error => {
      assert.equal(error.code, 'route_conflict');
      assert.ok(error.route, 'a refusal before bootstrap owes no cleanup');
      assert.equal(error.route.cleanup.state, 'confirmed');
      assert.equal(error.route.state, 'released');
      assert.notEqual(error.route.handle.id, retained.handle.id);
      assert.equal(error.route.published, null);
      return true;
    });
    assert.equal(await w.alive(), true, 'the retained controller is unaffected');
    await assert.rejects(w.run({ reservedHandle: retained.handle }), error => {
      assert.equal(error.code, 'route_conflict');
      assert.notEqual(error.route?.cleanup?.state, 'confirmed', 'retrying the retained identity is not proof of its removal');
      return true;
    });
  } finally {
    const closed = await closeAttachedRoute({ home: w.home, handle: retained.handle });
    assert.equal(closed.cleanup.state, 'confirmed');
    assert.equal(await gone(w), true);
  }
});

const root = fileURLToPath(new URL('../../', import.meta.url));

test('red: wait verified on a start whose create fails rejects with a code, and the controller that holds the cleanup debt stays authenticated', async t => {
  const world = await sessionWorld(t, "adapter.create = async () => { throw Object.assign(new Error('no auth'), { code: 'setup_required' }); };");
  const error = await world.run().then(() => null, caught => caught);
  assert.equal(error?.code, 'setup_required');
  assert.equal(error.route.cleanup.state, 'unconfirmed', 'a failed create is unconfirmed, never confirmed absence');
  assert.equal(error.route.published, null);
  assert.ok(await world.alive(), 'unconfirmed creation retains the controller that can still clean up');
});

test('red: wait verified returns only when the session is usable, and keeps the controller', async t => {
  const world = await sessionWorld(t);
  const view = await world.run();
  assert.equal(view.state, 'usable');
  assert.equal(view.published, 'https://example.invalid');
  assert.equal(view.verification.status, 'verified');
  assert.equal(view.handle.kind, 'session');
  assert.ok(await world.alive(), 'the controller is still serving');
  assert.equal((await closeAttachedRoute({ home: world.home, handle: view.handle, mode: 'remove' })).state, 'released');
  assert.ok(await gone(world), 'close ends the controller');
});

test('red: wait allocated returns once an origin exists, whether or not it is verified yet', async t => {
  const world = await sessionWorld(t);
  const view = await world.run({ wait: 'allocated' });
  assert.equal(view.origin, 'https://example.invalid');
  assert.notEqual(view.state, 'creating');
  await closeAttachedRoute({ home: world.home, handle: view.handle, mode: 'remove' });
});

test('wait verified on a session that never verifies times out as verification_failed and removes the route and the controller', async t => {
  const world = await sessionWorld(t, "adapter.verify = async () => ({ status: 'unverified', checkedAt: new Date().toISOString() });");
  const error = await world.run({ startTimeoutMs: 3000 }).then(() => null, caught => caught);
  assert.equal(error?.code, 'verification_failed');
  assert.ok(await gone(world), 'the failed start ended the controller after removing what it created');
});

test('a controller that never starts the route is stopped when the start times out', async t => {
  const world = await sessionWorld(t, 'await new Promise(() => { setInterval(() => {}, 1000); });');
  const error = await world.run({ startTimeoutMs: 1500 }).then(() => null, caught => caught);
  assert.equal(error?.code, 'provider_unavailable');
  assert.ok(await gone(world));
});

test('the CLI exits non-zero with the code envelope when a session start fails', async t => {
  const world = await sessionWorld(t, "adapter.verify = async () => ({ status: 'unverified', checkedAt: new Date().toISOString() });");
  const request = await world.approve('verified');
  const files = join(world.home, 'cli'); await mkdir(files, { recursive: true });
  const queryFile = join(files, 'query.json'), approvalFile = join(files, 'approval.json');
  await writeFile(queryFile, JSON.stringify(request)); await writeFile(approvalFile, JSON.stringify(request.approval), { mode: 0o600 }); await chmod(approvalFile, 0o600);
  let stdout = '';
  const code = await routeMain(['expose', '--query-file', queryFile, '--approval-file', approvalFile, '--wait', 'verified', '--json'],
    { api: { expose: () => world.run({ startTimeoutMs: 3000 }) }, stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: () => {} } });
  assert.notEqual(code, 0);
  assert.equal(JSON.parse(stdout.trim().split('\n').pop()).error.code, 'verification_failed');
  assert.ok(await gone(world));
});

// --- C: the key lease -----------------------------------------------------------------------------
// The lease is taken by the controller process that provisions the installation key, so a second live route on the same key is refused.

test('red: a second session while the key is held is route_conflict with a stop action, through the API and the CLI', async t => {
  const fingerprint = createHash('sha256').update('synthetic-key').digest('hex');
  const home = await attachedScratch(t);
  await mkdir(join(home, 'identities'), { recursive: true, mode: 0o700 });
  // Port 8801 holds the key: its owner is this live process.
  const lease = await acquireInstallKeyLease({ home, keyFingerprint: fingerprint, sessionDirectory: join(home, 'port-8801'), sessionId: 'first', targetPort: 8801 });
  t.after(() => lease.release());
  const error = await acquireInstallKeyLease({ home, keyFingerprint: fingerprint, sessionDirectory: join(home, 'port-8802'), sessionId: 'second', targetPort: 8802 }).then(() => null, caught => caught);
  assert.equal(error?.code, 'route_conflict');
  assert.match(error.message, /held by port 8801/);
  assert.equal(error.nextAction?.kind, 'instructions');
  assert.match(error.nextAction.instructions, /stop.*--port.*8801/);
  // The same failure on the CLI: a code envelope and a non-zero exit.
  let stdout = '';
  const code = await routeMain(['expose', '--query-file', '/nonexistent', '--json'], { api: { expose: async () => { throw error; } }, stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: () => {} } });
  assert.equal(code, 1);
  assert.ok(JSON.parse(stdout.trim().split('\n').pop()).error);
});

// --- D: the target check --------------------------------------------------------------------------

function status(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'bin', 'gozar.mjs'), 'status', '--json'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GOZAR_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; }); child.once('error', reject); child.once('close', () => resolve(JSON.parse(out)));
  });
}

test('red: a session to a port with nothing listening reports that on the target check, and stays usable like a durable route', async t => {
  const w = await providerWorld(t, 'localhost-run');
  const route = await w.expose(await w.approvedRequest());
  const port = Number(w.target.split(':')[1]);
  assert.equal((await status(w.home)).sessions.find(item => item.port === port).targetCheck, 'listening');
  await new Promise(resolve => { w.app.closeAllConnections(); w.app.close(resolve); });
  const entry = (await status(w.home)).sessions.find(item => item.port === port);
  assert.equal(entry.targetCheck, 'nothing listening');
  assert.equal(entry.state, 'usable', 'a dead target does not change the state, as for a durable route');
  assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed');
});
