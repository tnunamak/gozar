import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { normalizeError } from '../../packages/gozar-node/error-normalizer.mjs';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => {
  server.close(resolve);
  server.closeAllConnections();
});
const get = port => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port, path: '/', agent: false }, response => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve(text));
  }).on('error', reject);
});

test('held foreign listener deterministically prevents gate bind with safe collision cause', async t => {
  const foreign = http.createServer((_request, response) => response.end('foreign-still-owned'));
  const port = await listen(foreign);
  t.after(() => close(foreign));
  let returnedGate;
  await assert.rejects(async () => {
    returnedGate = await createGate(1, { listenPort: port });
  }, error => {
    const safe = normalizeError(error);
    assert.equal(safe.code, 'provider_unavailable');
    assert.equal(safe.message, 'Local connector port is already in use');
    assert.deepEqual(safe.cause, { code: 'gate_port_in_use' });
    assert.equal(safe.nextAction, null);
    // The safe cause does not carry the OS address, port, stack or raw SDK body.
    assert.deepEqual(Object.keys(safe.cause), ['code']);
    return true;
  });
  assert.equal(returnedGate, undefined);
  assert.equal(foreign.listening, true);
  assert.equal(await get(port), 'foreign-still-owned');
});

test('injected identity proof failure is not retried or classified as a port collision', async t => {
  const gate = await createGate(1);
  t.after(() => gate.close());
  let requests = 0;
  const injectedFetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ nonce: 'wrong-instance' }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  await assert.rejects(gate.verify('https://fixture.invalid', { fetch: injectedFetch }), error => {
    assert.equal(error.message, 'Origin points to a different instance');
    assert.notEqual(normalizeError(error).cause?.code, 'gate_port_in_use');
    return true;
  });
  assert.equal(requests, 1);
});

test('noncollision failures never gain the safe collision discriminator', () => {
  for (const code of ['verification_failed', 'internal_error', 'cleanup_unconfirmed']) {
    const error = Object.assign(new Error('synthetic noncollision'), { code });
    assert.notEqual(normalizeError(error).cause?.code, 'gate_port_in_use');
  }
});
