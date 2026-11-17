import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import privateServe from '../../adapters/providers/tailscale-private/index.mjs';
import funnel from '../../adapters/providers/tailscale-funnel/index.mjs';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';

const account = 'owner@example.invalid';
const tailnet = 'demo.ts.net';
const dnsName = 'node.demo.ts.net';
const handoff = 'https://login.tailscale.com/a/synthetic-handoff-canary';
const status = {
  BackendState: 'Running',
  Self: { ID: 'node-1', UserID: 123, DNSName: dnsName + '.', CapMap: { https: null, funnel: null, 'https://tailscale.com/cap/funnel-ports?ports=8443': null } },
  CurrentTailnet: { MagicDNSSuffix: tailnet, MagicDNSEnabled: true },
  User: { 123: { ID: 123, LoginName: account } },
  CertDomains: [dnsName],
};

async function cliFixture(t, initial) {
  const root = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.tmp');
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, 'ts-'));
  const statePath = join(path, 'state.json');
  const program = join(path, 'tailscale');
  const save = value => writeFile(statePath, JSON.stringify(value), { mode: 0o600 });
  const read = async () => JSON.parse(await readFile(statePath, 'utf8'));
  await save({ calls: [], status: initial, config: {}, handoff });
  await writeFile(program, `#!${process.execPath}
const fs = require('node:fs');
const path = ${JSON.stringify(statePath)};
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const write = () => fs.writeFileSync(path, JSON.stringify(state));
if (args[0] === 'up') {
  if (state.commandError) { write(); console.error(state.commandError); process.exit(1); }
  const count = state.calls.filter(args => args[0] === 'up').length;
  state.status.AuthURL = state.status.AuthURL ? state.handoff + '-' + count : state.handoff;
  if (state.failReadAfterLogin) state.statusError = "Interrupted readback";
  write();
  console.log(JSON.stringify(state.status));
  process.exit(1);
}
write();
if (args[0] === 'status') {
  if (state.statusError) { console.error(state.statusError); process.exit(1); }
  console.log(JSON.stringify(state.status));
} else if (args.join(' ') === 'serve status --json') {
  if (state.configError) process.exit(1);
  console.log(JSON.stringify(state.config));
} else {
  console.error('Unexpected fixture command');
  process.exit(2);
}
`, { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = path;
  t.after(async () => { process.env.PATH = previousPath; await rm(path, { recursive: true, force: true }); });
  return { read, edit: async fn => { const state = await read(); fn(state); await save(state); } };
}

const operation = { id: 'operation-1', cancelled: false, resources: [] };
const setupContext = (config, extras = {}) => ({
  now: () => Date.parse('2026-11-17T00:00:00Z'),
  platform: 'linux',
  configuration: async () => ({ ...config }),
  ...extras,
});
const intended = () => ({ 'tailscale-account': account, 'tailscale-tailnet': tailnet });
const observe = (adapter, ctx) => adapter.observeSetup(ctx, operation);
const execute = (adapter, ctx, offer, extra = {}) => adapter.executeSetup(ctx, {
  action: { ...offer.nextAction, consent: { scope: { operation: { id: operation.id } } } }, ...extra,
});

test('Tailscale CLI login offers transient AuthURL, then independently verifies account, tailnet and exact node', async t => {
  const cli = await cliFixture(t, { BackendState: 'NeedsLogin' });
  const config = intended(), ctx = setupContext(config);
  const login = await observe(privateServe, ctx);
  assert.equal(login.nextAction.id, 'tailscale-login');
  assert.equal(login.nextAction.kind, 'gozar-runs');
  assert.deepEqual((await cli.read()).calls, [['status', '--json', '--peers=false']]);
  await execute(privateServe, ctx, login);
  assert.deepEqual((await cli.read()).calls.filter(args => args[0] === 'up'), [['up', '--timeout=12s', '--json']]);
  const browser = await observe(privateServe, ctx);
  assert.equal(browser.state, 'pending');
  assert.equal(browser.nextAction.href, handoff);
  assert.ok(browser.nextAction.step.browser);
  assert.doesNotMatch(JSON.stringify({ ...browser, nextAction: { ...browser.nextAction, href: null } }), /synthetic-handoff-canary/);
  await execute(privateServe, ctx, browser);
  assert.equal((await observe(privateServe, ctx)).state, 'pending');
  assert.equal((await cli.read()).calls.filter(args => args[0] === 'up').length, 1);

  await cli.edit(value => { value.status = { ...status, User: { 123: { ID: 123, LoginName: 'other@example.invalid' } } }; });
  assert.equal((await observe(privateServe, ctx)).nextAction.id, 'tailscale-identity-mismatch');
  await cli.edit(value => { value.status = { ...status, CurrentTailnet: { MagicDNSSuffix: 'other.ts.net' } }; });
  assert.equal((await observe(privateServe, ctx)).nextAction.id, 'tailscale-identity-mismatch');
  await cli.edit(value => { value.status = status; });
  const confirm = await observe(privateServe, ctx);
  assert.equal(confirm.nextAction.id, 'tailscale-node');
  assert.equal(confirm.nextAction.step.options.length, 1);
  config['tailscale-node'] = confirm.nextAction.step.options[0].value;
  const ready = await observe(privateServe, ctx);
  assert.equal(ready.state, 'complete');
  assert.match(ready.evidence.value.summary, /independent tailnet client/i);
  await cli.edit(value => { value.status.Self.ID = 'replacement-node'; });
  assert.equal((await observe(privateServe, ctx)).nextAction.id, 'tailscale-node');
});

test('Tailscale re-reads privilege, browser expiry, admin approval, HTTPS and permitted free ports', async t => {
  const cli = await cliFixture(t, { BackendState: 'NeedsLogin' });
  const config = intended();
  let now = Date.parse('2026-11-17T00:01:00Z');
  const ctx = setupContext(config, { now: () => now });
  const login = await observe(funnel, ctx);
  await cli.edit(value => { value.commandError = 'Access denied: check operator permissions'; });
  const refused = await execute(funnel, ctx, login);
  assert.equal(refused.state, 'blocked');
  assert.equal(refused.nextAction.id, 'tailscale-operator');
  await cli.edit(value => { delete value.commandError; });
  await execute(funnel, ctx, await observe(funnel, ctx));
  const browser = await observe(funnel, ctx);
  now = Date.parse(browser.nextAction.step.browser.expiresAt) + 1;
  const expired = await observe(funnel, ctx);
  assert.equal(expired.state, 'expired');
  assert.equal(expired.nextAction.href, undefined);
  await cli.edit(value => { value.status = { BackendState: 'NeedsMachineAuth' }; });
  const admin = await observe(funnel, ctx);
  assert.equal(admin.nextAction.id, 'tailscale-node-approval');
  assert.equal(admin.nextAction.step.actor, 'administrator');
  await cli.edit(value => { value.status = status; });
  config['tailscale-node'] = (await observe(funnel, ctx)).nextAction.step.options[0].value;
  await cli.edit(value => { value.status.CurrentTailnet.MagicDNSEnabled = false; });
  assert.equal((await observe(funnel, ctx)).nextAction.id, 'tailscale-magicdns');
  await cli.edit(value => { value.status.CurrentTailnet.MagicDNSEnabled = true; delete value.status.Self.CapMap.funnel; });
  assert.equal((await observe(funnel, ctx)).nextAction.id, 'tailscale-funnel-policy');
  await cli.edit(value => { value.status = status; value.config = { TCP: { 8443: { HTTPS: true } }, Web: { 'foreign.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9191' } } } } }; });
  assert.equal((await observe(funnel, ctx)).nextAction.id, 'tailscale-allowed-port');
  const before = (await cli.read()).config;
  assert.equal((await funnel.observeSetup(ctx, { ...operation, cancelled: true })).state, 'cancelled');
  assert.deepEqual((await cli.read()).config, before);
  assert.ok((await cli.read()).calls.every(args => ['up', 'status', 'serve'].includes(args[0])));
});

test('ngrok reports the optional SDK and assisted agent credential intake with no browser-only grant', async () => {
  let available = false;
  const adapter = createNgrokAdapter({ loadSdk: async () => {
    if (!available) throw new Error('module missing');
    return { forward: () => assert.fail('setup starts no listener') };
  } });
  const config = {};
  let credential = 'synthetic-agent-canary';
  const ctx = setupContext(config, {
    withInputSecret: async use => use(Buffer.from(credential)),
    bindConnectorSecret: async (id, bytes) => { config[id] = Buffer.from(bytes).toString(); },
  });
  const install = await observe(adapter, ctx);
  assert.equal(install.nextAction.id, 'install-sdk');
  assert.equal(install.nextAction.kind, 'install-artifact');
  assert.match(install.nextAction.artifact.sha256, /^[0-9a-f]{64}$/);
  available = true;
  const auth = await observe(adapter, ctx);
  assert.equal(auth.nextAction.id, 'auth');
  assert.equal(auth.nextAction.kind, 'provide-secret');
  assert.match(auth.nextAction.help, /sign up|create an account/i);
  await execute(adapter, ctx, auth);
  assert.equal(config.auth, credential);
  const source = await observe(adapter, ctx);
  assert.equal(source.nextAction.id, 'ngrok-domain-source');
  assert.doesNotMatch(JSON.stringify(source), /synthetic-agent-canary/);
  config['ngrok-domain-source'] = 'dashboard';
  const domain = await observe(adapter, ctx);
  assert.equal(domain.nextAction.id, 'reserved-domain');
  assert.equal(domain.nextAction.step.options, undefined);
  config['reserved-domain'] = 'demo.ngrok.app';
  assert.match((await observe(adapter, ctx)).evidence.value.summary, /route proof/i);
  credential = 'bad\ncredential';
  delete config.auth;
  await assert.rejects(execute(adapter, ctx, await observe(adapter, ctx)), { code: 'setup_required' });
  assert.equal(config.auth, undefined);
});

test('ngrok inventory choices come from a bounded read and management stays outside connector options', async t => {
  let reply = { reserved_domains: [{ id: 'rd_1', domain: 'demo.ngrok.app' }, { id: 'rd_2', domain: '*.example.net' }], next_page_uri: null };
  let refusal = 0;
  const networkReads = [];
  const api = createServer((req, res) => {
    networkReads.push({ path: req.url, method: req.method, authorization: req.headers.authorization, version: req.headers['ngrok-version'] });
    res.writeHead(refusal || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => api.close());
  const loopback = 'http://127.0.0.1:' + api.address().port;
  const agent = 'synthetic-agent-canary', management = 'synthetic-management-canary', foreign = new Set(['foreign']);
  const opened = [], closed = [];
  const sdk = {
    forward: async options => {
      opened.push(options);
      foreign.add('owned');
      return { id: () => 'owned', url: () => 'https://' + options.domain,
        close: async () => { closed.push('owned'); foreign.delete('owned'); } };
    },
    getListener: async id => foreign.has(id) ? { id: () => id } : null,
  };
  const adapter = createNgrokAdapter({ loadSdk: async () => sdk, fetchManagement: (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.ngrok.com');
    return fetch(loopback + new URL(url).pathname + new URL(url).search, init);
  } });
  const config = { auth: agent, 'ngrok-domain-source': 'inventory' };
  let retained = false;
  const ctx = setupContext(config, {
    withManagementSecret: async (slot, use) => {
      assert.equal(slot, 'domain-inventory');
      return retained ? use(Buffer.from(management)) : null;
    },
    withInputSecret: async use => use(Buffer.from(management)),
    retainManagementSecret: async slot => { assert.equal(slot, 'domain-inventory'); retained = true; },
    generation: 1, assertGeneration: async () => {},
  });
  const input = await observe(adapter, ctx);
  assert.equal(input.nextAction.id, 'ngrok-management-key');
  await execute(adapter, ctx, input);
  const choice = await observe(adapter, ctx);
  assert.deepEqual(choice.nextAction.step.options, [{ value: 'demo.ngrok.app', label: 'demo.ngrok.app' }]);
  assert.ok(networkReads.length >= 1);
  assert.ok(networkReads.every(req => req.path === '/reserved_domains' && req.method === 'GET' && req.authorization === 'Bearer ' + management && req.version === '2'));
  assert.equal(opened.length, 0);
  assert.doesNotMatch(JSON.stringify(choice), /synthetic-(agent|management)-canary|rd_1/);
  config['reserved-domain'] = 'foreign.ngrok.app';
  assert.equal((await observe(adapter, ctx)).nextAction.id, 'reserved-domain');
  refusal = 403;
  const blocked = await observe(adapter, ctx);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.nextAction.id, 'ngrok-management-key');
  refusal = 0;
  reply = { ...reply, next_page_uri: 'https://foreign.invalid/reserved_domains' };
  assert.equal((await observe(adapter, ctx)).state, 'blocked');
  reply.next_page_uri = null;
  config['reserved-domain'] = 'demo.ngrok.app';
  const req = { target: '127.0.0.1:8123', usage: { kind: 'attached' } };
  const plan = await adapter.plan(ctx, req);
  const receipt = await adapter.create(ctx, plan);
  assert.deepEqual(opened, [{ addr: req.target, authtoken: agent, domain: 'demo.ngrok.app' }]);
  assert.equal((await adapter.remove(ctx, receipt)).removed, true);
  assert.deepEqual(closed, ['owned']);
  assert.deepEqual([...foreign], ['foreign']);
  assert.doesNotMatch(JSON.stringify({ plan, receipt }), /synthetic-(agent|management)-canary/);
});

test('Tailscale keeps the browser handoff within the approved operation and rechecks stale approval', async t => {
  const cli = await cliFixture(t, { BackendState: 'NeedsLogin' });
  const config = intended(), ctx = setupContext(config);
  const approval = await observe(privateServe, ctx);
  config['tailscale-account'] = 'replacement@example.invalid';
  await assert.rejects(execute(privateServe, ctx, approval), { code: 'setup_required' });
  assert.equal((await cli.read()).calls.filter(args => args[0] === 'up').length, 0);
  config['tailscale-account'] = account;
  await execute(privateServe, ctx, await observe(privateServe, ctx));
  assert.equal((await observe(privateServe, ctx)).nextAction.href, handoff);
  const foreignOperation = await privateServe.observeSetup(ctx, { ...operation, id: 'foreign-setup' });
  assert.equal(foreignOperation.state, 'pending');
  assert.equal(foreignOperation.nextAction.step.browser, undefined);
  assert.doesNotMatch(JSON.stringify(foreignOperation), /synthetic-handoff-canary/);
  const moduleUrl = new URL('../../adapters/providers/tailscale-private/index.mjs', import.meta.url);
  const restarted = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import adapter from ${JSON.stringify(moduleUrl.href)};
    const [values, operation] = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(await adapter.observeSetup({
      platform: 'linux', now: Date.now, configuration: async () => values
    }, operation)));
  `, JSON.stringify([config, operation])], { encoding: 'utf8' }));
  assert.equal(restarted.nextAction.id, 'tailscale-existing-sign-in');
  assert.doesNotMatch(JSON.stringify(restarted), /synthetic-handoff-canary/);
  await cli.edit(value => { value.status.Health = ['Authorization was denied']; });
  assert.equal((await observe(privateServe, ctx)).state, 'denied');
});

test('Tailscale interrupted readback does not advance past provider observation', async t => {
  const cli = await cliFixture(t, { BackendState: 'NeedsLogin' });
  const ctx = setupContext(intended());
  const approved = await observe(privateServe, ctx);
  await cli.edit(value => { value.failReadAfterLogin = true; });
  assert.equal((await execute(privateServe, ctx, approved)).nextAction.id, 'tailscale-status');
  await cli.edit(value => { delete value.statusError; });
  assert.equal((await observe(privateServe, ctx)).nextAction.href, handoff);
  assert.equal((await cli.read()).calls.filter(args => args[0] === 'up').length, 1);
});

test('ngrok rejects a same-process foreign listener before opening and reports provider domain refusals safely', async () => {
  const req = { target: '127.0.0.1:8123', usage: { kind: 'attached' } };
  const config = { auth: 'synthetic-agent-canary', 'reserved-domain': 'demo.ngrok.app' };
  const ctx = setupContext(config, { generation: 1, assertGeneration: async () => {} });
  let forwarded = 0, probe = [];
  const occupied = createNgrokAdapter({ loadSdk: async () => ({
    forward: () => { forwarded += 1; },
    getListenerByUrl: async url => { probe.push(url); return { close: () => assert.fail('foreign listener closed') }; },
  }) });
  await assert.rejects(occupied.create(ctx, await occupied.plan(ctx, req)), { code: 'setup_required' });
  assert.deepEqual(probe, ['https://demo.ngrok.app']);
  assert.equal(forwarded, 0);

  for (const code of ['ERR_NGROK_314', 'ERR_NGROK_316', 'ERR_NGROK_320']) {
    const denied = createNgrokAdapter({ loadSdk: async () => ({
      forward: async () => { throw Object.assign(new Error(config.auth), { code }); },
    }) });
    await assert.rejects(denied.create(ctx, await denied.plan(ctx, req)), error => {
      assert.equal(error.code, 'setup_required');
      assert.equal(error.nextAction.id, 'reserved-domain');
      assert.doesNotMatch(JSON.stringify(error), /synthetic-agent-canary/);
      return true;
    });
  }
});

test('Tailscale reports signed installation, missing daemon and a trusted client as separate actions', async t => {
  const cli = await cliFixture(t, { BackendState: 'NeedsLogin' });
  const ctx = setupContext(intended(), { architecture: 'x64' });
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const missing = await observe(privateServe, ctx);
    assert.equal(missing.nextAction.kind, 'install-artifact');
    assert.match(missing.nextAction.artifact.url, /tailscale_1\.104\.7_amd64\.tgz$/);
    assert.equal(missing.nextAction.effects.requiresPrivilege, true);
  } finally { process.env.PATH = previousPath; }

  await cli.edit(value => { value.statusError = "failed to connect to local tailscaled"; });
  const stopped = await observe(privateServe, ctx);
  assert.equal(stopped.nextAction.id, 'tailscale-daemon');
  assert.equal(stopped.nextAction.step.actor, 'administrator');

  for (const adapter of [privateServe, funnel]) {
    const [entry, client] = adapter.configurationActions();
    assert.equal(entry.id, 'tailscale-setup');
    assert.equal(client.id, 'tailscale-client-proof');
    assert.equal(client.step.actor, 'trusted-client');
    assert.equal(client.step.verification, 'trusted-client');
    assert.match(client.instructions, /exact HTTPS origin against the app challenge/);
  }
  assert.equal((await cli.read()).calls.some(args => args[0] === 'up'), false);
});
