import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp, mkdir, chmod, rm, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

async function listener() {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', data => socket.end(data));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    address: '127.0.0.1:' + server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

for (const kind of ['attached', 'session']) {
  test('public enumeration withdraws expired ' + kind + ' proof without renewing it',
    {timeout: 20000, concurrency: false}, async t => {
      const parent = join(homedir(), '.tmp');
      await mkdir(parent, {recursive: true});
      const home = await mkdtemp(join(parent, 'ge-'));
      await chmod(home, 0o700); // Private child only, never the shared parent.
      const owner = 'expiry-owner', operationId = 'expiry-' + kind;
      const handles = new Map(), errors = [];
      let api, registry, app, clock = false, unknownAllocation = false;
      const track = route => {
        if (route?.handle) handles.set(JSON.stringify(route.handle), route.handle);
      };
      try {
        app = await listener();
        const id = 'unfamiliar-expiry-' + kind;
        registry = await fakeRegistry({id, dir: join(home, 'registry'),
          kinds: ['attached', 'session'], reach: 'this-device', transport: 'tcp', proofProtocol: 'echo'});
        api = createGozar({manifest: registry.manifest, root: registry.root});
        const q = {schemaVersion: 1, home, owner, operationId, target: app.address,
          usage: kind === 'session' ? {kind, lifetimeMs: 60000} : {kind},
          requirements: {reach: 'this-device', transport: 'tcp', payloadAccess: 'allow-provider',
            address: 'any', setup: 'allow', protocols: []}};
        const choice = (await api.catalogRoutes(q)).candidates[0];
        assert.ok(choice, 'fixture must admit an actual route');
        const authority = Object.fromEntries(Object.entries(choice)
          .filter(([name]) => ['candidateToken', 'consentFactsDigest'].includes(name)));
        let route;
        try {
          route = await api.expose({...q, wait: 'verified',
            approval: {kind: 'route', ...authority, disclosureRevision: choice.disclosure.revision}});
          track(route);
        } catch (error) {
          track(error.route);
          unknownAllocation = !error.route?.handle;
          throw error;
        }
        assert.equal(route.handle.kind, kind);
        const current = await api.routeStatus({home, owner, handle: route.handle});
        track(current);
        assert.equal(current.verification.status, 'verified');
        assert.notEqual(current.published, null);
        assert.ok(current.verification.subject, 'genuine proof identity is required');
        assert.ok(current.verification.checkedAt, 'genuine proof check time is required');
        assert.equal(current.verification.validUntil?.known, true,
          'fixture must supply a known finite expiry; never invent one');
        const expires = Date.parse(current.verification.validUntil.value);
        assert.ok(Number.isFinite(expires), 'proof expiry must be finite');
        assert.ok(expires > Date.now(), 'fresh proof must not already be expired');
        if (kind === 'session') {
          const bootstrap = JSON.parse(await readFile(join(home,
            route.handle.id.split(':')[0], 'bootstrap.json'), 'utf8'));
          assert.equal(bootstrap.execution, 'generic-session-v1');
          assert.deepEqual(bootstrap.handle, route.handle);
        }
        const events = () => readFile(join(registry.root, 'providers', id, 'events.jsonl'));
        const before = await events();
        const fresh = await api.listRoutes({home, owner});
        assert.equal(fresh.routes.length, 1);
        assert.equal(fresh.routes[0].verification.status, 'verified');
        assert.deepEqual(fresh.routes[0].handle, current.handle);
        assert.deepEqual(fresh.routes[0].published, current.published);
        for (const field of ['subject', 'checkedAt', 'validUntil'])
          assert.deepEqual(fresh.routes[0].verification[field], current.verification[field]);
        assert.equal(fresh.routes[0].operationId, operationId);
        assert.deepEqual(await events(), before, 'fresh listing adds no provider effects');

        // Only this process's Date advances. Real timers, IPC, IO and the owned
        // controller clock remain untouched. No fresh routeStatus from here.
        t.mock.timers.enable({apis: ['Date'], now: expires});
        clock = true;
        for (const now of [expires, expires + 1]) {
          t.mock.timers.setTime(now);
          for (let repeat = 0; repeat < 2; repeat++) {
            const listed = await api.listRoutes({home, owner});
            assert.equal(listed.routes.length, 1);
            const expired = listed.routes[0];
            assert.equal(expired.published, null, 'public facade must withdraw expired publication');
            assert.equal(expired.verification.status, 'unverified');
            assert.deepEqual(expired.handle, current.handle, 'same exact handle and generation');
            assert.equal(expired.operationId, operationId);
            for (const field of ['subject', 'checkedAt', 'validUntil'])
              assert.deepEqual(expired.verification[field], current.verification[field],
                field + ' must remain the original evidence, not renewed proof');
            assert.deepEqual(await events(), before, 'expiry listing must cause zero provider events');
          }
        }
      } catch (error) {
        track(error.route);
        errors.push(error);
      } finally {
        // Reset before cleanup: never ask the controller to close under test time.
        if (clock) t.mock.timers.reset();
        let confirmed = !unknownAllocation;
        for (const handle of handles.values()) {
          try {
            const closed = await api.closeRoute({home, owner, handle, mode: 'remove'});
            assert.equal(closed.cleanup.state, 'confirmed', 'exact-handle cleanup must be confirmed');
          } catch (error) {
            confirmed = false;
            errors.push(error);
          }
        }
        try { await app?.close(); } catch (error) { confirmed = false; errors.push(error); }
        if (confirmed) {
          try {
            await registry?.cleanup();
            await rm(home, {recursive: true, force: true});
          } catch (error) { errors.push(error); }
        } else {
          errors.push(new Error('Unconfirmed cleanup; retained private evidence at ' + home));
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Public expiry assertion or cleanup failed');
    });
}
