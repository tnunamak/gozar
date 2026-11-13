// A session start honours `wait`, fails with a contract code, leaves no daemon behind, and reports its target the way a
// durable route does. The daemon here is a small fake that speaks the real control protocol, so launch, stop and the
// failure record are the real code.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';
import { control, launch } from '../../packages/gozar-node/daemon.mjs';
import { acquireInstallKeyLease } from '../../packages/gozar-node/key-route-lease.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { codeOf, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const url = path => new URL(path, new URL('../../', import.meta.url)).href;
const readContext = { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A daemon that answers `status` with the next phase of its script, `stop` with stopped, and optionally fails on the installation key. */
async function fakeDaemonScript(dir) {
  const file = join(dir, 'fake-daemon.mjs');
  await writeFile(file, `import net from 'node:net';
import { readFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWrite, processIdentity } from ${JSON.stringify(url('packages/gozar-node/journal.mjs'))};
import { failureRecord } from ${JSON.stringify(url('packages/gozar-node/daemon.mjs'))};
import { acquireInstallKeyLease } from ${JSON.stringify(url('packages/gozar-node/key-route-lease.mjs'))};
const directory = process.argv[3];
const config = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
if (config.lease) {
  try { await acquireInstallKeyLease({ home: dirname(directory), keyFingerprint: config.lease, sessionDirectory: directory, sessionId: 'second', targetPort: config.targetPort }); }
  catch (error) { await atomicWrite(join(directory, 'failure.json'), failureRecord(error)); process.exit(1); }
}
const nonce = 'fake-nonce';
let calls = 0;
const snapshot = () => { const phase = config.phases[Math.min(calls++, config.phases.length - 1)];
  return { sessionId: 's1', adapterId: 'stub-b', phase, ...(config.candidate && ['candidate-ready', 'published-ready'].includes(phase) ? { candidate: config.candidate } : {}), ...(phase === 'published-ready' ? { published: config.candidate } : {}) }; };
const server = net.createServer(socket => {
  let input = '';
  socket.on('error', () => {});
  socket.on('data', chunk => {
    input += chunk; if (!input.includes('\\n')) return;
    const { command } = JSON.parse(input.split('\\n')[0]);
    if (command.type === 'stop') { socket.end(JSON.stringify({ snapshot: { sessionId: 's1', phase: 'stopped' } }) + '\\n', () => process.exit(0)); return; }
    socket.end(JSON.stringify({ snapshot: snapshot() }) + '\\n');
  });
});
process.on('SIGTERM', () => process.exit(0));
await new Promise(resolve => server.listen(join(directory, 'control.sock'), resolve));
await chmod(join(directory, 'control.sock'), 0o600);
await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce });
`);
  return file;
}

async function sessionWorld(t, { port = 8799 } = {}) {
  const home = await scratch(t), script = await fakeDaemonScript(home), tokens = tokenStubs();
  const directory = join(home, `port-${port}`);
  t.after(async () => {
    const identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8').catch(() => 'null') ?? 'null');
    if (identity?.pid && await processIdentity(identity.pid) === identity.startIdentity) { try { process.kill(identity.pid, 'SIGKILL'); } catch { /* gone */ } }
  });
  // `run` redeems a fresh approval each time: a token is single use.
  const open = async (daemon, { wait = 'verified', ...deps } = {}) => {
    const q = query({ home, target: `127.0.0.1:${port}`, usage: { kind: 'session', lifetimeMs: 60_000 } });
    const approve = async () => {
      const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-b'), grant: { adapterId: 'stub-b', planDigest: `plan-stub-b-${q.target}`, observedResource: 'res-stub-b' } });
      return { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-b' }, wait };
    };
    const run = async () => openSessionRoute(await approve(), { adapters: [stubAdapter('stub-b')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext,
      startSession: options => launch(options.directory, { targetPort: options.port, ...daemon }, script), pollMs: 20, ...deps });
    return { request: await approve(), run };
  };
  const daemonGone = async () => {
    const identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    for (let end = Date.now() + 5000; Date.now() < end; await sleep(25)) if (await processIdentity(identity.pid) !== identity.startIdentity) return true;
    return false;
  };
  return { home, directory, script, open, daemonGone };
}

test('red: wait verified on a session that ends lost rejects with a code, and no daemon process remains', async t => {
  const world = await sessionWorld(t);
  const { run } = await world.open({ phases: ['failed'] });
  const error = await run().then(() => null, caught => caught);
  assert.equal(error?.code, 'provider_unavailable');
  assert.ok(await world.daemonGone(), 'the failed start stopped the session daemon');
  await assert.rejects(control(world.directory, { type: 'status' }, 500), 'no control channel is left');
});

test('red: wait verified returns only when the session is usable, and keeps the daemon', async t => {
  const world = await sessionWorld(t);
  const { run } = await world.open({ phases: ['starting', 'validating', 'published-ready'], candidate: 'https://example.invalid' });
  const view = await run();
  assert.equal(view.state, 'usable');
  assert.equal(view.published, 'https://example.invalid');
  assert.equal(view.verification.status, 'verified');
  assert.equal((await control(world.directory, { type: 'status' }, 2000)).snapshot.phase, 'published-ready', 'the daemon is still serving');
});

test('red: wait allocated returns once an origin exists, before verification', async t => {
  const world = await sessionWorld(t);
  const { run } = await world.open({ phases: ['starting', 'candidate-ready'], candidate: 'https://example.invalid' }, { wait: 'allocated' });
  const view = await run();
  assert.equal(view.origin, 'https://example.invalid');
  assert.equal(view.state, 'unverified');
  assert.equal(view.published, null);
});

test('wait verified on a session that never verifies times out as verification_failed and stops the daemon', async t => {
  const world = await sessionWorld(t);
  const { run } = await world.open({ phases: ['candidate-ready'], candidate: 'https://example.invalid' }, { startTimeoutMs: 400 });
  assert.equal((await run().then(() => null, caught => caught))?.code, 'verification_failed');
  assert.ok(await world.daemonGone());
});

test('a session that ends released or uncertain also fails the start', async t => {
  for (const phase of ['stopped', 'cleanup-pending']) {
    const world = await sessionWorld(t);
    const error = await (await world.open({ phases: [phase] })).run().then(() => null, caught => caught);
    assert.ok(['provider_unavailable', 'cleanup_debt'].includes(error?.code), `${phase}: ${error?.code}`);
  }
});

test('the CLI exits non-zero with the code envelope when a session start fails', async t => {
  const world = await sessionWorld(t);
  const { request, run } = await world.open({ phases: ['failed'] });
  const files = join(world.home, 'cli'); await mkdir(files, { recursive: true });
  const queryFile = join(files, 'query.json'), approvalFile = join(files, 'approval.json');
  await writeFile(queryFile, JSON.stringify(request)); await writeFile(approvalFile, JSON.stringify(request.approval), { mode: 0o600 }); await chmod(approvalFile, 0o600);
  let stdout = '';
  const code = await routeMain(['expose', '--query-file', queryFile, '--approval-file', approvalFile, '--wait', 'verified', '--json'],
    { api: { expose: () => run() }, stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: () => {} } });
  assert.notEqual(code, 0);
  const envelope = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(envelope.error.code, 'provider_unavailable');
  assert.ok(await world.daemonGone());
});

// --- C: the key lease -----------------------------------------------------------------------------

test('red: a second session while the key is held is route_conflict with a stop action, through the API and the CLI', async t => {
  const fingerprint = createHash('sha256').update('synthetic-key').digest('hex');
  const world = await sessionWorld(t, { port: 8802 });
  await mkdir(join(world.home, 'identities'), { recursive: true, mode: 0o700 });
  // Port 8801 holds the key: its owner is this live process.
  const lease = await acquireInstallKeyLease({ home: world.home, keyFingerprint: fingerprint, sessionDirectory: join(world.home, 'port-8801'), sessionId: 'first', targetPort: 8801 });
  t.after(() => lease.release());
  const { request, run } = await world.open({ phases: ['published-ready'], lease: fingerprint });
  const error = await run().then(() => null, caught => caught);
  assert.equal(error?.code, 'route_conflict');
  assert.match(error.message, /held by port 8801/);
  assert.equal(error.nextAction?.kind, 'instructions');
  assert.match(error.nextAction.instructions, /stop.*--port.*8801/);
  // The same failure on the CLI: a code envelope and a non-zero exit.
  const files = join(world.home, 'cli'); await mkdir(files, { recursive: true });
  const queryFile = join(files, 'query.json'), approvalFile = join(files, 'approval.json');
  await writeFile(queryFile, JSON.stringify(request)); await writeFile(approvalFile, JSON.stringify(request.approval), { mode: 0o600 }); await chmod(approvalFile, 0o600);
  let stdout = '';
  const code = await routeMain(['expose', '--query-file', queryFile, '--approval-file', approvalFile, '--json'],
    { api: { expose: () => run() }, stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: () => {} } });
  assert.equal(code, 1);
  const envelope = JSON.parse(stdout.trim().split('\n').pop());
  assert.equal(envelope.error.code, 'route_conflict');
  assert.ok(envelope.error.nextAction?.instructions.includes('8801'));
});

// --- D: the target check --------------------------------------------------------------------------

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise(resolve => server.close(resolve)); return port;
}
function status(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'bin', 'gozar.mjs'), 'status', '--json'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GOZAR_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; }); child.once('error', reject); child.once('close', () => resolve(JSON.parse(out)));
  });
}

test('red: a session to a port with nothing listening reports that on the target check, and stays usable like a durable route', async t => {
  const port = await freePort();
  const world = await sessionWorld(t, { port });
  await (await world.open({ phases: ['published-ready'], candidate: 'https://example.invalid' })).run();
  const entry = (await status(world.home)).sessions.find(item => item.port === port);
  assert.equal(entry.targetCheck, 'nothing listening');
  assert.equal(entry.phase, 'published-ready', 'a dead target does not change the state, as for a durable route');
  const listener = createServer(); await new Promise(resolve => listener.listen(port, '127.0.0.1', resolve)); t.after(() => listener.close());
  assert.equal((await status(world.home)).sessions.find(item => item.port === port).targetCheck, 'listening');
});
