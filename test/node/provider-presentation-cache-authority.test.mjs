import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteApi, fakeReadContext } from '../../packages/gozar-node/testing.mjs';
import { listProviders } from '../../packages/gozar-node/embedding-inventory.mjs';
import { createDetectionCache } from '../../packages/gozar-node/detection-cache.mjs';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { scratch, stubAdapter } from './route-schema-check.mjs';

const OWNER = 'presentation-fixture';
const ID = 'presentation';
const COLD = { checkedAt: null, fresh: false, refreshing: false };
const first = async result => (await result).providers[0];
function latch() {
  let open;
  const reached = new Promise(resolve => { open = resolve; });
  return { reached, open };
}

async function within(wait, label, ms = 2_000) {
  let timer;
  try {
    return await Promise.race([wait, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out: ' + label)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const publicCommitWithin = (work, label) => within(work, label, 5_000);

async function fixture(t, { plainInput = false } = {}) {
  const home = await scratch(t);
  let at = Date.parse('2026-11-20T00:00:00Z'), rev, setupCalls = 0, detections = 0, hold, readLatch;
  const subject = stubAdapter(ID);
  const originalDetect = subject.detect.bind(subject);
  const textAction = {
    id: 'fixture-label',
    kind: 'provide-value',
    label: 'Fixture display label',
    valueFormat: 'text',
    digest: 'sha256:' + 'a'.repeat(64),
    disclosure: { revision: 'fixture-label-v1', text: 'Stage an invented display label.', links: [] },
  };
  const adapter = {
    ...subject,
    definition: { ...subject.definition, facts: [{ id: 'fixture-observation', label: 'Fixture observation',
      group: 'proof', affectsConsent: false, source: 'local-observation:/observation' }] },
    ...(plainInput ? { setupActions: () => [textAction], configurationActions: () => [textAction] } : {}),
    async detect(ctx) {
      const n = ++detections, barrier = hold;
      if (barrier) {
        barrier.entered.open();
        await barrier.release.reached;
      }
      const result = await originalDetect(ctx);
      return {
        ...result,
        ...(plainInput ? { state: 'action-required' } : {}),
        facts: { ...result.facts, ...(plainInput ? { setupNeeded: true } : {}), observation: 'observation-' + n },
      };
    },
    async setup() { setupCalls++; throw new Error('The list must not invoke setup'); },
  };
  const registryId = await registryIdentity({ adapters: [adapter] });
  const real = createEmbeddingServices({ registryId });
  const embeddingServices = {
    ...real,
    async readConfiguration(request) {
      const saved = await real.readConfiguration(request);
      readLatch?.open();
      return rev === undefined ? saved : { ...saved, revision: rev };
    },
  };
  const readContext = fakeReadContext({ home, now: () => at });
  const detection = createDetectionCache({ now: () => at, ttlMs: 1_000 });
  const deps = { adapters: [adapter], registryId, embeddingServices, readContext, platform: 'linux', detection };
  const request = { home, owner: OWNER };
  const api = createRouteApi({ ...deps, detectionCache: detection });
  t.after(() => hold?.release.open());
  return {
    api: refresh => first(api.listProviders({ ...request, ...(refresh === undefined ? {} : { refresh }) })),
    list: (refresh = false) => first(listProviders({ ...request, refresh }, deps)),
    ...(plainInput ? {
      publicApi: api,
      scope: { ...request, providerId: ID },
    } : {}),
    setClock: ms => { at += ms; },
    counts: () => ({ detections, setupCalls }),
    fact: row => row.facts.find(fact => fact.id === 'fixture-observation'),
    holdNext() {
      hold = { entered: latch(), release: latch() };
      return hold;
    },
    nextConfigurationRead() { readLatch = latch(); return readLatch.reached; },
    mutate() {
      rev = 'fixture-mutation-v2';
      detection.invalidate({ registryId, home, owner: OWNER, providerId: ID });
    },
  };
}

test('passive presentation is not a probe, even when cold or expired', async t => {
  const f = await fixture(t);
  async function noProbe(read) {
    const before = f.counts();
    const row = await read();
    assert.deepEqual(f.counts(), before, 'passive presentation must run no probe or setup');
    return row;
  }
  const cold = await noProbe(() => f.api());
  assert.deepEqual(cold.detection, COLD);
  assert.equal(f.fact(cold)?.known, false, 'cold facts stay unknown');
  const live = await f.api(true);
  assert.equal(live.detection.fresh, true);
  assert.equal(f.fact(live)?.value, 'observation-1');
  const warm = await noProbe(() => f.api());
  assert.deepEqual(warm.detection, live.detection);
  assert.equal(warm.configuration.revision, live.configuration.revision);
  f.setClock(1_001);
  const expired = await noProbe(() => f.api());
  assert.deepEqual(expired.detection, { ...warm.detection, fresh: false });
  assert.equal(f.fact(expired)?.value, f.fact(warm)?.value);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });

  // Causal negative: the same read invariant must reject a polling wrapper that
  // changes only the authority to probe. No production source is modified.
  await assert.rejects(noProbe(() => f.api(true)), /passive presentation must run no probe or setup/);
  assert.deepEqual(f.counts(), { detections: 2, setupCalls: 0 });
});

test('simultaneous explicit public refreshes share one observation without setup', async t => {
  const f = await fixture(t);
  const barrier = f.holdNext();
  const one = f.api(true);
  let two;
  try {
    await within(Promise.race([barrier.entered.reached, one.then(() => assert.fail('refresh returned before its probe'))]), 'first explicit refresh reached its fixture');
    const secondRead = f.nextConfigurationRead();
    two = f.api(true);
    await within(Promise.race([secondRead, two.then(() => assert.fail('second refresh returned before reading configuration'))]), 'second explicit refresh read configuration');
    assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  } finally {
    barrier.release.open();
    // Both reads are joined even if a causal assertion fails.
    await within(Promise.allSettled(two ? [one, two] : [one]), 'released explicit refreshes settled');
  }
  const replies = await Promise.all([one, two]);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  assert.equal(replies[0].detection.fresh, true);
  assert.deepEqual(replies[0].detection, replies[1].detection);
  assert.equal(f.fact(replies[0])?.value, f.fact(replies[1])?.value);
});

test('an admitted refresh displaced by mutation cannot serve or retain the discarded observation', async t => {
  const f = await fixture(t);
  const before = await f.list();
  const barrier = f.holdNext();
  const old = f.list(true);
  try {
    await within(Promise.race([barrier.entered.reached, old.then(() => assert.fail('refresh returned before its probe'))]), 'refresh reached fixture before invalidation');
    assert.deepEqual((await within(f.list(), 'passive read before invalidation')).detection, { ...COLD, refreshing: true });
    f.mutate();
    const next = await within(f.list(), 'passive read after invalidation');
    assert.notEqual(next.configuration.revision, before.configuration.revision);
    assert.deepEqual(next.detection, COLD);
    assert.equal(f.fact(next)?.known, false);
  } finally {
    barrier.release.open();
    await within(Promise.allSettled([old]), 'released displaced refresh settled');
  }
  const discarded = await old;
  assert.deepEqual(discarded.detection, COLD);
  assert.equal(f.fact(discarded)?.known, false);
  assert.equal(f.fact(await f.list())?.known, false);
  assert.deepEqual(f.counts(), { detections: 1, setupCalls: 0 });
  const refreshed = await f.list(true);
  assert.equal(refreshed.configuration.revision, 'fixture-mutation-v2');
  assert.equal(f.fact(refreshed)?.value, 'observation-2');
  assert.deepEqual(f.counts(), { detections: 2, setupCalls: 0 });
});

test('a public text draft commit displaces an admitted refresh without serving or retaining its observation', async t => {
  const f = await fixture(t, { plainInput: true });
  const { publicApi: api, scope } = f;
  const { home, owner } = scope;
  const poll = () => first(api.listProviders({ home, owner }));
  const refresh = () => first(api.listProviders({ home, owner, refresh: true }));
  const value = 'Invented fixture display label';

  const before = await publicCommitWithin(poll(), 'read applied revision');
  assert.deepEqual(before.detection, COLD);
  const draft = await publicCommitWithin(api.beginConfigurationDraft({
    ...scope, expectedConfigurationRevision: before.configuration.revision,
  }), 'begin plain-text draft');
  const action = draft.configuration.actions.find(candidate => candidate.id === 'fixture-label');
  assert.ok(action && action.kind === 'provide-value');
  assert.equal(action.valueFormat, 'text');
  const requirement = draft.configuration.inputRequirements.find(field => field.actionId === action.id);
  assert.ok(requirement);
  assert.equal(requirement.id, action.id);
  assert.equal(requirement.secret, false);
  assert.equal(typeof action.consent?.consentFactsDigest, 'string');
  const draftScope = { ...scope, draftId: draft.draftId };
  const appliedSetup = await publicCommitWithin(api.runSetupAction({
    ...draftScope,
    expectedConfigurationRevision: draft.configuration.revision,
    actionId: action.id,
    value,
    approval: {
      kind: 'setup',
      digest: action.digest,
      disclosureRevision: action.disclosure.revision,
      consentFactsDigest: action.consent.consentFactsDigest,
    },
  }), 'stage plain-text input');
  assert.equal(appliedSetup.state, 'complete');
  const staged = await publicCommitWithin(api.readConfigurationDraft(draftScope), 'read staged revision');
  assert.notEqual(staged.configuration.revision, draft.configuration.revision);
  assert.equal(staged.configuration.values[requirement.id], value);
  assert.equal((await publicCommitWithin(poll(), 'confirm applied revision before commit')).configuration.revision,
    before.configuration.revision);
  assert.equal(f.counts().setupCalls, 0);

  // Staging also invalidates: admit the applied refresh only after staging has finished.
  const count = f.counts().detections;
  const barrier = f.holdNext();
  const held = refresh();
  let committed;
  try {
    await publicCommitWithin(Promise.race([
      barrier.entered.reached,
      held.then(() => assert.fail('applied refresh returned before its fixture observation')),
    ]), 'applied refresh entered before commit');
    assert.deepEqual(f.counts(), { detections: count + 1, setupCalls: 0 });

    committed = await publicCommitWithin(api.commitConfigurationDraft({
      ...draftScope, expectedConfigurationRevision: staged.configuration.revision,
    }), 'commit plain-text draft');
    assert.notEqual(committed.revision, before.configuration.revision);
    assert.equal(committed.values[requirement.id], value);
    assert.deepEqual(committed.detection, COLD);
  } finally {
    barrier.release.open();
    await publicCommitWithin(Promise.allSettled([held]), 'released applied refresh settled');
  }

  const displaced = await held;
  assert.deepEqual(displaced.detection, COLD);
  assert.equal(f.fact(displaced)?.known, false);
  const next = await publicCommitWithin(poll(), 'poll after public commit');
  assert.equal(next.configuration.revision, committed.revision);
  assert.equal(next.configuration.values[requirement.id], value);
  assert.deepEqual(next.detection, COLD);
  assert.equal(f.fact(next)?.known, false);
  assert.deepEqual(f.counts(), { detections: count + 1, setupCalls: 0 });

  const refreshed = await publicCommitWithin(refresh(), 'explicit refresh after public commit');
  assert.equal(refreshed.configuration.revision, committed.revision);
  assert.equal(refreshed.detection.fresh, true);
  assert.equal(f.fact(refreshed)?.value, 'observation-' + (count + 2));
  assert.deepEqual(f.counts(), { detections: count + 2, setupCalls: 0 });
});
