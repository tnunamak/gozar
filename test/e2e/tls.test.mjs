import test from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDummy } from '../../harness/dummy-server.mjs';
import { probe } from '../../harness/probe.mjs';
import { command } from '../../harness/process.mjs';

test('real local TLS enforces certificate trust and still cannot prove a public vantage', async () => {
  const base = (process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gz-tls-'));
  let server, upstream, gate, frontend;
  try {
    const certPath = join(directory, 'cert.pem'), keyPath = join(directory, 'key.pem');
    const generated = await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath]);
    assert.equal(generated.code, 0, generated.stderr);
    server = await startDummy({ tls: { key: await readFile(keyPath), cert: await readFile(certPath) } });
    await assert.rejects(probe({ origin: server.origin, nonce: server.nonce }), /fetch failed/);
    const output = await command(process.execPath, [fileURLToPath(new URL('../../harness/probe.mjs', import.meta.url))], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath }, input: JSON.stringify({ origin: server.origin, nonce: server.nonce, vantage: 'public', executorId: 'caller-string' }),
    });
    assert.equal(output.code, 0, output.stderr);
    const receipt = JSON.parse(output.stdout);
    assert.equal(receipt.tls, true); assert.equal(receipt.vantage, 'local'); assert.equal(receipt.executorId, 'local-node');
    assert.ok(receipt.events[1].receivedAt - receipt.events[0].receivedAt >= 100);
    assert.equal(receipt.toolCall, true); assert.equal(receipt.toolResult.nonce, server.nonce);
    upstream = await startDummy(); gate = await createGate(upstream.port);
    frontend = https.createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (request, response) => {
      const proxy = http.request({ host: '127.0.0.1', port: gate.port, path: request.url, method: request.method, headers: request.headers }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
      proxy.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(proxy);
    });
    await new Promise(resolve => frontend.listen(0, '127.0.0.1', resolve));
    const live = await command(process.execPath, [fileURLToPath(new URL('../../harness/live-probe.mjs', import.meta.url))], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath }, input: JSON.stringify({ origin: `https://127.0.0.1:${frontend.address().port}`, authorization: { nonceRef: gate.nonceRef, verifierRef: gate.verifierRef, expiresAtMs: Date.now() + 30_000 }, challenge: gate.challenge(), serviceNonce: upstream.nonce, toolEcho: 'gate-tool-echo' }),
    });
    assert.equal(live.code, 0, live.stderr);
    const observations = JSON.parse(live.stdout);
    assert.equal(observations.gate.identityMatched, true); assert.equal(observations.gate.events.length, 3);
    assert.equal(observations.service.toolCall, true); assert.equal(observations.service.toolResult.echo, 'gate-tool-echo');
    assert.equal(observations.observerVantage, 'local-to-execution-machine');
  } finally {
    if (frontend) { frontend.closeAllConnections(); await new Promise(resolve => frontend.close(resolve)); }
    if (gate) await gate.close(); if (upstream) await upstream.close();
    if (server) await server.close(); await rm(directory, { recursive: true, force: true }); }
});
