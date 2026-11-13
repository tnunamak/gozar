// The @tnunamak/gozar/testing helpers: an app lists and uses a fake provider with no code of ours changed and no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteApi, createReadContext, fakeReadContext, fakeRegistry } from '../../packages/gozar-node/testing.mjs';
import { assertShape, codeOf, query, scratch } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fakeId = () => `fake-${randomBytes(4).toString('hex')}`;
const session = home => query({ home, usage: { kind: 'session', lifetimeMs: 60_000 } });

test('red: a fake registry provider is listed by the testing route API, and expose with session usage succeeds against it', async t => {
  const home = await scratch(t), id = fakeId();
  assert.match(id, /^fake-[0-9a-f]{8}$/);
  const registry = await fakeRegistry({ id, kinds: ['session'], reach: 'internet' });
  t.after(registry.cleanup);
  const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
  const catalog = await api.catalogRoutes(session(home));
  assertShape('Catalog', catalog);
  assert.deepEqual(catalog.candidates.map(item => item.providerId), [id], 'the fake is the whole registry');
  const [own] = catalog.candidates;
  assert.equal(own.eligible, true, JSON.stringify(own.unmet));
  assert.equal(typeof own.candidateToken, 'string');
  const view = await api.expose({ ...session(home), approval: { candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision }, wait: 'allocated' });
  assertShape('RouteView', view);
  assert.equal(view.ownership, 'gozar-owned');
  assert.notEqual(view.origin, null);
  assert.equal(view.properties.reach, 'internet');
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

test('red: a durable fake is refused with unsupported and the message that names the durable facet', async () => {
  const error = await fakeRegistry({ id: fakeId(), kinds: ['session', 'durable'], reach: 'internet' }).then(() => null, e => e);
  assert.equal(error?.code, 'unsupported');
  assert.equal(error.message, 'durable fakes need the durable facet');
});

test('fakeRegistry checks its input, writes only under its own directory and removes it on cleanup', async () => {
  for (const bad of [{ id: 'Bad Id', kinds: ['session'], reach: 'internet' }, { id: fakeId(), kinds: [], reach: 'internet' }, { id: fakeId(), kinds: ['session'], reach: 'moon' }, { id: fakeId(), kinds: ['session'], reach: 'lan', transport: 'ftp' }]) {
    assert.equal((await fakeRegistry(bad).then(() => null, e => e))?.code, 'invalid_input', JSON.stringify(bad));
  }
  const registry = await fakeRegistry({ id: fakeId(), kinds: ['session', 'attached'], reach: 'tailnet' });
  await access(join(registry.root, 'providers', registry.manifest.providers[0].id, 'index.mjs'));
  await registry.cleanup();
  await assert.rejects(access(registry.root));
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
