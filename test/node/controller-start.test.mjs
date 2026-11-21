import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openAttachedRoute } from '../../packages/gozar-node/attached-route.mjs';
import { attachedScratch, query, stubAdapter, tokenStubs } from './route-schema-check.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { recordController, stopController, withCleanupOutcome } from '../../packages/gozar-node/controller-start.mjs';

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

const helperUrl = pathToFileURL(fileURLToPath(new URL('./route-schema-check.mjs', import.meta.url))).href;
const readContext = { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };

// The real start path: `openAttachedRoute` spawns the detached generic controller from `controllerModule`. A controller
// module that never settles stands in for a controller that never acknowledges; one that throws stands in for a failed start.
async function failedStart(t, moduleSource, deps = {}) {
  const home = await attachedScratch(t), dir = await scratch(t), module = join(dir, 'controller.mjs'), tokens = tokenStubs();
  await writeFile(module, moduleSource);
  const q = query({ home, usage: { kind: 'attached' } });
  const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-a'), grant: { adapterId: 'stub-a', planDigest: `plan-stub-a-${q.target}`, observedResource: 'res-stub-a' } });
  const request = { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-a' }, wait: 'verified' };
  const error = await openAttachedRoute(request, { adapters: [stubAdapter('stub-a')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext,
    controllerModule: module, leaseExpiryMs: 1500, heartbeatMs: 200, startTimeoutMs: 1500, ...deps }).then(() => assert.fail('the start should have failed'), failure => failure);
  const pid = error.controllerCleanup?.pid ?? error.cause?.controllerCleanup?.pid;
  assert.ok(pid, 'the start error names the controller it cleaned up');
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
  return { error, pid };
}
const HANGING = 'export default () => new Promise(() => { setInterval(() => {}, 1000); });\n';

test('a controller that never acknowledges is stopped, with its process group, when startup times out', async t => {
  const { error, pid } = await failedStart(t, HANGING);
  assert.equal(error.code, 'provider_unavailable');
  assert.match(error.message, /did not start in time/);
  assert.ok(['stopped', 'killed'].includes(error.controllerCleanup.state), error.controllerCleanup.state);
  assert.equal(await groupExists(pid), false, 'the controller process group is still running');
  assert.equal(await processIdentity(pid), null);
});

test('a controller that ignores SIGTERM is killed after the grace period', async t => {
  // The grace period is stopController's own parameter; the controller start path uses its default, so this is asserted on the function.
  // The child says so once its SIGTERM handler is installed; a fixed sleep raced the interpreter's start-up under load.
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await exited; });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  const record = await recordController(child);
  const outcome = await stopController(record, { graceMs: 300, killWaitMs: 5000 });
  assert.equal(outcome.state, 'killed');
  assert.equal(await groupExists(child.pid), false);
});

test('a controller whose module throws at startup: the original error is reported and nothing is left', async t => {
  const { error, pid } = await failedStart(t, "export default async function () { throw Object.assign(new Error('fake controller failed to start'), { code: 'provider_unavailable' }); }\n", { startTimeoutMs: 15_000 });
  assert.match(error.message, /fake controller failed to start/);
  assert.equal(await groupExists(pid), false);
});

test('an identity that cannot be read after spawn still stops the controller', async t => {
  const failing = async () => { throw new Error('Cannot read process identity: ps failed (timed out)'); };
  const { error, pid } = await failedStart(t, HANGING, { identityRecorder: failing });
  // The public surface sanitizes an unknown fault to internal_error; the original stays as the cause.
  assert.equal(error.code, 'internal_error');
  assert.match(error.cause?.message ?? '', /Cannot read process identity/);
  assert.equal(await groupExists(pid), false, 'an unreadable identity was taken for a dead controller');
});

test('a live controller with a null identity is not mistaken for an exited one (the macOS failure)', async t => {
  // The start fails before any acknowledgement because the identity of a LIVE child reads as null.
  const { error, pid } = await failedStart(t, HANGING, { identityRecorder: async () => null });
  assert.match(error.message, /did not start in time/, 'a null identity must not read as "controller exited"');
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

test('red: a group signal refused with EPERM (macOS, group already exiting) still stops the controller and reports it stopped', async t => {
  const child = detachedChild(t);
  await new Promise(resolve => child.once('spawn', resolve));
  const record = await recordController(child);
  const signals = [];
  const kill = (pid, signal) => {
    signals.push([pid, signal]);
    if (pid < 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM', syscall: 'kill' });
    process.kill(pid, signal);
  };
  const outcome = await stopController(record, { kill, graceMs: 2000 });
  assert.equal(outcome.state, 'stopped', JSON.stringify(outcome));
  assert.deepEqual(signals, [[-child.pid, 'SIGTERM'], [child.pid, 'SIGTERM']]);
  assert.equal(await processIdentity(child.pid), null);
});

test('an unconfirmed cleanup message keeps both sentences apart', () => {
  const wrapped = withCleanupOutcome(Object.assign(new Error('The route could not be started'), { code: 'provider_unavailable' }), { state: 'unconfirmed', pid: 42 });
  assert.match(wrapped.message, /^The route could not be started\. The controller \(pid 42\)/);
  assert.equal(wrapped.code, 'provider_unavailable');
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
