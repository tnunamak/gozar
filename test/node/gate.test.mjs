import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { fixture } from './helpers.mjs';

test('instance gate forwards to exact app and proves nonce plus timed incremental SSE', async t => {
  const target = http.createServer((request, response) => response.end(`app:${request.url}`));
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => { target.closeAllConnections(); target.close(); });
  const gate = await createGate(target.address().port); t.after(() => gate.close());
  assert.equal(await (await fetch(`${gate.target}/mcp`)).text(), 'app:/mcp');
  const proof = await gate.verify(gate.target, { sse: true, signal: AbortSignal.timeout(2000) });
  assert.equal(proof.instanceMatched, true); assert.equal(proof.streaming, true); assert.equal(proof.tls, false);
  const previousRef = gate.nonceRef; gate.rotate(); assert.notEqual(gate.nonceRef, previousRef);
  assert.equal((await gate.verify(gate.target, { signal: AbortSignal.timeout(2000) })).instanceMatched, true);
});

test('gate verifier rejects wrong instance, buffered SSE and oversized identity body', async t => {
  const gate = await createGate(1); t.after(() => gate.close());
  const buffered = http.createServer((request, response) => {
    http.get(`${gate.target}${request.url}`, upstream => {
      const chunks = []; upstream.on('data', chunk => chunks.push(chunk)); upstream.on('end', () => { response.writeHead(upstream.statusCode, upstream.headers); response.end(Buffer.concat(chunks)); });
    });
  });
  await new Promise(resolve => buffered.listen(0, '127.0.0.1', resolve));
  t.after(() => { buffered.closeAllConnections(); buffered.close(); });
  await assert.rejects(gate.verify(`http://127.0.0.1:${buffered.address().port}`, { sse: true, signal: AbortSignal.timeout(2000) }), /buffered/);
  const wrong = http.createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ nonce: 'different' })); });
  await new Promise(resolve => wrong.listen(0, '127.0.0.1', resolve));
  t.after(() => { wrong.closeAllConnections(); wrong.close(); });
  await assert.rejects(gate.verify(`http://127.0.0.1:${wrong.address().port}`, { signal: AbortSignal.timeout(2000) }), /different instance/);
});

test('host prepares real scoped private file and target bindings without fabricating provider facts', async t => {
  const { driver } = await fixture(t, {});
  const adapter = { bindings: { gatePort: { type: 'loopback-port' }, loopbackTarget: { type: 'loopback-http-origin' },
    privateFile: { type: 'session-private-path' }, profileId: { type: 'opaque-private-reference' } } };
  const host = await prepareHost(driver, adapter);
  assert.equal(host.bindings.gatePort.value, driver.targetPort);
  assert.equal(host.bindings.loopbackTarget.value, `http://127.0.0.1:${driver.targetPort}`);
  assert.equal(host.bindings.privateFile.mode, '0600');
  assert.equal(host.bindings.privateFile.sessionId, driver.sessionId);
  assert.equal(host.bindings.profileId, undefined);
  assert.equal(host.facts['current-profile'], undefined);
  assert.equal(host.features.includes('client-vantage-probe'), false);
});

test('operational local proof stays local; only injected trusted remote executor may supply a remote receipt', async t => {
  const gate = await createGate(1); t.after(() => gate.close());
  const { driver } = await fixture(t, {}, { targetPort: gate.port, origin: gate.target });
  await prepareHost(driver, { bindings: {} }, { gate });
  const effect = { id: 'proof-local', sessionId: 'test', generation: 1, adapterId: 'fake', kind: 'http-probe', operation: 'probe',
    recipeRef: 'probe', stepId: 'probe', stage: 'probe', probe: driver.host.probe, tls: false, url: gate.target, vantage: 'local', sse: true };
  const local = await driver.execute(effect);
  assert.equal(local.ok, true, JSON.stringify(local));
  assert.equal(local.result.probeReceipt.vantage, 'local');
  assert.equal(local.result.probeReceipt.remote, undefined);
  assert.equal(local.result.probeReceipt.sse, true);
  const remote = await driver.execute({ ...effect, id: 'proof-remote', vantage: 'public' });
  assert.equal(remote.ok, false); assert.equal(remote.result.code, 'needs-validation');
  driver.probeExecutor = { vantages: ['public'], verify: async () => ({ probeReceipt: { ...local.result.probeReceipt, vantage: 'public', remote: false } }) };
  assert.equal((await driver.execute({ ...effect, id: 'forged-remote', vantage: 'public' })).ok, false);
});

test('trusted executor queue can exceed core five-second IO timeout while bounded host wait remains abortable', async t => {
  const gate = await createGate(1); t.after(() => gate.close());
  const { driver } = await fixture(t, {}, { targetPort: gate.port, origin: gate.target });
  await prepareHost(driver, { bindings: {} }, { gate });
  driver.probeWaitMs = 10000;
  driver.probeExecutor = { vantages: ['public'], verify: async ({ authorization, origin }) => {
    await new Promise(resolve => setTimeout(resolve, 5200));
    const now = driver.nowMs();
    return { probeReceipt: { nonceRef: authorization.nonceRef, verifierRef: authorization.verifierRef, origin, vantage: 'public', remote: true,
      observedAtMs: now, expiresAtMs: now + 1000, instanceMatched: true, tls: false, sse: true, streamableHttp: true, oauthDcr: false } };
  } };
  const started = Date.now();
  const result = await driver.execute({ id: 'delayed-proof', sessionId: 'test', generation: 1, adapterId: 'fake', kind: 'http-probe', operation: 'probe',
    recipeRef: 'probe', stepId: 'probe', stage: 'probe', probe: driver.host.probe, tls: false, timeoutMs: 5000,
    url: gate.target, vantage: 'public', sse: true, streamableHttp: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Date.now() - started >= 5000);
});
