import { once } from 'node:events';
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
  const exitListeners = process.listenerCount('exit');
  await persist(driver);
  const created = await driver.execute(effect(recipe, 'create', 'child'));
  assert.equal(created.ok, true);
  const resourceId = created.result.resourceId;
  const owned = journal.value.owned[resourceId];
  const originalChild = driver.children.get(resourceId);
  assert.ok(originalChild, 'the original driver still owns the ChildProcess handle');
  assert.equal(process.listenerCount('exit'), exitListeners + 1, 'the live child installed the hook');
  const originalExit = once(originalChild, 'exit', { signal: AbortSignal.timeout(5000) });
  // Handle timeout even if an earlier removal assertion fails; the awaited result still rejects.
  void originalExit.catch(() => {});
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
  assert.deepEqual(await restarted.closeLocal(), []);
  assert.deepEqual(await restarted.closeLocal(), []);
  // Recovered PID removal proves OS state, not that the original JS exit handlers ran.
  await originalExit;
  assert.equal(process.listenerCount('exit'), exitListeners, 'cleanup detaches the exit hook');
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

test('a missing scoped handle produces a distinct error before doing file IO', async t => {
  const { driver } = await fixture(t, {});
  await assert.rejects(driver.readHandle({ handleRef: 'missing-fixture' }), {
    message: 'Unknown scoped file handle',
  });
});

test('a known handle whose file vanished fails instead of returning an empty read', async t => {
  const { driver, directory } = await fixture(t, {});
  const missing = join(directory, 'no-longer-present');
  driver.handles.removed = missing;

  await assert.rejects(driver.readHandle({ handleRef: 'removed' }), {
    code: 'ENOENT',
    path: missing,
  });
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

test('process observer discards an overlong line and resumes at the next newline',()=>{
 const lines=[];
 const driver=new EffectDriver({adapters:[],journal:{},sessionId:'synthetic',resolveProgram:()=>null,
  onProcessOutput:event=>{if(event.completeLine!==undefined)lines.push(event.completeLine);}});
 const resource={id:'fake-child',generation:1,adapterId:'fake',continuityRef:'fake'};
 driver.routeOutputReady.add(resource.id);
 driver.processOutput({id:'output'},resource,'stdout',Buffer.from('x'.repeat(4097)));
 driver.processOutput({id:'output'},resource,'stdout',Buffer.from('\nrecovered\r\n'));
 assert.deepEqual(lines,['recovered']);
});

test('process observer discards a line that exceeds the cap across two chunks', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  const lines = [];
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set([resource.id]);
  driver.onProcessOutput = row => { if (row.completeLine !== undefined) lines.push(row.completeLine); };
  driver.processOutput(effect, resource, 'stdout', Buffer.from('x'.repeat(4096)));
  driver.processOutput(effect, resource, 'stdout', Buffer.from('y'));
  driver.processOutput(effect, resource, 'stdout', Buffer.from('\nkept\n'));
  assert.deepEqual(lines, ['kept']);
});

test('a failing output observer does not discard retained diagnostics',()=>{
 const driver=new EffectDriver({adapters:[],journal:{},sessionId:'synthetic',resolveProgram:()=>null,
  observeProcessOutput:true,onProcessOutput:()=>{throw new Error('synthetic observer stopped');}});
 const resource={id:'fake-child',generation:1,adapterId:'fake',continuityRef:'fake'};
 driver.processOutput({id:'first'},resource,'stderr',Buffer.from('first'));
 driver.processOutput({id:'second'},resource,'stderr',Buffer.from('second'));
 const events=driver.readProcessOutput();
 assert.deepEqual(events.map(event=>event.output),['first','second']);
 assert.deepEqual(driver.readProcessOutput(events[0].sequence).map(event=>event.output),['second']);
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

test('complete output lines preserve UTF-8 characters split between pipe chunks', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set([resource.id]);
  const lines = [];
  driver.onProcessOutput = row => {
    if (row.completeLine !== undefined) lines.push([row.stream, row.completeLine]);
  };
  const output = Buffer.from('caf\u00e9 \ud83d\ude00\n');
  driver.processOutput(effect, resource, 'stdout', output.subarray(0, 4));
  driver.processOutput(effect, resource, 'stderr', Buffer.from('other stream\n'));
  driver.processOutput(effect, resource, 'stdout', output.subarray(4, 8));
  driver.processOutput(effect, resource, 'stdout', output.subarray(8));

  assert.deepEqual(lines, [['stderr', 'other stream'], ['stdout', 'caf\u00e9 \ud83d\ude00']]);
});

test('an observer callback failure does not discard diagnostic output', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set([resource.id]);
  const seen = [];
  driver.onProcessOutput = row => {
    if (row.completeLine === 'first') throw new Error('synthetic observer failure');
    if (row.completeLine !== undefined) seen.push(row.completeLine);
  };
  driver.processOutput(effect, resource, 'stdout', Buffer.from('first\nsecond\n'));
  driver.processOutput(effect, resource, 'stdout', Buffer.from('third\n'));
  assert.deepEqual(seen, ['second', 'third']);
  assert.deepEqual(driver.readProcessOutput().map(row => row.output), ['first\nsecond\n', 'third\n']);
});

test('diagnostic reads return independent rows and a noninclusive sequence cursor', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  driver.processOutput(effect, resource, 'stdout', Buffer.from('one'));
  driver.processOutput(effect, resource, 'stderr', Buffer.from('two'));
  const next = driver.readProcessOutput(1);
  assert.equal(next.length, 1);
  assert.equal(next[0].sequence, 2);
  next[0].output = 'client-local change';
  assert.deepEqual(driver.readProcessOutput().map(row => row.output), ['one', 'two']);
});

test('diagnostic retention evicts the oldest rows at the event count cap', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  for (let index = 0; index < 130; index++) {
    driver.processOutput(effect, resource, 'stdout', Buffer.from('x'));
  }
  const rows = driver.readProcessOutput();
  assert.equal(rows.length, 128);
  assert.equal(rows[0].sequence, 3);
  assert.equal(rows.at(-1).sequence, 130);
});

test('diagnostic rows keep the newest bytes of an oversized chunk', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  const tail = 'x'.repeat(8192 - 'end-marker'.length) + 'end-marker';

  driver.processOutput(effect, resource, 'stderr', Buffer.from('old-prefix-' + tail));

  const [row] = driver.readProcessOutput();
  assert.equal(row.stream, 'stderr');
  assert.equal(row.output, tail);
  assert.equal(driver.outputBytes, 8192);
});

test('a diagnostic cursor older than retained history starts at the first retained row', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  for (let index = 0; index < 6; index++) {
    driver.processOutput(effect, resource, 'stdout', Buffer.alloc(8192, 65 + index));
  }

  assert.deepEqual(driver.readProcessOutput(1).map(row => row.sequence), [3, 4, 5, 6]);
  assert.deepEqual(driver.readProcessOutput(6), []);
});

test('diagnostic retention counts multibyte characters by UTF-8 bytes', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  const effect = { id: 'synthetic-effect' };
  const chunk = Buffer.from('é'.repeat(4096));
  for (let index = 0; index < 5; index++) {
    driver.processOutput(effect, resource, 'stdout', chunk);
  }
  const rows = driver.readProcessOutput();
  assert.deepEqual(rows.map(row => row.sequence), [2, 3, 4, 5]);
  assert.equal(rows.reduce((bytes, row) => bytes + Buffer.byteLength(row.output), 0), 32768);
});

test('a callback-only observer does not retain diagnostic rows', () => {
  const driver = makeOutputOnlyDriver();
  driver.observeProcessOutput = false;
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set();
  const output = [];
  driver.onProcessOutput = row => output.push(row.output);
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  driver.processOutput({ id: 'sample' }, resource, 'stdout', Buffer.from('example status'));
  assert.deepEqual(output, ['example status']);
  assert.deepEqual(driver.readProcessOutput(), []);
});

test('a chunk received with no observers does not consume a diagnostic sequence', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'synthetic', generation: 2, adapterId: 'example' };
  driver.observeProcessOutput = false;
  driver.processOutput({ id: 'skipped' }, resource, 'stdout', Buffer.from('unobserved'));
  driver.observeProcessOutput = true;
  driver.processOutput({ id: 'observed' }, resource, 'stdout', Buffer.from('example status'));
  assert.deepEqual(driver.readProcessOutput().map(row => [row.sequence, row.output]), [[1, 'example status']]);
});

function makeOutputOnlyDriver() {
  return Object.assign(Object.create(EffectDriver.prototype), {
    sessionId: 'synthetic-session', observeProcessOutput: true, onProcessOutput: null,
    outputEvents: [], outputBytes: 0, outputSequence: 0, nowMs: () => 100,
  });
}

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

async function exactChildStillRunning(pid, identity) {
  if (await processIdentity(pid) !== identity) return false;
  if (process.platform !== 'linux') return true;
  // Linux may retain a reparented zombie briefly; a zombie is already dead.
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  return stat !== null && stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
}

for (const mode of ['normal', 'handled termination']) {
  test(`driver exit retires exact owned child only (${mode})`, { timeout: 6500 }, async t => {
    const { directory } = await fixture(t, {});
    // Bounded independent sibling; never signal it, even during test cleanup.
    const foreign = spawn(process.execPath, ['-e', 'setTimeout(()=>{},7500)'], { stdio: 'ignore' });
    await once(foreign, 'spawn');
    foreign.unref();
    const foreignIdentity = await processIdentity(foreign.pid);
    assert.ok(foreignIdentity);
    const code = `
import { Journal } from ${JSON.stringify(new URL('../../packages/gozar-node/journal.mjs', import.meta.url).href)};
import { EffectDriver } from ${JSON.stringify(new URL('../../packages/gozar-node/driver.mjs', import.meta.url).href)};
import { effect, persist } from ${JSON.stringify(new URL('./helpers.mjs', import.meta.url).href)};
const journal = new Journal(process.argv[1]); await journal.load();
const recipe = { kind: 'spawn', program: process.execPath, longRunning: true, collectMs: 15,
  timeoutMs: 3000, maxOutputBytes: 1024,
  args: ['-e', 'console.log("ready");setTimeout(()=>{},8000)'] };
const adapter = { id: 'fake', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes: { create: recipe } };
const driver = new EffectDriver({ adapters: [adapter], journal, sessionId: 'test' });
driver.authorize('fake');
const before = process.listenerCount('exit');
await persist(driver);
const created = await driver.execute(effect(recipe, 'create', 'child'));
if (!created.ok) throw new Error('fixture child did not start: ' + JSON.stringify(created));
const record = journal.value.owned[created.result.resourceId];
process.once('SIGTERM', () => process.exit(143));
process.stdin.once('data', () => process.exit(0));
console.log(JSON.stringify({ id: record.id, pid: record.pid, startIdentity: record.startIdentity,
  exitHooks: process.listenerCount('exit') - before }));
`;
    const controller = spawn(process.execPath, ['--input-type=module', '-e', code, directory],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(controller, 'close');
    t.after(async () => {
      if (controller.exitCode === null && controller.signalCode === null) controller.kill('SIGKILL');
      await closed;
    });
    let stderr = '';
    controller.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    controller.stdout.setEncoding('utf8');
    const ready = (async () => {
      let output = '';
      for await (const chunk of controller.stdout) {
        output += chunk;
        if (output.includes('\n')) return JSON.parse(output.slice(0, output.indexOf('\n')));
      }
      throw new Error('controller did not report its owned child: ' + stderr);
    })();
    const owned = await ready;
    assert.ok(await exactChildStillRunning(owned.pid, owned.startIdentity));
    if (mode === 'normal') controller.stdin.end('exit\n');
    else controller.kill('SIGTERM');
    assert.deepEqual(await closed, [mode === 'normal' ? 0 : 143, null]);
    const deadline = Date.now() + 1000;
    while (await exactChildStillRunning(owned.pid, owned.startIdentity) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(await exactChildStillRunning(owned.pid, owned.startIdentity), false, 'owned child must not outlive its controller');
    assert.equal(owned.exitHooks, 1, 'one process-exit hook covers live owned children');
    assert.equal(await processIdentity(foreign.pid), foreignIdentity, 'independent sibling remains unchanged');
    const journal = new Journal(directory); await journal.load();
    assert.equal(journal.value.owned[owned.id]?.startIdentity, owned.startIdentity, 'exit does not certify cleanup');
    assert.notEqual(journal.value.owned[owned.id]?.retired, true);
  });
}

test('line framing keeps two resources on the same output stream independent', () => {
  const driver = makeOutputOnlyDriver();
  const left = { id: 'left', generation: 2, adapterId: 'fixture' };
  const right = { ...left, id: 'right' };
  const effect = { id: 'fixture-effect' };
  const lines = [];
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set([left.id, right.id]);
  driver.onProcessOutput = event => {
    if (event.completeLine !== undefined) lines.push([event.resourceId, event.completeLine]);
  };
  driver.processOutput(effect, left, 'stdout', Buffer.from('left-'));
  driver.processOutput(effect, right, 'stdout', Buffer.from('right\n'));
  driver.processOutput(effect, left, 'stdout', Buffer.from('line\n'));
  assert.deepEqual(lines, [['right', 'right'], ['left', 'left-line']]);
});

test('line framing consumes a CRLF delimiter split across chunks exactly once', () => {
  const driver = makeOutputOnlyDriver();
  const resource = { id: 'fixture', generation: 2, adapterId: 'fixture' };
  const effect = { id: 'fixture-effect' };
  const lines = [];
  driver.routeLineBuffers = new Map();
  driver.routeOutputReady = new Set([resource.id]);
  driver.onProcessOutput = event => {
    if (event.completeLine !== undefined) lines.push(event.completeLine);
  };
  driver.processOutput(effect, resource, 'stderr', Buffer.from('first\r'));
  assert.deepEqual(lines, []);
  driver.processOutput(effect, resource, 'stderr', Buffer.from('\nsecond\r\n'));
  assert.deepEqual(lines, ['first', 'second']);
});
