import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestingGozar, fakeRegistry } from '@tnunamak/gozar/testing';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('an HTTP route gate preserves the request authority through to a strict app', async t => {
  const root = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? tmpdir(), 'gz-host-'));
  let app, harness, route, origin, gate;
  let present = false;
  const home = join(root, 'home'), owner = 'strict-host-fixture';
  const observed = [];
  const exchange = ({ port, host, path = '/stream?fixture=1', method = 'GET', headers = {}, body }) =>
    new Promise((resolve, reject) => {
      const requestHeaders = Array.isArray(host) ? host.flatMap(value => ['Host', value]) : { host, ...headers };
      const request = http.request({ hostname: '127.0.0.1', port, path, method, headers: requestHeaders }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(body);
    });
  try {
    app = http.createServer(async (req, res) => {
      observed.push({ host: req.headers.host, forwardedHost: req.headers['x-forwarded-host'],
        forwarded: req.headers.forwarded, address: req.headers['x-forwarded-for'], realIp: req.headers['x-real-ip'] });
      const expected = new URL(origin).host;
      if (req.headers.host !== expected && req.headers.host !== expected + ':443') return res.writeHead(421).end();
      if (req.headers.authorization !== 'Bearer fixture') return res.writeHead(401).end();
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify([req.method, req.url, Buffer.concat(chunks).toString()]) + '\n\n');
      res.end('data: done\n\n');
    });
    await listen(app);
    const registry = await fakeRegistry({ id: 'strict-' + randomUUID().slice(0, 8), kinds: ['attached'], reach: 'internet', protocols: [], dir: join(root, 'registry') });
    harness = await createTestingGozar({ manifest: registry.manifest, root: registry.root, effects: [
      { kind: 'process-runtime', operation: 'open', handle(input) {
        present = true;
        origin = input.origin;
        gate = new URL('http://' + input.target);
        return { handle: 'fixture', origin };
      } },
      { kind: 'process-runtime', operation: 'read', handle: () => ({ present }) },
      { kind: 'process-runtime', operation: 'close', handle() { present = false; return { closed: true }; } },
      { kind: 'network', operation: 'fetch', async handle({ url, method, headers }) {
        const parsed = new URL(url);
        const result = await exchange({ port: gate.port, host: parsed.host, path: parsed.pathname + parsed.search, method, headers });
        return { status: result.status, headers: result.headers, chunks: [{ data: Buffer.from(result.body).toString('base64'), delayMs: 0 }] };
      } },
    ] });
    const query = { schemaVersion: 1, home, owner, target: '127.0.0.1:' + app.address().port, usage: { kind: 'attached' },
      requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } };
    const { gozar } = harness;
    const [candidate] = (await gozar.catalogRoutes(query)).candidates;
    route = await gozar.expose({ ...query, wait: 'verified', approval: { kind: 'route', candidateToken: candidate.candidateToken,
      disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest } });
    assert.equal(route.published, origin);
    assert.ok(route.verification.checks.includes('nonce'));
    assert.equal(observed.length, 0, 'gate proof did not reach the application');

    const host = new URL(origin).host;
    const direct = { port: app.address().port, host, method: 'POST', body: 'fixture payload', headers: { authorization: 'Bearer fixture' } };
    const control = await exchange(direct);
    assert.equal(control.status, 200);
    assert.equal((await exchange({ ...direct, host: 'foreign.invalid', headers: { ...direct.headers, 'x-forwarded-host': host } })).status, 421);
    const proxied = { ...direct, port: gate.port, headers: { ...direct.headers, 'x-forwarded-for': '192.0.2.1',
      'x-real-ip': '192.0.2.2', forwarded: 'for=192.0.2.3;host=foreign.invalid', 'x-forwarded-host': 'foreign.invalid' } };
    const forwarded = await exchange(proxied);
    t.diagnostic(JSON.stringify({ directStatus: control.status, requestedHost: host, upstream: observed.at(-1), gateStatus: forwarded.status }));
    assert.equal(forwarded.status, 200);
    assert.equal(forwarded.headers['content-type'], 'text/event-stream');
    assert.equal(forwarded.body, 'data: ["POST","/stream?fixture=1","fixture payload"]\n\ndata: done\n\n');
    assert.deepEqual(observed.at(-1), { host, forwardedHost: undefined, forwarded: undefined, address: '127.0.0.1', realIp: undefined });
    assert.equal((await exchange({ ...proxied, host: host + ':443' })).status, 200);
    assert.equal(observed.at(-1).host, host + ':443');
    assert.equal((await exchange({ port: gate.port, host })).status, 401);
    assert.equal((await exchange({ ...proxied, host: 'foreign.invalid', headers: { ...proxied.headers, 'x-forwarded-host': host } })).status, 421);
    assert.equal(observed.at(-1).host, 'foreign.invalid');
    const beforeDuplicate = observed.length;
    assert.equal((await exchange({ port: gate.port, host: [host, 'foreign.invalid'] })).status, 400);
    assert.equal(observed.length, beforeDuplicate, 'duplicate Host never reaches the app');
    const missingHost = await new Promise((resolve, reject) => {
      const socket = net.createConnection(Number(gate.port), '127.0.0.1', () => socket.write('GET / HTTP/1.0\r\n\r\n'));
      const chunks = [];
      socket.on('data', chunk => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
      socket.on('error', reject);
    });
    assert.match(missingHost, /^HTTP\/1\.1 400 /);
    assert.equal(observed.length, beforeDuplicate, 'missing Host never becomes loopback authority');

    const stopped = await gozar.closeRoute({ home, owner, handle: route.handle, mode: 'remove' });
    assert.equal(stopped.cleanup.state, 'confirmed');
    // The controller sends its close reply before it disposes the gate listener.
    let listenerClosed = false;
    for (let attempt = 0; attempt < 40 && !listenerClosed; attempt++) {
      try { await exchange(proxied); }
      catch (error) {
        assert.equal(error.code, 'ECONNREFUSED');
        listenerClosed = true;
      }
      if (!listenerClosed) await delay(25);
    }
    assert.ok(listenerClosed, 'the owned gate stopped accepting connections');
    assert.equal((await exchange(direct)).status, 200);
  } finally {
    if (route) await harness.gozar.closeRoute({ home, owner, handle: route.handle, mode: 'remove' }).catch(() => {});
    await harness?.close();
    if (app) await close(app);
    await rm(root, { recursive: true, force: true });
  }
});
