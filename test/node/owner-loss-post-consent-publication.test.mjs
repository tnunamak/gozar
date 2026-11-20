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

async function fixture(t) {
  await mkdir(join(homedir(), '.tmp'), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(homedir(), '.tmp', 'g-'));
  const home = join(root, 'h');
  const directory = join(home, 'attached', HANDLE_ID);
  const statePath = join(directory, 'state.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const clock = { now: Date.parse('2026-11-20T12:00:00.000Z') };
  const iso = () => new Date(clock.now).toISOString();
  const seen = { configurationReads: 0, initialProofVerified: false, ownerListenerArmed: false,
    ownerLossRequested: false, localCloseSucceeded: false };
  const finalConsentRead = settled(), consentReply = settled(), ownerListenerArmed = settled();
  const localClosed = settled(), initialProof = settled(), heldUsableWrite = settled(), allowUsableWrite = settled();

  const configurationServices = {
    async readConfiguration() {
      const call = ++seen.configurationReads;
      if (call === 4) {
        finalConsentRead.resolve({ call, revision: CONFIGURATION.revision, scopeId: CONFIGURATION.scopeId });
        await consentReply.promise;
      }
      return CONFIGURATION;
    },
    async resolveConfiguration() { return null; },
    async releaseConfigurationUse() { return { released: true }; },
  };
  const identity = { instanceId: 'fixture-instance-1', bootId: 'fixture-boot-1' };
  const broker = await startEmbeddingBroker({ services: configurationServices, home, identity });
  const resolver = await broker.registerController({ identity });

  const adapter = stubAdapter('fake-owner-loss-publication', { caps: properties() });
  const proofServer = net.createServer(socket => { socket.on('error', () => {}); socket.end('local proof endpoint'); });
  await new Promise((resolve, reject) => { proofServer.once('error', reject); proofServer.listen(0, '127.0.0.1', resolve); });
  const proofPort = proofServer.address().port;
  const proofResult = (origin, attempt) => ({ attemptId: attempt.id, endpoint: origin, status: 'verified', checkedAt: iso(),
    vantage: 'this-device', checks: ['nonce'], validUntil: new Date(clock.now + 15_000).toISOString(), facts: [] });
  let closePromise;
  adapter.prepareProof = async () => ({
    target: `127.0.0.1:${proofPort}`,
    async verify({ origin, attempt }) { seen.initialProofVerified = true; initialProof.resolve(); return proofResult(origin, attempt); },
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
  let publicationHeld = false;
  fs.rename = async (from, to) => {
    if (to !== statePath) return originalRename(from, to);
    let candidate = null;
    try { candidate = JSON.parse(await readFile(from, 'utf8')); } catch {}
    const result = await originalRename(from, to);
    if (candidate?.phase === 'usable' && candidate.lastView?.published && !publicationHeld) {
      publicationHeld = true;
      heldUsableWrite.resolve(candidate);
      await allowUsableWrite.promise;
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
    ownerLossLocalCloseMs: 1_000, ownerLossTeardownMs: 10_000 })
    .then(view => ({ view }), error => { throw error; })
    .finally(() => { runSettled = true; });
  run.catch(() => {});
  const pending = [];
  const track = promise => { pending.push(Promise.resolve(promise)); return promise; };
  const status = () => track(controlAttached(directory,
    { type: 'status', fresh: false, handleId: HANDLE_ID, generation: 1 }, 4_000));
  const triggerOwnerLoss = () => { seen.ownerLossRequested = true; stdin.push(null); };
  const releaseConsent = () => consentReply.resolve(CONFIGURATION);

  t.after(async () => {
    try {
      releaseConsent();
      allowUsableWrite.resolve();
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

  return { directory, statePath, proofServer, bootstrap, seen, finalConsentRead, initialProof, ownerListenerArmed, localClosed,
    heldUsableWrite, allowUsableWrite, run, get runSettled() { return runSettled; }, status, triggerOwnerLoss, releaseConsent };
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
