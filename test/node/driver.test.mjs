import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Journal, processIdentity } from '../../packages/gozar-node/journal.mjs';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';
import { fixture, effect, persist } from './helpers.mjs';

test('effect replay history is bounded without reopening old IDs', async t => {
  const recipe = { kind: 'interfaces' };
  const { driver } = await fixture(t, { detect: recipe });
  const request = (generation, sequence) => ({ ...recipe, id: `test:${generation}:${sequence}`, sessionId: 'test', generation, operation: 'detect', adapterId: 'fake' });
  for (let generation = 1; generation <= 1280; generation++) {
    const current = request(generation, generation * 2);
    assert.equal((await driver.execute(current)).ok, true);
    assert.equal((await driver.execute(current)).ok, false);
    assert.ok(driver.issued.size <= 128, 'retained replay state is bounded');
  }
  assert.equal((await driver.execute(request(1, 2))).ok, false, 'old replay');
  assert.equal((await driver.execute(request(1280, 2559))).ok, false, 'unseen out-of-order ID');
  assert.equal((await driver.execute({ ...request(1280, 2561), id: 'test:1279:2561' })).ok, false, 'ID generation mismatch');
  assert.equal((await driver.execute({ ...request(1280, 2561), id: 'test:1280:02561' })).ok, false, 'noncanonical sequence');
  assert.equal((await driver.execute(request(1280, 2561))).ok, true, 'invalid requests do not consume valid IDs');
});

test('fresh older-generation cleanup remains allowed but its replay does not', async t => {
  const { driver } = await fixture(t, {});
  // Isolate replay admission from ownership I/O, which has separate tests above.
  driver.admitInspection = () => {};
  driver.inspectOwnership = async () => ({});
  const request = (generation, sequence) => ({ id: `test:${generation}:${sequence}`, sessionId: 'test', generation, operation: 'remove', action: 'inspect' });
  assert.equal((await driver.execute(request(9, 10))).ok, true);
  assert.equal((await driver.execute(request(2, 11))).ok, true);
  assert.equal((await driver.execute(request(2, 11))).ok, false);
  assert.equal((await driver.execute(request(2, 9))).ok, false);
});

test('legacy opaque replay IDs fail closed at their bounded capacity', async t => {
  const recipe = { kind: 'interfaces' };
  const { driver } = await fixture(t, { detect: recipe });
  const request = id => ({ ...recipe, id, sessionId: 'test', generation: 1, operation: 'detect', adapterId: 'fake' });
  for (let i = 0; i < 128; i++) assert.equal((await driver.execute(request(`opaque-${i}`))).ok, true);
  assert.equal((await driver.execute(request('opaque-128'))).ok, false);
  assert.equal((await driver.execute(request('opaque-0'))).ok, false);
  assert.equal(driver.issued.size, 128);
});

const program = process.execPath;
const spawnRecipe = { kind: 'spawn', program, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 1000, maxOutputBytes: 100 };

test('direct argv runs and completion preserves exact protocol identity', async t => {
  const { driver } = await fixture(t, { detect: spawnRecipe });
  const result = await driver.execute(effect(spawnRecipe));
  assert.deepEqual(result, { type: 'effect-result', effectId: 'test:1:1', sessionId: 'test', generation: 1,
    ok: true, result: { stdout: 'ok', stderr: '', exitCode: 0 } });
  assert.equal((await driver.execute(effect(spawnRecipe))).ok, false);
  assert.equal((await driver.execute(effect({ ...spawnRecipe, args: ['-e', 'process.exit(99)'] }, 'detect', 'changed'))).ok, false);
});

test('mutation requires a matching, single-use, durable receipt; failed sync cannot authorize it', async t => {
  const recipe = { ...spawnRecipe, longRunning: true, collectMs: 20, args: ['-e', 'process.stdout.write("ok");setInterval(()=>{},1000)'] };
  const { driver, journal } = await fixture(t, { create: recipe });
  assert.equal((await driver.execute(effect(recipe, 'create'))).ok, false);
  assert.equal((await persist(driver)).result.durable, true);
  assert.equal((await driver.execute(effect(recipe, 'create', 'create-good'))).ok, true);
  assert.equal((await driver.execute(effect(recipe, 'create', 'create-again'))).ok, false);
  const failing = new EffectDriver({ adapters: driver.adapters, journal: { ...journal, value: journal.value, intent: async () => { throw new Error('disk failure'); } }, sessionId: 'test' });
  failing.authorize('fake');
  assert.equal((await persist(failing)).ok, false);
  assert.equal((await failing.execute(effect(spawnRecipe, 'create', 'after-failed-sync'))).ok, false);
});

test('persist validates exact scope and never stores raw output', async t => {
  const { driver, journal } = await fixture(t, { create: spawnRecipe });
  const result = await driver.execute({ kind: 'persist', operation: 'create', sessionId: 'test', generation: 1, id: 'wrong', adapterId: 'fake',
    record: { operation: 'create', sessionId: 'other', generation: 1, adapterId: 'fake' } });
  assert.equal(result.ok, false);
  await persist(driver);
  const text = await readFile(journal.path, 'utf8');
  assert.equal(text.includes('stdout'), false);
  assert.equal((await stat(journal.path)).mode & 0o777, 0o600);
});

test('external-owned, shell recipes and unsupported guard fields cannot mutate', async t => {
  const guarded = { ...spawnRecipe, before: [{ assert: 'something' }] };
  const { driver } = await fixture(t, { create: guarded });
  await persist(driver);
  assert.equal((await driver.execute(effect(guarded, 'create', 'guarded'))).ok, false);
  const external = await fixture(t, { create: spawnRecipe });
  external.driver.adapters[0].ownership = 'external-owned';
  await persist(external.driver);
  assert.equal((await external.driver.execute(effect(spawnRecipe, 'create', 'external'))).ok, false);
  const shell = { kind: 'spawn', program: 'sh', args: ['-c', 'exit 0'] };
  const shellFixture = await fixture(t, { detect: shell });
  assert.equal((await shellFixture.driver.execute(effect(shell))).ok, false);
});

test('spawn timeout and output limits return failure with bounded transient data', async t => {
  for (const recipe of [
    { ...spawnRecipe, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 25 },
    { ...spawnRecipe, args: ['-e', 'process.stdout.write("x".repeat(1000))'], maxOutputBytes: 20 },
  ]) {
    const { driver } = await fixture(t, { detect: recipe });
    const result = await driver.execute(effect(recipe));
    assert.equal(result.ok, false);
    assert.equal(result.result.stdout, undefined);
  }
});

test('owned child survives driver restart, exact stop preserves unrelated process', async t => {
  const recipe = { ...spawnRecipe, args: ['-e', 'console.log("http://127.0.0.1:8123");setInterval(()=>{},1000)'], longRunning: true, collectMs: 20 };
  const { driver, directory, journal, adapter } = await fixture(t, { create: recipe, remove: { kind: 'spawn', program: 'unused', args: [] } });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise(resolve => unrelated.once('spawn', resolve));
  t.after(() => unrelated.kill('SIGKILL'));
  const unrelatedIdentity = await processIdentity(unrelated.pid);
  await persist(driver);
  const created = await driver.execute(effect(recipe, 'create', 'child'));
  assert.equal(created.ok, true);
  const resourceId = created.result.resourceId;
  const owned = journal.value.owned[resourceId];
  assert.ok(await processIdentity(owned.pid));
  const restartedJournal = new Journal(directory); await restartedJournal.load();
  const restarted = new EffectDriver({ adapters: [adapter], journal: restartedJournal, sessionId: 'test' });
  restarted.authorize('fake');
  assert.equal((await persist(restarted, 'remove', resourceId, 2)).ok, true);
  const removed = await restarted.execute(effect(adapter.recipes.remove, 'remove', 'remove-child', { resourceId, generation: 2 }));
  assert.equal(removed.ok, true);
  assert.equal(await processIdentity(owned.pid), null);
  assert.equal(await processIdentity(unrelated.pid), unrelatedIdentity);
  assert.equal(Object.keys(restartedJournal.value.owned).length, 0);
});

test('PID identity mismatch never kills an unrelated process', async t => {
  const { driver, journal } = await fixture(t, {});
  await journal.own({ id: 'stale', kind: 'process', sessionId: 'test', pid: process.pid, nonce: randomUUID(), startIdentity: 'not-current' });
  await driver.removeProcess('stale');
  assert.ok(await processIdentity(process.pid));
});

test('file reads require scoped regular non-symlink handle and byte bound', async t => {
  const recipe = { kind: 'read-file', handleRef: 'config', maxOutputBytes: 4 };
  const { driver, directory } = await fixture(t, { detect: recipe });
  const path = join(directory, 'config'); await writeFile(path, 'test');
  driver.handles.config = path;
  assert.equal((await driver.execute(effect(recipe))).result.stdout, 'test');
  await writeFile(path, 'too long');
  assert.equal((await driver.execute(effect(recipe, 'detect', 'large'))).ok, false);
  const link = join(directory, 'link'); await symlink(path, link); driver.handles.config = link;
  assert.equal((await driver.execute(effect(recipe, 'detect', 'link'))).ok, false);
});

test('local probe never claims a public, tailnet or LAN vantage', async t => {
  const { driver } = await fixture(t, {});
  for (const vantage of ['public', 'tailnet', 'lan']) {
    driver.origin = 'https://example.invalid';
    const result = await driver.execute({ id: `probe-${vantage}`, sessionId: 'test', generation: 1,
      kind: 'http-probe', operation: 'probe', url: driver.origin, vantage });
    assert.equal(result.ok, false);
    assert.equal(result.result.code, 'needs-validation');
    assert.notEqual(result.result.vantage, vantage);
  }
});

test('HTTP validates exact URL, rejects redirects, and SSE only reports event receipt', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/' }); return res.end(); }
    if (req.url === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: one\n\n'); return; }
    res.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const { driver } = await fixture(t, {}, { origin: url });
  for (const [path, sse, ok] of [['/', false, true], ['/redirect', false, false], ['/events', true, true]]) {
    driver.adapters[0].recipes.probe = { kind: 'http-probe', url: `${url}${path}`, vantage: 'local', sse };
    const result = await driver.execute({ id: path, sessionId: 'test', generation: 1, kind: 'http-probe', operation: 'probe', url: `${url}${path}`, vantage: 'local', sse });
    assert.equal(result.ok, ok, JSON.stringify(result));
    if (sse) { assert.equal(result.result.sseEventReceived, true); assert.equal(result.result.timedStreamingVerified, false); }
  }
  const changed = await driver.execute({ id: 'wrong-origin', sessionId: 'test', generation: 1, kind: 'http-probe', operation: 'probe', url: 'http://127.0.0.1:1' });
  assert.equal(changed.ok, false);
});

test('owned loopback forwarder selects ephemeral port, serves exact target, removes exact socket', async t => {
  const target = net.createServer(socket => socket.end('target'));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => target.close());
  const recipe = { kind: 'local-forwarder', bindAddress: '127.0.0.1', port: 0 };
  const { driver, journal } = await fixture(t, { create: recipe, remove: { kind: 'local-forwarder' } }, { targetPort: target.address().port });
  await persist(driver);
  const created = await driver.execute(effect(recipe, 'create'));
  assert.equal(created.ok, true);
  const actual = await new Promise((resolve, reject) => {
    let text = ''; const socket = net.connect({ host: '127.0.0.1', port: created.result.port });
    socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text)); socket.on('error', reject);
  });
  assert.equal(actual, 'target');
  await persist(driver, 'remove', created.result.resourceId, 2);
  const removed = await driver.execute(effect({ kind: 'local-forwarder' }, 'remove', 'remove', { resourceId: created.result.resourceId, generation: 2 }));
  assert.equal(removed.ok, true);
  assert.equal(Object.keys(journal.value.owned).length, 0);
});

test('LAN bind needs exact interface and explicit firewall prerequisite', async t => {
  const recipe = { kind: 'local-forwarder', bindAddress: '0.0.0.0' };
  const { driver } = await fixture(t, { create: recipe });
  await persist(driver);
  const result = await driver.execute(effect(recipe, 'create'));
  assert.equal(result.ok, false);
  assert.match(result.result.detail, /Firewall prerequisite/);
});

test('opt-in process observer captures later bounded transient output without journal persistence', async t => {
  const recipe={kind:'spawn',program:process.execPath,args:['-e','console.log("initial-output");setTimeout(()=>console.log("later-output"),100);setInterval(()=>{},1000)'],longRunning:true,collectMs:20,timeoutMs:1000,maxOutputBytes:1000};
  const {driver,journal}=await fixture(t,{create:recipe});driver.observeProcessOutput=true;
  await persist(driver);
  const result=await driver.execute(effect(recipe,'create'));
  assert.equal(result.ok,true);
  await new Promise(resolve=>setTimeout(resolve,150));
  const events=driver.readProcessOutput();
  assert.ok(events.some(event=>event.output.includes('initial-output')));
  assert.ok(events.some(event=>event.output.includes('later-output')));
  assert.ok(events.every(event=>event.resourceId===result.result.resourceId&&Number.isSafeInteger(event.observedAtMs)));
  assert.equal((await readFile(journal.path,'utf8')).includes('later-output'),false);
  assert.equal(driver.readProcessOutput(events.at(-1).sequence).length,0);
});

test('owned process output frames complete lines across chunks without diagnostic observation', async t => {
  const { driver } = await fixture(t, {});
  const lines = [];
  driver.onProcessOutput = event => { if (event.completeLine !== undefined) lines.push(event); };
  const resource = { id: 'owned', generation: 2, adapterId: 'adapter', continuityRef: 'ledger-ref' };
  const effect = { id: 'create', generation: 8 };
  driver.processOutput(effect, resource, 'stdout', Buffer.from('https://a.lhr.life\r\n'));
  assert.equal(lines.length, 0, 'initial output is buffered until the create effect is settled');
  driver.routeOutputReady.add(resource.id);
  driver.processOutput(effect, resource, 'stderr', Buffer.from('https://split.'));
  driver.processOutput(effect, resource, 'stdout', Buffer.from('https://b.lhr.'));
  driver.processOutput(effect, resource, 'stdout', Buffer.from('life\n'));
  driver.processOutput(effect, resource, 'stderr', Buffer.from('lhr.life\n'));
  driver.processOutput(effect, resource, 'stdout', Buffer.from(`${'x'.repeat(4097)}\nhttps://c.lhr.life\n`));
  assert.deepEqual(lines.map(line => line.completeLine), ['https://b.lhr.life', 'https://split.lhr.life', 'https://c.lhr.life']);
  assert.deepEqual(lines.map(line => [line.generation, line.adapterId, line.continuityRef]),
    Array.from({ length: 3 }, () => [2, 'adapter', 'ledger-ref']));
  assert.equal(JSON.stringify(driver.journal.value).includes('lhr.life'), false);
});

test('initial create URL is handled by the core result and never re-emitted as a route change', async t => {
  const recipe = { kind: 'spawn', program, args: ['-e', 'process.stdout.write("https://a.lhr.life\\n");setTimeout(()=>process.stdout.write("https://b.lhr.life\\n"),120);setInterval(()=>{},1000)'],
    timeoutMs: 1000, maxOutputBytes: 4096, longRunning: true, collectMs: 30 };
  const { driver } = await fixture(t, { create: recipe });
  const lines = [];
  let timeout;
  const laterRoute = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('Timed out waiting for the later route output')), 2000);
    driver.onProcessOutput = event => {
      if (event.completeLine === undefined) return;
      lines.push(event.completeLine);
      if (event.completeLine === 'https://b.lhr.life') resolve();
    };
  });
  try {
    await persist(driver);
    const result = await driver.execute(effect(recipe, 'create'));
    assert.equal(result.ok, true);
    await laterRoute;
    assert.deepEqual(lines, ['https://b.lhr.life']);
  } finally {
    clearTimeout(timeout);
  }
});
