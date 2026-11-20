// The installation identity (the ssh key a key-bound relay uses) is created only after the core admits the consented start,
// is never created by detection, and a stop that arrives while it is being provisioned leaves no late file or publication.
// A stale owner of the installation-key lease keeps the lease until its cleanup is confirmed.
// Ported from the earlier stable-relay tests of the same names, which drove the removed daemon: the same allocation primitive, Journal and
// host preparation are driven directly, with no process and no control socket. The matrix is in the delivery report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../packages/gozar-node/catalog.mjs';
import { SessionAllocation } from '../../packages/gozar-node/session-allocation.mjs';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { acquireInstallKeyLease } from '../../packages/gozar-node/key-route-lease.mjs';
import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import { atomicWrite, Journal } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 18765;
// The proof is never asked in these tests: nothing here reaches a published route.
const proof = { vantages: ['public'], async verify() { throw new Error('no proof is expected'); } };

/** A tunnl-gg controller in `port-18765` of a scratch home, detected and recommended but not started. `edit` changes the adapter first. */
async function world(t, edit = () => {}) {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, `port-${PORT}`); await mkdir(directory);
  const catalog = await loadCatalog(root, { operational: true });
  const adapter = structuredClone(catalog.find(item => item.id === 'tunnl-gg')); edit(adapter);
  const journal = new Journal(directory); await journal.load();
  const gate = await createGate(PORT, { lifetimeMs: 60_000 });
  const controller = new SessionAllocation({ step: await loadCore(), journal, adapters: [adapter], targetPort: gate.port, servicePort: PORT, sessionId: 'identity-test',
    requirements: { clientReach: 'internet', httpsRequired: true, sse: true } });
  t.after(async () => { await controller.shutdown().catch(() => {}); await gate.close?.(); });
  await prepareHost(controller.driver, adapter, { gate, probeExecutor: proof });
  await controller.command({ type: 'detect' }); await controller.command({ type: 'recommend' });
  return { home, directory, adapter, controller, driver: controller.driver, journal, key: join(home, 'identities', 'ed25519'), start: () => controller.command({ type: 'start', adapterId: adapter.id, consent: true }) };
}
const absent = path => assert.rejects(lstat(path), { code: 'ENOENT' });

test('a core grammar refusal creates no installation key and no session identity', async t => {
  const w = await world(t, adapter => {
    // Admission and features stay valid: only the core parser grammar is invalid.
    adapter.recipes.create.parser.jsonEvent.originPointer = 'url';
    assert.equal(adapter.admission.state, 'admitted');
  });
  assert.ok(w.adapter.admission.requiredFeatures.every(feature => w.driver.host.features.includes(feature)));
  const privateFiles = async () => readdir(join(w.directory, 'private')).then(names => names.sort()).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const before = await privateFiles(), ownedBefore = Object.keys(w.driver.journal.value.owned).sort();
  const refusal = await w.start().catch(error => error);
  assert.match(refusal?.message ?? '', /not admitted/);
  await absent(join(w.home, 'identities'));
  assert.deepEqual(await privateFiles(), before);
  assert.deepEqual(Object.keys(w.driver.journal.value.owned).sort(), ownedBefore);
  assert.equal(w.driver.host.bindings.installIdentityPath, undefined);
  assert.equal(w.controller.state.published, null);
});

test('detection and recommendation without consent never create an installation key', async t => {
  const w = await world(t);
  await absent(w.key);
  await absent(join(w.home, 'identities'));
});

test('a provider that is not admitted cannot create a key', async t => {
  const w = await world(t, adapter => { adapter.admission.state = 'blocked'; });
  await assert.rejects(w.start(), /not admitted/);
  await absent(w.key);
});

test('a stop that arrives while the key is being provisioned leaves no late file, no ownership and no publication', async t => {
  const w = await world(t);
  const create = w.driver.privateFiles.create.bind(w.driver.privateFiles);
  let entered; const entering = new Promise(resolve => { entered = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  w.driver.privateFiles.create = async options => { entered(); await held; return create(options); };
  const starting = w.start();
  await entering;
  await w.controller.shutdown();
  release(); await starting.catch(() => {});
  assert.equal(w.controller.state.stopRequested, true);
  assert.equal(w.controller.state.published, null);
  assert.deepEqual(w.controller.journal.value.owned, {});
});

test('a stale owner whose cleanup is not confirmed keeps the key lease, and the refusal names its stop command', async t => {
  const { directory: home } = await fixture(t, {});
  const identities = join(home, 'identities'); await mkdir(identities, { mode: 0o700 });
  const fingerprint = 'a'.repeat(64), oldDirectory = join(home, 'port-18765'); await mkdir(oldDirectory);
  const journal = new Journal(oldDirectory);
  await journal.save({ owned: { orphan: { id: 'orphan', kind: 'process', sessionId: 'old-session' } } });
  const leasePath = join(identities, `.active-route-${fingerprint}.json`);
  await atomicWrite(leasePath, { version: 1, leaseId: 'cleanup-pending', keyFingerprint: fingerprint, pid: 2147483647, startIdentity: '1', sessionId: 'old-session',
    sessionDirectory: oldDirectory, targetPort: 18765, stopCommand: cliCommand('stop', 18765) });
  const acquire = () => acquireInstallKeyLease({ home, keyFingerprint: fingerprint, sessionDirectory: join(home, 'port-18766'), sessionId: 'new-session', targetPort: 18766 });
  await assert.rejects(acquire(), error => {
    assert.match(error.message, /cleanup is not confirmed/);
    assert.ok(error.message.includes(cliCommand('stop', 18765)));
    return true;
  });
  assert.equal(JSON.parse(await readFile(leasePath, 'utf8')).leaseId, 'cleanup-pending');
  // Pending intents, whether or not they name the old session, are unresolved cleanup too.
  for (const session of [{ sessionId: 'old-session' }, {}]) {
    await journal.save({ owned: {}, state: { sessionId: 'old-session', resources: [] }, intents: { pending: { operation: 'create', adapterId: 'tunnl-gg', generation: 1, resourceId: null, ...session } } });
    await assert.rejects(acquire(), /cleanup is not confirmed/);
    assert.equal(JSON.parse(await readFile(leasePath, 'utf8')).leaseId, 'cleanup-pending');
  }
});
