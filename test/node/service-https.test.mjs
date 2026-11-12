import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServiceVerifier } from '../../packages/gozar-node/service.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

test('real HTTPS ingress verifies matching target, preserves public Host, survives CLI exit and stays running after remove', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-service-https-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const certPath = join(home, 'cert.pem'), keyPath = join(home, 'key.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
  const verifier = createServiceVerifier();
  const seen = [];
  let authority;
  const target = http.createServer((req, res) => {
    seen.push(req.headers.host);
    if (req.headers.host !== authority) { res.writeHead(421); res.end(); return; }
    if (!verifier(req, res)) res.end('application-alive');
  });
  await listen(target);
  t.after(() => close(target));
  let useWrongInstance = false;
  const otherVerifier = createServiceVerifier();
  const proxy = https.createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
    if (useWrongInstance) { otherVerifier(req, res); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: target.address().port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await listen(proxy);
  t.after(() => close(proxy));
  authority = `127.0.0.1:${proxy.address().port}`;
  const origin = `https://${authority}`;
  const invoke = async (...args) => {
    try {
      const reply = await exec(process.execPath, [cli, 'service', ...args, '--json'], {
        env: { ...process.env, GOZAR_HOME: home, NODE_EXTRA_CA_CERTS: certPath }, timeout: 15000,
      });
      return { code: 0, reply: JSON.parse(reply.stdout) };
    } catch (error) {
      if (!error.stdout) throw error;
      return { code: error.code, reply: JSON.parse(error.stdout) };
    }
  };
  const added = await invoke('add', '--origin', origin, '--target', `127.0.0.1:${target.address().port}`);
  assert.equal(added.code, 0, JSON.stringify(added));
  assert.equal(added.reply.route.verification.method, 'challenge');
  assert.equal(added.reply.route.verification.status, 'verified');
  assert.ok(seen.length >= 2);
  assert.ok(seen.every(value => value === authority));
  assert.equal((await invoke('status', '--origin', origin)).reply.routes[0].verification.status, 'verified');
  useWrongInstance = true;
  const drift = await invoke('status', '--origin', origin);
  assert.equal(drift.code, 1);
  assert.equal(drift.reply.routes[0].verification.status, 'failed');
  useWrongInstance = false;
  assert.equal((await invoke('status', '--origin', origin)).code, 0);
  assert.equal((await invoke('remove', '--origin', origin)).reply.removed, true);
  const request = http.get({ hostname: '127.0.0.1', port: target.address().port, headers: { Host: authority } });
  const body = await new Promise((resolve, reject) => {
    request.on('response', response => { let data = ''; response.on('data', chunk => data += chunk); response.on('end', () => resolve(data)); });
    request.on('error', reject);
  });
  assert.equal(body, 'application-alive');
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: target.address().port, headers: { Host: 'wrong.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 421);
  const trustedCertificate = await readFile(certPath);
  const stillListening = await new Promise((resolve, reject) => {
    https.get(`${origin}/`, { ca: trustedCertificate }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(stillListening, 200);
});
