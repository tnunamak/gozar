// Run against source or the ordinary installed package. All remote calls are intercepted.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { assertShape, query, scratch } from '../node/route-schema-check.mjs';

const account = 'a'.repeat(32), zone = 'b'.repeat(32), dnsId = 'c'.repeat(32);
const retainedDNS = 'd'.repeat(32);
const host = 'app.example.invalid', origin = 'https://' + host;
const apiPath = '/accounts/' + account + '/cfd_tunnel';
const dnsPath = '/zones/' + zone + '/dns_records';
const approved = action => ({ kind: 'setup', digest: action.digest,
  disclosureRevision: action.disclosure.revision, consentFactsDigest: action.consent.consentFactsDigest });

async function loopback(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}

async function fixture(t) {
  let harness;
  t.after(() => harness?.close());
  const home = await scratch(t);
  let appRequests = 0;
  const appPort = await loopback(t, (req, res) => { appRequests++; res.end('actual app response'); });
  const disposable = http.createServer();
  disposable.listen(0, '127.0.0.1');
  await once(disposable, 'listening');
  const port = disposable.address().port;
  await new Promise(resolve => disposable.close(resolve));

  const management = 'cf-api-canary-' + randomUUID(), runToken = 'cf-run-canary-' + randomUUID();
  const tunnels = new Map(), records = new Map(), writes = [], connectors = new Map(), reads = [];
  const foreign = { id: randomUUID(), name: 'foreign', config_src: 'cloudflare', account_tag: account, created_at: new Date().toISOString() };
  tunnels.set(foreign.id, foreign);
  records.set(retainedDNS, { id: retainedDNS, name: 'retained.example.invalid', content: 'retained.example.net' });
  const state = { permission: 'active', token: runToken, dropCreate: false, handles: [] };
  const success = result => ({ status: 200, body: { success: true, result } });
  const missing = code => ({ status: 404, body: { success: false, errors: [{ code }] } });

  const effects = [
    { kind: 'cloudflare-api', operation: 'request', async handle({ method, path, token, body }) {
      assert.equal(token, management);
      if (method === 'GET') reads.push(path); else writes.push([method, path]);
      if (path === '/user/tokens/verify') {
        return state.permission === 'denied' ? { status: 403, body: { success: false } } : success({ status: state.permission });
      }
      assert.equal(state.permission, 'active');
      if (path.startsWith('/zones?')) return success([{ id: zone, name: 'example.invalid', account: { id: account, name: 'Fixture account' } }]);
      if (path.startsWith(dnsPath + '?')) {
        const name = new URL('https://fixture.invalid' + path).searchParams.get('name.exact');
        return success([...records.values()].filter(record => record.name === name));
      }
      if (path.startsWith(apiPath + '?')) {
        const id = new URL('https://fixture.invalid' + path).searchParams.get('uuid');
        return success(tunnels.has(id) ? [tunnels.get(id)] : []);
      }
      if (path === apiPath && method === 'POST') {
        const tunnel = { id: randomUUID(), ...body, account_tag: account, created_at: new Date().toISOString(), deleted_at: null };
        tunnels.set(tunnel.id, tunnel);
        state.ownedTunnel = tunnel;
        if (state.dropCreate) throw new Error('provider allocated but response was lost');
        return success(tunnel);
      }
      if (path === dnsPath && method === 'POST') {
        assert.deepEqual(body, { name: host, type: 'CNAME', content: state.ownedTunnel.id + '.cfargotunnel.com', proxied: true, ttl: 1 });
        const time = new Date().toISOString();
        const dns = { id: dnsId, ...body, created_on: time, modified_on: time };
        records.set(dns.id, dns);
        return success(dns);
      }
      if (path.startsWith(apiPath + '/')) {
        const [id, operation] = path.slice(apiPath.length + 1).split('/');
        const tunnel = tunnels.get(id);
        if (!tunnel) return missing(1033);
        if (operation === 'configurations') {
          if (method === 'PUT') state.config = body.config;
          return success({ config: state.config ?? {} });
        }
        if (operation === 'token') return success(state.token);
        if (method === 'DELETE') {
          assert.equal(connectors.size, 0);
          tunnels.delete(id);
          return success({ id });
        }
        return success(tunnel);
      }
      if (path.startsWith(dnsPath + '/')) {
        const id = path.slice(dnsPath.length + 1);
        if (!records.has(id)) return missing(81044);
        if (method === 'DELETE') {
          assert.equal(connectors.size, 0);
          records.delete(id);
          return success({ id });
        }
        return success(records.get(id));
      }
      assert.fail(method + ' ' + path);
    } },
    { kind: 'process-runtime', operation: 'detect', handle: async () => ({ available: true }) },
    { kind: 'process-runtime', operation: 'open', async handle({ program, credential, origin: openedOrigin, target }) {
      assert.equal(program, 'cloudflared');
      assert.equal(credential, runToken);
      assert.equal(openedOrigin, origin);
      assert.equal(target, '127.0.0.1:' + port);
      assert.equal(state.config.ingress[0].service, 'http://' + target);
      const handle = randomUUID();
      connectors.set(handle, { target });
      return { handle };
    } },
    { kind: 'process-runtime', operation: 'read', handle: async ({ handle }) => ({ present: connectors.has(handle) }) },
    { kind: 'process-runtime', operation: 'close', handle: async ({ handle }) => ({ closed: connectors.delete(handle) }) },
    { kind: 'network', operation: 'fetch', async handle({ url, headers }) {
      const endpoint = new URL(url);
      assert.equal(endpoint.origin, origin);
      const [connector] = connectors.values();
      assert.ok(connector);
      const response = await fetch('http://' + connector.target + endpoint.pathname + endpoint.search, { headers });
      return { status: response.status, headers: Object.fromEntries(response.headers),
        chunks: [{ delayMs: 0, data: Buffer.from(await response.arrayBuffer()).toString('base64') }] };
    } },
  ];
  const restart = async () => {
    await harness?.close();
    harness = await createTestingGozar({ effects });
    return harness.gozar;
  };
  let api = await restart();
  const q = query({ home, providerId: 'cloudflare-named', target: '127.0.0.1:' + appPort, usage: { kind: 'attached' },
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } });
  const ref = { home, owner: q.owner, providerId: q.providerId, operationId: randomUUID() };
  const catalog = async () => (await api.catalogRoutes(q)).candidates[0];
  const configure = async view => {
    for (const [id, value] of [['managed-account', account], ['managed-zone', zone], ['managed-hostname', host], ['managed-port', String(port)]]) {
      assert.equal(view.nextAction?.id, id);
      view = await drive(view, { value });
    }
    return view;
  };
  const drive = async (view, input = {}) => {
    const request = { ...ref, actionId: view.nextAction.id, expectedSetupRevision: view.revision,
      expectedConfigurationRevision: view.scope.configurationRevision, approval: approved(view.nextAction), ...input };
    const updated = await api.runSetupAction(request);
    assertShape('SetupOperation', updated);
    return updated;
  };
  const start = async () => {
    const candidate = await catalog();
    const action = candidate.configuration.actions.find(action => action.step?.purpose === 'authorize');
    assert.equal(candidate.candidateToken, null);
    return api.runSetupAction({ ...ref, actionId: action.id, expectedSetupRevision: 0,
      expectedConfigurationRevision: candidate.configuration.revision });
  };
  const intake = async view => {
    const { handle } = await api.storeSecret({ ...ref, scopeId: view.scope.scopeId, inputId: view.nextAction.id,
      expectedConfigurationRevision: view.scope.configurationRevision, bytes: new TextEncoder().encode(management) });
    state.handles.push(handle);
    return drive(view, { secretHandle: handle });
  };
  return { start, intake, configure, drive, restart: async () => { api = await restart(); }, q, ref, state,
    get api() { return api; }, get harness() { return harness; }, get appRequests() { return appRequests; },
    catalog, writes, reads, tunnels, records, connectors, foreign, management, runToken };
}

test('managed authorization, exact independent resources, live gate proof, restart and teardown', async t => {
  const fx = await fixture(t);
  const starting = await fx.start();
  assert.equal(starting.state, 'authorization-required');
  assert.deepEqual(fx.writes, []);
  assert.deepEqual(fx.reads, []);
  const pending = await fx.intake(starting);
  assert.equal(pending.state, 'pending');
  let view = await fx.configure(pending);
  assert.equal(view.nextAction.id, 'managed-create-tunnel');
  assert.deepEqual(fx.writes, []);
  view = await fx.drive(view);
  assert.equal(view.nextAction.id, 'managed-configure-tunnel');
  await fx.restart();
  view = await fx.api.readSetupOperation(fx.ref);
  assert.equal(view.resources[0].ownership, 'owned');
  view = await fx.drive(view);
  assert.equal(view.nextAction.id, 'managed-create-dns');
  view = await fx.drive(view);
  assert.equal(view.nextAction.id, 'managed-capture-run-token');
  view = await fx.drive(view);
  assert.equal(view.state, 'complete');
  assert.deepEqual(view.resources.map(row => row.kind), ['tunnel', 'dns', 'credential']);

  const ready = await fx.catalog();
  assert.ok(ready.candidateToken);
  const stateWithSecrets = await readFile(join(fx.ref.home, 'embedding-state.json'), 'utf8');
  for (const bytes of [fx.management, fx.runToken]) assert.ok(!stateWithSecrets.includes(bytes));
  for (const canary of [fx.management, fx.runToken, ...fx.state.handles]) {
    assert.ok(!JSON.stringify([ready, view, fx.harness.events]).includes(canary));
  }
  const route = await fx.api.expose({ ...fx.q, wait: 'verified', approval: { kind: 'route',
    candidateToken: ready.candidateToken, disclosureRevision: ready.disclosure.revision, consentFactsDigest: ready.consentFactsDigest } });
  assert.equal(route.verification.status, 'verified');
  const [connector] = fx.connectors.values();
  const body = await (await fetch('http://' + connector.target + '/application')).text();
  assert.equal(body, 'actual app response');
  assert.ok(fx.appRequests > 0);
  view = await fx.api.cancelSetupOperation(fx.ref);
  assert.equal(view.nextAction.step.purpose, 'stop-connector');
  assert.deepEqual(fx.writes.map(([method]) => method), ['POST', 'PUT', 'POST']);
  const closed = await fx.api.closeRoute({ home: fx.ref.home, handle: route.handle, mode: 'remove' });
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(fx.connectors.size, 0);
  assert.equal(fx.tunnels.size, 2);
  assert.equal(fx.records.size, 2);

  view = await fx.drive(await fx.api.readSetupOperation(fx.ref));
  assert.equal(view.nextAction.step.purpose, 'revoke-credential');
  assert.equal(fx.tunnels.size, 2);
  assert.equal(fx.records.size, 1);
  fx.state.token = 'rotated-secret-fixture';
  view = await fx.api.readSetupOperation(fx.ref);
  assert.equal(view.resources.find(row => row.kind === 'credential').removal, 'confirmed');
  view = await fx.drive(view);
  assert.equal(fx.tunnels.size, 1);
  assert.equal(view.nextAction.id, 'managed-disconnect-connector');
  view = await fx.drive(view);
  assert.equal(view.nextAction.id, 'managed-disconnect-api');
  view = await fx.drive(view);
  assert.equal(view.nextAction, null);
  assert.ok(view.resources.every(row => row.removal === 'confirmed'));
  assert.deepEqual([...fx.records.keys()], [retainedDNS]);
  assert.deepEqual([...fx.tunnels.keys()], [fx.foreign.id]);
  const persisted = await readFile(join(fx.ref.home, 'embedding-state.json'), 'utf8');
  for (const secret of [fx.management, fx.runToken, ...fx.state.handles]) {
    assert.ok(!JSON.stringify([view, fx.harness.events, ready, route, closed]).includes(secret));
    assert.ok(!persisted.includes(secret));
  }
});

test('denial and expiry come from Cloudflare verification, and missing authority preserves unresolved debt', async t => {
  const fx = await fixture(t);
  fx.state.permission = 'denied';
  let view = await fx.intake(await fx.start());
  assert.equal(view.state, 'denied');
  fx.state.permission = 'expired';
  view = await fx.api.readSetupOperation(fx.ref);
  assert.equal(view.state, 'expired');
  assert.deepEqual(fx.writes, []);
  fx.state.permission = 'active';
  view = await fx.configure(await fx.api.readSetupOperation(fx.ref));
  await fx.drive(view);
  fx.state.permission = 'denied';
  await fx.restart();
  view = await fx.api.cancelSetupOperation(fx.ref);
  assert.equal(view.nextAction.kind, 'provide-secret');
  assert.equal(view.nextAction.step.purpose, 'reconcile');
  assert.equal(view.resources[0].removal, 'unconfirmed');
  assert.deepEqual(fx.writes, [['POST', apiPath]]);
});

test('loss before an immutable create receipt never adopts or deletes a name match', async t => {
  const fx = await fixture(t);
  fx.state.dropCreate = true;
  const action = await fx.configure(await fx.intake(await fx.start()));
  const lost = await fx.drive(action);
  assert.equal(lost.state, 'reconciling');
  assert.equal(lost.resources[0].ownership, 'unknown');
  const tunnel = fx.state.ownedTunnel;
  fx.tunnels.delete(tunnel.id);
  const foreignReplacement = { ...tunnel, id: randomUUID() };
  fx.tunnels.set(foreignReplacement.id, foreignReplacement);
  await fx.restart();
  const recovered = await fx.api.cancelSetupOperation(fx.ref);
  assert.equal(recovered.nextAction.kind, 'instructions');
  assert.equal(recovered.resources[0].removal, 'unconfirmed');
  assert.equal((await fx.drive(action)).state, 'cancelled');
  assert.deepEqual(fx.writes, [['POST', apiPath]]);
  assert.ok(fx.tunnels.has(foreignReplacement.id));
});

test('a changed DNS record with the same provider ID keeps cleanup debt and is never deleted', async t => {
  const fx = await fixture(t);
  let view = await fx.configure(await fx.intake(await fx.start()));
  for (let step = 0; step < 3; step++) view = await fx.drive(view);
  const record = fx.records.get(dnsId);
  fx.records.set(dnsId, { ...record, content: 'foreign-change.example.net' });
  view = await fx.api.cancelSetupOperation(fx.ref);
  assert.equal(view.nextAction.id, 'review-uncertain');
  assert.equal(view.resources.find(row => row.kind === 'dns').removal, 'unconfirmed');
  assert.equal(fx.records.get(dnsId).content, 'foreign-change.example.net');
  assert.ok(fx.writes.every(([method]) => method !== 'DELETE'));
});
