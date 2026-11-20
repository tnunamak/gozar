import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import test from 'node:test';
import { createGozar } from '../../packages/gozar-node/api.mjs';
import { createTestingGozar, fakeRegistry } from '../../packages/gozar-node/testing.mjs';

const broker = new URL('../../packages/gozar-node/embedding-broker.mjs', import.meta.url).href;
const within = (parent, file) => {
  const tail = relative(parent, file);
  return tail !== '' && tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
};

async function registryWithBroker(parent, id) {
  const root = join(parent, id);
  const home = join(root, 'home');
  const observed = join(root, 'observed-socket');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const fixture = await fakeRegistry({ id, root, dir: root, kinds: ['session'], reach: 'internet' });
  const module = join(root, 'providers', id, 'index.mjs');
  const original = await readFile(module, 'utf8');
  const replacement = [
    '  async detect() {',
    '    await Promise.resolve();',
    '    const instance = await startEmbeddingBroker({ services: {}, home: ' + JSON.stringify(home) +
      ', identity: { bootId: "synthetic-boot", instanceId: ' + JSON.stringify(id) + ' } });',
    '    try { await writeSocket(' + JSON.stringify(observed) + ', instance.descriptor.socketPath); }',
    '    finally { await instance.close(); }',
    '    return { state: "ready", facts: { fixture: true } };',
    '  },',
  ].join('\n');
  const source = original.replace(/^  async detect\(ctx\).*,$/m, replacement);
  assert.notEqual(source, original, 'the synthetic adapter replaced the actual detection callback');
  await writeFile(module,
    'import { startEmbeddingBroker } from ' + JSON.stringify(broker) + ';\n' +
    'import { writeFile as writeSocket } from "node:fs/promises";\n' + source);
  return { options: { manifest: fixture.manifest, root: fixture.root }, home, observed };
}

async function start(factory, fixture, socketDirectory) {
  const options = { ...fixture.options, ...(socketDirectory === undefined ? {} : { socketDirectory }) };
  if (factory === 'root') return { gozar: createGozar(options), close: async () => {} };
  return createTestingGozar({ ...options, effects: [] });
}

async function refresh(factory, fixture, socketDirectory) {
  const instance = await start(factory, fixture, socketDirectory);
  try {
    await instance.gozar.listProviders({ home: fixture.home, refresh: true });
  } finally {
    await instance.close();
  }
  return readFile(fixture.observed, 'utf8');
}

async function sandbox(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'gzf-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return parent;
}

test('root and testing factories isolate actual concurrent broker sockets', async t => {
  const parent = await sandbox(t);
  const a = join(parent, 'a'), b = join(parent, 'b');
  await Promise.all([mkdir(a, { mode: 0o700 }), mkdir(b, { mode: 0o700 })]);
  const marker = join(a, 'unrelated');
  await writeFile(marker, 'keep');
  const one = await registryWithBroker(parent, 'fx-root');
  const two = await registryWithBroker(parent, 'fx-test');
  const [socketOne, socketTwo] = await Promise.all([refresh('root', one, a), refresh('testing', two, b)]);
  assert.ok(within(a, socketOne), 'root broker uses the root factory directory');
  assert.ok(within(b, socketTwo), 'testing broker uses the testing factory directory');
  assert.notEqual(socketOne, socketTwo);
  assert.ok(Buffer.byteLength(socketOne, 'utf8') <= 103);
  assert.ok(Buffer.byteLength(socketTwo, 'utf8') <= 103);
  assert.equal(await readFile(marker, 'utf8'), 'keep');
});

for (const factory of ['root', 'testing']) {
  test(factory + ' keeps default allocation and rejects invalid socket parents', async t => {
    const parent = await sandbox(t);
    const normal = await registryWithBroker(parent, 'fx-default');
    const socket = await refresh(factory, normal);
    assert.ok(isAbsolute(socket));
    assert.ok(!within(parent, socket), 'default allocation is not inside the fixture');
    assert.ok(Buffer.byteLength(socket, 'utf8') <= 103);
    const relativeParent = await registryWithBroker(parent, 'fx-relative');
    await assert.rejects(() => start(factory, relativeParent, 'relative-parent'));
    const missing = await registryWithBroker(parent, 'fx-missing');
    await assert.rejects(() => refresh(factory, missing, join(parent, 'missing')));
    const tooLong = join(parent, 'é'.repeat(60));
    await mkdir(tooLong, { mode: 0o700 });
    assert.ok(Buffer.byteLength(tooLong, 'utf8') > 103);
    const long = await registryWithBroker(parent, 'fx-long');
    await assert.rejects(() => refresh(factory, long, tooLong));
  });
}
