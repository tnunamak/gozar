import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { addService, statusServices, removeService, createServiceVerifier } from '../../packages/gozar-node/service.mjs';

async function fixture(t) {
  const scratch = join(homedir(), '.tmp');
  await mkdir(scratch, { recursive: true });
  const home = await mkdtemp(join(scratch, 'gozar-service-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
async function server(t, handler) {
  const value = http.createServer(handler);
  await new Promise(resolve => value.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => value.close(resolve)));
  return value.address().port;
}
const recordPath = (home, origin) => join(home, 'services', createHash('sha256').update(origin).digest('hex') + '.json');

test('strict config rejects credentials, paths, unfixed ports and commands', async t => {
  const home = await fixture(t);
  for (const origin of ['http://example.test', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test?x=1'])
    await assert.rejects(addService({ home, origin, target: 'localhost:1' }));
  for (const target of ['localhost:0', 'localhost:65536', 'localhost', 'http://localhost:1', '[bad]:1', 'user@host:1'])
    await assert.rejects(addService({ home, origin: 'https://example.test', target }));
  await assert.rejects(addService({ home, origin: 'https://example.test', target: 'localhost:1', verifyCmd: '' }));
});

test('config-only persistence, fresh import, idempotence, conflicts, multiple records and removal', async t => {
  const home = await fixture(t);
  const input = { home, origin: 'https://example.test', target: '[::1]:1234', verifyCmd: 'exit 0' };
  const added = await addService(input);
  assert.equal(added.route.verification.status, 'verified');
  assert.equal(added.route.verification.scope, 'host-command');
  assert.equal((await stat(recordPath(home, input.origin))).mode & 0o777, 0o600);
  const before = await readFile(recordPath(home, input.origin), 'utf8');
  assert.equal(JSON.parse(before).verification, undefined);
  await addService(input);
  await assert.rejects(addService({ ...input, target: 'localhost:4321' }), /conflict/);
  await assert.rejects(addService({ ...input, verifyCmd: 'exit 1' }), /conflict/);
  assert.equal(await readFile(recordPath(home, input.origin), 'utf8'), before);
  await addService({ ...input, origin: 'https://second.test' });
  const fresh = await import('../../packages/gozar-node/service.mjs?restart=' + Date.now());
  assert.equal((await fresh.statusServices({ home })).routes.length, 2);
  assert.equal((await fresh.statusServices({ home, origin: input.origin })).routes.length, 1);
  assert.deepEqual(await removeService({ home, origin: input.origin }), { schemaVersion: 1, origin: input.origin, removed: true });
  assert.equal((await removeService({ home, origin: input.origin })).removed, false);
  assert.equal((await statusServices({ home })).routes.length, 1);
});

test('stored ownership/version/hash validation preserves invalid records', async t => {
  const home = await fixture(t), origin = 'https://example.test';
  await addService({ home, origin, target: 'localhost:1', verifyCmd: 'exit 0' });
  const path = recordPath(home, origin), original = JSON.parse(await readFile(path, 'utf8'));
  for (const patch of [{ ownership: 'managed' }, { schemaVersion: 2 }, { origin: 'https://other.test' }]) {
    const text = JSON.stringify({ ...original, ...patch });
    await writeFile(path, text);
    await assert.rejects(removeService({ home, origin }));
    await assert.rejects(statusServices({ home }));
    assert.equal(await readFile(path, 'utf8'), text);
  }
});

test('trusted command gets exact environment; status reruns and failure is generic', async t => {
  const home = await fixture(t);
  const marker = join(home, 'allow');
  await writeFile(marker, '');
  const script = "const f=require('node:fs');process.exit(process.env.GOZAR_SERVICE_ORIGIN==='https://example.test' && process.env.GOZAR_SERVICE_TARGET==='localhost:1' && /^[a-f0-9]{64}$/.test(process.env.GOZAR_SERVICE_NONCE) && f.existsSync(" + JSON.stringify(marker) + ")?0:9)";
  const cmd = JSON.stringify(process.execPath) + ' -e ' + "'" + script.replaceAll("'", "'\\''") + "'";
  const route = (await addService({ home, origin: 'https://example.test', target: 'localhost:1', verifyCmd: cmd })).route;
  assert.equal(route.verification.status, 'verified');
  await rm(marker);
  const failed = (await statusServices({ home })).routes[0].verification;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Service verification failed');
  assert.equal(failed.method, 'host-command');
});

test('middleware only exact GET challenge, stable per-instance UUID and no caching', async t => {
  const verifier = createServiceVerifier();
  const port = await server(t, (req, res) => { if (!verifier(req, res)) { res.writeHead(404); res.end(); } });
  const nonce = 'a'.repeat(64);
  const first = await fetch('http://127.0.0.1:' + port + '/.well-known/gozar/service?nonce=' + nonce);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const body = await first.json();
  const next = await (await fetch('http://127.0.0.1:' + port + '/.well-known/gozar/service?nonce=' + 'b'.repeat(64))).json();
  assert.equal(body.nonce, nonce);
  assert.equal(body.instanceId, next.instanceId);
  for (const suffix of ['', '?nonce=bad', '?nonce=' + nonce + '&other=1'])
    assert.equal((await fetch('http://127.0.0.1:' + port + '/.well-known/gozar/service' + suffix)).status, 404);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/.well-known/gozar/service?nonce=' + nonce, { method: 'POST' })).status, 404);
});

test('challenge compares instances, nonce, response limit and exact Host using local sockets', async t => {
  const home = await fixture(t), verifier = createServiceVerifier();
  let behavior = 'ok'; const hosts = [];
  const port = await server(t, (req, res) => {
    hosts.push(req.headers.host);
    if (behavior === 'large') { res.end('x'.repeat(4097)); return; }
    if (behavior === 'nonce') { res.end(JSON.stringify({ schemaVersion: 1, nonce: 'wrong', instanceId: '00000000-0000-4000-8000-000000000000' })); return; }
    if (behavior === 'redirect') { res.writeHead(302, { Location: '/secret' }); res.end(); return; }
    verifier(req, res);
  });
  const other = createServiceVerifier();
  let copiedInstanceId;
  const otherPort = await server(t, (req, res) => {
    if (!copiedInstanceId) { other(req, res); return; }
    // A copied public instance ID and an echoed fresh nonce do not prove arrival.
    res.end(JSON.stringify({ schemaVersion: 1, nonce: new URL(req.url, 'http://local').searchParams.get('nonce'),
      instanceId: copiedInstanceId, proof: 'a'.repeat(64) }));
  });
  const originalGet = https.get;
  let mismatch = false;
  // Offline transport seam only: production still uses https.get with default TLS.
  https.get = (url, options, cb) => http.get(new URL('http://127.0.0.1:' + (mismatch ? otherPort : port) + url.pathname + url.search), options, cb);
  t.after(() => { https.get = originalGet; });
  const origin = 'https://example.test:8443';
  const route = (await addService({ home, origin, target: '127.0.0.1:' + port })).route;
  assert.equal(route.verification.status, 'verified');
  assert.ok(hosts.length >= 2 && hosts.every(host => host === 'example.test:8443'));
  mismatch = true;
  assert.equal((await statusServices({ home })).routes[0].verification.status, 'failed');
  copiedInstanceId = (await (await fetch(`http://127.0.0.1:${port}/.well-known/gozar/service?nonce=${'a'.repeat(64)}`)).json()).instanceId;
  assert.equal((await statusServices({ home })).routes[0].verification.status, 'failed');
  mismatch = false;
  for (behavior of ['nonce', 'large', 'redirect'])
    assert.equal((await statusServices({ home })).routes[0].verification.status, 'failed');
});

test('concurrent conflicting adds cannot overwrite the winner', async t => {
  const home = await fixture(t), origin = 'https://race.test';
  const inputs = [1, 2].map(port => ({ home, origin, target: 'localhost:' + port, verifyCmd: 'exit 0' }));
  const results = await Promise.allSettled(inputs.map(addService));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.findIndex(r => r.status === 'fulfilled');
  assert.equal((await statusServices({ home })).routes[0].target, inputs[winner].target);
});

test('host command timeout fails within bounded verification', async t => {
  const home = await fixture(t), started = Date.now();
  const cmd = 'exec ' + JSON.stringify(process.execPath) + ' -e "setTimeout(()=>{},30000)"';
  const result = await addService({ home, origin: 'https://timeout.test', target: 'localhost:1', verifyCmd: cmd });
  assert.equal(result.route.verification.status, 'failed');
  assert.ok(Date.now() - started < 7000);
});

test('POSIX timed-out command kills descendants in its dedicated group', { skip: process.platform === 'win32' }, async t => {
  const home = await fixture(t), pidFile = join(home, 'child.pid');
  const js = "require('node:fs').writeFileSync(" + JSON.stringify(pidFile) + ",String(process.pid));setInterval(()=>{},1000)";
  const command = JSON.stringify(process.execPath) + " -e '" + js.replaceAll("'", "'\\''") + "' & wait";
  const result = await addService({ home, origin: 'https://children.test', target: 'localhost:1', verifyCmd: command });
  assert.equal(result.route.verification.status, 'failed');
  const pid = Number(await readFile(pidFile, 'utf8'));
  assert.ok(pid > 0);
  // On Linux a killed orphan may await init reaping briefly; zombie is not executing.
  let alive = true;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        const status = await readFile('/proc/' + pid + '/stat', 'utf8');
        if (status.slice(status.lastIndexOf(')') + 2).startsWith('Z')) { alive = false; break; }
      }
    } catch (error) { if (['ESRCH', 'ENOENT'].includes(error.code)) { alive = false; break; } throw error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(alive, false);
});
