import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, join } from 'node:path';
import test from 'node:test';

const implementation = new URL('../../packages/gozar-node/runtime-sockets.mjs', import.meta.url);
const unixOnly = { skip: typeof process.getuid !== 'function' };
const disposable = async t => {
  const dir = await mkdtemp(join(await realpath('/tmp'), 'gz-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};
const closeServer = server => server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
async function ping(path) {
  const socket = net.createConnection(path);
  try {
    socket.setTimeout(3000, () => socket.destroy(new Error('fixture socket timed out')));
    const [body] = await once(socket, 'data');
    return body.toString();
  } finally { socket.destroy(); }
}

test('short runtime socket foundation', unixOnly, async t => {
  // The base intentionally lacks the module. Assert this as a red, not a module-loading error.
  await assert.doesNotReject(() => access(implementation), 'the runtime endpoint implementation must exist');
  const { allocateRuntimeSocket, resolveRuntimeSocket } = await import(implementation.href);

  await t.test('real cells have bounded paths and retire without touching each other', async t => {
    const parent = await disposable(t);
    const a = await allocateRuntimeSocket(parent);
    const b = await allocateRuntimeSocket(parent);
    assert.notEqual(a.path, b.path);
    assert.ok(Buffer.byteLength(a.path, 'utf8') <= 103);
    const serverA = net.createServer(socket => socket.end('app A'));
    const serverB = net.createServer(socket => socket.end('app B'));
    t.after(() => Promise.all([closeServer(serverA), closeServer(serverB)]));
    const first = await a.bind(serverA);
    const second = await b.bind(serverB);
    assert.equal(first.version, 1);
    assert.match(first.root.ino, /^\d+$/);
    assert.match(first.socket.dev, /^\d+$/);
    assert.equal((await lstat(dirname(a.path))).mode & 0o777, 0o700);
    assert.equal((await lstat(a.path)).mode & 0o777, 0o600);
    assert.deepEqual(await resolveRuntimeSocket({ runtimeSocket: first }), { kind: 'bound', path: a.path });
    assert.equal(await ping(first.path), 'app A');
    assert.equal((await a.retire()).state, 'confirmed');
    await assert.rejects(lstat(dirname(a.path)), { code: 'ENOENT' });
    assert.equal(await ping(second.path), 'app B');
    assert.equal((await b.retire()).state, 'confirmed');
  });

  await t.test('over-budget roots are refused before making a child', async t => {
    const parent = await disposable(t);
    const deep = join(parent, 'é'.repeat(50));
    await mkdir(deep, { mode: 0o700 });
    await assert.rejects(allocateRuntimeSocket(deep), /too long/);
    assert.deepEqual(await readdir(deep), []);
  });

  await t.test('retiring an unbound allocation preserves an unrelated entry or directory', async t => {
    const parent = await disposable(t);
    const a = await allocateRuntimeSocket(parent);
    const child = dirname(a.path), marker = join(child, 'fixture.txt');
    await writeFile(marker, 'untouched');
    assert.equal((await a.retire()).state, 'unconfirmed');
    assert.equal((await lstat(marker)).isFile(), true);
    await rm(marker);
    assert.equal((await a.retire()).state, 'confirmed');

    const b = await allocateRuntimeSocket(parent);
    const other = dirname(b.path);
    await rename(other, other + '-old');
    await mkdir(other, { mode: 0o700 });
    await writeFile(join(other, 'fixture.txt'), 'other directory');
    assert.equal((await b.retire()).state, 'unconfirmed');
    assert.equal((await lstat(join(other, 'fixture.txt'))).isFile(), true);
  });

  await t.test('malformed or mismatched descriptions do not choose a legacy path', async t => {
    const parent = await disposable(t);
    const endpoint = await allocateRuntimeSocket(parent);
    const server = net.createServer();
    t.after(() => closeServer(server));
    const descriptor = await endpoint.bind(server);
    const legacyPath = join(parent, 'legacy.sock');
    assert.deepEqual(await resolveRuntimeSocket({}, { legacyPath }), { kind: 'legacy', path: legacyPath });
    await assert.rejects(resolveRuntimeSocket({ runtimeSocket: null }, { legacyPath }), { code: 'invalid_input' });
    const mismatch = { ...descriptor, socket: { ...descriptor.socket, ino: '0' } };
    await assert.rejects(resolveRuntimeSocket({ runtimeSocket: mismatch }, { legacyPath }), { code: 'invalid_input' });
    assert.equal((await endpoint.retire()).state, 'confirmed');
  });

  await t.test('retiring during bind does not publish a descriptor or keep the listener', async t => {
    const parent = await disposable(t);
    const endpoint = await allocateRuntimeSocket(parent);
    const server = net.createServer();
    t.after(() => closeServer(server));
    const binding = assert.rejects(endpoint.bind(server), /retirement already requested/);
    const retiring = endpoint.retire();
    await binding;
    assert.equal((await retiring).state, 'confirmed');
    assert.equal(server.listening, false);
    await assert.rejects(lstat(dirname(endpoint.path)), { code: 'ENOENT' });
  });
});
