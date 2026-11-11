import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProbeDirectoryExecutor, receiptMac } from '../../packages/gozar-node/probe-directory.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

async function requestIn(directory) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const path = (await readdir(directory)).find(name => name.endsWith('.request.json'));
      if (path) return { path: join(directory, path), value: JSON.parse(await readFile(join(directory, path), 'utf8')) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Fixture request unavailable');
}

test('private verifier channel authenticates exact request response and removes challenge secrets', async t => {
  const { directory } = await fixture(t, {});
  const probes = join(directory, 'probes');
  const executor = new ProbeDirectoryExecutor(probes);
  const pending = executor.verify({ origin: 'https://fixture.example', vantage: 'public', authorization: { nonceRef: 'n', verifierRef: 'v', expiresAtMs: Date.now() + 10000 },
    challenge: { nonce: 'private-fixture-nonce', identityPath: '/private/identity', streamPath: '/private/stream' }, requirements: { sse: true }, signal: AbortSignal.timeout(2000) });
  const request = await requestIn(probes);
  assert.equal((await stat(request.path)).mode & 0o777, 0o600);
  assert.equal((await stat(probes)).mode & 0o777, 0o700);
  const receipt = { origin: request.value.origin, vantage: 'public', remote: true, sse: true };
  await atomicWrite(join(probes, `${request.value.requestId}.receipt.json`), { requestId: request.value.requestId, receipt, mac: receiptMac(receipt, JSON.parse(await readFile(request.value.authentication.keyPath, 'utf8')).key) });
  assert.deepEqual(await pending, { probeReceipt: receipt });
  assert.deepEqual(await readdir(probes), []);
});

test('private verifier rejects forged authentication and cancels missing receipt promptly', async t => {
  const { directory } = await fixture(t, {});
  const probes = join(directory, 'probes');
  const executor = new ProbeDirectoryExecutor(probes);
  const start = signal => executor.verify({ origin: 'https://fixture.example', vantage: 'public', authorization: {}, challenge: {}, requirements: {}, signal });
  const forged = start(AbortSignal.timeout(2000));
  const rejected = assert.rejects(forged, /authentication failed/);
  const request = await requestIn(probes);
  await atomicWrite(join(probes, `${request.value.requestId}.receipt.json`), { requestId: request.value.requestId, receipt: {}, mac: '0'.repeat(64) });
  await rejected;
  const cancelled = start(AbortSignal.timeout(50));
  await assert.rejects(cancelled, error => error.code === 'needs-validation');
  assert.deepEqual(await readdir(probes), []);
});

test('fixed Drop1a paths keep signing key local and verify locally signed executor envelope', async t => {
  const { directory } = await fixture(t, {});
  const requestPath = join(directory, 'probe-request.json');
  const receiptPath = join(directory, 'trusted-outside-receipt.json');
  const executor = new ProbeDirectoryExecutor(directory, { requestPath, receiptPath, executorRef: 'fixture-outside' });
  const pending = executor.verify({ origin: 'https://fixture.example', vantage: 'public', authorization: { nonceRef: 'one', verifierRef: 'verify' }, challenge: { nonce: 'challenge' }, requirements: { sse: true }, signal: AbortSignal.timeout(2000) });
  let request;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { request = JSON.parse(await readFile(requestPath, 'utf8')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const key = JSON.parse(await readFile(request.authentication.keyPath, 'utf8')).key;
  assert.equal(JSON.stringify(request).includes(key), false);
  const envelope = { requestId: request.requestId, executorId: 'fixture-outside', jobId: 'fixture-job', probeReceipt: { nonceRef: 'one', verifierRef: 'verify', origin: request.origin }, observations: {} };
  await atomicWrite(receiptPath, { ...envelope, mac: receiptMac(envelope, key) });
  assert.deepEqual(await pending, { probeReceipt: envelope.probeReceipt, provenance: { executorId: 'fixture-outside', jobId: 'fixture-job' } });
  assert.equal(JSON.parse(await readFile(requestPath, 'utf8')).requestId, request.requestId);
});
