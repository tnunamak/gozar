// The @tnunamak/gozar/testing helpers use synthetic providers and isolated loopback transport.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteApi, createReadContext, fakeReadContext, fakeRegistry } from '../../packages/gozar-node/testing.mjs';
import { assertShape, codeOf, query, scratch } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fakeId = () => `fake-${randomBytes(4).toString('hex')}`;
const session = home => query({ home, usage: { kind: 'session', lifetimeMs: 60_000 } });

test('red: a fake registry provider is listed by the testing route API, and expose with session usage succeeds against it', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-export-')), id = fakeId();
  let cleaned = false;
  t.after(async () => {
    if (cleaned) await rm(home, { recursive: true });
    else t.diagnostic(`Unconfirmed fixture cleanup retained at ${home}`);
  });
  assert.match(id, /^fake-[0-9a-f]{8}$/);
  const registry = await fakeRegistry({ id, kinds: ['session'], reach: 'internet', transport: 'tcp', proofProtocol: 'echo' });
  const requested = { ...session(home), requirements: { ...session(home).requirements, transport: 'tcp', protocols: [] } };
  let api, handle, bodyFailure, bodyFailed = false;
  try {
    api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) }); // A real owned lifecycle, including close: the generic session controller runs.
    const catalog = await api.catalogRoutes(requested);
    assertShape('Catalog', catalog);
    assert.deepEqual(catalog.candidates.map(item => item.providerId), [id], 'the fake is the whole registry');
    const [own] = catalog.candidates;
    assert.equal(own.eligible, true, JSON.stringify(own.unmet));
    assert.equal(typeof own.candidateToken, 'string');
    let view;
    try {
      view = await api.expose({ ...requested, approval: { kind: 'route', consentFactsDigest: own.consentFactsDigest, candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision }, wait: 'allocated' });
      handle = view.handle;
    } catch (error) {
      handle = error.route?.handle;
      throw error;
    }
    assertShape('RouteView', view);
    assert.equal(view.ownership, 'gozar-owned');
    assert.notEqual(view.origin, null);
    assert.equal(view.properties.reach, 'internet');
  } catch (error) {
    bodyFailed = true;
    bodyFailure = error;
    throw error;
  } finally {
    try {
      if (handle) {
        const closed = await api.closeRoute({ home, handle, mode: 'remove' });
        assert.equal(closed.cleanup.state, 'confirmed');
      }
      await registry.cleanup();
      cleaned = true;
    } catch (cleanupFailure) {
      if (bodyFailed) throw new AggregateError([bodyFailure, cleanupFailure], 'Fixture body and cleanup failed');
      throw cleanupFailure;
    }
  }
});

test('a fake whose probe fails is listed but not eligible, and plain HTTP does not meet an https need', async t => {
  const home = await scratch(t);
  const down = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet' });
  const plain = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'lan', transport: 'http' });
  t.after(down.cleanup); t.after(plain.cleanup);
  const [off] = (await createRouteApi({ manifest: down.manifest, root: down.root, readContext: fakeReadContext({ home, probeOk: false }) }).catalogRoutes(session(home))).candidates;
  assert.equal(off.eligible, false);
  assert.equal(off.candidateToken, null);
  const api = createRouteApi({ manifest: plain.manifest, root: plain.root, readContext: fakeReadContext({ home }) });
  const [strict] = (await api.catalogRoutes({ ...session(home), requirements: { ...session(home).requirements, reach: 'lan' } })).candidates;
  assert.equal(strict.eligible, false);
  assert.ok(strict.unmet.some(item => item.requirement === 'transport'));
  const [loose] = (await api.catalogRoutes({ ...session(home), requirements: { ...session(home).requirements, reach: 'lan', transport: 'any' } })).candidates;
  assert.equal(loose.eligible, true);
});

test('red: a fake carries every protocol unless the test narrows it, so an app that needs oauth-dcr can use its own fake', async t => {
  const home = await scratch(t);
  const all = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet' });
  const narrow = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet', protocols: ['sse'] });
  t.after(all.cleanup); t.after(narrow.cleanup);
  const needsDcr = { ...session(home), requirements: { ...session(home).requirements, protocols: ['oauth-dcr'] } };
  const [open] = (await createRouteApi({ manifest: all.manifest, root: all.root, readContext: fakeReadContext({ home }) }).catalogRoutes(needsDcr)).candidates;
  assert.equal(open.eligible, true, JSON.stringify(open.unmet));
  const [shut] = (await createRouteApi({ manifest: narrow.manifest, root: narrow.root, readContext: fakeReadContext({ home }) }).catalogRoutes(needsDcr)).candidates;
  assert.equal(shut.eligible, false);
  assert.ok(shut.unmet.some(item => item.requirement === 'protocols'), JSON.stringify(shut.unmet));
  assert.equal((await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet', protocols: ['carrier-pigeon'] }).then(() => null, e => e))?.code, 'invalid_input');
});

test('red: a durable fake is created, checked, shown usable and verified, and closed with no rule left in its store', async t => {
  const home = await scratch(t), id = fakeId();
  const registry = await fakeRegistry({ id, kinds: ['durable'], reach: 'internet' });
  t.after(registry.cleanup);
  const storePath = join(registry.root, 'providers', id, 'store.json');
  const rules = async () => Object.keys(JSON.parse(await readFile(storePath, 'utf8')).entries);
  const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
  const durable = query({ home, usage: { kind: 'durable', routeId: 'coordinator' } });
  const catalog = await api.catalogRoutes(durable);
  assertShape('Catalog', catalog);
  const [own] = catalog.candidates;
  assert.equal(own.providerId, id);
  assert.equal(own.eligible, true, JSON.stringify(own.unmet));
  const view = await api.ensureRoute({ ...durable, approval: { kind: 'route', consentFactsDigest: own.consentFactsDigest, candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision } });
  assertShape('RouteView', view);
  assert.deepEqual(await rules(), ['a'], 'the rule is in the store file');
  const status = await api.routeStatus({ home, handle: view.handle });
  assert.equal(status.state, 'usable');
  assert.equal(status.verification.status, 'verified');
  assert.equal(status.origin, `https://a.${id}.invalid`);
  const closed = await api.closeRoute({ home, handle: view.handle, mode: 'remove' });
  assertShape('RouteView', closed);
  assert.equal(closed.state, 'released');
  assert.deepEqual(await rules(), [], 'the store holds no rule after close');
});

test('a durable fake answers the check as told: an unverified answer leaves the route unverified', async t => {
  const home = await scratch(t), id = fakeId();
  const registry = await fakeRegistry({ id, kinds: ['durable'], reach: 'internet' });
  t.after(registry.cleanup);
  const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home, verified: false }) });
  const durable = query({ home, usage: { kind: 'durable', routeId: 'coordinator' } });
  const [own] = (await api.catalogRoutes(durable)).candidates;
  const view = await api.ensureRoute({ ...durable, approval: { kind: 'route', consentFactsDigest: own.consentFactsDigest, candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision } });
  assert.equal(view.state, 'unverified');
  assert.equal(view.verification.status, 'unverified');
  assert.equal((await api.routeStatus({ home, handle: view.handle })).state, 'unverified', 'a later status asks the same fake');
});

test('fakeRegistry checks its input, writes only under its own directory and removes it on cleanup', async () => {
  for (const bad of [{ id: 'Bad Id', kinds: ['session'], reach: 'internet' }, { id: fakeId(), kinds: [], reach: 'internet' }, { id: fakeId(), kinds: ['session'], reach: 'moon' }, { id: fakeId(), kinds: ['session'], reach: 'lan', transport: 'ftp' }, { id: fakeId(), kinds: ['session', 'external'], reach: 'tailnet' }]) {
    assert.equal((await fakeRegistry(bad).then(() => null, e => e))?.code, 'invalid_input', JSON.stringify(bad));
  }
  const registry = await fakeRegistry({ id: fakeId(), kinds: ['session', 'durable'], reach: 'tailnet' });
  await access(join(registry.root, 'providers', registry.manifest.providers[0].id, 'index.mjs'));
  await registry.cleanup();
  await assert.rejects(access(registry.root));
});

test('red: cleanup with a caller directory removes the providers directory it made, and leaves the caller directory and other fakes', async t => {
  const dir = await mkdtemp(join(homedir(), '.tmp', 'gozar-fake-dir-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const one = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet', dir });
  const two = await fakeRegistry({ id: fakeId(), kinds: ['session'], reach: 'internet', dir });
  await one.cleanup();
  await access(join(dir, 'providers', two.manifest.providers[0].id)); // another fake in the same directory stays
  await two.cleanup();
  await assert.rejects(access(join(dir, 'providers')), 'the empty providers directory is gone');
  await access(dir);
});

test('createReadContext is the package context itself', () => {
  assert.equal(typeof createReadContext({ home: '/nonexistent' }).probe, 'function');
});

test('the contract names no provider, and the testing module reads no provider recipe', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'adapters/manifest.json'), 'utf8'));
  for (const file of ['packages/gozar-node/route-contract.d.ts', 'packages/gozar-node/testing.mjs']) {
    const text = await readFile(join(root, file), 'utf8');
    for (const { id } of manifest.providers.filter(({ id }) => id.includes('-'))) assert.ok(!text.includes(id), `${file} names ${id}`);
  }
});
