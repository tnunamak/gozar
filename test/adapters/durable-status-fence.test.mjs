// The unlocked status path renews a due lease only while the route is live (the same fence as a proof).
// Cut: a release commits after the last eligibility read and before the provider's renew call (see tombstone-read-interposer.mjs).
import { interposeTombstoneRead } from '../node/tombstone-read-interposer.mjs'; // first: it wraps fs.link before the library binds it
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { ensureRoute, releaseRoute, statusRoutes, durablePlanFacts, setVerifierForTest } from '../../packages/gozar-node/durable-route.mjs';
import { issueConsentToken, consentBinding } from '../../packages/gozar-node/consent-token.mjs';
import { consentDisclosureRevision } from '../../packages/gozar-node/adopt-disclosure.mjs';
import { canonicalHome } from '../../packages/gozar-node/service-state.mjs';
import { store } from './fixtures/providers/fake-durable/index.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const requirements = { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [] };
const target = '127.0.0.1:4999', adapterId = 'fake-durable';
let home, adapters, deps, restoreVerifier, onVerified;

beforeEach(async () => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  home = await mkdtemp(join(homedir(), '.tmp', 'gozar-status-fence-'));
  adapters = await loadAdapters({ manifest: here('./fixtures/durable-fake.json'), root: here('./fixtures') });
  deps = { adapters };
  store.reset();
  onVerified = () => {};
  restoreVerifier = setVerifierForTest(async () => { onVerified(); return { status: 'verified', method: 'challenge', checkedAt: new Date().toISOString(), error: null, scope: 'controller-origin' }; });
});
afterEach(async () => { restoreVerifier(); await rm(home, { recursive: true, force: true }); });

async function approved() {
  const q = { schemaVersion: 1, owner: 'example-app', target, usage: { kind: 'durable', routeId: 'coordinator' }, requirements, home };
  const facts = await durablePlanFacts({ home, adapterId, target, origin: null, adapters });
  const disclosureRevision = consentDisclosureRevision(adapters.find(adapter => adapter.id === adapterId).definition);
  const binding = consentBinding({ ...q, intent: 'create' }, await canonicalHome(home, true), disclosureRevision);
  const { token } = await issueConsentToken({ home, binding, grant: { adapterId, planDigest: facts.planDigest, observedResource: facts.observedResource } });
  return { ...q, approval: { candidateToken: token, disclosureRevision } };
}

test('a release that commits after the last eligibility read is not followed by a lease renewal', async t => {
  store.leaseMs = 3_600_000;
  await ensureRoute(await approved(), deps);
  store.entries.get('a').expiresAt = new Date(Date.now() + 5_000).toISOString(); // due
  const interposer = interposeTombstoneRead(t);
  onVerified = () => { interposer.armed = true; }; // the proof's own recheck is past; the next such read is the renewal's
  let releasing = null, released = false, witness = null;
  const renewals = [];
  let count = store.renewals;
  Object.defineProperty(store, 'renewals', { configurable: true, get: () => count, set: value => { renewals.push({ afterReleaseCommitted: released }); count = value; } });
  t.after(() => { delete store.renewals; store.renewals = count; });
  interposer.onAbsent = async () => {
    const blocked = interposer.contention();
    releasing = releaseRoute({ routeId: 'coordinator', home }, deps).then(result => { released = true; return result; });
    // Hold the cut until the release did something concrete: reached the reservation lock and lost the link race (fenced: it
    // is blocked behind the renewal), or committed (unfenced). The timer only bounds a broken fixture and fails it.
    let bound; const failed = new Promise((_, reject) => { bound = setTimeout(() => reject(new Error('fixture: the release neither reached the lock nor committed')), 20_000); });
    try { witness = await Promise.race([blocked, releasing.then(() => 'release-committed'), failed]); } finally { clearTimeout(bound); }
  };
  await statusRoutes({ home }, deps);
  assert.equal(interposer.fired, 1, 'the cut was reached once');
  assert.equal(witness, 'blocked-at-lock', 'the competing release was witnessed blocked at the reservation lock while the renewal held the cut');
  assert.equal((await releasing).removed, true, 'the release completed');
  assert.deepEqual(renewals.filter(item => item.afterReleaseCommitted), [], 'no lease was renewed after the release had committed');
  assert.equal(renewals.length, 1, 'the due lease was renewed while the route was still live');
  assert.equal(store.entries.has('a'), false, 'and the release then removed the rule');
});
