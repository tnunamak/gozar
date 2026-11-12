import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launch } from '../../packages/gozar-node/daemon.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { recordController, stopController } from '../../packages/gozar-node/controller-start.mjs';

const fakeController = fileURLToPath(new URL('./fixtures/fake-controller.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scratch(t) {
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gozar-start-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
// A process group leader like a detached controller. Only PIDs started here are ever signalled.
function detachedChild(t, script = 'setInterval(()=>{},1000)') {
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await exited; });
  return child;
}
const groupNow = pid => { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
// A killed leader is a zombie, and so still a group member, until this process reaps it a moment later.
async function groupExists(pid) {
  for (let attempt = 0; attempt < 100 && groupNow(pid); attempt++) await sleep(10);
  return groupNow(pid);
}

async function failedLaunch(t, mode, options = {}) {
  const directory = join(await scratch(t), 'port-18765');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'mode'), mode);
  const error = await launch(directory, { adapters: [], targetPort: 18765, probeWaitMs: 1 }, fakeController, { startupTimeoutMs: 600, graceMs: 2000, ...options })
    .then(() => assert.fail('launch should have failed'), failure => failure);
  const pid = error.controllerCleanup?.pid ?? error.cause?.controllerCleanup?.pid;
  assert.ok(pid, 'the launch error names the controller it cleaned up');
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
  return { error, pid, directory };
}

test('a controller that never acknowledges is stopped, with its process group, when startup times out', async t => {
  const { error, pid } = await failedLaunch(t, 'silent');
  assert.match(error.message, /startup still pending/);
  assert.equal(error.controllerCleanup.state, 'stopped');
  assert.equal(await groupExists(pid), false, 'the controller process group is still running');
  assert.equal(await processIdentity(pid), null);
});

test('a controller that ignores SIGTERM is killed after the grace period', async t => {
  const { error, pid } = await failedLaunch(t, 'stubborn', { graceMs: 300 });
  assert.equal(error.controllerCleanup.state, 'killed');
  assert.equal(await groupExists(pid), false);
});

test('a controller that reports a failure and exits: the original error is reported and nothing is left', async t => {
  const { error, pid } = await failedLaunch(t, 'failure', { startupTimeoutMs: 5000 });
  assert.equal(error.message, 'fake controller failed to start');
  assert.equal(await groupExists(pid), false);
});

test('an identity that cannot be read after spawn still stops the controller', async t => {
  const failing = async () => { throw new Error('Cannot read process identity: ps failed (timed out)'); };
  const { error, pid } = await failedLaunch(t, 'silent', { identity: failing });
  assert.match(error.message, /Cannot read process identity/);
  assert.equal(await groupExists(pid), false, 'an unreadable identity was taken for a dead controller');
});

test('a live controller with a null identity is not mistaken for an exited one (the macOS failure)', async t => {
  // The start fails before any acknowledgement because the identity of a LIVE child reads as null.
  const { error, pid } = await failedLaunch(t, 'silent', { identity: async () => null });
  assert.match(error.message, /startup still pending/, 'a null identity must not read as "controller exited"');
  assert.equal(await groupExists(pid), false);
});

test('a reused PID is not signalled', async t => {
  const bystander = detachedChild(t);
  await sleep(50);
  const signals = [];
  const outcome = await stopController({ pid: bystander.pid, startIdentity: 'a-different-process-start' },
    { kill: (pid, signal) => { signals.push([pid, signal]); }, graceMs: 50, killWaitMs: 50 });
  assert.equal(outcome.state, 'foreign');
  assert.deepEqual(signals, []);
  assert.ok(await processIdentity(bystander.pid), 'the bystander must still be running');
});

test('the recorded controller is stopped by SIGTERM, and a stopped one reads as gone', async t => {
  const child = detachedChild(t);
  await new Promise(resolve => child.once('spawn', resolve));
  const record = await recordController(child);
  assert.ok(record.startIdentity);
  assert.equal((await stopController(record, { graceMs: 2000 })).state, 'stopped');
  assert.equal(await groupExists(child.pid), false);
  assert.equal((await stopController(record)).state, 'gone');
});
