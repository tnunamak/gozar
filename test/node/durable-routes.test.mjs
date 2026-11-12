// Durable routes against a fake `tailscale` whose serve config lives in a temporary file.
// These tests prove contract behaviour against the fake, not real provider atomicity or
// reboot behaviour. Every route operation runs in a fresh child process, so each step
// rehydrates from the record and provider state alone. Tests marked todo are the G1 red list.
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

const exec = promisify(execFile);
const here = path => fileURLToPath(new URL(path, import.meta.url));
const cli = here('../../bin/gozar.mjs'), runner = here('./durable-runner.mjs'), network = here('./durable-network.mjs'), fake = here('./fake-tailscale.mjs');
const dnsName = 'node.tailnet.test';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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

// One isolated world: fake provider, the app (with the service verifier) and a loopback
// HTTPS ingress per candidate port that forwards according to the fake serve config.
async function world(t, provider = {}) {
  const base = await mkdtemp(join(root, 'world-'));
  const bin = join(base, 'bin'), home = join(base, 'home'), statePath = join(base, 'tailscale.json');
  await mkdir(bin, { mode: 0o700 }); await mkdir(home, { mode: 0o700 });
  await writeFile(join(bin, 'tailscale'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`); await chmod(join(bin, 'tailscale'), 0o755);
  const initial = { dnsName, nodeId: 'node-1', backendState: 'Running', funnelPorts: [8443], config: {}, etag: 1, audit: [], crash: null, ...provider };
  await writeFile(statePath, JSON.stringify(initial));
  const provider_ = async () => JSON.parse(await readFile(statePath, 'utf8'));
  const edit = async change => { const value = await provider_(); change(value); await writeFile(statePath, JSON.stringify(value)); };
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('app'); });
  await listen(app); t.after(() => close(app));
  const routes = {};
  for (const port of [443, 8443, 10000]) {
    const ingress = https.createServer({ cert: await readFile(certificate.cert), key: await readFile(certificate.key) }, async (req, res) => {
      const { config, dnsName: name } = await provider_();
      const proxy = config.Web?.[`${name}:${port}`]?.Handlers?.['/']?.Proxy;
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
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_TAILSCALE_STATE: statePath, GOZAR_HOME: home,
    NODE_EXTRA_CA_CERTS: certificate.cert, GOZAR_TEST_NETWORK: JSON.stringify(routes) };
  const child = async args => {
    try { const { stdout } = await exec(process.execPath, ['--import', network, ...args], { env, timeout: 30000 }); return { code: 0, stdout }; }
    catch (error) { if (error.stdout === undefined) throw error; return { code: error.code, signal: error.signal, stdout: error.stdout }; }
  };
  const run = async (operation, input = {}) => {
    const reply = await child([runner, operation, JSON.stringify({ home, ...input })]);
    return reply.signal ? { crashed: reply.signal } : JSON.parse(reply.stdout);
  };
  const gozar = async (...args) => {
    const reply = await child([cli, ...args]);
    return { code: reply.code, stdout: reply.stdout, json: args.includes('--json') ? JSON.parse(reply.stdout) : null };
  };
  const target = `127.0.0.1:${app.address().port}`;
  const request = { routeId: 'coordinator', owner: 'example-app', adapterId: 'tailscale-funnel', target,
    approvals: [{ adapterId: 'tailscale-funnel', target, origin: null, durable: true }] };
  const mutations = async () => (await provider_()).audit.filter(args => ['serve', 'funnel'].includes(args[0]) && args[1] !== 'status');
  const records = async () => (await readdir(join(home, 'routes')).catch(() => [])).filter(name => /^[0-9a-f]{64}\.json$/.test(name));
  return { home, run, gozar, provider: provider_, edit, target, request, mutations, records, origin: `https://${dnsName}:8443` };
}
const foreignRule = (port, proxy) => ({ config }) => {
  (config.TCP ??= {})[port] = { HTTPS: true };
  (config.Web ??= {})[`${dnsName}:${port}`] = { Handlers: { '/': { Proxy: proxy } } };
};

// Allocation and pinning

test('1. ensure creates a --bg rule, writes a receipt, verifies through the challenge, and records gozar-owned', async t => {
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
  assert.deepEqual(await w.mutations(), [['funnel', '--bg', '--yes', '--https=8443', '--set-path=/', `http://${w.target}`]]);
  // The record carries intent and a receipt with the exact provider rule and is private.
  const [name] = await w.records();
  const path = join(w.home, 'routes', name);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const record = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(record.intent, { dnsName, port: 8443, mode: 'funnel', origin: w.origin,
    rule: { tcp: { HTTPS: true }, web: { Handlers: { '/': { Proxy: `http://${w.target}` } } }, funnel: true } });
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
});

test('2. a second ensure with the same tuple reuses the rule and makes no mutation', async t => {
  const w = await world(t);
  const first = await w.run('ensure', w.request);
  const second = await w.run('ensure', w.request);
  assert.equal(second.result.route.state, 'usable');
  assert.equal(second.result.route.origin, first.result.route.origin);
  assert.equal(second.result.route.createdAt, first.result.route.createdAt);
  assert.equal((await w.mutations()).length, 1);
});

test('3. a pinned origin with a different node DNS name gives address_changed and no mutation', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await w.edit(state => { state.dnsName = 'renamed.tailnet.test'; });
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'address_changed');
  assert.equal((await w.mutations()).length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'address_changed');
});

test('4. a readback mismatch after creation removes only its own rule and gives address_changed', { todo: 'G1: readback mismatch currently leaves the rule as uncertain; removal needs ownership continuity for a just-created rule' }, async t => {
  const w = await world(t, { createProxy: 'http://127.0.0.1:1', config: {} });
  await w.edit(foreignRule(10000, 'http://127.0.0.1:2'));
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'address_changed');
  const { config } = await w.provider();
  assert.equal(config.Web[`${dnsName}:8443`], undefined);
  assert.deepEqual(config.Web[`${dnsName}:10000`], { Handlers: { '/': { Proxy: 'http://127.0.0.1:2' } } });
});

test('5. occupied port is refused and the foreign rule is untouched', async t => {
  const w = await world(t);
  await w.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const before = (await w.provider()).config;
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'port_occupied');
  assert.deepEqual((await w.provider()).config, before);
  assert.deepEqual(await w.mutations(), []);
  assert.deepEqual(await w.records(), []);
  // With another permitted port free, the occupied one is skipped, never replaced.
  await w.edit(state => { state.funnelPorts = [8443, 10000]; });
  const created = await w.run('ensure', w.request);
  assert.equal(created.result.route.origin, `https://${dnsName}:10000`);
  assert.deepEqual((await w.provider()).config.Web[`${dnsName}:8443`], before.Web[`${dnsName}:8443`]);
});

test('6. restart with an omitted origin uses the recorded pin; a conflicting origin or adapter is refused', async t => {
  const w = await world(t);
  const created = await w.run('ensure', w.request);
  const again = await w.run('ensure', { ...w.request, approvals: [] });
  assert.equal(again.result.route.origin, created.result.route.origin);
  assert.equal((await w.run('ensure', { ...w.request, origin: `https://${dnsName}:10000` })).error.code, 'origin_changed');
  assert.equal((await w.run('ensure', { ...w.request, adapterId: 'tailscale-private' })).error.code, 'adapter_changed');
  assert.equal((await w.mutations()).length, 1);
});

test('7. a saved lost record is restored only at the pinned origin and never re-allocated unpinned', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  await w.run('ensure', w.request);
  await w.edit(state => { state.config = {}; });
  assert.equal((await w.run('status', {})).result.routes[0].state, 'lost');
  const restored = await w.run('ensure', w.request);
  assert.equal(restored.result.route.state, 'usable');
  assert.equal(restored.result.route.origin, w.origin);
  // Lost again, and another program now holds the pinned port: refused, not moved to 10000.
  // The foreign rule does not match the receipt, so the route reports uncertain, not lost.
  await w.edit(state => { state.config = {}; foreignRule(8443, 'http://127.0.0.1:9')(state); });
  assert.equal((await w.run('ensure', w.request)).error.code, 'uncertain');
  assert.deepEqual((await w.provider()).config.Web[`${dnsName}:8443`], { Handlers: { '/': { Proxy: 'http://127.0.0.1:9' } } });
  assert.equal((await w.provider()).config.Web[`${dnsName}:10000`], undefined);
});

test('8. an adapter without addressStability stable, or a lifetimeMs, refuses a durable route', async t => {
  const w = await world(t);
  const relay = await w.run('ensure', { ...w.request, adapterId: 'localhost-run', approvals: [{ ...w.request.approvals[0], adapterId: 'localhost-run' }] });
  assert.equal(relay.error.code, 'adapter_not_durable');
  assert.equal((await w.run('ensure', { ...w.request, lifetimeMs: 60000 })).error.code, 'durable_lifetime_unsupported');
  assert.deepEqual(await w.mutations(), []);
});

// Consent

test('9. a changed approval tuple is refused', async t => {
  const w = await world(t);
  assert.equal((await w.run('ensure', { ...w.request, approvals: [] })).error.code, 'consent_required');
  assert.equal((await w.run('ensure', { ...w.request, approvals: [{ ...w.request.approvals[0], durable: false }] })).error.code, 'consent_required');
  await w.run('ensure', w.request);
  assert.equal((await w.run('ensure', { ...w.request, target: '127.0.0.1:1' })).error.code, 'consent_changed');
  assert.equal((await w.mutations()).length, 1);
});

test('10. fallback to another adapter only on a first allocation, and only with its own approved tuple', { todo: 'G1: adapter fallback is not implemented in the spike' }, async t => {
  const w = await world(t, { funnelPorts: [] });
  const funnelOnly = await w.run('ensure', w.request);
  assert.equal(funnelOnly.error.code, 'port_occupied');
  const approvals = [w.request.approvals[0], { adapterId: 'tailscale-private', target: w.target, origin: null, durable: true }];
  const fallback = await w.run('ensure', { ...w.request, approvals });
  assert.equal(fallback.result.route.adapterId, 'tailscale-private');
  // A pinned route never changes adapter, even with approval.
  await w.edit(state => { state.config = {}; state.funnelPorts = [8443]; });
  const pinned = await w.run('ensure', { ...w.request, approvals });
  assert.equal(pinned.result.route.adapterId, 'tailscale-private');
});

// Crashes and races

test('11. crash after intent, before the command, gives lost', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  assert.equal((await w.records()).length, 1);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'lost');
  assert.equal(status.result.routes[0].origin, null);
  assert.deepEqual((await w.provider()).config, {});
});

test('12. crash after intent, then an identical foreign rule appears: uncertain, not claimed, not removed', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  await w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const foreign = (await w.provider()).config;
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'uncertain');
  assert.equal(status.result.routes[0].verification, null);
  assert.equal((await w.run('ensure', w.request)).error.code, 'uncertain');
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.removed, true);
  assert.equal(released.result.providerRemoved, false);
  assert.deepEqual(released.result.cleanupDebt, { reason: 'unattributed-rule', port: 8443 });
  assert.deepEqual((await w.provider()).config, foreign);
  assert.equal((await w.mutations()).filter(args => args.at(-1) === 'off').length, 0);
});

test('13. crash after the command, before the receipt, gives uncertain', async t => {
  const w = await world(t, { crash: 'after-apply' });
  assert.equal((await w.run('ensure', w.request)).crashed, 'SIGKILL');
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
  const record = JSON.parse(await readFile(join(w.home, 'routes', (await w.records())[0]), 'utf8'));
  assert.equal(record.receipt, null);
});

test('14. release with a changed rule keeps cleanup debt and the record, and leaves the foreign rule untouched', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await w.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const changed = (await w.provider()).config;
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: false, providerRemoved: false, cleanupDebt: { reason: 'rule-changed', port: 8443 } });
  assert.deepEqual((await w.provider()).config, changed);
  assert.equal((await w.records()).length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'releasing');
});

test('14. an edit between readback and removal makes the conditional removal fail', { todo: 'G1: the Tailscale CLI exposes no serve-config ETag; conditional removal needs LocalAPI If-Match' }, async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  // The fake bumps its ETag on this edit; a conditional removal must observe the change.
  await w.edit(state => { state.raceBeforeOff = { proxy: 'http://127.0.0.1:9' }; });
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.removed, false);
  assert.equal(released.result.cleanupDebt.reason, 'etag-mismatch');
  assert.deepEqual((await w.provider()).config.Web[`${dnsName}:8443`], { Handlers: { '/': { Proxy: 'http://127.0.0.1:9' } } });
});

test('15. release racing a late create or verification does not re-publish the route and keeps debt', { todo: 'G1: the spike holds the reservation lock through create; a concurrent release is refused as busy, not fenced' }, async t => {
  const w = await world(t);
  await w.edit(state => { state.createDelayMs = 500; });
  const [created, released] = await Promise.all([w.run('ensure', w.request), w.run('release', { routeId: 'coordinator' })]);
  assert.notEqual(created.result?.route.state, 'usable');
  assert.equal(released.result.removed, false);
  assert.ok(released.result.cleanupDebt);
  assert.notEqual((await w.run('status', {})).result.routes[0]?.state, 'usable');
});

test('16. concurrent ensure, adopt and session for one listener or port with distinct origins: exactly one wins', { todo: 'G1: no reservation table yet; sessions and adoption do not take the reservation lock' }, async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  // Sequential: a second route ID for the same listener is refused, not given a second port.
  await w.run('ensure', w.request);
  assert.equal((await w.run('ensure', { ...w.request, routeId: 'second' })).error?.code, 'reserved');
  await w.run('release', { routeId: 'coordinator' });
  // Concurrent: exactly one claim on the listener wins, whichever operation makes it.
  const replies = await Promise.all([
    w.run('ensure', w.request),
    w.run('ensure', { ...w.request, routeId: 'second' }),
    w.run('adopt', { routeId: 'third', adapterId: 'tailscale-funnel', target: w.target, origin: `https://${dnsName}:10000` }),
  ]);
  assert.equal(replies.filter(reply => reply.result).length, 1);
  assert.equal(Object.keys((await w.provider()).config.Web ?? {}).length, 1);
});

test('17. removeService on a gozar-owned record is refused', { todo: 'G1: statusServices/removeService do not see durable records yet' }, async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const reply = await w.run('removeService', { origin: w.origin });
  assert.match(reply.error.message, /releaseRoute/);
  assert.equal((await w.records()).length, 1);
});

// Adoption

test('18. adopt of an exact rule with a handover makes no provider mutation and records adopted; mismatch, missing handover or a change during verification is refused', { todo: 'G1: adoptRoute is not implemented' }, async t => {
  const w = await world(t);
  await w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const claim = { dnsName, port: 8443, mode: 'funnel', target: `http://${w.target}` };
  const base = { routeId: 'coordinator', owner: 'example-app', adapterId: 'tailscale-funnel', target: w.target, origin: w.origin, claim,
    approvals: [{ adapterId: 'tailscale-funnel', target: w.target, origin: w.origin, durable: true }] };
  assert.equal((await w.run('adopt', base)).error.code, 'handover_required');
  assert.equal((await w.run('adopt', { ...base, claim: { ...claim, port: 443 }, handover: { from: 'example-app', generation: 1 } })).error.code, 'claim_mismatch');
  const adopted = await w.run('adopt', { ...base, handover: { from: 'example-app', generation: 1 } });
  assert.equal(adopted.result.route.state, 'usable');
  assert.equal(adopted.result.route.provenance, 'adopted');
  assert.deepEqual(await w.mutations(), []);
});

test('19. adopt while the reservation table holds the listener or port is refused', { todo: 'G1: adoptRoute and the reservation table are not implemented' }, async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const reply = await w.run('adopt', { routeId: 'other', owner: 'example-app', adapterId: 'tailscale-funnel', target: w.target, origin: w.origin,
    claim: { dnsName, port: 8443, mode: 'funnel', target: `http://${w.target}` }, handover: { from: 'example-app', generation: 1 } });
  assert.equal(reply.error.code, 'reserved');
});

test('20. hand-back then re-adopt with a newer generation keeps exactly one owner at every step', { todo: 'G1: hand-back and adoptRoute are not implemented' }, async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const back = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.equal(back.result.claim.port, 8443);
  assert.deepEqual(await w.records(), []);
  assert.equal((await w.mutations()).filter(args => args.at(-1) === 'off').length, 0);
  const again = await w.run('adopt', { ...w.request, origin: w.origin, claim: back.result.claim, handover: { from: 'example-app', generation: 2 } });
  assert.equal(again.result.route.state, 'usable');
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

test('22. gozar stop --route ID removes the provider rule by compare-and-remove and deletes the record; a changed rule is left as cleanup debt', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  const stopped = await w.gozar('stop', '--route', 'coordinator', '--json');
  assert.equal(stopped.code, 0, stopped.stdout);
  assert.deepEqual(stopped.json, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null });
  assert.deepEqual((await w.provider()).config, {});
  assert.deepEqual(await w.records(), []);
  assert.deepEqual((await w.mutations()).at(-1), ['serve', '--https=8443', 'off']);

  const changed = await world(t);
  await changed.run('ensure', changed.request);
  await changed.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const foreign = (await changed.provider()).config;
  const text = await changed.gozar('stop', '--route', 'coordinator');
  assert.equal(text.code, 1);
  assert.match(text.stdout, /not removed.*Cleanup debt: rule-changed on port 8443.*left in place/);
  assert.deepEqual((await changed.provider()).config, foreign);
  assert.equal((await changed.records()).length, 1);
  assert.equal((await changed.gozar('status', '--json')).json.durableRoutes[0].cleanupDebt.reason, 'rule-changed');
});

test('23. after gozar stop --route ID, ensureRoute is refused with stopped_by_user and makes no mutation; reconsent: true creates it again', async t => {
  const w = await world(t);
  await w.run('ensure', w.request);
  await w.gozar('stop', '--route', 'coordinator');
  const before = (await w.mutations()).length;
  const refused = await w.run('ensure', w.request);
  assert.equal(refused.error.code, 'stopped_by_user');
  assert.equal((await w.mutations()).length, before);
  const again = await w.run('ensure', { ...w.request, reconsent: true });
  assert.equal(again.result.route.state, 'usable');
  assert.equal(again.result.route.origin, w.origin);
  // The re-consented call clears the stop; the next ordinary ensure reuses the route.
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
});
