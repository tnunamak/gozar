import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { controlAttached, runAttachedController } from '../../packages/gozar-node/attached-route.mjs';
import { startEmbeddingBroker } from '../../packages/gozar-node/embedding-broker.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { currentRouteReview } from '../../packages/gozar-node/route-consent.mjs';
import { properties, stubAdapter } from './route-schema-check.mjs';

const EXPIRY_MS = 100;
const HANDLE_ID = 'att_0123456789abcdef';
const OWNER = 'fixture-owner';
const CONFIGURATION = { revision: 'fixture-revision-1', scopeId: 'fixture-scope-1' };
const settled = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  let done = false;
  return { promise, resolve(value) { if (!done) { done = true; resolve(value); } } };
};
async function bounded(promise, label, ms = 5_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));

async function fixture(t, { holdConsentRead = 4, armPublicationOnStartup = true, holdRuntimeFacts = false,
  ownerLossTeardownMs = 10_000, observationFact = false } = {}) {
  await mkdir(join(homedir(), '.tmp'), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(homedir(), '.tmp', 'g-'));
  const home = join(root, 'h');
  const directory = join(home, 'attached', HANDLE_ID);
  const statePath = join(directory, 'state.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const clock = { now: Date.parse('2026-11-20T12:00:00.000Z') };
  const iso = () => new Date(clock.now).toISOString();
  const seen = { configurationReads: 0, initialProofVerified: false, refreshProofVerified: false, ownerListenerArmed: false,
    ownerLossRequested: false, localCloseSucceeded: false, runtimeFactsCalls: 0, removeCalls: 0, releaseCalls: 0,
    releaseRequests: [], resourceRemovalWrites: 0, journalWrites: [] };
  const finalConsentRead = settled(), consentReply = settled(), ownerListenerArmed = settled();
  const localClosed = settled(), initialProof = settled(), refreshProof = settled(), heldUsableWrite = settled();
  const allowUsableWrite = settled(), initialUsableSaved = settled(), removalStarted = settled(), allowRemoval = settled();
  const runtimeFactsStarted = settled(), runtimeFactsGate = settled(), ownerLossDeadlineJournal = settled();
  const removalRecordedJournal = settled(), terminalReleasedJournal = settled(), cleanupResolutionJournal = settled();
  const brokerSocketClosed = settled();

  const configurationServices = {
    async readConfiguration() {
      const call = ++seen.configurationReads;
      if (call === holdConsentRead) {
        finalConsentRead.resolve({ call, revision: CONFIGURATION.revision, scopeId: CONFIGURATION.scopeId });
        await consentReply.promise;
      }
      return CONFIGURATION;
    },
    async resolveConfiguration() { return null; },
    async releaseConfigurationUse(use) { seen.releaseCalls++; seen.releaseRequests.push(structuredClone(use)); return { released: true }; },
  };
  const identity = { instanceId: 'fixture-instance-1', bootId: 'fixture-boot-1' };
  const broker = await startEmbeddingBroker({ services: configurationServices, home, identity, onLoss: () => brokerSocketClosed.resolve() });
  const resolver = await broker.registerController({ identity });

  const adapter = stubAdapter('fake-owner-loss-publication', { caps: properties() });
  let observation = 'before-owner-loss';
  if (observationFact) {
    adapter.definition.facts = [{ id: 'fixture.lifecycle', label: 'Fixture lifecycle observation', group: 'proof',
      source: 'local-observation:/lifecycle', known: false, value: null, reason: 'local-observation-unavailable',
      asOf: null, affectsConsent: false }];
    adapter.detect = async () => ({ state: 'ready', facts: { lifecycle: observation } });
  }
  const originalRuntimeFacts = adapter.runtimeFacts.bind(adapter);
  adapter.runtimeFacts = async (...args) => {
    seen.runtimeFactsCalls++;
    if (!holdRuntimeFacts) return originalRuntimeFacts(...args);
    runtimeFactsStarted.resolve();
    const response = await runtimeFactsGate.promise;
    if (response.error) throw response.error;
    return response.facts;
  };
  const proofServer = net.createServer(socket => { socket.on('error', () => {}); socket.end('local proof endpoint'); });
  await new Promise((resolve, reject) => { proofServer.once('error', reject); proofServer.listen(0, '127.0.0.1', resolve); });
  const proofPort = proofServer.address().port;
  const proofResult = (origin, attempt) => ({ attemptId: attempt.id, endpoint: origin, status: 'verified', checkedAt: iso(),
    vantage: 'this-device', checks: ['nonce'], validUntil: new Date(clock.now + 15_000).toISOString(), facts: [] });
  let closePromise;
  adapter.prepareProof = async () => ({
    target: `127.0.0.1:${proofPort}`,
    async verify({ origin, attempt }) { seen.initialProofVerified = true; initialProof.resolve(); return proofResult(origin, attempt); },
    async refresh({ origin, attempt }) { seen.refreshProofVerified = true; refreshProof.resolve(); return proofResult(origin, attempt); },
    close() {
      if (!closePromise) closePromise = new Promise((resolve, reject) => proofServer.close(error => {
        if (error) return reject(error);
        seen.localCloseSucceeded = true;
        localClosed.resolve();
        resolve();
      }));
      return closePromise;
    },
  });
  const remove = adapter.remove.bind(adapter);
  adapter.remove = async (...args) => { seen.removeCalls++; removalStarted.resolve(); await allowRemoval.promise; return remove(...args); };

  const request = { schemaVersion: 1, owner: OWNER, target: '127.0.0.1:49152', origin: null,
    usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider',
      address: 'any', setup: 'none', protocols: [] } };
  const registryId = await registryIdentity({ adapters: [adapter] });
  const registry = { adapters: [{ definition: adapter.definition }] };
  const readContext = { now: () => clock.now, configuration: async () => null,
    probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
  const reviewed = await currentRouteReview({ ...request, home, owner: OWNER }, adapter,
    { embeddingServices: configurationServices, registryId, platform: 'linux', readContext, owner: OWNER });
  const plan = { digest: 'fixture-plan', origin: null, resourceKey: `res-${adapter.id}`,
    effects: [{ target: request.target }], readback: null, cleanup: null, precondition: null };
  const bootstrap = { schemaVersion: 1, id: HANDLE_ID, home, platform: 'linux', adapterId: adapter.id,
    request, plan, owner: OWNER, registryId, registry, identity, resolver, consentReview: reviewed.review,
    leaseExpiryMs: EXPIRY_MS };
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify(bootstrap));

  const originalRename = fs.rename;
  let publicationArmed = armPublicationOnStartup, publicationHeld = false;
  fs.rename = async (from, to) => {
    if (to !== statePath) return originalRename(from, to);
    let candidate = null;
    try { candidate = JSON.parse(await readFile(from, 'utf8')); } catch {}
    const result = await originalRename(from, to);
    if (candidate) {
      const milestone = { phase: candidate.phase, state: candidate.lastView?.state,
        cleanup: candidate.lastView?.cleanup?.state, resourceRemoval: candidate.resourceRemoval ?? null,
        facts: candidate.lastView?.facts ?? [] };
      seen.journalWrites.push(milestone);
      if (milestone.phase === 'uncertain' && milestone.cleanup === 'unconfirmed' && !milestone.resourceRemoval)
        ownerLossDeadlineJournal.resolve(milestone);
      if (milestone.resourceRemoval) {
        seen.resourceRemovalWrites++;
        removalRecordedJournal.resolve(milestone);
        if (seen.resourceRemovalWrites === 3) {
          seen.cleanupResolutionIndex = seen.journalWrites.length - 1;
          cleanupResolutionJournal.resolve(milestone);
        }
      }
      if (milestone.phase === 'released' && milestone.cleanup === 'confirmed' && milestone.resourceRemoval)
        terminalReleasedJournal.resolve(milestone);
    }
    if (candidate?.phase === 'usable' && candidate.lastView?.published) {
      if (publicationArmed && !publicationHeld) {
        publicationHeld = true;
        heldUsableWrite.resolve(candidate);
        await allowUsableWrite.promise;
      } else if (!publicationArmed) initialUsableSaved.resolve(candidate);
    }
    return result;
  };
  syncBuiltinESMExports();

  const stdin = new PassThrough();
  const originalOnce = stdin.once.bind(stdin);
  stdin.once = (event, listener) => {
    const result = originalOnce(event, listener);
    if (event === 'end') { seen.ownerListenerArmed = true; ownerListenerArmed.resolve(); }
    return result;
  };
  let runSettled = false;
  const run = runAttachedController(directory, { adapters: [adapter], effectContext: () => ({}), readContext,
    now: () => clock.now, lease: { kind: 'stdin', stream: stdin },
    ownerLossLocalCloseMs: 1_000, ownerLossTeardownMs })
    .then(view => ({ view }), error => { throw error; })
    .finally(() => { runSettled = true; });
  run.catch(() => {});
  const pending = [];
  const track = promise => { pending.push(Promise.resolve(promise)); return promise; };
  const status = (fresh = false) => track(controlAttached(directory,
    { type: 'status', fresh, handleId: HANDLE_ID, generation: 1 }, 4_000));
  const triggerOwnerLoss = () => { seen.ownerLossRequested = true; stdin.push(null); };
  const releaseConsent = () => consentReply.resolve(CONFIGURATION);
  const armPublication = () => { publicationArmed = true; };

  t.after(async () => {
    try {
      releaseConsent();
      allowUsableWrite.resolve();
      allowRemoval.resolve();
      if (holdRuntimeFacts) runtimeFactsGate.resolve({ facts: await originalRuntimeFacts() });
      if (!runSettled) {
        await Promise.race([ownerListenerArmed.promise, run.then(() => {}, () => {})]);
        if (!runSettled) triggerOwnerLoss();
      }
      await bounded(run.then(() => {}, () => {}), 'controller cleanup', 8_000).catch(() => {});
      await Promise.allSettled(pending);
      if (proofServer.listening) await new Promise((resolve, reject) => proofServer.close(error => error ? reject(error) : resolve()));
      await broker.close().catch(() => {});
    } finally {
      fs.rename = originalRename;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });

  return { directory, statePath, proofServer, adapter, bootstrap, seen, finalConsentRead, initialProof, refreshProof,
    ownerListenerArmed, localClosed, initialUsableSaved, removalStarted, heldUsableWrite, allowUsableWrite, allowRemoval,
    runtimeFactsStarted, ownerLossDeadlineJournal, removalRecordedJournal, terminalReleasedJournal, cleanupResolutionJournal,
    brokerSocketClosed,
    run, get runSettled() { return runSettled; }, status, triggerOwnerLoss, releaseConsent, armPublication,
    setObservation(value) { observation = value; },
    resolveRuntimeFacts(facts) { runtimeFactsGate.resolve({ facts }); },
    rejectRuntimeFacts(error) { runtimeFactsGate.resolve({ error }); } };
}

async function waitForStartupComplete(s) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await bounded(s.status(), 'controller status', 4_500);
    if (result.startupComplete) return result;
    assert.ok(Date.now() < deadline, 'controller did not finish initial startup');
    await new Promise(resolve => setImmediate(resolve));
  }
}

function noPublishedRoute(status, journal, witness) {
  assert.notEqual(status.state, 'usable', `ownerless status became usable: ${JSON.stringify(witness)}`);
  assert.equal(status.published, null, `ownerless status exposed a publication: ${JSON.stringify(witness)}`);
  assert.notEqual(journal.phase, 'usable', `ownerless journal became usable: ${JSON.stringify(witness)}`);
  assert.equal(journal.lastView.published, null, `ownerless journal retained publication: ${JSON.stringify(witness)}`);
}

test('owner loss after matching startup consent cannot publish an attached route', async t => {
  const s = await fixture(t);
  const held = await bounded(s.finalConsentRead.promise, 'final startup consent read');
  await bounded(s.initialProof.promise, 'verified startup proof');
  await bounded(s.ownerListenerArmed.promise, 'stdin owner-loss listener');
  assert.equal(held.call, 4, 'the exact final enforceConsent read is held');
  assert.equal(s.seen.configurationReads, 4);
  assert.equal(s.seen.initialProofVerified, true);
  assert.deepEqual({ revision: held.revision, scopeId: held.scopeId }, CONFIGURATION,
    'the held read returns the exact configuration used to create the approved review');
  assert.notEqual((await json(s.statePath)).phase, 'usable');

  s.triggerOwnerLoss();
  await bounded(s.localClosed.promise, 'successful local forwarding close');
  assert.equal(s.seen.localCloseSucceeded, true);
  assert.equal(s.seen.ownerLossRequested, true);
  assert.equal(s.proofServer.listening, false);
  s.releaseConsent();
  await bounded(s.removalStarted.promise, 'owner-loss provider removal');
  s.allowRemoval.resolve();
  const result = await bounded(Promise.race([
    s.heldUsableWrite.promise.then(record => ({ kind: 'usable-write', record })),
    s.run.then(result => ({ kind: 'run-settled', result }), error => ({ kind: 'run-failed', error })),
  ]), 'owner-loss publication outcome');
  assert.notEqual(result.kind, 'run-failed', result.error?.stack ?? 'controller failed');
  const status = result.kind === 'usable-write' ? (await bounded(s.status(), 'status after startup consent')).view : result.result?.view;
  const journal = await json(s.statePath);
  const witness = { result: result.kind, configurationReads: s.seen.configurationReads,
    proofVerified: s.seen.initialProofVerified, ownerLossRequested: s.seen.ownerLossRequested,
    localCloseSucceeded: s.seen.localCloseSucceeded, status: status && { state: status.state, published: status.published },
    journal: { phase: journal.phase, state: journal.lastView?.state, published: journal.lastView?.published },
    consentFactsDigest: s.bootstrap.consentReview.consentFactsDigest };
  noPublishedRoute(status, journal, witness);
});

test('owner loss during a held refresh consent cannot republish after release starts', async t => {
  const s = await fixture(t, { holdConsentRead: 7, armPublicationOnStartup: false });
  await bounded(s.initialUsableSaved.promise, 'initial usable journal');
  const startup = await bounded(waitForStartupComplete(s), 'initial startup completion');
  assert.equal(startup.view.state, 'usable');

  s.armPublication();
  const refreshRequest = s.status(true);
  const refreshOutcome = refreshRequest.then(result => ({ kind: 'refresh-settled', result }), error => ({ kind: 'refresh-failed', error }));
  const held = await bounded(s.finalConsentRead.promise, 'final refresh consent read');
  await bounded(s.refreshProof.promise, 'verified refresh proof');
  assert.equal(held.call, 7, 'the exact final refresh enforceConsent read is held');
  assert.equal(s.seen.configurationReads, 7);
  assert.equal(s.seen.refreshProofVerified, true);
  assert.deepEqual({ revision: held.revision, scopeId: held.scopeId }, CONFIGURATION,
    'the held read returns the exact configuration used to create the approved review');

  s.triggerOwnerLoss();
  await bounded(s.localClosed.promise, 'successful local forwarding close');
  await bounded(s.removalStarted.promise, 'owner-loss reached the held local removal seam');
  assert.equal(s.seen.localCloseSucceeded, true);
  assert.equal(s.seen.ownerLossRequested, true);
  assert.equal(s.proofServer.listening, false);
  s.releaseConsent();
  const result = await bounded(Promise.race([
    s.heldUsableWrite.promise.then(record => ({ kind: 'usable-write', record })),
    refreshOutcome,
  ]), 'owner-loss refresh publication outcome');
  assert.notEqual(result.kind, 'refresh-failed', result.error?.stack ?? 'refresh failed');
  const status = (await bounded(s.status(), 'status after refresh consent')).view;
  const journal = await json(s.statePath);
  const witness = { result: result.kind, configurationReads: s.seen.configurationReads,
    proofVerified: s.seen.refreshProofVerified, ownerLossRequested: s.seen.ownerLossRequested,
    localCloseSucceeded: s.seen.localCloseSucceeded, status: { state: status.state, published: status.published },
    journal: { phase: journal.phase, state: journal.lastView?.state, published: journal.lastView?.published },
    consentFactsDigest: s.bootstrap.consentReview.consentFactsDigest };
  noPublishedRoute(status, journal, witness);
});

test('a matching refresh consent still permits publication when the owner remains present', async t => {
  const s = await fixture(t, { holdConsentRead: 7, armPublicationOnStartup: false });
  await bounded(s.initialUsableSaved.promise, 'initial usable journal');
  const startup = await bounded(waitForStartupComplete(s), 'initial startup completion');
  assert.equal(startup.view.state, 'usable');

  const refreshRequest = s.status(true);
  const held = await bounded(s.finalConsentRead.promise, 'final refresh consent read');
  await bounded(s.refreshProof.promise, 'verified refresh proof');
  assert.equal(held.call, 7, 'the exact final refresh enforceConsent read is held');
  assert.equal(s.seen.refreshProofVerified, true);
  s.releaseConsent();

  const refreshed = await bounded(refreshRequest, 'ordinary refresh completion');
  assert.equal(refreshed.view.state, 'usable');
  assert.notEqual(refreshed.view.published, null);
  const journal = await json(s.statePath);
  assert.equal(journal.phase, 'usable');
  assert.notEqual(journal.lastView.published, null);
});

test('late non-consent facts from a retired lifecycle are not committed', async t => {
  const s = await fixture(t, { holdConsentRead: 4, observationFact: true });
  const held = await bounded(s.finalConsentRead.promise, 'final startup consent read');
  await bounded(s.initialProof.promise, 'verified startup proof');
  await bounded(s.ownerListenerArmed.promise, 'stdin owner-loss listener');
  assert.equal(held.call, 4);
  const approvedDigest = s.bootstrap.consentReview.consentFactsDigest;

  s.triggerOwnerLoss();
  await bounded(s.localClosed.promise, 'successful local forwarding close');
  s.setObservation('observed-after-owner-loss');
  s.releaseConsent();
  s.allowRemoval.resolve();
  const result = await bounded(s.run, 'owner-loss release completion');
  const journal = await json(s.statePath);
  const observation = journal.lastView.facts.find(fact => fact.id === 'fixture.lifecycle');
  const witness = { state: journal.lastView.state, published: journal.lastView.published,
    cleanup: journal.lastView.cleanup.state, consentFactsDigest: journal.lastView.consentFactsDigest,
    observedFact: observation?.value, removeCalls: s.seen.removeCalls, releaseCalls: s.seen.releaseCalls,
    localCloseSucceeded: s.seen.localCloseSucceeded };
  assert.equal(s.seen.localCloseSucceeded, true);
  assert.equal(s.proofServer.listening, false);
  assert.equal(s.seen.removeCalls, 1);
  assert.equal(s.seen.releaseCalls, 1);
  assert.notEqual(observation?.value, 'observed-after-owner-loss',
    `retired observation was committed: ${JSON.stringify(witness)}`);
  assert.equal(journal.lastView.consentFactsDigest, approvedDigest);
  assert.equal(journal.lastView.state, 'released');
  assert.equal(journal.lastView.published, null);
  process.stdout.write(`retired-facts-witness ${JSON.stringify({ ...witness, controllerReturned: Boolean(result.view) })}\n`);
});

test('current non-consent facts still update while the owner remains present', async t => {
  const s = await fixture(t, { holdConsentRead: 4, armPublicationOnStartup: false, observationFact: true });
  const held = await bounded(s.finalConsentRead.promise, 'final startup consent read');
  await bounded(s.initialProof.promise, 'verified startup proof');
  assert.equal(held.call, 4);
  const approvedDigest = s.bootstrap.consentReview.consentFactsDigest;

  s.setObservation('observed-with-owner-present');
  s.releaseConsent();
  await bounded(s.initialUsableSaved.promise, 'ordinary usable journal');
  const journal = await json(s.statePath);
  const observation = journal.lastView.facts.find(fact => fact.id === 'fixture.lifecycle');
  assert.equal(observation?.known, true);
  assert.equal(observation?.value, 'observed-with-owner-present');
  assert.equal(journal.lastView.consentFactsDigest, approvedDigest);
  assert.equal(journal.lastView.state, 'usable');
  assert.notEqual(journal.lastView.published, null);
  process.stdout.write(`live-facts-witness ${JSON.stringify({ value: observation.value,
    consentFactsDigest: journal.lastView.consentFactsDigest, state: journal.lastView.state })}\n`);
});

test('late startup failure waits for owner-loss deadline and retains cleanup debt without false confirmation', async t => {
  const s = await fixture(t, { holdRuntimeFacts: true, ownerLossTeardownMs: 120 });
  await bounded(s.runtimeFactsStarted.promise, 'held startup runtime facts');
  await bounded(s.ownerListenerArmed.promise, 'stdin owner-loss listener');

  s.triggerOwnerLoss();
  await bounded(s.localClosed.promise, 'successful local forwarding close');
  const deadline = await bounded(s.ownerLossDeadlineJournal.promise, 'owner-loss cleanup deadline journal');
  assert.equal(deadline.phase, 'uncertain');
  assert.equal(deadline.cleanup, 'unconfirmed');
  assert.equal(deadline.resourceRemoval, null);
  assert.equal(s.seen.removeCalls, 0);
  assert.equal(s.seen.releaseCalls, 0);
  assert.equal(s.seen.localCloseSucceeded, true);
  const expiredController = await bounded(s.run, 'owner-loss controller retirement');
  assert.equal(expiredController.view.state, 'uncertain');
  await bounded(s.brokerSocketClosed.promise, 'resolver client socket close');

  s.allowRemoval.resolve();
  s.rejectRuntimeFacts(Object.assign(new Error('controlled late runtime facts failure'), { code: 'provider_unavailable' }));
  const recorded = await bounded(s.removalRecordedJournal.promise, 'exact resource-removal milestone');
  const terminal = await bounded(s.cleanupResolutionJournal.promise, 'central release cleanup journal');
  const expectedHandle = { kind: 'attached', id: HANDLE_ID, generation: 1 };
  const expectedRemoval = { schemaVersion: 1, registryId: s.bootstrap.registryId, owner: OWNER,
    providerId: s.adapter.id, handle: expectedHandle };
  assert.deepEqual(recorded.resourceRemoval, expectedRemoval);
  assert.equal(recorded.cleanup, 'unconfirmed');
  assert.deepEqual(terminal.resourceRemoval, expectedRemoval);
  assert.equal(s.seen.removeCalls, 1, 'only the startup catch removed the provider resource');
  assert.ok(['unconfirmed', 'confirmed'].includes(terminal.cleanup));
  if (terminal.cleanup === 'confirmed') assert.ok(s.seen.releaseCalls > 0, 'confirmed cleanup needs a successful reference-release response');
  assert.ok(s.seen.releaseCalls <= 2, 'startup catch and central release can each request the exact reference release');
  assert.ok(s.seen.releaseRequests.every(use => JSON.stringify(use.handle) === JSON.stringify(expectedHandle)));
  const deadlineIndex = s.seen.journalWrites.findIndex(write => write.phase === 'uncertain' &&
    write.cleanup === 'unconfirmed' && write.resourceRemoval === null);
  const removalIndex = s.seen.journalWrites.findIndex(write => write.resourceRemoval !== null);
  const terminalIndex = s.seen.cleanupResolutionIndex;
  assert.ok(deadlineIndex >= 0 && deadlineIndex < removalIndex && removalIndex < terminalIndex,
    `cleanup milestones were out of order: ${JSON.stringify(s.seen.journalWrites)}`);
  const witness = { deadline: { phase: deadline.phase, cleanup: deadline.cleanup, resourceRemoval: deadline.resourceRemoval },
    removeCalls: s.seen.removeCalls, releaseCalls: s.seen.releaseCalls, releaseHandles: s.seen.releaseRequests.map(use => use.handle),
    final: { phase: terminal.phase, cleanup: terminal.cleanup, resourceRemoval: terminal.resourceRemoval },
    localCloseSucceeded: s.seen.localCloseSucceeded, milestones: s.seen.journalWrites.map(({phase,state,cleanup,resourceRemoval}) => ({phase,state,cleanup,resourceRemoval:Boolean(resourceRemoval)})) };
  process.stdout.write(`late-cleanup-witness ${JSON.stringify({ ...witness, serviceReleaseRequests: s.seen.releaseRequests })}\n`);
});
