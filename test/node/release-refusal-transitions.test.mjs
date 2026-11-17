import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fakeRegistry } from '@tnunamak/gozar/testing';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { redeemConsentToken } from '../../packages/gozar-node/consent-token.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { scratch, query } from './route-schema-check.mjs';

const fact = id => ({
  id, label: id, value: null, known: false, reason: 'not-observed',
  group: 'fixture', affectsConsent: true, source: `local-observation:/${id}`, asOf: null,
});
async function fixture(t, id, options = {}) {
  const home = options.home ?? await scratch(t), owner = 'transition-owner';
  const registry = await fakeRegistry({
    dir: join(home, 'registry'), id, kinds: ['attached'], reach: 'this-device',
    // The real fixture forwarder emits http://loopback, not HTTPS.
    // Keep declared transport consistent with its allocation in both controls.
    transport: 'http',
    protocols: [], facts: [fact('base')],
  });
  const registryOptions = { manifest: registry.manifest, root: registry.root };
  const services = createEmbeddingServices({ registryId: await registryIdentity(registryOptions) });
  const folder = join(registry.root, 'providers', id);
  const path = join(folder, 'definition.json'), original = await readFile(path, 'utf8');
  const change = async () => {
    const data = JSON.parse(original);
    data.adapter.facts.push(fact('changed-at-boundary'));
    await writeFile(path, JSON.stringify(data));
  };
  const restore = () => writeFile(path, original);
  const counts = async () => {
    let text;
    try { text = await readFile(join(folder, 'events.jsonl'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; text = ''; }
    return {
      starts: (text.match(/"start"/g) ?? []).length,
      removals: (text.match(/"(?:remove|removed|stop|close)"/g) ?? []).length,
    };
  };
  const q = query({
    home, owner, usage: { kind: 'attached' },
    requirements: { reach: 'this-device', transport: 'any', payloadAccess: 'allow-provider',
      address: 'any', setup: 'allow', protocols: [] },
  });
  if (options.target) q.target = options.target;
  const factory = expose => createRouteApi({
    ...registryOptions, embeddingServices: services, ...(expose ? { expose } : {}),
  });
  const request = async api => {
    const choice = (await api.catalogRoutes(q)).candidates[0];
    assert.ok(choice?.candidateToken);
    return {
      ...q, operationId: `operation-${id}`, wait: 'verified',
      approval: { kind: 'route', candidateToken: choice.candidateToken,
        disclosureRevision: choice.disclosure.revision, consentFactsDigest: choice.consentFactsDigest },
    };
  };
  const draft = async api => {
    const { providers } = await api.listProviders({ home, owner });
    assert.equal(providers.length, 1);
    const provider = providers[0];
    assert.ok(provider.configuration);
    return api.beginConfigurationDraft({
      home, owner, providerId: id, expectedConfigurationRevision: provider.configuration.revision,
    });
  };
  const commit = (api, value) => api.commitConfigurationDraft({
    home, owner, providerId: id, draftId: value.draftId,
    expectedConfigurationRevision: value.configuration.revision,
  });
  const onlyRoute = async api => {
    const { routes } = await api.listRoutes({ home, owner });
    assert.equal(routes.length, 1);
    assert.equal(routes[0].handle.kind, 'attached');
    return routes[0];
  };
  const close = (api, handle) => api.closeRoute({ home, owner, handle, mode: 'remove' });
  return { home, owner, services, change, restore, counts, factory, request, draft, commit, onlyRoute, close };
}

test('unchanged registry proves the counts observer sees real attached allocation and removal', async t => {
  // Separate registry/home: positive events cannot satisfy either refusal baseline.
  // This foreign app belongs to the fixture, not to the route being removed.
  const home = await mkdtemp(join(tmpdir(), 'refusal-observer-positive-'));
  const app = createServer((_request, response) => response.end('fixture app'));
  let f, api, bodyError, confirmed = true;
  const handles = new Map(), cleanupErrors = [];
  const remember = handle => { if (handle) handles.set(JSON.stringify(handle), handle); };
  try {
    await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
    f = await fixture(t, 'observer-positive', { home, target: `127.0.0.1:${app.address().port}` });
    api = f.factory();
    assert.deepEqual(await f.counts(), { starts: 0, removals: 0 });
    let route;
    try { route = await api.expose(await f.request(api)); }
    catch (error) { remember(error.route?.handle); throw error; }
    remember(route.handle);
    assert.equal(route.handle.kind, 'attached');
    assert.equal(route.state, 'usable');
    assert.equal(route.verification.status, 'verified');
    assert.deepEqual(await f.counts(), { starts: 1, removals: 0 },
      'a missing or disabled event logger must fail the positive');
    assert.deepEqual((await f.onlyRoute(api)).handle, route.handle);
    for (const current of [api, f.factory()]) {
      // A fresh factory shares services; this is not a process-restart test.
      for (let retry = 0; retry < 2; retry++) {
        const closed = await f.close(current, route.handle);
        assert.deepEqual(closed.handle, route.handle);
        assert.equal(closed.state, 'released');
        assert.equal(closed.cleanup.state, 'confirmed');
        const listed = await f.onlyRoute(current);
        assert.deepEqual(listed.handle, route.handle);
        assert.equal(listed.state, 'released');
        assert.equal(listed.cleanup.state, 'confirmed');
        assert.deepEqual(await f.counts(), { starts: 1, removals: 1 });
      }
    }
    assert.equal(app.listening, true, 'route removal must not close the foreign app');
  } catch (error) { bodyError = error; }
  finally {
    if (api) {
      try { for (const route of (await api.listRoutes({ home, owner: f.owner })).routes) remember(route.handle); }
      catch (error) { confirmed = false; cleanupErrors.push(error); }
      for (const handle of handles.values()) {
        try {
          const closed = await f.close(api, handle);
          assert.deepEqual(closed.handle, handle);
          assert.equal(closed.cleanup.state, 'confirmed');
        } catch (error) { confirmed = false; cleanupErrors.push(error); }
      }
    }
    try {
      app.closeAllConnections();
      if (app.listening) {
        let timer;
        try { await Promise.race([
          new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve())),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture app close unconfirmed')), 2000); }),
        ]); } finally { clearTimeout(timer); }
      }
    } catch (error) { confirmed = false; cleanupErrors.push(error); }
    // Keep recovery records and event evidence if route/app cleanup is uncertain.
    if (confirmed) {
      try { await rm(home, { recursive: true, force: true }); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  const errors = [...(bodyError ? [bodyError] : []), ...cleanupErrors];
  if (errors.length) throw new AggregateError(errors, `positive observer fixture failed; recovery home: ${home}`);
});

test('canonical redemption after reservation sees a changed registry and releases one resource-free handle', async t => {
  const f = await fixture(t, 'redeem-boundary');
  let redeemed = 0, handle, reservedHandle;
  const api = f.factory({
    redeem: async input => {
      // route-api wraps openAttachedRoute in withRouteOperation, whose atomic
      // starting record is written before run; openAttachedRoute then redeems.
      // Read that exact owned record, never manufacture recovery state.
      const operationId = 'operation-redeem-boundary';
      const filename = createHash('sha256').update(JSON.stringify([f.owner, operationId])).digest('hex') + '.json';
      const file = await open(join(f.home, 'operations', filename), 'r');
      let reservation;
      try {
        const buffer = Buffer.alloc(64 * 1024 + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        assert.ok(bytesRead < buffer.length, 'bounded fixture reservation evidence');
        reservation = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      } finally { await file.close(); }
      assert.equal(reservation.owner, f.owner);
      assert.equal(reservation.operationId, operationId);
      assert.equal(reservation.phase, 'starting');
      assert.equal(reservation.view.state, 'creating');
      assert.equal(reservation.view.handle.kind, 'attached');
      reservedHandle = structuredClone(reservation.view.handle);
      assert.deepEqual(await f.counts(), { starts: 0, removals: 0 });
      redeemed++;
      await f.change();
      return redeemConsentToken(input);
    },
  });
  try {
    const request = await f.request(api);
    const before = await f.counts();
    assert.deepEqual(before, { starts: 0, removals: 0 });
    await assert.rejects(api.expose(request), { code: 'artifact_integrity_failed' });
    assert.equal(redeemed, 1);
    const route = await f.onlyRoute(api);
    handle = route.handle;
    assert.deepEqual(handle, reservedHandle, 'refusal retains the pre-mutation reserved identity');
    assert.equal(route.state, 'released');
    assert.equal(route.cleanup.state, 'confirmed');
    assert.equal(route.operationId, request.operationId);
    await f.commit(api, await f.draft(api));
    assert.deepEqual(await f.counts(), before);

    // Restore only the fixture registry deployment, never route/operation state.
    await f.restore();
    for (const current of [api, f.factory()]) {
      for (let retry = 0; retry < 2; retry++) {
        const closed = await f.close(current, handle);
        assert.deepEqual(closed.handle, handle);
        assert.equal(closed.state, 'released');
        assert.equal(closed.cleanup.state, 'confirmed');
        const listed = await f.onlyRoute(current);
        assert.deepEqual(listed.handle, handle);
        assert.equal(listed.state, 'released');
        assert.equal(listed.cleanup.state, 'confirmed');
        assert.deepEqual(await f.counts(), before);
      }
    }
  } finally {
    await f.restore();
    for (const route of (await api.listRoutes({ home: f.home, owner: f.owner })).routes) {
      assert.equal((await f.close(api, route.handle)).cleanup.state, 'confirmed');
    }
  }
});

test('registered configuration hold survives denied release until exact public close retries it', async t => {
  const f = await fixture(t, 'release-boundary');
  const register = f.services.registerConfigurationUse.bind(f.services);
  const release = f.services.releaseConfigurationUse.bind(f.services);
  let denyRelease = true, registered = 0, denied = 0, released = 0, handle;
  f.services.registerConfigurationUse = async input => {
    await register(input); // Store the real hold before changing deployment.
    registered++;
    await f.change();
  };
  f.services.releaseConfigurationUse = async input => {
    if (denyRelease) {
      denied++;
      throw Object.assign(new Error('fixture release unavailable'), { code: 'secret_backend_unavailable' });
    }
    await release(input); // Promise<void>, never a fabricated receipt.
    released++;
  };
  const api = f.factory();
  try {
    const request = await f.request(api), before = await f.counts();
    assert.deepEqual(before, { starts: 0, removals: 0 });
    await assert.rejects(api.expose(request), { code: 'artifact_integrity_failed' });
    assert.equal(registered, 1);
    assert.ok(denied > 0);
    const route = await f.onlyRoute(api);
    handle = route.handle;
    assert.equal(route.cleanup.state, 'unconfirmed');
    assert.equal(route.operationId, request.operationId);
    const draft = await f.draft(api);
    await assert.rejects(f.commit(api, draft), { code: 'configuration_in_use' });

    await f.restore();
    const fresh = f.factory();
    for (const current of [api, fresh]) {
      for (let retry = 0; retry < 2; retry++) {
        const beforeDenial = denied;
        try {
          const result = await f.close(current, handle);
          assert.deepEqual(result.handle, handle);
          assert.equal(result.cleanup.state, 'unconfirmed');
        } catch (error) {
          assert.equal(error.code, 'cleanup_debt');
          assert.ok(error.route, 'a cleanup refusal retains public recovery evidence');
          assert.deepEqual(error.route.handle, handle);
          assert.equal(error.route.cleanup.state, 'unconfirmed');
        }
        assert.ok(denied > beforeDenial, 'close actually retries the denied reference release');
        const listed = await f.onlyRoute(current);
        assert.deepEqual(listed.handle, handle);
        assert.equal(listed.cleanup.state, 'unconfirmed');
        await assert.rejects(f.commit(current, draft), { code: 'configuration_in_use' });
        assert.deepEqual(await f.counts(), before);
        assert.equal(released, 0);
      }
    }

    denyRelease = false;
    const recovered = await f.close(fresh, handle);
    assert.deepEqual(recovered.handle, handle);
    assert.equal(recovered.state, 'released');
    assert.equal(recovered.cleanup.state, 'confirmed');
    assert.ok(released > 0);
    await f.commit(fresh, draft);
    for (let retry = 0; retry < 2; retry++) {
      const closed = await f.close(f.factory(), handle);
      assert.deepEqual(closed.handle, handle);
      assert.equal(closed.state, 'released');
      assert.equal(closed.cleanup.state, 'confirmed');
    }
    assert.deepEqual((await f.onlyRoute(fresh)).handle, handle);
    assert.equal((await f.onlyRoute(fresh)).cleanup.state, 'confirmed');
    assert.deepEqual(await f.counts(), before);
  } finally {
    denyRelease = false;
    f.services.registerConfigurationUse = register;
    await f.restore();
    for (const route of (await api.listRoutes({ home: f.home, owner: f.owner })).routes) {
      assert.equal((await f.close(api, route.handle)).cleanup.state, 'confirmed');
    }
    f.services.releaseConfigurationUse = release;
  }
});
