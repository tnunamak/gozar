import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { prepareStreamProof, ephemeralProofCertificate } from '../../adapters/providers/_shared/stream-proof.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server => `127.0.0.1:${server.address().port}`;
const stop = server => new Promise(resolve => server.close(resolve));
const attempt = () => ({ id: 'attempt-1', nonce: 'synthetic-nonce-7d72', deadlineMs: Date.now() + 2000, signal: new AbortController().signal });
const credentials = { key: await readFile(new URL('./fixtures/stream-proof-key.pem', import.meta.url)), cert: await readFile(new URL('./fixtures/stream-proof-cert.pem', import.meta.url)) };
const exchange = (target, payload) => new Promise((resolve, reject) => {
  const [host, port] = target.split(':');
  const socket = net.connect({ host, port: Number(port) }, () => socket.end(payload));
  const chunks = [];
  socket.on('data', data => chunks.push(data)); socket.on('error', reject);
  socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
});

test('TCP proof binds the actual gate and retains the configured target after proof', async t => {
  const app = net.createServer(socket => socket.pipe(socket)); await listen(app); t.after(() => stop(app));
  const request = { target: address(app) }, current = attempt();
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' });
  t.after(() => proof.close());
  const origin = `tcp://${proof.target}`;
  const receipt = { origin, readback: { target: request.target } };
  assert.equal((await proof.verify({ origin, receipt: { ...receipt, readback: { target: '127.0.0.1:1' } }, attempt: current })).status, 'unverified');
  assert.equal((await proof.verify({ origin, receipt, attempt: { ...current, id: 'stale' } })).status, 'unverified');
  assert.equal((await proof.verify({ origin, receipt, attempt: { ...current, nonce: 'wrong' } })).status, 'unverified');
  assert.equal((await proof.verify({ origin, receipt, attempt: { ...current, deadlineMs: Date.now() - 1 } })).status, 'unverified');
  const checked = await proof.verify({ origin, receipt, attempt: current });
  assert.equal(checked.status, 'verified'); assert.equal(checked.attemptId, current.id); assert.equal(checked.endpoint, origin);
  assert.equal(await exchange(proof.target, 'ordinary application bytes'), 'ordinary application bytes');
  await proof.close(); await proof.close();
  assert.equal((await proof.verify({ origin, receipt, attempt: current })).status, 'unverified');
});

test('an unrelated public echo cannot prove the owned route', async t => {
  const unrelated = net.createServer(socket => socket.pipe(socket)); await listen(unrelated); t.after(() => stop(unrelated));
  const current = attempt(), request = { target: address(unrelated) };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' }); t.after(() => proof.close());
  const origin = `tcp://${address(unrelated)}`;
  assert.equal((await proof.verify({ origin, receipt: { origin, readback: request }, attempt: current })).status, 'unverified');
});

test('wrong nonce, deadline and cancellation fail closed and close pending sockets', async t => {
  const wrong = net.createServer(socket => socket.on('data', () => socket.end('wrong'))); await listen(wrong); t.after(() => stop(wrong));
  const controller = new AbortController(), current = { ...attempt(), signal: controller.signal };
  const request = { target: address(wrong) };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' }); t.after(() => proof.close());
  const origin = `tcp://${address(wrong)}`, input = { origin, receipt: { origin, readback: request }, attempt: current };
  assert.equal((await proof.verify(input)).status, 'unverified');
  assert.equal((await proof.verify({ ...input, attempt: { ...current, deadlineMs: Date.now() - 1 } })).status, 'unverified');
  controller.abort();
  assert.equal((await proof.verify(input)).status, 'unverified');
});

test('TLS exact echo is pinned to synthetic proof cert; forwarding remains opaque after initial proof', async t => {
  const app = tls.createServer(credentials, socket => socket.pipe(socket)); await listen(app); t.after(() => stop(app));
  const current = attempt(), request = { target: address(app) };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tls', certificate: async () => credentials }); t.after(() => proof.close());
  const origin = `tls://${proof.target}`, input = { origin, receipt: { origin, readback: request }, attempt: current };
  const result = await proof.verify(input);
  assert.equal(result.status, 'verified');
  assert.equal(result.facts.find(f => f.id === 'identityTrusted').value, false);
  assert.equal(JSON.parse(result.facts.find(f => f.id === 'proof-certificate-subject').value).CN, 'Gozar synthetic test only');
  assert.equal(proof.refresh, undefined);
  const [host, p] = proof.target.split(':');
  const socket = tls.connect({ host, port: Number(p), rejectUnauthorized: false });
  t.after(() => socket.destroy());
  await new Promise(resolve => socket.once('secureConnect', resolve));
  const read = () => new Promise(resolve => socket.once('data', bytes => resolve(bytes.toString())));
  const first = read(); socket.write('app-before-status'); assert.equal(await first, 'app-before-status');
  assert.equal((await proof.verify(input)).status, 'unverified', 'repeat verify never reinstalls echo service');
  const second = read(); socket.write('app-after-status'); assert.equal(await second, 'app-after-status');
  const newer = tls.connect({ host, port: Number(p), rejectUnauthorized: false }); t.after(() => newer.destroy());
  await new Promise(resolve => newer.once('secureConnect', resolve));
  const third = new Promise(resolve => newer.once('data', bytes => resolve(bytes.toString())));
  newer.write('new-app-stream'); assert.equal(await third, 'new-app-stream');
  socket.destroy(); newer.destroy();
});

test('cancel during stalled proof closes gate, probe and accepted sockets; late bytes cannot revive proof', async t => {
  const held = new Set();
  const stall = net.createServer(socket => { held.add(socket); socket.once('close', () => held.delete(socket)); });
  await listen(stall); t.after(() => stop(stall));
  const abort = new AbortController(), current = { ...attempt(), signal: abort.signal };
  const request = { target: address(stall) };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' }); t.after(() => proof.close());
  const origin = `tcp://${address(stall)}`;
  const pending = proof.verify({ origin, receipt: { origin, readback: request }, attempt: current });
  await new Promise(resolve => stall.once('connection', resolve));
  abort.abort();
  for (const socket of held) socket.end(`GOZAR-PROOF/1 ${current.nonce}\n`);
  assert.equal((await pending).status, 'unverified');
  await proof.close(); await proof.close();
  for (const socket of held) socket.destroy();
  await assert.rejects(exchange(proof.target, 'cannot resurrect'));
});

test('framing accepts fragmentation and rejects trailing, truncated and oversized frames at the owned listener', async t => {
  for (const mutation of ['fragment', 'trailing', 'truncated', 'oversized']) {
    const current = attempt(), request = { target: '127.0.0.1:1' };
    const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' }); t.after(() => proof.close());
    const held = new Set();
    const relay = net.createServer({ allowHalfOpen: true }, socket => {
      const [host, p] = proof.target.split(':'), upstream = net.connect({ host, port: Number(p) });
      held.add(socket); held.add(upstream); socket.on('error', () => {}); upstream.on('error', () => socket.destroy());
      upstream.pipe(socket); const chunks = [];
      socket.on('data', bytes => chunks.push(bytes));
      socket.on('end', async () => {
        const bytes = Buffer.concat(chunks);
        if (mutation === 'trailing') upstream.end(Buffer.concat([bytes, Buffer.from('extra')]));
        else if (mutation === 'truncated') upstream.end(bytes.subarray(0, bytes.length - 1));
        else if (mutation === 'oversized') upstream.end(Buffer.alloc(65536, 65));
        else {
          for (const byte of bytes) { upstream.write(Buffer.from([byte])); await new Promise(resolve => setImmediate(resolve)); }
          upstream.end();
        }
      });
      socket.once('close', () => upstream.destroy());
    });
    await listen(relay);
    const origin = `tcp://${address(relay)}`;
    const result = await proof.verify({ origin, receipt: { origin, readback: request }, attempt: current });
    assert.equal(result.status, mutation === 'fragment' ? 'verified' : 'unverified', mutation);
    for (const socket of held) socket.destroy();
    await stop(relay); await proof.close();
  }
});

test('a total deadline bounds a stalled public probe', async t => {
  const held = new Set(), stall = net.createServer(socket => { held.add(socket); socket.on('error', () => {}); });
  await listen(stall); t.after(async () => { for (const socket of held) socket.destroy(); await stop(stall); });
  const current = { ...attempt(), deadlineMs: Date.now() + 80 }, request = { target: address(stall) };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tcp' }); t.after(() => proof.close());
  const origin = `tcp://${address(stall)}`, start = Date.now();
  assert.equal((await proof.verify({ origin, receipt: { origin, readback: request }, attempt: current })).status, 'unverified');
  assert.ok(Date.now() - start < 1000);
});

test('runtime generates a fresh synthetic proof certificate; cancelled certificate preparation cannot open a gate', async () => {
  const certificate = await ephemeralProofCertificate();
  const x509 = new X509Certificate(certificate.cert);
  assert.equal(x509.subject, 'CN=Gozar synthetic route proof');
  assert.ok(certificate.key.length > 0);
  let release;
  const abort = new AbortController(), current = { ...attempt(), signal: abort.signal };
  const pending = prepareStreamProof({ now: Date.now }, { target: '127.0.0.1:1' }, current,
    { transport: 'tls', certificate: () => new Promise(resolve => { release = resolve; }) });
  abort.abort(); release(credentials);
  await assert.rejects(pending, /cancelled/);
});

test('TLS proof teardown also closes peers stalled before secure connection', { timeout: 2000 }, async t => {
  const current = attempt(), request = { target: '127.0.0.1:1' };
  const proof = await prepareStreamProof({ now: Date.now }, request, current, { transport: 'tls', certificate: async () => credentials }); t.after(() => proof.close());
  const sockets = new Set();
  const relay = net.createServer({ allowHalfOpen: true }, socket => {
    const [host, p] = proof.target.split(':');
    const idle = net.connect({ host, port: Number(p) }), upstream = net.connect({ host, port: Number(p) });
    for (const tracked of [socket, idle, upstream]) { sockets.add(tracked); tracked.on('error', () => {}); }
    socket.pipe(upstream).pipe(socket); socket.once('close', () => upstream.destroy());
  });
  await listen(relay); t.after(async () => { for (const socket of sockets) socket.destroy(); await stop(relay); });
  const origin = `tls://${address(relay)}`;
  assert.equal((await proof.verify({ origin, receipt: { origin, readback: request }, attempt: current })).status, 'verified');
});
