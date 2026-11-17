import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { attachedCleanupReference } from '../../packages/gozar-node/attached-route.mjs';
import { closeRoute } from '../../packages/gozar-node/route-view.mjs';
import { control, launch } from '../../packages/gozar-node/daemon.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';

const moduleUrl = name => new URL('../../packages/gozar-node/' + name, import.meta.url).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));


// Fixture authority is separate from product custody and never proves product cleanup.
function fixtureStop({ directory, sessionId, identity }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(join(directory, 'control.sock'));
    let output = '', settled = false;
    const finish = (error, reply) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(reply);
    };
    const timer = setTimeout(() => finish(new Error('Fixture stop timed out')), 1000);
    socket.once('connect', () => socket.write(JSON.stringify({
      nonce: identity.nonce, command: { type: 'fixture-stop', sessionId },
    }) + '\n'));
    socket.on('data', chunk => {
      output += chunk;
      if (output.length > 65536) return finish(new Error('Fixture stop response too large'));
      if (!output.includes('\n')) return;
      try {
        const reply = JSON.parse(output.split('\n')[0]);
        assert.equal(reply.snapshot?.sessionId, sessionId);
        assert.equal(reply.snapshot?.phase, 'stopped');
        finish(null, reply);
      } catch (error) { finish(error); }
    });
    socket.once('error', error => finish(error));
    socket.once('end', () => finish(new Error('Fixture stop ended without a reply')));
  });
}

function fixtureSocketRetired(directory) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(join(directory, 'control.sock'));
    const finish = (error, retired) => {
      clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(retired);
    };
    const timer = setTimeout(() => finish(new Error('Fixture socket retirement unknown')), 250);
    socket.once('connect', () => finish(null, false));
    socket.once('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(null, true);
      else finish(error);
    });
  });
}

async function retireFixture(world, deps = {}) {
  const { identity, home, directory } = world;
  assert.ok(identity?.startIdentity && identity?.nonce && Number.isSafeInteger(identity.pid) && identity.pid > 0,
    'Fixture identity unavailable; retain recovery home: ' + home);
  const identify = deps.identify ?? processIdentity;
  const stop = deps.stop ?? fixtureStop;
  const kill = deps.kill ?? ((pid, signal) => process.kill(pid, signal));
  const socketRetired = deps.socketRetired ?? fixtureSocketRetired;
  const remove = deps.remove ?? (path => rm(path, { recursive: true, force: true }));
  const failures = [];
  const now = deps.now ?? Date.now;
  const pause = deps.sleep ?? sleep;
  async function exactFallback() {
    // Identity-read failure is uncertainty, never evidence of exit or permission to kill.
    let current;
    try { current = await identify(identity.pid); }
    catch (error) { failures.push(error); return; }
    if (current !== identity.startIdentity) return;
    try { kill(identity.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') failures.push(error); }
  }
  const timeoutError = () => new Error('Fixture process did not retire; recovery home: ' + home);
  async function waitForRetirement(processTimeout = timeoutError()) {
    const deadline = now() + 2000;
    while (await identify(identity.pid) === identity.startIdentity) {
      if (now() >= deadline) throw processTimeout;
      await pause(10);
    }
    const socketDeadline = now() + 2000;
    while (!await socketRetired(directory)) {
      if (now() >= socketDeadline) throw new Error('Fixture socket did not retire; recovery home: ' + home);
      await pause(10);
    }
  }
  if (await identify(identity.pid) === identity.startIdentity) {
    try { await stop(world); }
    catch (error) { failures.push(error); await exactFallback(); }
  }
  const retirementTimeout = timeoutError();
  try { await waitForRetirement(retirementTimeout); }
  catch (error) {
    failures.push(error);
    if (error === retirementTimeout) {
      // A stop ACK is not exit. Preserve this timeout even if emergency cleanup works.
      await exactFallback();
      try { await waitForRetirement(); }
      catch (retirementError) { failures.push(retirementError); }
    }
  }
  // Even a successful emergency kill does not erase a graceful-stop failure.
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Fixture teardown failed; retained ' + home);
  await remove(home);
}

async function localSession(t, extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-legacy-scope-'));
  const directory = join(home, 'port-8799');
  const sessionId = randomUUID();
  const script = join(home, 'controller.mjs');
  // A real local process and private socket, with a fresh nonce and real process
  // identity. No claimed resource-removal or confirmed-cleanup journal is made.
  await writeFile(script, `import net from 'node:net';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, processIdentity } from ${JSON.stringify(moduleUrl('journal.mjs'))};
const directory = process.argv[3];
const config = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
const nonce = randomUUID();
const server = net.createServer(socket => {
  let input = '';
  socket.on('error', () => {});
  socket.on('data', chunk => {
    input += chunk;
    if (!input.includes('\\n')) return;
    const request = JSON.parse(input.split('\\n')[0]);
    if (request.nonce !== nonce) { socket.destroy(); return; }
    if (request.command.type === 'fixture-stop' && request.command.sessionId !== config.sessionId) { socket.destroy(); return; }
    const stopping = ['stop', 'fixture-stop'].includes(request.command.type);
    socket.end(JSON.stringify({
      snapshot: { sessionId: config.sessionId, adapterId: config.adapterId, phase: stopping ? 'stopped' : 'starting' },
      ...(config.proofSubject ? { proofSubject: config.proofSubject } : {})
    }) + '\\n', () => { if (stopping) server.close(() => process.exit(0)); });
  });
});
await new Promise(resolve => server.listen(join(directory, 'control.sock'), resolve));
await chmod(join(directory, 'control.sock'), 0o600);
await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce });
`);
  let identity;
  t.after(() => retireFixture({ home, directory, sessionId, identity }));
  await launch(directory, { targetPort: 8799, adapterId: 'ngrok', sessionId, ...extra }, script);
  identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  const request = { home, handle: { kind: 'session', id: 'port-8799:' + sessionId, generation: 1 }, mode: 'remove' };
  return {
    home, directory, request, identity,
    gone: async () => {
      for (let i = 0; i < 100; i++) {
        if (await processIdentity(identity.pid) !== identity.startIdentity) return true;
        await sleep(10);
      }
      return false;
    },
  };
}

for (const [label, extra] of [
  ['generic execution without identity', { execution: 'generic-session-v1' }],
  ['null managed handle', { handle: null }],
  ['null managed embedding', { embedding: null }],
  ['malformed managed handle', { handle: {} }],
  ['managed owner without binding', { owner: 'fixture-owner' }],
]) {
  test('red: ' + label + ' cannot take legacy no-reference cleanup', async t => {
    const world = await localSession(t, extra);
    await assert.rejects(attachedCleanupReference(world.request, { registryId: 'fixture-registry' }),
      error => ['route_conflict', 'cleanup_debt'].includes(error.code));
    assert.equal((await control(world.directory, { type: 'status' })).snapshot.phase, 'starting');
    assert.equal(await processIdentity(world.identity.pid), world.identity.startIdentity,
      'refused custody does not stop an unrelated or unproven process');
  });
}

for (const [label, extra] of [
  ['genuine old native session', {}],
  ['identity-only direct ngrok proof is not configuration custody', {
    proofSubject: { instanceId: 'fixture-instance', bootId: 'fixture-boot', handleGeneration: 1,
      origin: 'https://example.invalid', target: '127.0.0.1:8799' },
  }],
]) {
  test(label + ' remains exactly stoppable through the authenticated local controller', async t => {
    const world = await localSession(t, extra);
    assert.equal(await attachedCleanupReference(world.request, { registryId: 'fixture-registry' }), null);
    await assert.rejects(closeRoute({ ...world.request, handle: { ...world.request.handle, id: 'port-8799:wrong' } }, { adapters: [] }),
      error => error.code === 'route_conflict');
    assert.equal((await control(world.directory, { type: 'status' })).snapshot.sessionId, world.request.handle.id.split(':')[1]);
    await closeRoute(world.request, { adapters: [] });
    assert.equal(await world.gone(), true, 'exact stop retires the real child process');
    await assert.rejects(control(world.directory, { type: 'status' }, 100));
  });
}

test('fixture teardown retains recovery evidence on socket uncertainty', async () => {
  const failure = new Error('socket inspection denied');
  let removed = false;
  await assert.rejects(retireFixture({
    home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session',
    identity: { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' },
  }, {
    identify: async () => null,
    stop: async () => assert.fail('already gone'),
    kill: () => assert.fail('already gone'),
    socketRetired: async () => { throw failure; },
    remove: async () => { removed = true; },
  }), error => error === failure);
  assert.equal(removed, false);
});

test('fixture teardown preserves a failed graceful stop after exact fallback retirement', async () => {
  const failure = new Error('fixture stop rejected');
  const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
  let alive = true, removed = false;
  const calls = [];
  await assert.rejects(retireFixture({ home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity }, {
    identify: async pid => { assert.equal(pid, identity.pid); calls.push('identify'); return alive ? identity.startIdentity : null; },
    stop: async () => { calls.push('stop'); throw failure; },
    kill: (pid, signal) => { assert.equal(pid, identity.pid); assert.equal(signal, 'SIGKILL'); calls.push('kill'); alive = false; },
    socketRetired: async () => { calls.push('socket'); return true; },
    remove: async () => { removed = true; },
  }), error => error === failure);
  assert.deepEqual(calls, ['identify', 'stop', 'identify', 'kill', 'identify', 'socket']);
  assert.equal(removed, false, 'unexpected cleanup failure retains recovery evidence');
});


for (const killFails of [false, true]) test('fixture stop ACK cannot hide live-child timeout; fallback ' + (killFails ? 'failure is aggregated' : 'retires exact child'), async () => {
  const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
  const killFailure = new Error('exact kill denied');
  let alive = true, removed = false, now = 0, caught;
  const calls = [];
  try {
    await retireFixture({ home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity }, {
      now: () => now,
      sleep: async () => { now += 2100; },
      identify: async pid => { assert.equal(pid, identity.pid); calls.push('identify'); return alive ? identity.startIdentity : null; },
      stop: async () => { calls.push('ack'); return { snapshot: { phase: 'stopped', sessionId: 'fixture-session' } }; },
      kill: (pid, signal) => {
        assert.equal(pid, identity.pid); assert.ok(pid > 0); assert.equal(signal, 'SIGKILL');
        calls.push('kill');
        if (killFails) throw killFailure;
        alive = false;
      },
      socketRetired: async directory => { assert.equal(directory, '/fixture/session'); calls.push('socket'); return !alive; },
      remove: async () => { removed = true; },
    });
    assert.fail('original retirement timeout must remain a failure');
  } catch (error) { caught = error; }
  const failures = caught instanceof AggregateError ? caught.errors : [caught];
  assert.match(failures[0].message, /^Fixture process did not retire; recovery home: \/fixture$/);
  assert.equal(calls.filter(call => call === 'kill').length, 1);
  const killedAt = calls.indexOf('kill');
  assert.equal(calls[killedAt - 1], 'identify', 'recheck start identity immediately before exact kill');
  if (killFails) {
    assert.ok(failures.includes(killFailure));
    assert.ok(failures.length >= 2, 'original timeout and fallback error both survive');
  } else {
    assert.equal(alive, false);
    assert.deepEqual(calls.slice(killedAt + 1), ['identify', 'socket'], 'verify process and socket after fallback');
    assert.equal(failures.length, 1);
  }
  assert.equal(removed, false, 'timeout preserves recovery home even after emergency retirement');
});

for (const unreadable of [false, true]) test('post-ACK timeout never signals a ' + (unreadable ? 'unreadable' : 'replaced') + ' identity', async () => {
  const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
  const readFailure = new Error('identity inspection denied');
  let reads = 0, now = 0, removed = false, socketChecks = 0, killCalls = 0, caught;
  try {
    await retireFixture({ home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity }, {
      now: () => now, sleep: async () => { now += 2100; },
      identify: async pid => {
        assert.equal(pid, identity.pid);
        if (++reads < 4) return identity.startIdentity;
        if (unreadable) throw readFailure;
        return 'replacement-start';
      },
      stop: async () => ({ snapshot: { phase: 'stopped', sessionId: 'fixture-session' } }),
      kill: () => { killCalls++; assert.fail('no authority to signal an unreadable or replaced identity'); },
      socketRetired: async () => { socketChecks++; return true; },
      remove: async () => { removed = true; },
    });
    assert.fail('original timeout must survive');
  } catch (error) { caught = error; }
  const failures = caught instanceof AggregateError ? caught.errors : [caught];
  assert.match(failures[0].message, /^Fixture process did not retire;/);
  assert.ok(reads >= 5, 'fallback rechecks identity and subsequently verifies retirement');
  assert.equal(killCalls, 0, 'no signal when the captured identity cannot be confirmed');
  if (unreadable) {
    assert.ok(failures.includes(readFailure));
    assert.equal(socketChecks, 0, 'identity uncertainty cannot become process absence');
  } else assert.equal(socketChecks, 1);
  assert.equal(removed, false);
});
