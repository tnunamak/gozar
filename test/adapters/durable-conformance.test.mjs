// A brand-new durable provider (fake-durable: an in-memory versioned rule store with slots and leases) is loaded from its
// own registry entry and driven through the durable engine with no core edit. These tests prove the engine's rules
// against the facet interface, not any real provider. The challenge verifier is faked.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { ensureRoute, releaseRoute, statusRoutes, durablePlanFacts, durableAdapters, setVerifierForTest, casAttempts } from '../../packages/gozar-node/durable-route.mjs';
import { issueConsentToken, consentBinding } from '../../packages/gozar-node/consent-token.mjs';
import { canonicalHome } from '../../packages/gozar-node/service-state.mjs';
import { store } from './fixtures/providers/fake-durable/index.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const requirements = { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [] };
const target = '127.0.0.1:4999';
const adapterId = 'fake-durable';
let home, adapters, deps, verdict, restoreVerifier;

beforeEach(async () => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  home = await mkdtemp(join(homedir(), '.tmp', 'gozar-durable-fake-'));
  adapters = await loadAdapters({ manifest: here('./fixtures/durable-fake.json'), root: here('./fixtures') });
  deps = { adapters };
  store.reset();
  verdict = 'verified';
  restoreVerifier = setVerifierForTest(async () => ({ status: verdict, method: 'challenge', checkedAt: new Date().toISOString(), error: verdict === 'verified' ? null : 'fake', scope: 'controller-origin' }));
});
afterEach(async () => { restoreVerifier(); await rm(home, { recursive: true, force: true }); });

const query = (extra = {}) => ({ schemaVersion: 1, owner: 'example-app', target, usage: { kind: 'durable', routeId: 'coordinator' }, requirements, home, ...extra });
// What the catalog does: read the facts, then issue a single-use token whose grant names the adapter.
async function approved(extra = {}) {
  const q = query(extra);
  const facts = await durablePlanFacts({ home, adapterId, target, origin: q.origin ?? null, adapters });
  const binding = consentBinding({ ...q, intent: 'create' }, await canonicalHome(home, true), 'disclosure-1');
  const { token } = await issueConsentToken({ home, binding, grant: { adapterId, planDigest: facts.planDigest, observedResource: facts.observedResource } });
  return { ...q, approval: { candidateToken: token, disclosureRevision: 'disclosure-1' } };
}
const status = async () => (await statusRoutes({ home }, deps)).routes[0];
const release = () => releaseRoute({ routeId: 'coordinator', home }, deps);

test('the fake provider loads from its own registry entry, and core finds its durable facet', async () => {
  assert.deepEqual((await durableAdapters(deps)).map(adapter => adapter.id), [adapterId]);
});

test('create, verify, publish, status, renew when due, release', async () => {
  store.leaseMs = 3_600_000;
  // The check fails first: the rule is written and receipted, but the origin is not published.
  verdict = 'failed';
  const created = await ensureRoute(await approved(), deps);
  assert.equal(created.route.state, 'unverified');
  assert.equal(created.route.origin, null, 'nothing is published before verification');
  assert.equal(created.route.allocatedOrigin, 'https://a.fake.test');
  assert.deepEqual(store.view(), [['a', { rule: { forward: target }, expiresAt: store.entries.get('a').expiresAt }]]);
  // The check passes: the next status publishes it.
  verdict = 'verified';
  const published = await status();
  assert.equal(published.state, 'usable');
  assert.equal(published.origin, 'https://a.fake.test');
  assert.equal(store.renewals, 0, 'a lease with an hour left is not renewed');
  // Due: status renews it.
  store.entries.get('a').expiresAt = new Date(Date.now() + 5_000).toISOString();
  const renewed = await status();
  assert.equal(renewed.state, 'usable');
  assert.equal(store.renewals, 1);
  assert.ok(Date.parse(store.entries.get('a').expiresAt) > Date.now() + 3_000_000);
  // A renewal that fails is `unverified`, never a silent loss: the rule stays and the route says so.
  store.entries.get('a').expiresAt = new Date(Date.now() + 5_000).toISOString();
  store.failRenew = true;
  const failed = await status();
  assert.equal(failed.state, 'unverified');
  assert.equal(failed.verification.status, 'failed');
  assert.equal(store.entries.has('a'), true);
  store.failRenew = false;
  const released = await release();
  assert.deepEqual(released, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: true, cleanupDebt: null });
  assert.equal(store.entries.size, 0);
  assert.deepEqual((await statusRoutes({ home }, deps)).routes, []);
});

test('a foreign rule in the store survives create and release byte-identical', async () => {
  store.foreignWrite('a', { forward: '127.0.0.1:1' });
  const before = JSON.stringify(store.entries.get('a'));
  const created = await ensureRoute(await approved(), deps);
  assert.equal(created.route.allocatedOrigin, 'https://b.fake.test', 'the occupied slot is skipped');
  assert.equal(created.route.state, 'usable');
  assert.equal(JSON.stringify(store.entries.get('a')), before);
  assert.equal((await release()).removed, true);
  assert.equal(JSON.stringify(store.entries.get('a')), before);
  assert.deepEqual([...store.entries.keys()], ['a']);
});

test('a slot another program holds without a rule is skipped, and nothing is written there', async () => {
  store.foreignClaim('a');
  const created = await ensureRoute(await approved(), deps);
  assert.equal(created.route.allocatedOrigin, 'https://b.fake.test', 'the claimed slot is skipped');
  assert.equal(store.entries.has('a'), false);
  assert.equal((await release()).removed, true);
  assert.deepEqual([...store.entries.keys()], []);
});

test('a changed rule becomes cleanup debt and is not deleted', async () => {
  await ensureRoute(await approved(), deps);
  store.edit('a', { forward: '127.0.0.1:9' });
  const changed = JSON.stringify(store.entries.get('a'));
  const writes = store.writes.length;
  assert.equal((await status()).state, 'uncertain');
  const released = await release();
  assert.deepEqual(released, { schemaVersion: 1, routeId: 'coordinator', removed: false, providerRemoved: false, cleanupDebt: { reason: 'rule-changed', port: 'a' } });
  assert.equal(JSON.stringify(store.entries.get('a')), changed);
  assert.equal(store.writes.length, writes, 'no delete was issued');
});

test('after the provider identity changes, release leaves an equal rule at the new identity in place', async () => {
  await ensureRoute(await approved(), deps);
  // The provider now answers as a different identity (for a node, a new DNS name). The rule at slot `a`
  // is equal to the receipt's rule, but it is not the rule Gozar wrote, so it must not be deleted.
  store.identity = 'store-2';
  const before = JSON.stringify(store.entries.get('a'));
  const writes = store.writes.length;
  const released = await release();
  assert.deepEqual(released, { schemaVersion: 1, routeId: 'coordinator', removed: true, providerRemoved: false, cleanupDebt: null });
  assert.equal(JSON.stringify(store.entries.get('a')), before);
  assert.equal(store.writes.length, writes, 'no delete was issued');
});

test('release preserves a foreign-marked intent rule at its pinned identity after a provider rename', async () => {
  const facet = adapters.find(a => a.id === adapterId).durable;
  const put = facet.put;
  facet.put = async (...args) => { await put(...args); throw new Error('crash after write'); };
  await assert.rejects(ensureRoute(await approved(), deps), /crash after write/);
  facet.put = put;
  const entry = store.entries.get('a');
  entry.foreign = true;
  entry.identity = 'store-1';
  store.identity = 'store-2';
  const before = JSON.stringify(entry);
  const writes = store.writes.length;
  const released = await release();
  assert.equal(released.providerRemoved, false);
  assert.deepEqual(released.cleanupDebt, { reason: 'unattributed-rule', port: 'a' });
  assert.equal(JSON.stringify(store.entries.get('a')), before);
  assert.equal(store.writes.length, writes);
});

test('release with the adapter gone keeps the record as cleanup debt, and dismiss drops it', async () => {
  await ensureRoute(await approved(), deps);
  const before = JSON.stringify(store.view());
  const released = await releaseRoute({ routeId: 'coordinator', home }, { adapters: [] });
  assert.deepEqual(released, { schemaVersion: 1, routeId: 'coordinator', removed: false, providerRemoved: false, cleanupDebt: { reason: 'adapter-unavailable', port: 'a' } });
  assert.equal(JSON.stringify(store.view()), before, 'nothing was removed without the adapter');
  const dismissed = await releaseRoute({ routeId: 'coordinator', home, mode: 'dismiss' }, { adapters: [] });
  assert.equal(dismissed.removed, true);
  assert.deepEqual((await statusRoutes({ home }, deps)).routes, []);
});

test('a crash between the intent write and put is reconciled on the next status', async () => {
  store.crashOnPut = true;
  await assert.rejects(ensureRoute(await approved(), deps), /simulated crash/);
  store.crashOnPut = false;
  assert.equal(store.entries.size, 0);
  const route = await status();
  assert.equal(route.state, 'lost', 'the intent is on record, the rule is not in the store');
  assert.equal(route.origin, null);
  assert.equal(store.writes.length, 0);
});

test('a conflict on every attempt ends in provider_conflict after the bound, with no write', async () => {
  store.alwaysConflict = true;
  await assert.rejects(ensureRoute(await approved(), deps), error => {
    assert.equal(error.code, 'provider_conflict');
    assert.equal(error.provider, 'fake');
    assert.equal(error.nextAction, 'retry later');
    assert.doesNotMatch(error.message, /fake/i, 'core names no provider');
    return true;
  });
  assert.equal(casAttempts, 3, 'the contract bound');
  assert.equal(store.putCalls, 3);
  assert.deepEqual(store.writes, []);
  assert.equal(store.entries.size, 0);
  assert.deepEqual((await statusRoutes({ home }, deps)).routes, [], 'the intent of the failed first allocation was dropped');
});

for (const variant of ['exact', 'missing-evidence', 'foreign', 'different']) {
  test(`interrupted fake create attributes only an exact empty-slot intent: ${variant}`, async () => {
    const facet = adapters.find(a => a.id === adapterId).durable;
    const put = facet.put;
    facet.put = async (...args) => {
      await put(...args);
      throw new Error('crash after write');
    };
    await assert.rejects(ensureRoute(await approved(), deps), /crash after write/);
    facet.put = put;
    if (variant === 'missing-evidence') {
      const dir = join(home, 'routes');
      const path = join(dir, (await readdir(dir)).find(name => name.endsWith('.json')));
      const record = JSON.parse(await readFile(path, 'utf8'));
      delete record.intent.slotWasEmpty;
      await writeFile(path, JSON.stringify(record));
    }
    if (variant === 'foreign') store.entries.get('a').foreign = true;
    if (variant === 'different') store.edit('a', { forward: '127.0.0.1:9', extra: true });
    assert.equal((await status()).state, variant === 'exact' ? 'creating' : 'uncertain');
    const before = store.view();
    const removed = await release();
    assert.equal(removed.providerRemoved, variant === 'exact');
    if (variant !== 'exact') {
      assert.deepEqual(store.view(), before);
      assert.ok(removed.cleanupDebt);
      await releaseRoute({ home, routeId: 'coordinator', mode: 'dismiss' }, deps);
      assert.deepEqual(store.view(), before);
    }
  });
}
