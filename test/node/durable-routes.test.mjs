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
import { portHolders, reserveSession } from '../../packages/gozar-node/durable-route.mjs';
import { selectAdoptable } from '../../adapters/providers/_shared/tailscale-adopt.mjs';
import { redeemConsentToken, consentBinding } from '../../packages/gozar-node/consent-token.mjs';
import { startFakeLocalApi, forwardTarget } from './fake-localapi.mjs';

const exec = promisify(execFile);
const here = path => fileURLToPath(new URL(path, import.meta.url));
const cli = here('../../bin/gozar.mjs'), runner = here('./durable-runner.mjs'), network = here('./durable-network.mjs');
const packageUrl = name => here(`../../packages/gozar-node/${name}`);
const requirements = { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [] };
const dnsName = 'node.tailnet.test';
const listen = (server, port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
let root, certificate, helper;

before(async () => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  root = await mkdtemp(join(homedir(), '.tmp', 'gozar-durable-'));
  certificate = { cert: join(root, 'cert.pem'), key: join(root, 'key.pem') };
  // Operations the shared runner does not have: mint a consent token (what the catalog does), read
  // plan facts, inspect a legacy route. Each runs in a fresh process like every other operation.
  helper = join(root, 'helper-runner.mjs');
  await writeFile(helper, `import { durablePlanFacts } from ${JSON.stringify(packageUrl('durable-route.mjs'))};
import { issueConsentToken, consentBinding } from ${JSON.stringify(packageUrl('consent-token.mjs'))};
import { inspectLegacyRoute } from ${JSON.stringify(packageUrl('legacy-import.mjs'))};
import { canonicalHome } from ${JSON.stringify(packageUrl('service-state.mjs'))};
const [operation, input] = process.argv.slice(2);
const args = JSON.parse(input);
try {
  let result;
  if (operation === 'issue') {
    const { home, query, adapterId, intent, disclosureRevision, grant: override, ttlMs } = args;
    const facts = override?.skipFacts ? {} : await durablePlanFacts({ home, adapterId, target: query.target, origin: query.origin ?? null });
    const grant = { adapterId, planDigest: facts.planDigest, observedResource: facts.observedResource, ...override };
    delete grant.skipFacts;
    const binding = consentBinding({ ...query, intent }, await canonicalHome(home, true), disclosureRevision);
    result = { ...await issueConsentToken({ home, binding, grant, ttlMs }), grant };
  } else if (operation === 'facts') result = await durablePlanFacts(args);
  else if (operation === 'inspect') result = await inspectLegacyRoute(args);
  else throw Object.assign(new Error(operation + ' is not implemented'), { code: 'not_implemented' });
  console.log(JSON.stringify({ result }));
} catch (error) {
  console.log(JSON.stringify({ error: { code: error.code ?? null, message: error.message, provider: error.provider ?? null, nextAction: error.nextAction ?? null } }));
}
`);
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
  // 9443 is the private Serve adapter's adopt-only legacy slot (test 32).
  for (const port of [443, 8443, 9443, 10000]) {
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
  const helperOperations = new Set(['issue', 'facts', 'inspect']);
  const run = async (operation, input = {}, extraEnv) => {
    const reply = await child([helperOperations.has(operation) ? helper : runner, operation, JSON.stringify({ home, ...input })], extraEnv);
    return reply.signal ? { crashed: reply.signal } : JSON.parse(reply.stdout);
  };
  const gozar = async (...args) => {
    const reply = await child([cli, ...args]);
    return { code: reply.code, signal: reply.signal, stdout: reply.stdout, json: args.includes('--json') && !reply.signal ? JSON.parse(reply.stdout) : null };
  };
  const target = `127.0.0.1:${app.address().port}`;
  // The consumer contract's request: a Query with durable usage, and no adapter. Approval comes from `mint`.
  const query = (extra = {}) => ({ schemaVersion: 1, owner: 'example-app', target, usage: { kind: 'durable', routeId: 'coordinator' }, requirements, home, ...extra });
  const request = query();
  // What the catalog does: observe, then issue a single-use token whose grant names the adapter.
  const mint = async (extra = {}, { adapterId = 'tailscale-funnel', intent = 'create', disclosureRevision = 'disclosure-1', grant, ttlMs } = {}) => {
    const q = query(extra);
    const reply = await run('issue', { query: q, adapterId, intent, disclosureRevision, grant, ttlMs });
    if (reply.error) throw Object.assign(new Error(reply.error.message), reply.error);
    return { query: q, approval: { candidateToken: reply.result.token, disclosureRevision }, grant: reply.result.grant };
  };
  const ensure = async (extra = {}, options) => { const m = await mint(extra, options); return run('ensure', { ...m.query, approval: m.approval }); };
  const adopt = async (extra = {}, options) => {
    const m = await mint({ origin: origin(), ...extra }, { intent: 'adopt', ...options });
    return run('adopt', { ...m.query, handover: { from: 'example-app', generation: 1 }, approval: m.approval });
  };
  const origin = () => `https://${dnsName}:8443`;
  const records = async () => (await readdir(join(home, 'routes')).catch(() => [])).filter(name => /^[0-9a-f]{64}\.json$/.test(name));
  const record = async () => JSON.parse(await readFile(join(home, 'routes', (await records())[0]), 'utf8'));
  const cliCalls = async () => (await readFile(cliLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const edit = change => { change(state); state.etag++; };
  return { home, run, gozar, state, provider: async () => state, edit, target, request, query, mint, ensure, adopt, records, record, cliCalls, app,
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
  const created = await w.ensure();
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
  // The grant named the adapter; the record pins it with the digest of the plan the user approved.
  assert.equal(record.adapterId, 'tailscale-funnel');
  assert.match(record.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(record).includes('candidateToken'), false);
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
  const first = await w.ensure();
  // A later identical ensure needs no token: the record is the pin.
  const second = await w.run('ensure', w.request);
  assert.equal(second.result.route.state, 'usable');
  assert.equal(second.result.route.origin, first.result.route.origin);
  assert.equal(second.result.route.createdAt, first.result.route.createdAt);
  assert.equal(w.writes().length, 1);
});

test('3. a pinned origin with a different node DNS name gives address_changed and no mutation', async t => {
  const w = await world(t);
  await w.ensure();
  w.state.dnsName = 'renamed.tailnet.test';
  const reply = await w.run('ensure', w.request);
  assert.equal(reply.error.code, 'address_changed');
  assert.equal(w.writes().length, 1);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'address_changed');
});

test('3b. after a node rename, release removes the rule under the recorded name', async t => {
  const w = await world(t);
  await w.ensure();
  w.state.dnsName = 'renamed.tailnet.test';
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.deepEqual(released.result, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null });
  assert.deepEqual((await w.provider()).config, {});
  assert.deepEqual(await w.records(), []);
});

test('3c. after a node rename, an equal rule another program wrote under the new name survives release', async t => {
  const w = await world(t);
  await w.ensure();
  const port = Number(new URL(w.origin).port || 443);
  w.edit(state => {
    state.dnsName = 'renamed.tailnet.test';
    state.config.Web[`renamed.tailnet.test:${port}`] = structuredClone(state.config.Web[`${dnsName}:${port}`]);
  });
  const theirs = structuredClone(w.state.config.Web[`renamed.tailnet.test:${port}`]);
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.providerRemoved, true);
  const config = (await w.provider()).config;
  assert.equal(config.Web?.[`${dnsName}:${port}`], undefined, 'our rule under the recorded name is gone');
  assert.deepEqual(config.Web[`renamed.tailnet.test:${port}`], theirs, 'their equal rule under the new name is untouched');
});

test('4. a readback mismatch after creation leaves the listener in place as cleanup debt and publishes nothing', async t => {
  // The listener on the pinned port differs after our write: another program may have replaced
  // it, so Gozar cannot attribute it and must not remove it.
  const w = await world(t, { createProxy: 'http://127.0.0.1:1' });
  w.edit(foreignRule(10000, 'http://127.0.0.1:2'));
  const reply = await w.ensure();
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
  const reply = await w.ensure();
  assert.equal(reply.error.code, 'port_occupied');
  assert.deepEqual(w.state.config, before);
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.records(), []);
  // With another permitted port free, the occupied one is skipped, never replaced.
  w.state.funnelPorts = [8443, 10000];
  const created = await w.ensure();
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
  assert.equal((await w.ensure()).result.route.state, 'usable');
  w.edit(state => { delete state.config.TCP; });
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
  // Private adapter: no AllowFunnel anywhere in what it writes.
  const p = await world(t);
  const created = await p.ensure({}, { adapterId: 'tailscale-private' });
  assert.equal(created.result.route.state, 'usable');
  assert.ok(p.writes().every(config => config.AllowFunnel === undefined));
});

test('6. restart with an omitted origin uses the recorded pin; a conflicting origin is refused; a different preference never moves the pin', async t => {
  const w = await world(t);
  const created = await w.ensure();
  const again = await w.run('ensure', w.request);
  assert.equal(again.result.route.origin, created.result.route.origin);
  assert.equal((await w.run('ensure', { ...w.request, origin: `https://${dnsName}:10000` })).error.code, 'origin_changed');
  // Preference or catalog order changed: the catalog now offers the other adapter first, and the app
  // passes that token. The pin wins; no write happens, and the unused token is not spent.
  const other = await w.mint({}, { adapterId: 'tailscale-private' });
  const kept = await w.run('ensure', { ...other.query, approval: other.approval });
  assert.equal(kept.result.route.adapterId, 'tailscale-funnel');
  assert.equal(kept.result.route.origin, w.origin);
  assert.equal(w.writes().length, 1);
  assert.equal((await w.record()).adapterId, 'tailscale-funnel');
  const binding = consentBinding(other.query, w.home, other.approval.disclosureRevision);
  assert.equal((await redeemConsentToken({ home: w.home, token: other.approval.candidateToken, binding })).adapterId, 'tailscale-private');
});

test('7. a saved lost record is restored only at the pinned origin and never re-allocated unpinned', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  await w.ensure();
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

test('7. a lost record is restored only with the listener the user approved: a changed plan digest gives adapter_changed and writes nothing', async t => {
  const w = await world(t);
  await w.ensure();
  w.edit(state => { state.config = {}; });
  const path = join(w.home, 'routes', (await w.records())[0]);
  await writeFile(path, JSON.stringify({ ...(await w.record()), planDigest: 'sha256:' + '0'.repeat(64) }));
  assert.equal((await w.run('ensure', w.request)).error.code, 'adapter_changed');
  assert.equal(w.writes().length, 1);
  assert.deepEqual(w.state.config, {});
});

test('8. an adapter with no durable recipe gives no plan facts and no token use; a finite usage is refused', async t => {
  const w = await world(t);
  const facts = await w.run('facts', { adapterId: 'localhost-run', target: w.target });
  assert.equal(facts.error.code, 'provider_unsupported');
  // A token granted for such an adapter (forged grant) cannot create anything.
  const forged = await w.ensure({}, { adapterId: 'localhost-run', grant: { skipFacts: true, planDigest: 'sha256:x', observedResource: 'sha256:y' } });
  assert.equal(forged.error.code, 'adapter_not_durable');
  assert.equal((await w.run('ensure', { ...w.request, usage: { kind: 'session', lifetimeMs: 60000 } })).error.code, 'durable_lifetime_unsupported');
  assert.equal((await w.run('ensure', { ...w.request, usage: { kind: 'attached' } })).error.code, 'invalid_input');
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.records(), []);
});

// Consent

test('9. a new route needs an approval; a changed tuple on an existing route is refused', async t => {
  const w = await world(t);
  assert.equal((await w.run('ensure', w.request)).error.code, 'consent_required');
  await w.ensure();
  assert.equal((await w.run('ensure', { ...w.request, target: '127.0.0.1:1' })).error.code, 'consent_changed');
  assert.equal((await w.run('ensure', { ...w.request, owner: 'other-app' })).error.code, 'consent_changed');
  assert.equal(w.writes().length, 1);
});

test('10. a catalog order that offers the other adapter never moves a pin, even when Funnel is available again', async t => {
  const w = await world(t, { funnelPorts: [] });
  // No Funnel port is permitted: the funnel candidate cannot be allocated. The catalog offers the private one.
  const funnelOnly = await w.ensure();
  assert.equal(funnelOnly.error.code, 'port_occupied');
  assert.deepEqual(w.writes(), []);
  const created = await w.ensure({}, { adapterId: 'tailscale-private' });
  assert.equal(created.result.route.adapterId, 'tailscale-private');
  // Funnel is available again and the catalog now ranks it first: the pin stays.
  w.edit(state => { state.config = {}; state.funnelPorts = [8443]; });
  const pinned = await w.ensure();
  assert.equal(pinned.result.route.adapterId, 'tailscale-private');
  assert.ok(w.writes().every(config => config.AllowFunnel === undefined));
});

// Crashes and races

test('11. crash after intent, before the provider write, gives lost', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.ensure()).crashed, 'SIGKILL');
  assert.equal((await w.records()).length, 1);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'lost');
  assert.equal(status.result.routes[0].origin, null);
  assert.deepEqual(w.state.config, {});
});

test('12. crash after intent, then an identical foreign rule appears: uncertain, not claimed, not removed, kept visible as debt', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.ensure()).crashed, 'SIGKILL');
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
  await again.ensure();
  again.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  await again.run('release', { routeId: 'coordinator' });
  again.edit(state => { state.config = {}; });
  assert.equal((await again.run('release', { routeId: 'coordinator' })).result.removed, true);
  assert.deepEqual(await again.records(), []);
});

test('13. crash after the provider write, before the receipt, gives uncertain', async t => {
  const w = await world(t, { crash: 'after-apply' });
  assert.equal((await w.ensure()).crashed, 'SIGKILL');
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
  assert.equal((await w.record()).receipt, null);
});

test('13. crash after the receipt, before verification: the next ensure verifies the pinned origin and publishes it', async t => {
  const w = await world(t);
  // The app is not answering during the first ensure: the receipt is written, verification fails.
  const port = w.app.address().port;
  await close(w.app);
  const first = await w.ensure();
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
  await w.ensure();
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
  await w.ensure();
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
  const minted = await w.mint();
  const ensuring = w.run('ensure', { ...minted.query, approval: minted.approval });
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
  const lateMint = await slow.mint({ target });
  const late = slow.run('ensure', { ...lateMint.query, approval: lateMint.approval });
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
  await w.ensure();
  assert.equal((await w.run('ensure', { ...w.request, usage: { kind: 'durable', routeId: 'second' } })).error?.code, 'reserved');
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
  const first = await w.mint(), second = await w.mint({ usage: { kind: 'durable', routeId: 'second' } });
  const third = await w.mint({ usage: { kind: 'durable', routeId: 'third' }, origin: adoptOrigin }, { intent: 'adopt' });
  const replies = await Promise.all([
    w.run('ensure', { ...first.query, approval: first.approval }),
    w.run('ensure', { ...second.query, approval: second.approval }),
    w.run('adopt', { ...third.query, handover: { from: 'example-app', generation: 1 }, approval: third.approval }),
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
  await w.ensure();
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
  const fenced = { handover: { from: 'example-app', generation: 1 } };
  // No fenced old owner: refused before any token is used.
  const unfenced = await w.mint({ origin: w.origin }, { intent: 'adopt' });
  assert.equal((await w.run('adopt', { ...unfenced.query, approval: unfenced.approval })).error.code, 'handover_required');
  for (const handover of [{ from: 'example-app' }, { from: 'example-app', generation: 0 }, { generation: 1 }, { from: '', generation: 1 }])
    assert.equal((await w.run('adopt', { ...unfenced.query, approval: unfenced.approval, handover })).error.code, 'handover_required', JSON.stringify(handover));
  assert.equal((await w.run('adopt', { ...unfenced.query, approval: unfenced.approval, origin: `https://${dnsName}`, ...fenced })).error.code, 'claim_mismatch');
  assert.deepEqual(await w.records(), []);
  // The rule changes while the challenge runs: refused, nothing recorded.
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => {
    if (req.url.startsWith('/.well-known/gozar/service') && req.headers.host === `${dnsName}:8443`) w.edit(state => { state.config.Web[`${dnsName}:8443`].Handlers['/'].Proxy = `http://${w.target}/changed`; });
    if (!verifier(req, res)) res.end('app');
  });
  w.app.removeAllListeners('request'); w.app.on('request', (req, res) => app.emit('request', req, res));
  const changing = await w.mint({ origin: w.origin }, { intent: 'adopt' });
  assert.equal((await w.run('adopt', { ...changing.query, approval: changing.approval, ...fenced })).error.code, 'claim_mismatch');
  assert.deepEqual(await w.records(), []);
  // Restore the exact rule and a normal app: adoption succeeds with no provider write.
  w.edit(state => { state.config.Web[`${dnsName}:8443`] = listener(`http://${w.target}`); });
  const plain = createServiceVerifier();
  w.app.removeAllListeners('request'); w.app.on('request', (req, res) => { if (!plain(req, res)) res.end('app'); });
  const adopted = await w.adopt();
  assert.equal(adopted.result.route.state, 'usable');
  assert.equal(adopted.result.route.provenance, 'adopted');
  assert.equal(adopted.result.route.adapterId, 'tailscale-funnel');
  assert.deepEqual((await w.record()).handover, { from: 'example-app', generation: 1 });
  assert.deepEqual(w.writes(), []);
});

test('18. adopt with a token granted for a different adapter than the rule\'s gives candidate_stale (claim_mismatch) and changes nothing', async t => {
  const w = await world(t);
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  // The rule is the Funnel adapter's. A token whose grant names the private adapter cannot adopt it.
  const wrong = await w.adopt({}, { adapterId: 'tailscale-private' });
  assert.equal(wrong.error.code, 'claim_mismatch');
  assert.deepEqual(await w.records(), []);
  assert.deepEqual(w.writes(), []);
  // The token was spent by the attempt; the right adapter's token adopts.
  assert.equal((await w.adopt()).result.route.state, 'usable');
});

test('18. adopt checks the migrationRef from inspectLegacyRoute when it is given', async t => {
  const w = await world(t);
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const inspected = (await w.run('inspect', { owner: 'example-app', source: { stateFiles: [] }, target: w.target, origin: w.origin })).result;
  assert.equal(inspected.state, 'adoptable');
  const wrong = await w.adopt({ migrationRef: 'mig_' + '0'.repeat(40) });
  assert.equal(wrong.error.code, 'claim_mismatch');
  assert.deepEqual(await w.records(), []);
  // A reference for another target is as wrong: it names a different route.
  const other = (await w.run('inspect', { owner: 'example-app', source: { stateFiles: [] }, target: '127.0.0.1:1' })).result;
  assert.notEqual(other.migrationRef, inspected.migrationRef);
  assert.equal((await w.adopt({ migrationRef: other.migrationRef })).error.code, 'claim_mismatch');
  assert.equal((await w.adopt({ migrationRef: inspected.migrationRef })).result.route.state, 'usable');
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
  await w.ensure();
  const reply = await w.adopt({ usage: { kind: 'durable', routeId: 'other' } });
  assert.equal(reply.error.code, 'reserved');
  // Another listener on the provider port that a record holds is refused too: a rule for another
  // target now sits on the held port, so Gozar finds it for that target and sees the port is held.
  w.edit(state => { state.config.Web[`${dnsName}:8443`].Handlers['/'].Proxy = 'http://127.0.0.1:1'; });
  const port = await w.adopt({ usage: { kind: 'durable', routeId: 'other' }, target: '127.0.0.1:1' });
  assert.equal(port.error.code, 'reserved');
  assert.equal(w.writes().length, 1);
});

test('20. hand-back then re-adopt with a newer generation keeps exactly one owner at every step', async t => {
  const w = await world(t);
  await w.ensure();
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
  const mint = await w.mint({ origin: w.origin }, { intent: 'adopt' });
  const again = await w.run('adopt', { ...mint.query, approval: mint.approval, handover: { from: 'example-app', generation: 2 } });
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
  const created = (await w.ensure()).result.route;
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
  await w.ensure();
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
  await w.ensure();
  const stopped = await w.gozar('stop', '--route', 'coordinator', '--json');
  assert.equal(stopped.code, 0, stopped.stdout);
  assert.deepEqual(stopped.json, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null, stopped: true });
  assert.deepEqual(w.state.config, {});
  assert.deepEqual(await w.records(), []);
  assert.deepEqual(w.writes().at(-1), {});

  const changed = await world(t);
  await changed.ensure();
  changed.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const foreign = structuredClone(changed.state.config);
  const text = await changed.gozar('stop', '--route', 'coordinator');
  assert.equal(text.code, 1);
  assert.match(text.stdout, /not removed.*Cleanup debt: rule-changed on port 8443.*left in place/);
  assert.deepEqual(changed.state.config, foreign);
  assert.equal((await changed.records()).length, 1);
  assert.equal((await changed.gozar('status', '--json')).json.durableRoutes[0].cleanupDebt.reason, 'rule-changed');
});

test('23. after gozar stop --route ID, ensureRoute is refused with stopped_by_user and makes no mutation; reconsent needs a fresh approval', async t => {
  const w = await world(t);
  await w.ensure();
  await w.gozar('stop', '--route', 'coordinator');
  const before = w.writes().length;
  // Neither a plain ensure nor an ensure with a fresh approval but no reconsent clears the stop.
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
  const fresh = await w.mint();
  assert.equal((await w.run('ensure', { ...fresh.query, approval: fresh.approval })).error.code, 'stopped_by_user');
  // Reconsent without an approval is consent_required.
  assert.equal((await w.run('ensure', { ...w.request, reconsent: true })).error.code, 'consent_required');
  assert.equal(w.writes().length, before);
  // The refusals did not spend the token: the same one clears the stop together with reconsent.
  const again = await w.run('ensure', { ...fresh.query, approval: fresh.approval, reconsent: true });
  assert.equal(again.result.route.state, 'usable');
  assert.equal(again.result.route.origin, w.origin);
  // The re-consented call clears the stop; the next ordinary ensure reuses the route.
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  assert.deepEqual((await w.run('status', {})).result.stoppedRoutes, []);
});

// LocalAPI contract

test('24. a foreign edit between GET and POST gives 412 on create and on remove; Gozar re-reads and never overwrites or deletes it', async t => {
  // Create: the foreign rule takes the only permitted port between Gozar's read and write.
  const w = await world(t);
  const minted = await w.mint();
  w.state.beforePost = foreignRule(8443, 'http://127.0.0.1:9');
  assert.equal((await w.run('ensure', { ...minted.query, approval: minted.approval })).error.code, 'port_occupied');
  assert.deepEqual(w.state.config.Web, { [`${dnsName}:8443`]: listener('http://127.0.0.1:9') });
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.records(), []);
  // With another port permitted, the approval was for 8443: a foreign edit that takes it makes the
  // approval stale. Gozar does not quietly publish at 10000; the foreign rule survives.
  const moved = await world(t, { funnelPorts: [8443, 10000] });
  const approved = await moved.mint();
  moved.state.beforePost = foreignRule(8443, 'http://127.0.0.1:9');
  assert.equal((await moved.run('ensure', { ...approved.query, approval: approved.approval })).error.code, 'claim_mismatch');
  assert.deepEqual(moved.state.config.Web, { [`${dnsName}:8443`]: listener('http://127.0.0.1:9') });
  assert.deepEqual(moved.writes(), []);
  assert.deepEqual(await moved.records(), []);
  // A foreign edit on an unrelated port between read and write is a 412 too, but the approval is
  // still true: Gozar re-reads, re-decides, writes conditionally on the new read, and the edit survives.
  const unrelated = await world(t);
  const kept = await unrelated.mint();
  unrelated.state.beforePost = foreignRule(443, 'http://127.0.0.1:8');
  const made = await unrelated.run('ensure', { ...kept.query, approval: kept.approval });
  assert.equal(made.result.route.origin, unrelated.origin);
  assert.deepEqual(unrelated.state.config.Web[`${dnsName}:443`], listener('http://127.0.0.1:8'));
  assert.deepEqual(unrelated.state.config.Web[`${dnsName}:8443`], listener(`http://${unrelated.target}`));
  assert.equal(unrelated.writes().length, 1);
  // Remove: a foreign edit on another listener; the retry is conditional on the new read, so it survives.
  moved.state.config = {}; moved.state.etag++;
  const again = await moved.ensure();
  assert.equal(again.result.route.origin, `https://${dnsName}:8443`);
  moved.state.beforePost = foreignRule(443, 'http://127.0.0.1:8');
  const released = await moved.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.providerRemoved, true);
  assert.deepEqual(moved.state.config, { TCP: { 443: { HTTPS: true } }, Web: { [`${dnsName}:443`]: listener('http://127.0.0.1:8') } });
  // A program that keeps changing the config: bounded attempts, then a typed conflict, no write.
  const busy = await world(t);
  busy.state.beforePost = state => { state.config.Services = { [`svc:${state.etag}`]: {} }; };
  busy.state.beforePostAlways = true;
  const conflicted = (await busy.ensure()).error;
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
    // The catalog issued the token while the provider was healthy.
    w.state.failure = null;
    const minted = await w.mint();
    w.state.failure = failure;
    const reply = await w.run('ensure', { ...minted.query, approval: minted.approval }, env);
    assert.equal(reply.error.code, code, failure ?? 'missing socket');
    assert.equal(reply.error.provider, 'tailscale');
    assert.equal(reply.error.nextAction, nextAction);
    assert.match(reply.error.message, /start tailscaled|tailscale set --operator|upgrade tailscaled/);
  }
  w.state.failure = null;
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(await w.cliCalls(), []);
  // Removal fails closed the same way: the record stays and nothing is written.
  await w.ensure();
  w.state.failure = 'no-etag';
  assert.equal((await w.run('release', { routeId: 'coordinator' })).error.code, 'provider_unsupported');
  assert.equal((await w.records()).length, 1);
  assert.equal(w.writes().length, 1);
  assert.deepEqual(await w.cliCalls(), []);
});

// Sticky stop

test('27. a user stop survives app release in every mode and a restart; it clears only with reconsent plus a fresh approval, or gozar allow; a crash mid-stop still blocks', async t => {
  const w = await world(t);
  await w.ensure();
  await w.gozar('stop', '--route', 'coordinator');
  for (const mode of ['remove', 'hand-back', 'dismiss']) await w.run('release', { routeId: 'coordinator', mode });
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
  w.edit(state => { foreignRule(8443, `http://${w.target}`)(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const writesBefore = w.writes().length;
  // Adopt: an approval without reconsent is stopped_by_user, reconsent without an approval is
  // consent_required, and neither spends the token. Both together adopt and clear the stop.
  const mint = await w.mint({ origin: w.origin }, { intent: 'adopt' });
  const handover = { from: 'example-app', generation: 1 };
  assert.equal((await w.run('adopt', { ...mint.query, approval: mint.approval, handover })).error.code, 'stopped_by_user');
  assert.equal((await w.run('adopt', { ...mint.query, reconsent: true, handover })).error.code, 'consent_required');
  assert.equal((await w.records()).length, 0);
  const listed = await w.gozar('status', '--json');
  assert.equal(listed.json.stoppedRoutes[0].routeId, 'coordinator');
  const adopted = await w.run('adopt', { ...mint.query, approval: mint.approval, reconsent: true, handover });
  assert.equal(adopted.result.route.provenance, 'adopted');
  assert.deepEqual((await w.gozar('status', '--json')).json.stoppedRoutes, []);
  assert.equal(w.writes().length, writesBefore);
  // Stop again: a second user stop, now with no provider rule left to remove first.
  await w.gozar('stop', '--route', 'coordinator');
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
  // Allow asks for durable consent; --yes approves it.
  const refusedAllow = await w.gozar('allow', '--route', 'coordinator');
  assert.notEqual(refusedAllow.code, 0);
  const allowed = await w.gozar('allow', '--route', 'coordinator', '--yes');
  assert.equal(allowed.code, 0, allowed.stdout);
  assert.match(allowed.stdout, /whether or not .* is running/);
  assert.equal((await w.ensure()).result.route.state, 'usable');
  // Crash during gozar stop after the tombstone write and before the provider write.
  w.state.crash = 'before-apply';
  assert.equal((await w.gozar('stop', '--route', 'coordinator')).signal, 'SIGKILL');
  assert.equal((await w.run('ensure', w.request)).error.code, 'stopped_by_user');
  // The record is still there beside the tombstone. Reconsent alone must not clear the stop on the
  // strength of that record: a fresh approval is still required.
  assert.equal((await w.records()).length, 1);
  const afterCrash = w.writes().length;
  assert.equal((await w.run('ensure', { ...w.request, reconsent: true })).error.code, 'consent_required');
  assert.equal(w.writes().length, afterCrash);
  assert.equal((await w.gozar('status', '--json')).json.stoppedRoutes[0].routeId, 'coordinator');
});

// Hand-back

test('28. a crash around hand-back keeps the route listed as handing-back with its receipt and reservation; a retry returns the same claim and transfer', async t => {
  const w = await world(t);
  await w.ensure();
  const first = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  // A lost reply or a crash before confirmation: the retry returns the same values.
  const retry = await w.run('release', { routeId: 'coordinator', mode: 'hand-back' });
  assert.deepEqual(retry.result, first.result);
  const status = await w.run('status', {});
  assert.equal(status.result.routes[0].state, 'handing-back');
  assert.deepEqual(status.result.routes[0].handBack, { transfer: first.result.transfer, claim: first.result.claim });
  assert.ok((await w.record()).receipt);
  // The reservation holds: another route for that listener is refused.
  assert.equal((await w.run('ensure', { ...w.request, usage: { kind: 'durable', routeId: 'other' } })).error.code, 'reserved');
  // Cancel returns it to its previous state.
  const cancelled = await w.run('cancelHandBack', { routeId: 'coordinator', transfer: first.result.transfer });
  assert.equal(cancelled.result.route.state, 'usable');
  assert.equal((await w.run('ensure', w.request)).result.route.state, 'usable');
  assert.equal(w.writes().length, 1);
});

test('29. during hand-back ensure and adopt return handing_back; gozar stop still removes by compare-and-set and writes the tombstone; a stale transfer is refused', async t => {
  const w = await world(t);
  await w.ensure();
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
  await w.ensure();
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
  await w.ensure();
  w.state.dnsName = 'renamed.tailnet.test';
  const json = await w.gozar('status', '--json');
  const route = json.json.durableRoutes[0];
  assert.equal(route.state, 'address_changed');
  assert.equal(route.origin, w.origin);
  assert.ok(!json.stdout.includes('renamed'));
  assert.ok(!(await w.gozar('status')).stdout.includes('renamed'));
});

// Requirement tokens: misuse, drift and plan facts

const posts = w => w.state.requests.filter(request => request.method === 'POST').length;
const spent = async (w, minted) => (await w.run('ensure', { ...minted.query, approval: minted.approval })).error?.code;

test('R1. token replay and any changed request field give no provider write and no record, and spend the token', async t => {
  const w = await world(t);
  // Replay: the token created one route; after release, the same token creates nothing.
  const first = await w.mint();
  assert.equal((await w.run('ensure', { ...first.query, approval: first.approval })).result.route.state, 'usable');
  await w.run('release', { routeId: 'coordinator' });
  const before = posts(w);
  assert.equal(await spent(w, first), 'consent_unknown');
  assert.equal(posts(w), before);
  assert.deepEqual(await w.records(), []);
  // Each field the token binds, changed after the user approved.
  const changes = {
    owner: { owner: 'other-app' }, target: { target: '127.0.0.1:1' }, usage: { usage: { kind: 'durable', routeId: 'other' } },
    requirements: { requirements: { ...requirements, address: 'any' } }, route: { route: 'other-policy' }, origin: { origin: `https://${dnsName}:10000` },
    disclosureRevision: { approval: { disclosureRevision: 'disclosure-2' } },
  };
  for (const [field, change] of Object.entries(changes)) {
    const minted = await w.mint({ route: 'hosting' });
    const request = { ...minted.query, approval: minted.approval, ...change, ...(change.approval ? { approval: { ...minted.approval, ...change.approval } } : {}) };
    if (field !== 'route') request.route = 'hosting';
    assert.equal((await w.run('ensure', request)).error.code, 'consent_mismatch', field);
    assert.equal(posts(w), before, field);
    assert.deepEqual(await w.records(), [], field);
    assert.equal(await spent(w, minted), 'consent_unknown', `${field}: the token is spent`);
  }
  // A token minted for adoption cannot create, and one minted to create cannot adopt.
  const adoption = await w.mint({}, { intent: 'adopt' });
  assert.equal(await spent(w, adoption), 'consent_mismatch');
  const creation = await w.mint({ origin: w.origin });
  assert.equal((await w.run('adopt', { ...creation.query, approval: creation.approval, handover: { from: 'example-app', generation: 1 } })).error.code, 'claim_mismatch');
  assert.equal(posts(w), before);
  // A token from another home does not exist in this one.
  const other = await world(t);
  const elsewhere = await other.mint();
  assert.equal((await w.run('ensure', { ...elsewhere.query, approval: elsewhere.approval, home: w.home })).error.code, 'consent_unknown');
  assert.equal(posts(w), before);
});

test('R1. an expired token creates nothing', async t => {
  const w = await world(t);
  const minted = await w.mint({}, { ttlMs: 50 });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await spent(w, minted), 'consent_expired');
  assert.equal(posts(w), 0);
  assert.deepEqual(await w.records(), []);
});

test('R1. two processes racing one token for one route: one provider write, one record, one route', async t => {
  const w = await world(t);
  const minted = await w.mint();
  const request = { ...minted.query, approval: minted.approval };
  const replies = await Promise.all([w.run('ensure', request), w.run('ensure', request), w.run('ensure', request)]);
  assert.equal(replies.filter(reply => reply.result?.route.state === 'usable').length, replies.filter(reply => reply.result).length);
  assert.ok(replies.some(reply => reply.result), JSON.stringify(replies));
  for (const reply of replies.filter(item => item.error)) assert.ok(['consent_unknown', 'busy'].includes(reply.error.code), reply.error.code);
  assert.equal(w.writes().length, 1);
  assert.equal(posts(w), 1);
  assert.equal((await w.records()).length, 1);
  // Two different routes cannot share a token. If the wrong route presents it first it burns the
  // token by design (a mismatch spends it), so there are never more than one winner and one write.
  const solo = await world(t);
  const one = await solo.mint();
  const racing = await Promise.all([solo.run('ensure', { ...one.query, approval: one.approval }),
    solo.run('ensure', { ...one.query, usage: { kind: 'durable', routeId: 'other' }, approval: one.approval })]);
  const winners = racing.filter(reply => reply.result);
  assert.ok(winners.length <= 1, JSON.stringify(racing));
  assert.ok(winners.every(reply => reply.result.route.routeId === 'coordinator'));
  assert.ok(racing.every(reply => reply.result || ['consent_mismatch', 'consent_unknown', 'reserved'].includes(reply.error.code)), JSON.stringify(racing));
  assert.equal(solo.writes().length, winners.length);
});

test('R2. drift between issue and redeem makes the approval stale: candidate_stale, token spent, no provider write', async t => {
  const drifts = {
    'the node was renamed': w => { w.state.dnsName = 'renamed.tailnet.test'; },
    'the candidate listener was taken': w => w.edit(foreignRule(8443, 'http://127.0.0.1:9')),
    'the candidate listener changed shape': w => w.edit(state => { state.config.TCP = { 8443: { HTTP: true } }; }),
  };
  for (const [name, drift] of Object.entries(drifts)) {
    const w = await world(t);
    const minted = await w.mint();
    drift(w);
    const config = structuredClone(w.state.config);
    assert.equal(await spent(w, minted), 'claim_mismatch', name);
    assert.equal(posts(w), 0, name);
    assert.deepEqual(w.state.config, config, name);
    assert.deepEqual(await w.records(), [], name);
    assert.equal(await spent(w, minted), 'consent_unknown', `${name}: spent`);
  }
  // Each half of the grant is checked alone.
  for (const forged of [{ planDigest: 'sha256:' + '1'.repeat(64) }, { observedResource: 'sha256:' + '2'.repeat(64) }]) {
    const w = await world(t);
    const minted = await w.mint({}, { grant: forged });
    assert.equal(await spent(w, minted), 'claim_mismatch', Object.keys(forged)[0]);
    assert.equal(posts(w), 0);
    assert.deepEqual(await w.records(), []);
  }
  // A token issued when no port was free is stale once one frees up.
  const full = await world(t);
  full.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const early = await full.mint();
  full.edit(state => { state.config = {}; });
  assert.equal(await spent(full, early), 'claim_mismatch');
  assert.equal(posts(full), 0);
});

test('R3. an unrelated foreign edit does not make the approval stale; the edit survives', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  const facts = (await w.run('facts', { adapterId: 'tailscale-funnel', target: w.target })).result;
  const minted = await w.mint();
  // Another program edits other ports, other keys and a foreground session on another port.
  w.edit(foreignRule(443, 'http://127.0.0.1:8'));
  w.edit(foreignRule(10000, 'http://127.0.0.1:9'));
  w.edit(state => { state.config.Services = { 'svc:example': {} }; state.config.Foreground = { other: { TCP: { 4000: { HTTPS: true } } } }; });
  assert.deepEqual((await w.run('facts', { adapterId: 'tailscale-funnel', target: w.target })).result, facts);
  const created = await w.run('ensure', { ...minted.query, approval: minted.approval });
  assert.equal(created.result.route.state, 'usable', JSON.stringify(created));
  assert.equal(created.result.route.origin, w.origin);
  assert.deepEqual(w.state.config.Web[`${dnsName}:443`], listener('http://127.0.0.1:8'));
  assert.deepEqual(w.state.config.Web[`${dnsName}:10000`], listener('http://127.0.0.1:9'));
  assert.deepEqual(w.state.config.Services, { 'svc:example': {} });
  assert.equal(w.writes().length, 1);
});

test('R4. plan facts are read-only, stable, and cover the recipe, the target, the origin and the candidate listener', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  const facts = args => w.run('facts', { adapterId: 'tailscale-funnel', target: w.target, ...args });
  const base = (await facts({})).result;
  assert.match(base.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(base.observedResource, /^sha256:[0-9a-f]{64}$/);
  assert.equal(base.origin, w.origin);
  assert.deepEqual((await facts({})).result, base);
  // Read only: GET requests, never a POST, and nothing on disk.
  assert.equal(posts(w), 0);
  assert.deepEqual(await readdir(w.home), []);
  assert.deepEqual(await w.cliCalls(), []);
  // The plan digest follows the adapter, the target and the origin.
  assert.notEqual((await facts({ adapterId: 'tailscale-private' })).result.planDigest, base.planDigest);
  assert.notEqual((await facts({ target: '127.0.0.1:1' })).result.planDigest, base.planDigest);
  const pinned = (await facts({ origin: `https://${dnsName}:10000` })).result;
  assert.equal(pinned.origin, `https://${dnsName}:10000`);
  assert.notEqual(pinned.planDigest, base.planDigest);
  assert.equal((await facts({ origin: 'https://elsewhere.example.test' })).result.origin, null);
  // The observed resource follows the node name and the candidate listener, and nothing else.
  w.edit(foreignRule(10000, 'http://127.0.0.1:9'));
  assert.deepEqual((await facts({})).result, base);
  w.edit(foreignRule(8443, 'http://127.0.0.1:9'));
  const taken = (await facts({})).result;
  assert.equal(taken.origin, null);
  assert.notEqual(taken.observedResource, base.observedResource);
  w.edit(state => { state.config = {}; state.dnsName = 'renamed.tailnet.test'; });
  assert.notEqual((await facts({})).result.observedResource, base.observedResource);
  // No durable recipe: unsupported, with an existing mapped code. A bad target is invalid_input.
  assert.equal((await facts({ adapterId: 'localhost-run' })).error.code, 'provider_unsupported');
  assert.equal((await facts({ adapterId: 'no-such-adapter' })).error.code, 'provider_unsupported');
  assert.equal((await facts({ target: 'example.test:80' })).error.code, 'invalid_input');
});

test('R5. a crash after intent and before the write, with a token, gives uncertainty after a foreign rule appears, never a claim', async t => {
  const w = await world(t, { crash: 'before-apply' });
  assert.equal((await w.ensure()).crashed, 'SIGKILL');
  const foreign = foreignRule(8443, `http://${w.target}`);
  w.edit(state => { foreign(state); state.config.AllowFunnel = { [`${dnsName}:8443`]: true }; });
  const config = structuredClone(w.state.config);
  // A fresh ensure needs no token (the record is the pin) and must not claim the identical foreign rule.
  const again = await w.run('ensure', w.request);
  assert.equal(again.error.code, 'uncertain');
  assert.deepEqual(w.state.config, config);
  assert.equal(w.writes().length, 0);
  assert.equal((await w.run('status', {})).result.routes[0].state, 'uncertain');
});

test('a session that may use either of two provider ports is not refused while one of them is free, and the holder is named', async t => {
  const w = await world(t, { funnelPorts: [8443, 10000] });
  await w.ensure();
  const provider = { providerResource: 'tailscale-https-port' };
  assert.deepEqual(await portHolders({ home: w.home, ...provider, ports: [8443, 10000] }), [{ port: 8443, routeId: 'coordinator' }]);
  // The route holds 8443: a session that can fall back to 10000 is not refused, one that can only use 8443 is.
  assert.deepEqual(await reserveSession({ home: w.home, port: 18711, ...provider, providerPorts: [8443, 10000] }), { reserved: true });
  await assert.rejects(reserveSession({ home: w.home, port: 18712, ...provider, providerPorts: [8443] }), { code: 'reserved' });
});

// Other apps' rules on the same node: Funnel rules on 443 and 9443 and a tailnet-only rule on 8443.
const otherApps = w => {
  w.edit(foreignRule(443, 'http://127.0.0.1:9001'));
  w.edit(foreignRule(9443, 'http://127.0.0.1:9002'));
  w.edit(foreignRule(8443, 'http://127.0.0.1:9003'));
  w.edit(({ config }) => { (config.AllowFunnel ??= {})[`${dnsName}:443`] = true; config.AllowFunnel[`${dnsName}:9443`] = true; });
};

test('31. other apps\' Funnel rules on 443 and 9443 and a tailnet-only rule on 8443 survive create and release byte-identical', async t => {
  const w = await world(t);
  w.state.funnelPorts = [443, 8443, 10000];
  otherApps(w);
  const before = structuredClone(w.state.config);
  const created = await w.ensure();
  assert.equal(created.result.route.origin, `https://${dnsName}:10000`, JSON.stringify(created));
  const others = config => [443, 8443, 9443].map(port => [config.TCP?.[port], config.Web?.[`${dnsName}:${port}`], config.AllowFunnel?.[`${dnsName}:${port}`]]);
  assert.deepEqual(others(w.state.config), others(before), 'creating the route changed no other rule or Funnel bit');
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.providerRemoved, true, JSON.stringify(released));
  assert.deepEqual(w.state.config, before);
  assert.deepEqual(await w.cliCalls(), []);
});

test('31. another app\'s path on the route\'s port blocks removal, and its handler and the Funnel bit survive', async t => {
  const w = await world(t);
  await w.ensure();
  w.edit(({ config }) => { config.Web[`${dnsName}:8443`].Handlers['/other'] = { Proxy: 'http://127.0.0.1:9004' }; });
  const changed = structuredClone(w.state.config);
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result.removed, false);
  assert.equal(released.result.cleanupDebt.reason, 'rule-changed');
  assert.deepEqual(w.state.config, changed);
});

// An adopt-only slot: the private Serve adapter can take over an app's existing rule on its legacy port 9443 with no
// teardown, so an upgrade keeps that address. Gozar never writes a rule there.
test('32. an exact private rule on the adopt-only port 9443 is adopted with no write; Gozar never creates or restores a rule there, and release removes it', async t => {
  const w = await world(t, { funnelPorts: [] });
  const legacy = `https://${dnsName}:9443`;
  const private_ = { adapterId: 'tailscale-private' };
  // Never created: with 443, 8443 and 10000 held by other programs, a new route is refused and 9443 stays empty.
  w.edit(state => { for (const port of [443, 8443, 10000]) foreignRule(port, 'http://127.0.0.1:9')(state); });
  assert.equal((await w.ensure({}, private_)).error.code, 'port_occupied');
  // A create pinned to the legacy origin is refused as an address Gozar cannot create.
  assert.equal((await w.ensure({ origin: legacy }, private_)).error.code, 'address_changed');
  assert.equal(w.state.config.Web[`${dnsName}:9443`], undefined);
  assert.deepEqual(w.writes(), []);
  // The app's own tailnet-only rule on 9443 is adopted exactly, with no provider write.
  w.edit(state => { state.config = {}; foreignRule(9443, `http://${w.target}`)(state); });
  const adopted = await w.adopt({ origin: legacy }, private_);
  assert.equal(adopted.error, undefined, JSON.stringify(adopted));
  assert.equal(adopted.result.route.state, 'usable');
  assert.equal(adopted.result.route.origin, legacy);
  assert.equal(adopted.result.route.adapterId, 'tailscale-private');
  assert.deepEqual(w.writes(), []);
  assert.equal((await w.run('ensure', w.request)).result.route.origin, legacy, 'a restart resumes at the legacy origin');
  // Lost: the rule is gone. Gozar does not write a new one on 9443.
  w.edit(state => { state.config = {}; });
  assert.equal((await w.run('ensure', w.request)).error.code, 'address_changed');
  assert.deepEqual(w.state.config, {});
  assert.deepEqual(w.writes(), []);
  // Back again (the app restored it): release removes exactly that rule.
  w.edit(state => { foreignRule(9443, `http://${w.target}`)(state); });
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result?.providerRemoved, true, JSON.stringify(released));
  assert.equal(w.state.config.Web?.[`${dnsName}:9443`], undefined);
});

test('33. an adopted rule on the adopt-only port 9443 that another program changes is never rewritten or removed', async t => {
  const w = await world(t, { funnelPorts: [] });
  const legacy = `https://${dnsName}:9443`;
  w.edit(foreignRule(9443, `http://${w.target}`));
  const adopted = await w.adopt({ origin: legacy }, { adapterId: 'tailscale-private' });
  assert.equal(adopted.result?.route.origin, legacy, JSON.stringify(adopted));
  // Another program points the rule at its own listener.
  w.edit(({ config }) => { config.Web[`${dnsName}:9443`] = listener('http://127.0.0.1:9005'); });
  const changed = structuredClone(w.state.config);
  const resumed = await w.run('ensure', w.request);
  assert.equal(resumed.error?.code, 'uncertain', JSON.stringify(resumed));
  assert.deepEqual(w.state.config, changed, 'the changed rule is not rewritten');
  const released = await w.run('release', { routeId: 'coordinator' });
  assert.equal(released.result?.removed, false, JSON.stringify(released));
  assert.equal(released.result.cleanupDebt.reason, 'rule-changed');
  assert.deepEqual(w.state.config, changed, 'nor removed');
  assert.deepEqual(w.writes(), []);
});
