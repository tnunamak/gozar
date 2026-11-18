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
  const waitMs = deps.waitMs ?? 2000;
  // Never signal a PID without rechecking the exact start identity.
  const killExact = () => {
    return Promise.resolve(identify(identity.pid)).then(current => {
      if (current === identity.startIdentity) kill(identity.pid, 'SIGKILL');
    }).catch(killError => { if (killError.code !== 'ESRCH') failures.push(killError); });
  };
  const waitGone = async () => {
    const deadline = Date.now() + waitMs;
    while (await identify(identity.pid) === identity.startIdentity) {
      if (Date.now() >= deadline) return false;
      await sleep(10);
    }
    return true;
  };
  if (await identify(identity.pid) === identity.startIdentity) {
    try { await stop(world); }
    catch (error) { failures.push(error); await killExact(); }
  }
  try {
    if (!await waitGone()) {
      // An acknowledged stop does not prove retirement: record it, then retire the exact identity.
      failures.push(new Error('Fixture process did not retire; recovery home: ' + home));
      await killExact();
      if (!await waitGone()) failures.push(new Error('Fixture process survived exact retirement; recovery home: ' + home));
    }
    const socketDeadline = Date.now() + 2000;
    while (!await socketRetired(directory)) {
      if (Date.now() >= socketDeadline) throw new Error('Fixture socket did not retire; recovery home: ' + home);
      await sleep(10);
    }
  } catch (error) { failures.push(error); }
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


test('an acknowledged stop that leaves the exact process alive is retired by identity-guarded fallback', async () => {
  const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
  let alive = true, removed = false;
  const calls = [];
  await assert.rejects(retireFixture({ home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity }, {
    waitMs: 30,
    identify: async pid => { assert.equal(pid, identity.pid); return alive ? identity.startIdentity : null; },
    stop: async () => { calls.push('stop'); },
    kill: (pid, signal) => { assert.equal(signal, 'SIGKILL'); calls.push('kill:' + pid); alive = false; },
    socketRetired: async () => { calls.push('socket'); return true; },
    remove: async () => { removed = true; },
  }), error => /did not retire; recovery home: \/fixture/.test(error.message));
  assert.deepEqual(calls, ['stop', 'kill:12345', 'socket']);
  assert.equal(removed, false, 'the original timeout failure retains the recovery home');
});

test('exact fallback never signals a PID that a different process now owns', async () => {
  const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
  let reads = 0;
  const calls = [];
  await retireFixture({ home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity }, {
    waitMs: 20,
    // Alive for the first checks, then a different process owns the PID.
    identify: async () => (++reads <= 3 ? identity.startIdentity : 'foreign-start'),
    stop: async () => { calls.push('stop'); },
    kill: () => { calls.push('kill'); },
    socketRetired: async () => true,
    remove: async () => { calls.push('remove'); },
  });
  // The original process is gone (the PID is foreign): no signal, and the owned home is removed.
  assert.equal(calls.includes('kill'), false);
  assert.deepEqual(calls, ['stop', 'remove']);
});

test('late retirement failures preserve timeout and require an immediate exact identity check', async () => {
  for (const phase of ['kill-denied', 'inspection-unreadable', 'foreign-identity']) {
    const identity = { pid: 12345, startIdentity: 'fixture-start', nonce: 'fixture-nonce' };
    const marker = new Error('late ' + phase);
    const calls = [], signals = [], inspected = [];
    let reads = 0, stops = 0, sockets = 0, removals = 0;
    const error = await retireFixture({
      home: '/fixture', directory: '/fixture/session', sessionId: 'fixture-session', identity,
    }, {
      waitMs: 0,
      identify: async pid => {
        inspected.push(pid);
        calls.push('identify:' + ++reads);
        if (reads <= 2 || phase === 'kill-denied') return identity.startIdentity;
        if (phase === 'inspection-unreadable') throw marker;
        return 'foreign-start';
      },
      stop: async () => { stops++; calls.push('stop'); },
      kill: (pid, signal) => {
        signals.push([pid, signal]);
        calls.push('kill');
        throw marker;
      },
      socketRetired: async () => { sockets++; calls.push('socket'); return true; },
      remove: async () => { removals++; calls.push('remove'); },
    }).then(() => null, failure => failure);

    // Inspect outside the seams: a helper swallowing a callback assertion must not pass.
    assert.ok(error instanceof Error, phase + ': must retain the original timeout');
    const errors = error instanceof AggregateError ? error.errors : [error];
    assert.equal(errors[0].message, 'Fixture process did not retire; recovery home: /fixture', phase);
    assert.equal(stops, 1, phase);
    assert.equal(reads, 4, phase);
    assert.deepEqual(inspected, [identity.pid, identity.pid, identity.pid, identity.pid], phase);
    assert.equal(removals, 0, phase + ': recovery home must remain');
    assert.deepEqual(signals, phase === 'kill-denied' ? [[12345, 'SIGKILL']] : [], phase);

    if (phase === 'kill-denied') {
      assert.equal(errors.length, 3);
      assert.equal(errors[1], marker);
      assert.equal(errors[2].message, 'Fixture process survived exact retirement; recovery home: /fixture');
      assert.equal(sockets, 1);
      assert.deepEqual(calls, ['identify:1', 'stop', 'identify:2', 'identify:3', 'kill', 'identify:4', 'socket']);
    } else if (phase === 'inspection-unreadable') {
      assert.equal(errors.length, 3);
      assert.equal(errors[1], marker);
      assert.equal(errors[2], marker);
      assert.equal(sockets, 0, 'unreadable identity cannot become absence');
      assert.deepEqual(calls, ['identify:1', 'stop', 'identify:2', 'identify:3', 'identify:4']);
    } else {
      assert.equal(errors.length, 1);
      assert.equal(sockets, 1);
      assert.deepEqual(calls, ['identify:1', 'stop', 'identify:2', 'identify:3', 'identify:4', 'socket']);
    }
  }
});
