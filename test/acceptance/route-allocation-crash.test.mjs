// Historical filename only: these are IN-PROCESS pending-effect replay oracles.
// No SIGKILL, restart, native/generic session, or real-provider crash acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar, fakeRegistry} from '@tnunamak/gozar/testing';
import {query} from '../node/route-schema-check.mjs';

const DEADLINE = 15000;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' deadline')), DEADLINE);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
function allocationOracle(ledger) {
  assert.equal(ledger.allocations, 1, 'exactly one physical fixture allocation');
  assert.equal(ledger.removals, 0, 'pending allocation must not have been removed');
}
test('in-process allocation oracle rejects a deliberately extra physical fixture allocation', () => {
  const ledger = {allocations: 0, removals: 0};
  const physical = new Map();
  const allocate = id => { physical.set(id, {target: 'synthetic'}); ledger.allocations++; };
  allocate('first');
  allocationOracle(ledger);
  allocate('deliberate-extra');
  assert.equal(physical.size, 2);
  assert.throws(() => allocationOracle(ledger), {code: 'ERR_ASSERTION'});
  physical.clear();
});

for (const kind of ['attached', 'durable']) {
  test('in-process ' + kind + ' pending-effect replay retains one allocation and exact cleanup', {timeout: 90000}, async t => {
    const home = await mkdtemp(join(tmpdir(), 'gozar-in-process-cut-'));
    const committed = deferred(), release = deferred();
    const pending = [], handles = new Map(), ledger = {allocations: 0, removals: 0};
    const foreign = {TCP: {'9000': {TCPForward: '127.0.0.1:9001'}}};
    const neighbor = {target: '127.0.0.1:9001', owner: 'foreign'};
    const transports = new Map([['foreign-neighbor', structuredClone(neighbor)]]);
    let config = structuredClone(foreign), version = 1, harness, registry, app;
    let primary, cleanupFailed = false;
    const own = route => {
      if (route?.handle && route.cleanup?.state !== 'confirmed')
        handles.set(JSON.stringify(route.handle), route.handle);
      return route;
    };
    const invoke = action => {
      // Observe rejection immediately; keep the original promise for both-call settlement.
      const promise = Promise.resolve().then(action).then(own, error => { own(error.route); throw error; });
      promise.catch(() => {});
      pending.push(promise);
      return promise;
    };
    const network = async request => {
      const url = new URL(request.url);
      const proxy = url.protocol === 'http:' ? 'http://' + url.host
        : kind === 'durable'
          ? config.Web?.[url.hostname + ':' + (url.port || '443')]?.Handlers?.['/']?.Proxy
          : [...transports.entries()].find(([id, row]) => id !== 'foreign-neighbor' && row.origin === url.origin)?.[1]?.proxy;
      assert.ok(proxy, 'proof must traverse independently stored fixture allocation');
      return new Promise((resolve, reject) => {
        const req = http.get(proxy + url.pathname + url.search, {headers: request.headers}, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => resolve({
            status: response.statusCode, headers: response.headers,
            chunks: [{data: Buffer.concat(chunks).toString('base64'), delayMs: 0}],
          }));
        });
        req.setTimeout(DEADLINE, () => req.destroy(new Error('fixture proof deadline')));
        req.on('error', reject);
      });
    };
    try {
      const verifier = createServiceVerifier();
      app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('synthetic app'); });
      await bounded(new Promise((resolve, reject) => {
        app.once('error', reject); app.listen(0, '127.0.0.1', resolve);
      }), 'app listening');
      const effects = [{kind: 'network', operation: 'fetch', handle: network}];
      let options = {};
      if (kind === 'attached') {
        registry = await fakeRegistry({
          id: 'pending-attached', dir: join(home, 'registry'),
          kinds: ['attached'], reach: 'this-device', transport: 'https',
        });
        options = {manifest: registry.manifest, root: registry.root};
        effects.push(
          {kind: 'process-runtime', operation: 'open', handle: async input => {
            const handle = 'owned-transport-' + (++ledger.allocations);
            transports.set(handle, {origin: input.origin, proxy: 'http://' + input.target});
            committed.resolve();
            await bounded(release.promise, 'attached response release');
            return {handle};
          }},
          {kind: 'process-runtime', operation: 'read', handle: async ({handle}) => ({present: transports.has(handle)})},
          {kind: 'process-runtime', operation: 'close', handle: async ({handle}) => {
            assert.notEqual(handle, 'foreign-neighbor');
            if (transports.delete(handle)) ledger.removals++;
            return {closed: true};
          }},
        );
      } else {
        const node = {
          BackendState: 'Running',
          Self: {DNSName: 'fixture.node.invalid.', ID: 'fixture-node',
            CapMap: {https: [], funnel: [], 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': []}},
          CurrentTailnet: {MagicDNSEnabled: true, MagicDNSSuffix: 'node.invalid'},
          CertDomains: ['fixture.node.invalid'],
        };
        effects.push(
          {kind: 'recipe', operation: 'probe', handle: async ({recipe}) => ({
            stdout: JSON.stringify(recipe.args[0] === 'serve' ? config : node), stderr: '', exitCode: 0,
          })},
          {kind: 'local-api', operation: 'request', handle: async request => {
            if (request.path.includes('status?')) return {status: 200, headers: {}, body: JSON.stringify(node)};
            assert.equal(request.path, '/localapi/v0/serve-config');
            if (request.method === 'GET') return {status: 200, headers: {etag: '"' + version + '"'}, body: JSON.stringify(config)};
            assert.equal(request.method, 'POST');
            if (request.headers['If-Match'] !== '"' + version + '"') return {status: 412, headers: {}, body: ''};
            const before = config.Web?.['fixture.node.invalid:443']?.Handlers?.['/']?.Proxy;
            config = structuredClone(request.body);
            version++;
            const after = config.Web?.['fixture.node.invalid:443']?.Handlers?.['/']?.Proxy;
            if (after) ledger.allocations++; // Count even a duplicate write of the same physical slot.
            if (before && !after) ledger.removals++;
            assert.deepEqual(config.TCP?.['9000'], foreign.TCP['9000'], 'foreign neighbor survives every write');
            if (after && ledger.allocations === 1 && !before) {
              committed.resolve();
              await bounded(release.promise, 'durable response release');
            }
            return {status: 200, headers: {}, body: ''};
          }},
        );
      }
      harness = await createTestingGozar({...options, effects});
      const api = harness.gozar, owner = 'pending-effect-' + kind, operationId = 'same-operation';
      const provider = kind === 'durable'
        ? (await api.listProviders({home, owner})).providers.find(row => row.availability.durable.state === 'available')
        : null;
      if (kind === 'durable') assert.ok(provider, 'shipped durable fixture available');
      const q = query({
        home, owner, operationId,
        ...(provider ? {providerId: provider.providerId} : {}),
        target: '127.0.0.1:' + app.address().port,
        usage: kind === 'durable' ? {kind, routeId: 'pending-durable'} : {kind},
        requirements: {reach: provider?.reach ?? 'this-device', transport: 'https',
          payloadAccess: 'allow-provider', address: kind === 'durable' ? 'stable' : 'any',
          setup: 'allow', protocols: []},
      });
      const choice = (await api.catalogRoutes(q)).candidates[0];
      assert.equal(choice.eligible, true);
      const request = {...q, wait: 'verified', approval: {
        kind: 'route', candidateToken: choice.candidateToken,
        disclosureRevision: choice.disclosure.revision, consentFactsDigest: choice.consentFactsDigest,
      }};
      const call = () => kind === 'attached' ? api.expose(request) : api.ensureRoute(request);
      const first = invoke(call);
      await bounded(committed.promise, 'external allocation committed');
      allocationOracle(ledger);
      const second = invoke(call); // Invoked while the first effect's response remains withheld.
      const listed = await bounded(api.listRoutes({home, owner}), 'public pending listing');
      assert.equal(listed.routes.length, 1);
      const retained = own(listed.routes[0]);
      assert.equal(retained.operationId, operationId);
      assert.equal(retained.handle.kind, kind);
      assert.equal(retained.published, null, 'pending receipt is not published');
      assert.notEqual(retained.cleanup.state, 'confirmed', 'pending allocation remains owned');
      allocationOracle(ledger);
      release.resolve();
      const results = await bounded(Promise.allSettled([first, second]), 'both public calls settle');
      for (const result of results) {
        assert.equal(result.status, 'fulfilled', result.reason?.stack);
        assert.equal(result.value.operationId, operationId);
        assert.deepEqual(result.value.handle, retained.handle);
      }
      allocationOracle(ledger);
      if (kind === 'attached') assert.deepEqual(transports.get('foreign-neighbor'), neighbor);
      else assert.deepEqual(config.TCP['9000'], foreign.TCP['9000']);
      const closed = await bounded(api.closeRoute({home, handle: retained.handle, mode: 'remove'}), 'exact close');
      assert.equal(closed.cleanup.state, 'confirmed');
      handles.delete(JSON.stringify(retained.handle));
      assert.equal(ledger.removals, 1, 'exact close removes the physical allocation once');
      if (kind === 'attached') assert.deepEqual([...transports], [['foreign-neighbor', neighbor]]);
      else assert.deepEqual(config, foreign);
    } catch (error) { primary = error; }
    finally {
      release.resolve();
      const failures = [];
      try { await bounded(Promise.allSettled(pending), 'cleanup settles public calls'); }
      catch (error) { failures.push(error); }
      for (const handle of handles.values()) {
        try {
          const closed = await bounded(harness.gozar.closeRoute({home, handle, mode: 'remove'}), 'cleanup exact close');
          assert.equal(closed.cleanup.state, 'confirmed');
        } catch (error) { failures.push(error); }
      }
      try { if (harness) await bounded(harness.close(), 'testing harness close'); }
      catch (error) { failures.push(error); }
      if (app) {
        app.closeAllConnections();
        try { await bounded(new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())), 'owned app close'); }
        catch (error) { failures.push(error); }
      }
      cleanupFailed = failures.length > 0;
      if (!cleanupFailed) {
        if (registry) await registry.cleanup();
        await rm(home, {recursive: true, force: true});
      } else {
        t.diagnostic('Cleanup debt; retain exact handles ' + JSON.stringify([...handles.values()]) + ' and home ' + home);
      }
      if (failures.length) throw new AggregateError(primary ? [primary, ...failures] : failures, 'In-process fixture cleanup debt');
    }
    if (primary) throw primary;
  });
}
