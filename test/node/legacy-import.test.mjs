// inspectLegacyRoute: recognise a provider-owned legacy route through the provider itself, change
// nothing, and treat every state file as opaque input. Fakes only: a fake LocalAPI on a unix socket.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { inspectLegacyRoute } from '../../packages/gozar-node/legacy-import.mjs';
import { migrationRefOf, durablePlanFacts } from '../../packages/gozar-node/durable-route.mjs';
import { startFakeLocalApi } from './fake-localapi.mjs';

const dnsName = 'node.tailnet.test';
const target = '127.0.0.1:4310';
const schema = JSON.parse(await readFile(fileURLToPath(new URL('../../runtime/route-catalog.schema.json', import.meta.url)), 'utf8'));
let root;
before(async () => { await mkdir(join(homedir(), '.tmp'), { recursive: true }); root = await mkdtemp(join(homedir(), '.tmp', 'gozar-legacy-')); });
after(() => rm(root, { recursive: true, force: true }));

const funnelRule = (config, port, proxy) => {
  (config.TCP ??= {})[port] = { HTTPS: true };
  (config.Web ??= {})[`${dnsName}:${port}`] = { Handlers: { '/': { Proxy: proxy } } };
  (config.AllowFunnel ??= {})[`${dnsName}:${port}`] = true;
};
async function world(t, initial = {}) {
  const base = await mkdtemp(join(root, 'w-'));
  const socket = join(base, 'ts.sock');
  const fake = await startFakeLocalApi(socket, initial);
  const saved = process.env.GOZAR_TAILSCALED_SOCKET;
  process.env.GOZAR_TAILSCALED_SOCKET = socket;
  t.after(async () => { if (saved === undefined) delete process.env.GOZAR_TAILSCALED_SOCKET; else process.env.GOZAR_TAILSCALED_SOCKET = saved; await fake.close(); });
  const inspect = (extra = {}) => inspectLegacyRoute({ home: join(base, 'home'), owner: 'example-app', source: { stateFiles: [] }, target, ...extra });
  return { base, state: fake.state, inspect };
}
// The whole world a request could change: the provider config and what it was asked.
const untouched = (w, before) => {
  assert.deepEqual(w.state.config, before.config);
  assert.equal(w.state.etag, before.etag);
  assert.deepEqual(w.state.writes, []);
  assert.ok(w.state.requests.every(request => request.method === 'GET'), JSON.stringify(w.state.requests));
  assert.ok(w.state.requests.every(request => ['/localapi/v0/serve-config', '/localapi/v0/status?peers=false'].includes(request.path)));
};
const snapshot = w => ({ config: structuredClone(w.state.config), etag: w.state.etag });
const resultKeys = Object.keys(schema.$defs.InspectLegacyRouteResult.properties).sort();

test('an exact rule for the target is adoptable, and the origin is found from the provider when none is given', async t => {
  const w = await world(t);
  funnelRule(w.state.config, 8443, `http://${target}`);
  const before = snapshot(w);
  const found = await w.inspect();
  assert.deepEqual(Object.keys(found).sort(), resultKeys);
  assert.deepEqual({ ...found, migrationRef: undefined }, { schemaVersion: 1, migrationRef: undefined, origin: `https://${dnsName}:8443`, target,
    bridgeHome: null, state: 'adoptable', reasonCode: null, nextAction: null });
  assert.match(found.migrationRef, /^mig_[0-9a-f]{40}$/);
  // With the origin given the answer is the same, including the opaque reference.
  assert.deepEqual(await w.inspect({ origin: `https://${dnsName}:8443` }), found);
  // The reference is the digest adopt recomputes from the same observation.
  const facts = await durablePlanFacts({ home: join(w.base, 'home'), adapterId: 'tailscale-funnel', target, origin: found.origin });
  assert.equal(found.migrationRef, migrationRefOf({ origin: found.origin, target, observedResource: facts.observedResource }));
  untouched(w, before);
  // An unrelated edit elsewhere does not change the reference; an edit to this listener does.
  funnelRule(w.state.config, 443, 'http://127.0.0.1:1'); w.state.etag++;
  assert.equal((await w.inspect({ origin: found.origin })).migrationRef, found.migrationRef);
  w.state.config.Web[`${dnsName}:8443`].Handlers['/'].Proxy = `http://${target}/`; w.state.etag++;
  assert.equal((await w.inspect({ origin: found.origin })).state, 'external');
});

test('a rule for the target that is not exactly an adapter rule, or a foreground session, is external and not adoptable', async t => {
  const w = await world(t);
  funnelRule(w.state.config, 8443, `http://${target}`);
  w.state.config.Web[`${dnsName}:8443`].Handlers['/other'] = { Proxy: 'http://127.0.0.1:9' };
  const before = snapshot(w);
  assert.deepEqual(await w.inspect(), { schemaVersion: 1, migrationRef: (await w.inspect()).migrationRef, origin: `https://${dnsName}:8443`, target,
    bridgeHome: null, state: 'external', reasonCode: 'not_adoptable', nextAction: null });
  untouched(w, before);
  const session = await world(t);
  funnelRule(session.state.config, 8443, `http://${target}`);
  session.state.config.Foreground = { s1: { TCP: { 8443: { HTTPS: true } } } };
  assert.equal((await session.inspect()).state, 'external');
});

test('blocked reasons: nothing found, another target at that origin, another origin for the target, several origins', async t => {
  const w = await world(t);
  const before = snapshot(w);
  assert.deepEqual(pick(await w.inspect()), ['blocked', 'not_found', null]);
  assert.deepEqual(pick(await w.inspect({ origin: `https://${dnsName}:8443` })), ['blocked', 'not_found', `https://${dnsName}:8443`]);
  funnelRule(w.state.config, 8443, 'http://127.0.0.1:9');
  assert.deepEqual(pick(await w.inspect({ origin: `https://${dnsName}:8443` })), ['blocked', 'target_mismatch', `https://${dnsName}:8443`]);
  funnelRule(w.state.config, 10000, `http://${target}`);
  assert.deepEqual(pick(await w.inspect({ origin: `https://${dnsName}:8443` })), ['blocked', 'origin_mismatch', `https://${dnsName}:8443`]);
  assert.deepEqual(pick(await w.inspect({ origin: `https://${dnsName}:10000` })), ['adoptable', null, `https://${dnsName}:10000`]);
  funnelRule(w.state.config, 443, `http://${target}`);
  assert.deepEqual(pick(await w.inspect()), ['blocked', 'not_adoptable', null]);
  assert.ok(w.state.requests.every(request => request.method === 'GET'));
  assert.deepEqual(w.state.writes, []);
  assert.notDeepEqual(w.state.config, before.config);
});
const pick = result => [result.state, result.reasonCode, result.origin];

test('a state file is opaque: it is not read, and a route only a file could describe asks to sign in again', async t => {
  const w = await world(t);
  // A file with a secret in it, and a path that does not exist, and an unreadable file.
  const secret = 'tskey-auth-SYNTHETICSECRETVALUE123';
  const known = join(w.base, 'legacy-state.json'), unreadable = join(w.base, 'locked.json');
  await writeFile(known, JSON.stringify({ authtoken: secret, tunnels: { web: { addr: 4310 } } }));
  await writeFile(unreadable, secret); await chmod(unreadable, 0o000);
  t.after(() => chmod(unreadable, 0o600));
  const filesBefore = await readdir(w.base);
  const times = await Promise.all([known, unreadable].map(async path => (await stat(path)).atimeMs));
  const before = snapshot(w);
  for (const stateFiles of [[known], [join(w.base, 'missing.json')], [unreadable], [known, unreadable]]) {
    const found = await w.inspect({ source: { stateFiles } });
    assert.deepEqual(Object.keys(found).sort(), resultKeys);
    assert.equal(found.state, 'blocked');
    assert.equal(found.reasonCode, 'unrecognized_format');
    assert.equal(found.bridgeHome, null);
    const action = found.nextAction;
    assert.equal(action.kind, 'instructions');
    assert.equal(action.id, 'legacy-sign-in-again');
    assert.match(action.label, /sign in again/i);
    assert.match(action.instructions, /sign in/i);
    assert.match(action.digest, /^sha256:[0-9a-f]{64}$/);
    const properties = Object.keys(schema.$defs.Action.properties);
    assert.ok(Object.keys(action).every(key => properties.includes(key)));
    for (const key of schema.$defs.Action.required) assert.ok(key in action, key);
    assert.deepEqual(Object.keys(action.disclosure).sort(), ['links', 'revision', 'text']);
    // No file content, no path and no format name in the output.
    const text = JSON.stringify(found);
    for (const leaked of [secret, 'authtoken', 'tunnels', 'legacy-state', 'locked.json', 'missing.json', w.base]) assert.ok(!text.includes(leaked), leaked);
    assert.match(found.migrationRef, /^mig_/);
  }
  untouched(w, before);
  assert.deepEqual(await readdir(w.base), filesBefore);
  assert.deepEqual(await Promise.all([known, unreadable].map(async path => (await stat(path)).atimeMs)), times);
  // The provider still answers first: an exact rule is adoptable whatever files the caller names.
  funnelRule(w.state.config, 8443, `http://${target}`);
  assert.equal((await w.inspect({ source: { stateFiles: [known] } })).state, 'adoptable');
});

test('with the provider unreachable, a file asks to sign in again and no file means a typed provider error', async t => {
  const w = await world(t);
  process.env.GOZAR_TAILSCALED_SOCKET = join(w.base, 'missing.sock');
  const found = await w.inspect({ source: { stateFiles: [join(w.base, 'state.json')] } });
  assert.equal(found.reasonCode, 'unrecognized_format');
  assert.equal(found.nextAction.kind, 'instructions');
  await assert.rejects(w.inspect(), { code: 'provider_unavailable', provider: 'tailscale' });
});

test('invalid input is refused before any provider request', async t => {
  const w = await world(t);
  for (const bad of [{ target: 'example.test:80' }, { target: undefined }, { owner: '' }, { source: { stateFiles: 'x' } }, { source: {} }, { source: { stateFiles: [3] } }, { origin: 3 }])
    await assert.rejects(w.inspect(bad), { code: 'invalid_input' }, JSON.stringify(bad));
  assert.deepEqual(w.state.requests, []);
});
