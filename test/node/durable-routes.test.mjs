// Durable routes against a fake Tailscale LocalAPI on a unix socket (fake-localapi.mjs).
// These tests prove contract behaviour against the fake, not real provider atomicity or
// reboot behaviour. Every route operation runs in a fresh child process, so each step
// rehydrates from the record and provider state alone. A `tailscale` stub on PATH records
// any CLI call; durable paths must never make one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServiceVerifier } from '../../packages/gozar-node/service.mjs';
import { selectAdoptable } from '../../packages/gozar-node/durable-route.mjs';
import { startFakeLocalApi, forwardTarget } from './fake-localapi.mjs';

const exec = promisify(execFile);
const here = path => fileURLToPath(new URL(path, import.meta.url));
const cli = here('../../bin/gozar.mjs'), runner = here('./durable-runner.mjs'), network = here('./durable-network.mjs');
const dnsName = 'node.tailnet.test';
const listen = (server, port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
let root, certificate;

before(async () => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  root = await mkdtemp(join(homedir(), '.tmp', 'gozar-durable-'));
  certificate = { cert: join(root, 'cert.pem'), key: join(root, 'key.pem') };
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certificate.key, '-out', certificate.cert,
    '-days', '1', '-subj', `/CN=${dnsName}`, '-addext', `subjectAltName=DNS:${dnsName}`]);
});
after(() => rm(root, { recursive: true, force: true }));

// One isolated world: fake LocalAPI, the app (with the service verifier) and a loopback HTTPS
// ingress per candidate port that forwards according to the fake serve config.
async function world(t, provider = {}) {
  const base = await mkdtemp(join(root, 'w-'));
  const bin = join(base, 'bin'), home = join(base, 'home'), socket = join(base, 'ts.sock'), cliLog = join(base, 'cli.log');
  await mkdir(bin, { mode: 0o700 }); await mkdir(home, { mode: 0o700 });
  await writeFile(join(bin, 'tailscale'), `#!/bin/sh\necho "$*" >> "${cliLog}"\nexit 97\n`); await chmod(join(bin, 'tailscale'), 0o755);
  const fake = await startFakeLocalApi(socket, provider);
  t.after(() => fake.close());
  const state = fake.state;
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('app'); });
  await listen(app); t.after(() => close(app));
  const routes = {};
  for (const port of [443, 8443, 10000]) {
    const ingress = https.createServer({ cert: await readFile(certificate.cert), key: await readFile(certificate.key) }, (req, res) => {
      const proxy = forwardTarget(state.config, state.dnsName, port);
      if (!proxy) { res.writeHead(404); res.end(); return; }
      const upstream = http.request(new URL(req.url, proxy), { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
    });
    await listen(ingress); t.after(() => close(ingress));
    routes[`${dnsName}:${port}`] = ingress.address().port;
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOZAR_TAILSCALED_SOCKET: socket, GOZAR_HOME: home,
    NODE_EXTRA_CA_CERTS: certificate.cert, GOZAR_TEST_NETWORK: JSON.stringify(routes) };
  const child = async (args, extraEnv = {}) => {
    const pending = exec(process.execPath, ['--import', network, ...args], { env: { ...env, ...extraEnv }, timeout: 60000 });
    state.client = pending.child;
    try { const { stdout } = await pending; return { code: 0, stdout }; }
    catch (error) { if (error.stdout === undefined) throw error; return { code: error.code, signal: error.signal, stdout: error.stdout }; }
  };
  const run = async (operation, input = {}, extraEnv) => {
    const reply = await child([runner, operation, JSON.stringify({ home, ...input })], extraEnv);
    return reply.signal ? { crashed: reply.signal } : JSON.parse(reply.stdout);
  };
  const gozar = async (...args) => {
    const reply = await child([cli, ...args]);
    return { code: reply.code, signal: reply.signal, stdout: reply.stdout, json: args.includes('--json') && !reply.signal ? JSON.parse(reply.stdout) : null };
  };
  const target = `127.0.0.1:${app.address().port}`;
  const request = { routeId: 'coordinator', owner: 'example-app', adapterId: 'tailscale-funnel', target,
    approvals: [{ adapterId: 'tailscale-funnel', target, origin: null, durable: true }] };
  const records = async () => (await readdir(join(home, 'routes')).catch(() => [])).filter(name => /^[0-9a-f]{64}\.json$/.test(name));
  const record = async () => JSON.parse(await readFile(join(home, 'routes', (await records())[0]), 'utf8'));
  const cliCalls = async () => (await readFile(cliLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const edit = change => { change(state); state.etag++; };
  return { home, run, gozar, state, provider: async () => state, edit, target, request, records, record, cliCalls, app,
    writes: () => state.writes, origin: `https://${dnsName}:8443` };
}
const foreignRule = (port, proxy) => ({ config }) => {
  (config.TCP ??= {})[port] = { HTTPS: true };
  (config.Web ??= {})[`${dnsName}:${port}`] = { Handlers: { '/': { Proxy: proxy } } };
};
const listener = proxy => ({ Handlers: { '/': { Proxy: proxy } } });

// Allocation and pinning

test('1. ensure creates a background rule by compare-and-set, writes a receipt, verifies through the challenge, and records gozar-owned', async t => {
  const w = await world(t);
  const created = await w.run('ensure', w.request);
  assert.equal(created.error, undefined, JSON.stringify(created));
  const route = created.result.route;
  assert.equal(route.state, 'usable');
  assert.equal(route.origin, w.origin);
  assert.equal(route.ownership, 'gozar-owned');
  assert.equal(route.lifetime, 'provider-persistent');
  assert.equal(route.verification.status, 'verified');
  assert.equal(route.verification.method, 'challenge');
  assert.equal(w.writes().length, 1);
  assert.deepEqual(w.writes()[0], { TCP: { 8443: { HTTPS: true } }, Web: { [`${dnsName}:8443`]: listener(`http://${w.target}`) }, AllowFunnel: { [`${dnsName}:8443`]: true } });
  // Every write carried If-Match; the record is private and carries intent and a receipt.
  const path = join(w.home, 'routes', (await w.records())[0]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const record = await w.record();
  assert.deepEqual(record.intent, { dnsName, port: 8443, mode: 'funnel', origin: w.origin,
    rule: { tcp: { HTTPS: true }, web: listener(`http://${w.target}`), funnel: true } });
  assert.deepEqual(record.receipt.rule, record.intent.rule);
  assert.equal(record.receipt.port, 8443);
  // A fresh process rehydrates the route from the record alone and re-verifies it.
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'usable');
  assert.equal(status.result.routes[0].verification.status, 'verified');
  // Another fresh process removes exactly that rule from the receipt.
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null });
  assert.deepEqual((await w.provider()).config, {});
  assert.deepEqual(await w.records(), []);
  assert.deepEqual(await w.cliCalls(), []);
});

test('2. a second ensure with the same tuple reuses the rule and makes no mutation', async t => {
  const w = await world(t);
  const first = await w.run('ensure', w.request);
  const second = await w.run('ensure', w.request);
  assert.equal(second.result.route.state, 'usable');
  assert.equal(second.result.route.origin, first.result.route.origin);
  assert.equal(second.result.route.createdAt, first.result.route.createdAt);
  assert.equal(w.writes().length, 1);
});

test('3. a pinned origin with a different node DNS name gives address_changed and no mutation', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  w.state.dnsName = 'renamed.tailnet.test';
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'address_changed');
  assert.equal(w.writes().length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'address_changed');
});

test('4. a readback mismatch after creation leaves the listener in place as cleanup debt and publishes nothing', async t => {
  // The listener on the pinned port differs after our write: another program may have replaced
  // it, so Gozar cannot attribute it and must not remove it.
  const w = await world(t, { createProxy: 'http://127.0.0.1:1' });
  w.edit(foreignRule(10000, 'http://127.0.0.1:2'));
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'uncertain');
  const { config } = await w.provider();
  assert.deepEqual(config.Web[`${dnsName}:8443`], listener('http://127.0.0.1:1'));
  assert.deepEqual(config.Web[`${dnsName}:10000`], listener('http://127.0.0.1:2'));
  assert.equal(w.writes().length, 1);
  const status = (await w.run('status', {})).result.routes[0];
  assert.equal(status.state, 'uncertain');
  assert.equal(status.origin, null);
});

test('5. occupied port is refused and the foreign rule is untouched', async t => {
  const w = await world(t);
  w.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const before = structuredClone(w.state.config);
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'port_occupied');
  assert.deepEqual(w.state.config, before);
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.records(), []);
  // With another permitted port free, the occupied one is skipped, never replaced.
  w.state.funnelPorts = [8443, 10000];
  const created = await w.run('ensure', w.request);
  assert.equal(created.result.route.origin, `https://${dnsName}:10000`);
  assert.deepEqual(w.state.config.Web[`${dnsName}:8443`], before.Web[`${dnsName}:8443`]);
});

test('5. the fake forwards only with a TCP HTTPS handler, Funnel needs AllowFunnel, and the private adapter never sets AllowFunnel', async t => {
  const proxy = 'http://127.0.0.1:7';
  const full = { TCP: { 8443: { HTTPS: true } }, Web: { [`${dnsName}:8443`]: listener(proxy) }, AllowFunnel: { [`${dnsName}:8443`]: true } };
  assert.equal(forwardTarget(full, dnsName, 8443, { publicVantage: true }), proxy);
  assert.equal(forwardTarget({ ...full, TCP: {} }, dnsName, 8443), null);
  assert.equal(forwardTarget({ ...full, TCP: { 8443: { HTTP: true } } }, dnsName, 8443), null);
  assert.equal(forwardTarget({ ...full, AllowFunnel: undefined }, dnsName, 8443, { publicVantage: true }), null);
  assert.equal(forwardTarget({ ...full, AllowFunnel: undefined }, dnsName, 8443), proxy);
  // The ingress uses the same rule: once the TCP handler is gone it stops forwarding, and the
  // listener no longer matches the receipt.
  const w = await world(t);
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  w.edit(state => { delete state.config.TCP; });
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
  // Private adapter: no AllowFunnel anywhere in what it writes.
  const p = await world(t);
  const created = await p.run('ensure', { ...p.request, adapterId: 'tailscale-private', approvals: [{ ...p.request.approvals[0], adapterId: 'tailscale-private' }] });
  assert.equal(created.result.route.state, 'usable');
  assert.ok(p.writes().every(config => config.AllowFunnel === undefined));
});

test('6. restart with an omitted origin uses the recorded pin; a conflicting origin or adapter is refused', async t => {
  const w = await world(t);
  const created = await w.run('ensure', w.request);
  const again = await w.run('ensure', { ...w.request, approvals: [] });
  assert.equal(again.result.route.origin, created.result.route.origin);
  assert.equal((await w.run('ensure', { ...w.request, origin: `https://${dnsName}:10000` })).error.code, 'origin_changed');
  assert.equal((await w.run('ensure', { ...w.request, adapterId: 'tailscale-private' })).error.code, 'adapter_changed');
  assert.equal(w.writes().length, 1);
});

test('7. a saved lost record is restored only at the pinned origin and never re-allocated unpinned', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  await w.run('ensure', w.request);
  w.edit(state => { state.config = {}; });
  assert.equal((await w.run('status', {})).result.routes[0].state, 'lost');
  const restored = await w.run('ensure', w.request);
  assert.equal(restored.result.route.state, 'usable');
  assert.equal(restored.result.route.origin, w.origin);
  // Lost again, and another program now holds the pinned port: refused, not moved to 10000.
  w.edit(state => { state.config = {}; foreignRule(8443, 'http://127.0.0.1:9')(state); });
  assert.equal((await w.run('ensure', w.request)).error.code, 'uncertain');
  assert.deepEqual(w.state.config.Web[`${dnsName}:8443`], listener('http://127.0.0.1:9'));
  assert.equal(w.state.config.Web[`${dnsName}:10000`], undefined);
});

test('8. an adapter without addressStability stable, or a lifetimeMs, refuses a durable route', async t => {
  const w = await world(t);
  const relay = await w.run('ensure', { ...w.request, adapterId: 'localhost-run', approvals: [{ ...w.request.approvals[0], adapterId: 'localhost-run' }] });
  assert.equal(relay.error.code, 'adapter_not_durable');
  assert.equal((await w.run('ensure', { ...w.request, lifetimeMs: 60000 })).error.code, 'durable_lifetime_unsupported');
  assert.deepEqual(w.writes(), []);
});

// Consent

test('9. a changed approval tuple is refused', async t => {
  const w = await world(t);
  assert.equal((await w.run('ensure', { ...w.request, approvals: [] })).error.code, 'consent_required');
  assert.equal((await w.run('ensure', { ...w.request, approvals: [{ ...w.request.approvals[0], durable: false }] })).error.code, 'consent_required');
  await w.run('ensure', w.request);
  assert.equal((await w.run('ensure', { ...w.request, target: '127.0.0.1:1' })).error.code, 'consent_changed');
  assert.equal(w.writes().length, 1);
});

test('10. fallback to another adapter only on a first allocation, and only with its own approved tuple', async t => {
  const w = await world(t, { funnelPorts: [] });
  const funnelOnly = await w.run('ensure', w.request);
  assert.equal(funnelOnly.error.code, 'port_occupied');
  // An approval for another target does not cover the fallback.
  const wrongTarget = await w.run('ensure', { ...w.request, approvals: [w.request.approvals[0], { adapterId: 'tailscale-private', target: '127.0.0.1:1', origin: null, durable: true }] });
  assert.equal(wrongTarget.error.code, 'port_occupied');
  assert.deepEqual(w.writes(), []);
  const approvals = [w.request.approvals[0], { adapterId: 'tailscale-private', target: w.target, origin: null, durable: true }];
  const fallback = await w.run('ensure', { ...w.request, approvals });
  assert.equal(fallback.result.route.adapterId, 'tailscale-private');
  // A pinned route never changes adapter, even with approval and Funnel available again.
  w.edit(state => { state.config = {}; state.funnelPorts = [8443]; });
  const pinned = await w.run('ensure', { ...w.request, approvals });
  assert.equal(pinned.result.route.adapterId, 'tailscale-private');
  assert.ok(w.writes().every(config => config.AllowFunnel === undefined));
});

// Crashes and races

test('11. crash after intent, before the provider write, gives lost', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  assert.equal((await w.records()).length, 1);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'lost');
  assert.equal(status.result.routes[0].origin, null);
  assert.deepEqual(w.state.config, {});
});

test('12. crash after intent, then an identical foreign rule appears: uncertain, not claimed, not removed, kept visible as debt', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const foreign = structuredClone(w.state.config);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'uncertain');
  assert.equal(status.result.routes[0].verification, null);
  assert.equal((await w.run('ensure', w.request)).error.code, 'uncertain');
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: false, providerRemoved: false, cleanupDebt: { reason: 'unattributed-rule', port: 8443 } });
  // The debt stays visible until the rule is gone or the user dismisses it.
  const listed = (await w.run('status', {})).result.routes[0];
  assert.equal(listed.state, 'releasing');
  assert.deepEqual(listed.cleanupDebt, { reason: 'unattributed-rule', port: 8443 });
  const dismissed = await w.run('release', { routeId: 'coordinator', mode: 'dismiss' });
  assert.equal(dismissed.result.removed, true);
  assert.deepEqual(await w.records(), []);
  assert.deepEqual(w.state.config, foreign);
  assert.deepEqual(w.writes(), []);
  // Once the rule is gone, a later release drops a debt record on its own.
  const again = await world(t, { crash: 'before-apply' });
  await again.run('ensure', again.request);
  again.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  await again.run('release', { routeId: 'coordinator' });
  again.edit(state => { state.config = {}; });
  assert.equal((await again.run('release', { routeId: 'coordinator' })).result.removed, true);
  assert.deepEqual(await again.records(), []);
});

test('13. crash after the provider write, before the receipt, gives uncertain', async t => {
  const w = await world(t, { crash: 'after-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
  assert.equal((await w.record()).receipt, null);
});

test('13. crash after the receipt, before verification: the next ensure verifies the pinned origin and publishes it', async t => {
  const w = await world(t);
  // The app is not answering during the first ensure: the receipt is written, verification fails.
  const port = w.app.address().port;
  await close(w.app);
  const first = await w.run('ensure', w.request);
  assert.equal(first.result.route.state, 'unverified');
  assert.equal(first.result.route.origin, null);
  assert.ok((await w.record()).receipt);
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('app'); });
  await listen(app, port); t.after(() => close(app));
  // Status verifies the pinned origin and durably publishes it.
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'usable');
  assert.equal(status.result.routes[0].origin, w.origin);
  assert.equal((await w.record()).origin, w.origin);
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  assert.equal(w.writes().length, 1);
});

test('14. release with a changed rule keeps cleanup debt and the record, and leaves the foreign rule untouched', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  w.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const changed = structuredClone(w.state.config);
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: false, providerRemoved: false, cleanupDebt: { reason: 'rule-changed', port: 8443 } });
  assert.deepEqual(w.state.config, changed);
  assert.equal((await w.records()).length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'releasing');
});

test('14. an edit between readback and removal makes the conditional removal fail with 412 and the foreign edit survives', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  w.state.beforePost = foreignRule(8443, 'http://127.0.0.1:9');
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.removed, false);
  assert.equal(released.result.cleanupDebt.reason, 'rule-changed');
  assert.deepEqual(w.state.config.Web[`${dnsName}:8443`], listener('http://127.0.0.1:9'));
  assert.equal(w.writes().length, 1);
});

test('15. release racing a late create or verification waits for it, then removes it: the route is not re-published', async t => {
  const w = await world(t);
  w.state.createDelayMs = 700;
  const ensuring = w.run('ensure', w.request);
  await new Promise(resolve => setTimeout(resolve, 300));
  const [created, released] = await Promise.all([ensuring, w.run('release', { routeId: 'coordinator' })]);
  // The release blocked on the reservation lock instead of failing busy, then saw the committed record.
  assert.equal(created.result.route.state, 'usable');
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null });
  assert.deepEqual(w.state.config, {});
  assert.deepEqual((await w.run('status', {})).result.routes, []);
  // Late verification: the app answers slowly; a release that arrives during verification waits too.
  const slow = await world(t);
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => setTimeout(() => { if (!verifier(req, res)) res.end('app'); }, 400));
  await listen(app); t.after(() => close(app));
  const target = `127.0.0.1:${app.address().port}`;
  const request = { ...slow.request, target, approvals: [{ ...slow.request.approvals[0], target }] };
  const late = slow.run('ensure', request);
  await new Promise(resolve => setTimeout(resolve, 300));
  const [lateCreated, lateReleased] = await Promise.all([late, slow.run('release', { routeId: 'coordinator' })]);
  assert.ok(lateCreated.result);
  assert.equal(lateReleased.result.removed, true);
  assert.deepEqual(slow.state.config, {});
  assert.deepEqual((await slow.run('status', {})).result.routes, []);
});

test('16. concurrent ensure, adopt and session for one listener or port with distinct origins: exactly one wins', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  // Sequential: a second route ID for the same listener is refused, not given a second port.
  await w.run('ensure', w.request);
  assert.equal((await w.run('ensure', { ...w.request, routeId: 'second', approvals: w.request.approvals })).error?.code, 'reserved');
  // A session for the same listener is refused before any detection runs.
  const session = await w.gozar('expose', '--port', String(w.app.address().port), '--yes', '--json');
  assert.equal(session.code, 1);
  assert.match(session.json.error, /already holds this listener/);
  await w.run('release', { routeId: 'coordinator' });
  // Concurrent: three valid contenders for one listener. A previous owner's rule on 10000 is
  // adoptable; the two ensures would create on 8443. Exactly one wins; the others are refused
  // as reserved, and the adoptable rule is never changed by a loser.
  const adoptOrigin = `https://${dnsName}:10000`;
  w.edit(state => { foreignRule(10000, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:10000`]: true }; });
  const adoptable = structuredClone(w.state.config.Web[`${dnsName}:10000`]);
  const replies = await Promise.all([
    w.run('ensure', w.request),
    w.run('ensure', { ...w.request, routeId: 'second' }),
    w.run('adopt', { routeId: 'third', owner: 'example-app', target: w.target, origin: adoptOrigin, handover: { from: 'example-app', generation: 1 },
      approvals: [{ adapterId: 'tailscale-funnel', target: w.target, origin: adoptOrigin, durable: true }] }),
  ]);
  const winners = replies.filter(reply => reply.result);
  assert.equal(winners.length, 1);
  assert.deepEqual(replies.filter(reply => !reply.result).map(reply => reply.error.code), ['reserved', 'reserved']);
  assert.deepEqual(w.state.config.Web[`${dnsName}:10000`], adoptable);
  assert.equal(Object.keys(w.state.config.Web).length, winners[0].result.route.routeId === 'third' ? 1 : 2);
  // A live session holds its listener: a durable route for that listener is refused.
  await w.run('release', { routeId: winners[0].result.route.routeId });
  w.edit(state => { state.config = {}; });
  const port = w.app.address().port;
  await mkdir(join(w.home, `port-${port}`), { mode: 0o700 });
  const identity = (await readFile(`/proc/${process.pid}/stat`, 'utf8')).split(') ')[1].split(' ')[19];
  await writeFile(join(w.home, `port-${port}`, 'reservation.json'), JSON.stringify({ pid: process.pid, startIdentity: identity, providerResource: 'tailscale-https-port', providerPorts: [8443] }));
  assert.equal((await w.run('ensure', w.request)).error.code, 'reserved');
  assert.deepEqual(w.state.config, {});
});

test('17. removeService on a gozar-owned record is refused, and statusServices lists durable records', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const reply = await w.run('removeService', { origin: w.origin });
  assert.match(reply.error.message, /releaseRoute/);
  assert.equal((await w.records()).length, 1);
  const listed = await w.run('statusServices', {});
  const durable = listed.result.routes.filter(route => route.ownership === 'gozar-owned');
  assert.equal(durable.length, 1);
  assert.equal(durable[0].routeId, 'coordinator');
});

// Adoption

test('18. adopt of an exact rule with a handover makes no provider mutation and records adopted; mismatch, missing handover or a change during verification is refused', async t => {
  const w = await world(t);
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const base = { routeId: 'coordinator', owner: 'example-app', target: w.target, origin: w.origin,
    approvals: [{ adapterId: 'tailscale-funnel', target: w.target, origin: w.origin, durable: true }] };
  assert.equal((await w.run('adopt', base)).error.code, 'handover_required');
  assert.equal((await w.run('adopt', { ...base, origin: `https://${dnsName}`, handover: { from: 'example-app', generation: 1 } })).error.code, 'claim_mismatch');
  // The rule changes while the challenge runs: refused, nothing recorded.
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => {
    if (req.url.startsWith('/.well-known/gozar/service') && req.headers.host === `${dnsName}:8443`) w.edit(state => { state.config.Web[`${dnsName}:8443`].Handlers['/'].Proxy = `http://${w.target}/changed`; });
    if (!verifier(req, res)) res.end('app');
  });
  w.app.removeAllListeners('request'); w.app.on('request', (req, res) => app.emit('request', req, res));
  assert.equal((await w.run('adopt', { ...base, handover: { from: 'example-app', generation: 1 } })).error.code, 'claim_mismatch');
  assert.deepEqual(await w.records(), []);
  // Restore the exact rule and a normal app: adoption succeeds with no provider write.
  w.edit(state => { state.config.Web[`${dnsName}:8443`] = listener(`http://${w.target}`); });
  const plain = createServiceVerifier();
  w.app.removeAllListeners('request'); w.app.on('request', (req, res) => { if (!plain(req, res)) res.end('app'); });
  const adopted = await w.run('adopt', { ...base, handover: { from: 'example-app', generation: 1 } });
  assert.equal(adopted.result.route.state, 'usable');
  assert.equal(adopted.result.route.provenance, 'adopted');
  assert.deepEqual((await w.record()).handover, { from: 'example-app', generation: 1 });
  assert.deepEqual(w.writes(), []);
});

test('18. adopt refuses ambiguity: two adapters whose rule matches this target at this origin give ambiguous_route, and one match is chosen without caller input', () => {
  const rule = { tcp: { HTTPS: true }, web: { Handlers: { '/': { Proxy: 'http://{target}' } } }, funnel: true };
  const capability = port => ({ candidatePorts: [port], recipe: { listener: rule } });
  const observed = { dnsName, config: { TCP: { 8443: { HTTPS: true } }, Web: { [`${dnsName}:8443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:5' } } } }, AllowFunnel: { [`${dnsName}:8443`]: true } } };
  const input = { origin: `https://${dnsName}:8443`, target: '127.0.0.1:5' };
  const one = selectAdoptable([{ adapterId: 'a', capability: capability(8443) }, { adapterId: 'b', capability: capability(10000) }], observed, input);
  assert.deepEqual([one.adapterId, one.port], ['a', 8443]);
  assert.throws(() => selectAdoptable([{ adapterId: 'a', capability: capability(8443) }, { adapterId: 'b', capability: capability(8443) }], observed, input),
    { code: 'ambiguous_route' });
  assert.throws(() => selectAdoptable([{ adapterId: 'a', capability: capability(10000) }], observed, input), { code: 'claim_mismatch' });
  assert.throws(() => selectAdoptable([{ adapterId: 'a', capability: capability(8443) }], observed, { ...input, target: '127.0.0.1:6' }), { code: 'claim_mismatch' });
});

test('19. adopt while the reservation table holds the listener or port is refused', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const reply = await w.run('adopt', { routeId: 'other', owner: 'example-app', target: w.target, origin: w.origin, handover: { from: 'example-app', generation: 1 } });
  assert.equal(reply.error.code, 'reserved');
  // Another listener on the provider port that a record holds is refused too: a rule for another
  // target now sits on the held port, so Gozar finds it for that target and sees the port is held.
  w.edit(state => { state.config.Web[`${dnsName}:8443`].Handlers['/'].Proxy = 'http://127.0.0.1:1'; });
  const port = await w.run('adopt', { routeId: 'other', owner: 'example-app', target: '127.0.0.1:1', origin: w.origin, handover: { from: 'example-app', generation: 1 } });
  assert.equal(port.error.code, 'reserved');
  assert.equal(w.writes().length, 1);
});

test('20. hand-back then re-adopt with a newer generation keeps exactly one owner at every step', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const back = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.equal(back.result.claim.port, 8443);
  // Phase 1 keeps the record, its receipt and its reservation.
  assert.equal((await w.records()).length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'handing-back');
  assert.ok((await w.record()).receipt);
  // The previous owner takes the rule back (lifts its fence with a newer generation), then Gozar confirms.
  const confirmed = await w.run('confirmHandBack', { routeId: 'coordinator', transfer: back.result.transfer });
  assert.equal(confirmed.result.handedBack, true);
  assert.deepEqual(await w.records(), []);
  assert.equal(w.writes().length, 1);
  // Rollback in the other direction: adopt again with a newer generation.
  const { adapterId, ...app } = w.request;
  const again = await w.run('adopt', { ...app, origin: w.origin, approvals: [{ ...w.request.approvals[0], origin: w.origin }],
    handover: { from: 'example-app', generation: 2 } });
  assert.equal(again.result.route.state, 'usable');
  assert.equal(w.writes().length, 1);
  // A second hand-back gets a new transfer; replaying the first confirmation cannot delete it.
  const second = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.notEqual(second.result.transfer, back.result.transfer);
  assert.equal((await w.run('confirmHandBack', { routeId: 'coordinator', transfer: back.result.transfer })).error.code, 'stale_transfer');
  assert.equal((await w.records()).length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'handing-back');
});

// Visibility

test('21. gozar status with no arguments lists a durable route next to sessions and service routes; --json has the same fields', async t => {
  const w = await world(t);
  const created = (await w.run('ensure', w.request)).result.route;
  // A recorded session with no running controller, next to the durable route.
  await mkdir(join(w.home, 'port-3000'), { mode: 0o700 });
  await writeFile(join(w.home, 'port-3000', 'session.json'), JSON.stringify({ version: 1, owned: {}, intents: {} }));
  const json = await w.gozar('status', '--json');
  assert.equal(json.code, 0, json.stdout);
  assert.deepEqual(json.json.sessions, [{ port: 3000, phase: 'not-running', origin: null }]);
  assert.deepEqual(json.json.serviceRoutes, []);
  const [route] = json.json.durableRoutes;
  assert.deepEqual({ routeId: route.routeId, adapterId: route.adapterId, origin: route.origin, owner: route.owner, createdAt: route.createdAt, state: route.state },
    { routeId: 'coordinator', adapterId: 'tailscale-funnel', origin: w.origin, owner: 'example-app', createdAt: created.createdAt, state: 'usable' });
  const text = await w.gozar('status');
  for (const field of ['coordinator', 'tailscale-funnel', w.origin, 'example-app', created.createdAt, 'usable', 'port 3000', 'gozar stop --route coordinator'])
    assert.ok(text.stdout.includes(field), `${field} missing from:\n${text.stdout}`);
  const one = await w.gozar('status', '--route', 'coordinator', '--json');
  assert.equal(one.json.durableRoutes[0].routeId, 'coordinator');
});

test('21. when last.json names a session, bare status keeps the session output and exit, and adds the inventory', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await writeFile(join(w.home, 'last.json'), JSON.stringify({ port: 3000 }));
  const json = await w.gozar('status', '--json');
  // The old session reply: no controller, so phase unknown and exit 1, as before.
  assert.equal(json.code, 1);
  assert.equal(json.json.snapshot.phase, 'unknown');
  assert.equal(json.json.inventory.durableRoutes[0].routeId, 'coordinator');
  const text = await w.gozar('status');
  assert.equal(text.code, 1);
  assert.ok(text.stdout.indexOf('Durable routes:') > 0, text.stdout);
  // status --port N is unchanged: no inventory.
  const port = await w.gozar('status', '--port', '3000', '--json');
  assert.equal(port.json.inventory, undefined);
  // An inventory failure is reported inside the inventory; the session reply and exit stay as they were.
  const routes = (await readdir(w.home)).find(name => ['routes', 'durable-routes'].includes(name)) ?? 'services';
  await chmod(join(w.home, routes), 0o770);
  t.after(() => chmod(join(w.home, routes), 0o700));
  const broken = await w.gozar('status', '--json');
  assert.equal(broken.code, port.code);
  assert.deepEqual(broken.json.snapshot, port.json.snapshot);
  assert.match(broken.json.inventory.error, /./);
  const brokenText = await w.gozar('status');
  assert.equal(brokenText.code, port.code);
  assert.match(brokenText.stdout, /Routes: unavailable/);
});

test('22. gozar stop --route ID removes the provider rule by compare-and-set and deletes the record; a changed rule is left as cleanup debt', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const stopped = await w.gozar('stop', '--route', 'coordinator', '--json');
  assert.equal(stopped.code, 0, stopped.stdout);
  assert.deepEqual(stopped.json, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null, stopped: true });
  assert.deepEqual(w.state.config, {});
  assert.deepEqual(await w.records(), []);
  assert.deepEqual(w.writes().at(-1), {});

  const changed = await world(t);
  await changed.run('ensure', changed.request);
  changed.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const foreign = structuredClone(changed.state.config);
  const text = await changed.gozar('stop', '--route', 'coordinator');
  assert.equal(text.code, 1);
  assert.match(text.stdout, /not removed.*Cleanup debt: rule-changed on port 8443.*left in place/);
  assert.deepEqual(changed.state.config, foreign);
  assert.equal((await changed.records()).length, 1);
  assert.equal((await changed.gozar('status', '--json')).json.durableRoutes[0].cleanupDebt.reason, 'rule-changed');
});

test('23. after gozar stop --route ID, ensureRoute is refused with stopped_by_user and makes no mutation; reconsent: true creates it again', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await w.gozar('stop', '--route', 'coordinator');
  const before = w.writes().length;
  const refused = await w.run('ensure', w.request);
  assert.equal(refused.error.code, 'stopped_by_user');
  assert.equal(w.writes().length, before);
  const again = await w.run('ensure', { ...w.request, reconsent: true });
  assert.equal(again.result.route.state, 'usable');
  assert.equal(again.result.route.origin, w.origin);
  // The re-consented call clears the stop; the next ordinary ensure reuses the route.
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
});

// LocalAPI contract

test('24. a foreign edit between GET and POST gives 412 on create and on remove; Gozar re-reads and never overwrites or deletes it', async t => {
  // Create: the foreign rule takes the only permitted port between Gozar's read and write.
  const w = await world(t);
  w.state.beforePost = foreignRule(8443, 'http://127.0.0.1:9');
  assert.equal((await w.run('ensure', w.request)).error.code, 'port_occupied');
  assert.deepEqual(w.state.config.Web, { [`${dnsName}:8443`]: listener('http://127.0.0.1:9') });
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.records(), []);
  // With another port permitted, Gozar re-decides from the new state and takes the free port.
  const moved = await world(t, { funnelPorts: [8443, 10000] });
  moved.state.beforePost = foreignRule(8443, 'http://127.0.0.1:9');
  const created = await moved.run('ensure', moved.request);
  assert.equal(created.result.route.origin, `https://${dnsName}:10000`);
  assert.deepEqual(moved.state.config.Web[`${dnsName}:8443`], listener('http://127.0.0.1:9'));
  // Remove: a foreign edit on another listener; the retry is conditional on the new read, so it survives.
  moved.state.beforePost = foreignRule(443, 'http://127.0.0.1:8');
  const released = await moved.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.providerRemoved, true);
  assert.deepEqual(moved.state.config, { TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
    Web: { [`${dnsName}:443`]: listener('http://127.0.0.1:8'), [`${dnsName}:8443`]: listener('http://127.0.0.1:9') } });
  // A program that keeps changing the config: bounded attempts, then a typed conflict, no write.
  const busy = await world(t);
  busy.state.beforePost = state => { state.config.Services = { [`svc:${state.etag}`]: {} }; };
  busy.state.beforePostAlways = true;
  const conflicted = (await busy.run('ensure', busy.request)).error;
  assert.equal(conflicted.code, 'provider_conflict');
  assert.equal(conflicted.provider, 'tailscale');
  assert.equal(conflicted.nextAction, 'retry later');
  assert.deepEqual(busy.writes(), []);
  assert.deepEqual(await busy.cliCalls(), []);
});

test('25. a missing socket, a denied request, a 404, a reply without Etag, or an unexpected body each give the named typed error, and no CLI runs', async t => {
  const w = await world(t);
  const cases = [
    [{ GOZAR_TAILSCALED_SOCKET: join(w.home, 'missing.sock') }, null, 'provider_unavailable', 'start tailscaled'],
    [{}, 'denied', 'provider_denied', 'sudo tailscale set --operator=$USER'],
    [{}, 'missing-endpoint', 'provider_unsupported', 'upgrade tailscaled'],
    [{}, 'no-etag', 'provider_unsupported', 'upgrade tailscaled'],
    [{}, 'bad-shape', 'provider_unsupported', 'upgrade tailscaled'],
  ];
  for (const [env, failure, code, nextAction] of cases) {
    w.state.failure = failure;
    const reply = await w.run('ensure', w.request, env);
    assert.equal(reply.error.code, code, failure ?? 'missing socket');
    assert.equal(reply.error.provider, 'tailscale');
    assert.equal(reply.error.nextAction, nextAction);
    assert.match(reply.error.message, /start tailscaled|tailscale set --operator|upgrade tailscaled/);
  }
  w.state.failure = null;
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.cliCalls(), []);
  // Removal fails closed the same way: the record stays and nothing is written.
  await w.run('ensure', w.request);
  w.state.failure = 'no-etag';
  assert.equal((await w.run('release', { routeId: 'coordinator' })).error.code, 'provider_unsupported');
  assert.equal((await w.records()).length, 1);
  assert.equal(w.writes().length, 1);
  assert.deepEqual(await w.cliCalls(), []);
});

// Sticky stop

test('27. a user stop survives app release in every mode and a restart; adopt is refused; only gozar allow clears it; a crash mid-stop still blocks', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await w.gozar('stop', '--route', 'coordinator');
  for (const mode of ['remove', 'hand-back', 'dismiss']) await w.run('release', { routeId: 'coordinator', mode });
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const adopt = await w.run('adopt', { ...w.request, origin: w.origin, approvals: [{ ...w.request.approvals[0], origin: w.origin }],
    handover: { from: 'example-app', generation: 1 } });
  assert.equal(adopt.error.code, 'stopped_by_user');
  const listed = await w.gozar('status', '--json');
  assert.equal(listed.json.stoppedRoutes[0].routeId, 'coordinator');
  // Allow asks for durable consent; --yes approves it.
  const refusedAllow = await w.gozar('allow', '--route', 'coordinator');
  assert.notEqual(refusedAllow.code, 0);
  const allowed = await w.gozar('allow', '--route', 'coordinator', '--yes');
  assert.equal(allowed.code, 0, allowed.stdout);
  assert.match(allowed.stdout, /whether or not .* is running/);
  w.edit(state => { state.config = {}; });
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  // Crash during gozar stop after the tombstone write and before the provider write.
  w.state.crash = 'before-apply';
  assert.equal((await w.gozar('stop', '--route', 'coordinator')).signal, 'SIGKILL');
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
});

// Hand-back

test('28. a crash around hand-back keeps the route listed as handing-back with its receipt and reservation; a retry returns the same claim and transfer', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const first = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  // A lost reply or a crash before confirmation: the retry returns the same values.
  const retry = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.deepEqual(retry.result, first.result);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'handing-back');
  assert.deepEqual(status.result.routes[0].handBack, { transfer: first.result.transfer, claim: first.result.claim });
  assert.ok((await w.record()).receipt);
  // The reservation holds: another route for that listener is refused.
  assert.equal((await w.run('ensure', { ...w.request, routeId: 'other' })).error.code, 'reserved');
  // Cancel returns it to its previous state.
  const cancelled = await w.run('cancelHandBack', { routeId: 'coordinator', transfer: first.result.transfer });
  assert.equal(cancelled.result.route.state, 'usable');
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  assert.equal(w.writes().length, 1);
});

test('29. during hand-back ensure and adopt return handing_back; gozar stop still removes by compare-and-set and writes the tombstone; a stale transfer is refused', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const back = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.equal((await w.run('ensure', w.request)).error.code, 'handing_back');
  assert.equal((await w.run('adopt', { ...w.request, origin: w.origin, handover: { from: 'example-app', generation: 3 } })).error.code, 'handing_back');
  assert.equal((await w.run('release', { routeId: 'coordinator' })).error.code, 'handing_back');
  assert.equal((await w.run('confirmHandBack', { routeId: 'coordinator', transfer: '00000000-0000-4000-8000-000000000000' })).error.code, 'stale_transfer');
  assert.equal(w.writes().length, 1);
  const stopped = await w.gozar('stop', '--route', 'coordinator', '--json');
  assert.equal(stopped.json.providerRemoved, true);
  assert.deepEqual(w.state.config, {});
  assert.deepEqual(await w.records(), []);
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
});

// Owner-run exposure

test('30. another program on the target still receives forwarded traffic, and status says so with gozar stop as the next action', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const port = w.app.address().port;
  await close(w.app);
  const none = (await w.gozar('status', '--json')).json.durableRoutes[0];
  assert.equal(none.targetCheck, 'nothing listening');
  assert.equal(none.exposure, 'owner-run');
  assert.equal(none.forwards, `forwards to ${w.target} whether or not example-app is running`);
  const squatter = http.createServer((req, res) => res.end('squatter'));
  await listen(squatter, port); t.after(() => close(squatter));
  // The provider rule still forwards: the design does not prevent this.
  assert.equal(forwardTarget(w.state.config, dnsName, 8443, { publicVantage: true }), `http://${w.target}`);
  const json = (await w.gozar('status', '--json')).json.durableRoutes[0];
  assert.equal(json.targetCheck, 'another program is listening');
  assert.equal(json.nextAction, 'gozar stop --route coordinator');
  assert.match(json.warning, /Another program is listening/);
  const text = (await w.gozar('status')).stdout;
  for (const field of ['owner-run', `forwards to ${w.target} whether or not example-app is running`, 'another program is listening', 'gozar stop --route coordinator'])
    assert.ok(text.includes(field), `${field} missing from:\n${text}`);
});

test('31. the node DNS name changes while no Gozar call runs: status shows address_changed and never reports the new origin', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  w.state.dnsName = 'renamed.tailnet.test';
  const json = await w.gozar('status', '--json');
  const route = json.json.durableRoutes[0];
  assert.equal(route.state, 'address_changed');
  assert.equal(route.origin, w.origin);
  assert.ok(!json.stdout.includes('renamed'));
  assert.ok(!(await w.gozar('status')).stdout.includes('renamed'));
});
