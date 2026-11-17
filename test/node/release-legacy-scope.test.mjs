import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { attachedCleanupReference } from '../../packages/gozar-node/attached-route.mjs';
import { closeRoute } from '../../packages/gozar-node/route-view.mjs';
import { control, launch, stopSession } from '../../packages/gozar-node/daemon.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';

const moduleUrl = name => new URL('../../packages/gozar-node/' + name, import.meta.url).href;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    const stopping = request.command.type === 'stop';
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
  t.after(async () => {
    if (identity && await processIdentity(identity.pid) === identity.startIdentity) {
      await stopSession(directory).catch(() => {});
      for (let i = 0; i < 100 && await processIdentity(identity.pid) === identity.startIdentity; i++) await sleep(10);
      if (await processIdentity(identity.pid) === identity.startIdentity) process.kill(identity.pid, 'SIGKILL');
    }
    await rm(home, { recursive: true, force: true });
  });
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
