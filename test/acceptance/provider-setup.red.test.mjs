// Topic branch only. Run with node --test test/acceptance/provider-setup.red.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, copyFile, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createGozar } from '@tnunamak/gozar';
import { fakeRegistry } from '@tnunamak/gozar/testing';
import { assertShape, query, scratch } from '../node/route-schema-check.mjs';

const exec = promisify(execFile);
const cli = new URL(import.meta.resolve('@tnunamak/gozar/bin/gozar.mjs'));
const approvalFor = action => ({
  kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
  consentFactsDigest: action.consent.consentFactsDigest,
});

async function fixture(t, mode) {
  const home = await scratch(t);
  const providerId = 'setup-' + randomUUID();
  const registry = await fakeRegistry({
    id: providerId, dir: join(home, 'registry'), kinds: ['attached'], reach: 'this-device',
    facts: [{ id: 'price', label: 'Fixture price', value: null, known: false,
      reason: 'not-read', group: 'cost', affectsConsent: true, source: 'local-observation:/price', asOf: null }],
  });
  const folder = join(registry.root, 'providers', providerId);
  await rename(join(folder, 'index.mjs'), join(folder, 'base.mjs'));
  await copyFile(new URL('./provider-setup-fixture.mjs', import.meta.url), join(folder, 'index.mjs'));
  const worldFile = join(folder, 'world.json');
  const world = async () => JSON.parse(await readFile(worldFile, 'utf8'));
  const update = async patch => writeFile(worldFile, JSON.stringify({ ...await world(), ...patch }));
  const save = current => writeFile(worldFile, JSON.stringify(current));
  await save({
    mode, grant: mode === 'browser' ? 'pending' : 'verified',
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    browserReturned: false, admin: false, connectorCredential: false, price: 0,
    readable: mode !== 'loss', loseResponse: mode === 'loss', creates: 0, calls: [],
    resources: { adopted: 'adopted-dns-sentinel', foreign: 'foreign-tunnel-sentinel' },
  });
  const options = { root: registry.root, manifest: registry.manifest };
  const api = createGozar(options);
  const q = query({ home, usage: { kind: 'attached' },
    requirements: { reach: 'this-device', transport: 'any', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const [candidate] = (await api.catalogRoutes(q)).candidates;
  assert.equal(candidate.providerId, providerId);
  assert.equal(candidate.candidateToken, null);
  const draft = mode === 'loss' ? await api.beginConfigurationDraft({
    home, owner: q.owner, providerId, expectedConfigurationRevision: candidate.configuration.revision,
  }) : null;
  const configuration = draft?.configuration ?? candidate.configuration;
  const [first] = draft ? configuration.actions : candidate.setup.actions;
  assertShape('Action', first);
  assert.equal(first.id, mode === 'browser' ? 'grant' : 'create-tunnel');
  const ref = { home, providerId: candidate.providerId, owner: q.owner, operationId: randomUUID() };
  const start = { ...ref, expectedConfigurationRevision: configuration.revision,
    ...(draft && { draftId: draft.draftId }), expectedSetupRevision: 0, actionId: first.id };
  const begin = async () => {
    assertShape('RunSetupOperationRequest', start);
    let view;
    await assert.doesNotReject(async () => { view = await api.runSetupAction(start); },
      'reserving a setup operation needs no approval and makes no provider write');
    assertShape('SetupOperation', view);
    assert.equal(view.operationId, ref.operationId);
    assert.equal(view.scope.scopeId, configuration.scopeId);
    assert.equal(view.scope.draftId, draft?.draftId ?? null);
    assert.deepEqual(view.nextAction.consent.scope.operation, { id: ref.operationId, revision: view.revision });
    assert.deepEqual((await world()).calls, []);
    return view;
  };
  const command = (view, input = {}) => ({
    ...ref, expectedConfigurationRevision: view.scope.configurationRevision,
    ...(view.scope.draftId && { draftId: view.scope.draftId }),
    expectedSetupRevision: view.revision, actionId: view.nextAction.id,
    approval: approvalFor(view.nextAction), ...input,
  });
  const restartRead = async () => {
    const script = 'import { createGozar } from "@tnunamak/gozar";'
      + 'const [options, ref] = JSON.parse(process.argv[1]);'
      + 'console.log(JSON.stringify(await createGozar(options).readSetupOperation(ref)));';
    const { stdout } = await exec(process.execPath, ['--input-type=module', '--eval', script,
      JSON.stringify([options, ref])], { timeout: 10_000 });
    const view = JSON.parse(stdout);
    assertShape('SetupOperation', view);
    return view;
  };
  return { api, ref, start, q, first, world, update, begin, command, restartRead, draft, registry };
}

test('a browser return remains pending across host restart, and denial or expiry is authoritative', async t => {
  for (const terminal of ['denied', 'expired']) {
    await t.test(terminal, async t => {
      const fx = await fixture(t, 'browser');
      const initial = await fx.begin();
      assert.equal(initial.nextAction.step.actor, 'owner');
      assert.equal(initial.nextAction.kind, 'open-url');
      assert.equal(initial.nextAction.href, undefined);
      const handoff = await fx.api.readSetupOperation({ ...fx.ref, includeBrowserHandoff: true });
      assert.equal(new URL(handoff.nextAction.href).protocol, 'https:');
      assertShape('InteractiveSetupOperation', handoff);
      assert.throws(() => assertShape('SetupOperation', handoff));
      const canary = 'transient-fixture-canary';
      const guesses = [initial, handoff.nextAction.consent, await fx.api.catalogRoutes(fx.q),
        await fx.api.listProviders({ home: fx.ref.home, owner: fx.ref.owner })];
      assert.ok(JSON.stringify(handoff).includes(canary));
      assert.ok(!JSON.stringify(guesses).includes(canary));
      assert.equal(handoff.nextAction.consent.disclosures.action.href, undefined);
      await fx.update({ browserReturned: true });
      const pending = await fx.restartRead();
      assert.equal(pending.state, 'pending');
      assert.equal(pending.evidence.known, false);
      assert.equal((await fx.api.catalogRoutes(fx.q)).candidates[0].candidateToken, null);
      await fx.update({ grant: terminal });
      assert.equal((await fx.restartRead()).state, terminal);
      assert.equal((await fx.world()).creates, 0);
    });
  }
});

test('verified grant offers choices, secret intake and admin verification without authorizing provisioning', async t => {
  const fx = await fixture(t, 'browser');
  await fx.begin();
  await fx.update({ grant: 'verified' });
  const account = await fx.restartRead();
  assert.equal(account.evidence.value.source, 'provider');
  assert.equal(account.nextAction.kind, 'provide-value');
  const [choice] = account.nextAction.step.options;
  await assert.rejects(fx.api.runSetupAction(fx.command(account, { value: 'unoffered' })), { code: 'invalid_input' });
  const intake = await fx.api.runSetupAction(fx.command(account, { value: choice.value }));
  assert.equal(intake.nextAction.kind, 'provide-secret');
  const canary = 'fixture-secret-' + randomUUID();
  const { handle } = await fx.api.storeSecret({ ...fx.ref, scopeId: intake.scope.scopeId,
    expectedConfigurationRevision: intake.scope.configurationRevision, inputId: intake.nextAction.id,
    bytes: new TextEncoder().encode(canary) });
  const admin = await fx.api.runSetupAction(fx.command(intake, { secretHandle: handle }));
  assert.equal(admin.nextAction.step.actor, 'administrator');
  assert.equal(admin.nextAction.step.verification, 'provider');
  assert.ok(admin.nextAction.step.permission.label);
  const stillWaiting = await fx.api.runSetupAction(fx.command(admin, { approval: undefined }));
  assert.equal(stillWaiting.state, 'authorization-required');
  assert.equal((await fx.world()).admin, false);
  await fx.update({ admin: true });
  const provision = await fx.restartRead();
  assert.equal(provision.nextAction.step.purpose, 'provision');
  const unapproved = await fx.api.runSetupAction(fx.command(provision, { approval: undefined }));
  assert.equal(unapproved.state, 'authorization-required');
  assert.equal((await fx.world()).creates, 0);
  const inventory = await fx.api.listProviders({ home: fx.ref.home, owner: fx.ref.owner });
  const output = JSON.stringify([intake, admin, stillWaiting, provision, unapproved, inventory]);
  assert.equal(output.includes(canary) || output.includes(handle), false);
});

test('an unscoped setup approval at revision zero causes no external write', async t => {
  const fx = await fixture(t, 'owned');
  // An old root-catalog snapshot has no operation binding. The actual legacy
  // executor can create with this approval, so this guards the overload boundary.
  const outcome = await fx.api.runSetupAction({ ...fx.start, approval: approvalFor(fx.first) })
    .then(() => 'accepted', error => error.code);
  assert.equal((await fx.world()).creates, 0, 'an unscoped approval performed a create');
  assert.equal(outcome, 'invalid_input');
});

test('operation-only provision is refused on the legacy setup path', async t => {
  const fx = await fixture(t, 'owned');
  const { home, owner, providerId, expectedConfigurationRevision, actionId } = fx.start;
  const outcome = await fx.api.runSetupAction({ home, owner, providerId, expectedConfigurationRevision,
    actionId, approval: approvalFor(fx.first) }).then(() => 'accepted', error => error.code);
  assert.equal((await fx.world()).creates, 0, 'legacy setup bypassed the operation journal');
  assert.equal(outcome, 'setup_required');
});

test('restart and replay reconcile a lost create before cleanup, preserving foreign resources', async t => {
  const fx = await fixture(t, 'loss');
  const initial = await fx.begin();
  // Crossing the operation scope must fail even with the same provider and revision.
  const other = await fx.api.runSetupAction({ ...fx.start, operationId: randomUUID() });
  await assert.rejects(fx.api.runSetupAction({ ...fx.command(initial), operationId: other.operationId }), { code: 'consent_mismatch' });
  assert.equal((await fx.world()).creates, 0);

  await fx.update({ price: 1 });
  await assert.rejects(fx.api.runSetupAction(fx.command(initial)), { code: 'consent_mismatch' });
  assert.equal((await fx.world()).creates, 0);
  const refreshed = await fx.restartRead();
  assert.notEqual(refreshed.nextAction.consent.consentFactsDigest, initial.nextAction.consent.consentFactsDigest);
  const create = fx.command(refreshed);
  const uncertain = await fx.api.runSetupAction(create);
  assert.equal(uncertain.state, 'reconciling');
  assert.equal((await fx.world()).creates, 1);
  const replay = await fx.api.runSetupAction(create);
  assert.equal(replay.state, 'reconciling');
  const afterRestart = await fx.restartRead();
  const debt = afterRestart.resources.find(resource => resource.kind === 'tunnel' && resource.ownership === 'unknown');
  assert.equal(debt.presence.known, false);
  assert.equal(debt.removal, 'unconfirmed');
  assert.equal((await fx.world()).creates, 1);
  await assert.rejects(fx.api.readSetupOperation({ ...fx.ref, owner: 'foreign-owner' }));
  await assert.rejects(fx.api.cancelSetupOperation({ ...fx.ref, owner: 'foreign-owner' }));

  const cancelled = await fx.api.cancelSetupOperation(fx.ref);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.resources.find(resource => resource.handle === debt.handle).removal, 'unconfirmed');
  await fx.update({ readable: true });
  const recoverable = await fx.restartRead();
  assert.equal(recoverable.nextAction.step.purpose, 'remove-resource');
  assert.equal(recoverable.nextAction.step.resourceHandle, debt.handle);
  await fx.api.runSetupAction(create); // A replay after cancellation remains a recovery read.
  assert.equal((await fx.world()).creates, 1);
  const removed = await fx.api.runSetupAction(fx.command(recoverable));
  assert.equal(removed.resources.find(resource => resource.handle === debt.handle).removal, 'confirmed');
  assert.deepEqual((await fx.world()).resources, { adopted: 'adopted-dns-sentinel', foreign: 'foreign-tunnel-sentinel' });
  assert.deepEqual((await fx.world()).calls, ['create-tunnel', 'remove-tunnel']);
});


test('concurrent reservation and replay allocate once, and unrelated scopes or altered replay are refused', async t => {
  const fx = await fixture(t, 'owned');
  const [first, second] = await Promise.all([fx.api.runSetupAction(fx.start), fx.api.runSetupAction(fx.start)]);
  assert.equal(second.revision, first.revision);
  assert.deepEqual(second.scope, first.scope);
  assert.deepEqual(second.nextAction, first.nextAction);
  assert.deepEqual(second.resources, first.resources);
  const run = fx.command(first);
  const otherHome = await scratch(t);
  for (const patch of [
    { home: otherHome }, { providerId: 'foreign-provider' }, { owner: 'foreign-owner' },
    { draftId: randomUUID() }, { expectedConfigurationRevision: 'wrong' }, { expectedSetupRevision: first.revision + 10 },
  ]) {
    await assert.rejects(fx.api.runSetupAction({ ...run, ...patch }));
  }
  assert.equal((await fx.world()).creates, 0);
  await Promise.all([fx.api.runSetupAction(run), fx.api.runSetupAction(run), fx.api.runSetupAction(run)]);
  assert.equal((await fx.world()).creates, 1);
  await assert.rejects(fx.api.runSetupAction({ ...run, value: 'changed' }), { code: 'consent_mismatch' });
  await assert.rejects(fx.api.runSetupAction({ ...run, approval: { ...run.approval, digest: 'changed' } }), { code: 'consent_mismatch' });
});

test('not-found while create can still settle stays uncertain through cancel and discarded draft', async t => {
  const fx = await fixture(t, 'loss');
  await fx.update({ deferCreate: true, readable: true });
  const command = fx.command(await fx.begin());
  const initial = await fx.api.runSetupAction(command);
  assert.equal(initial.state, 'reconciling');
  assert.equal(initial.resources[0].presence.known, false);
  await fx.api.discardConfigurationDraft({ ...fx.ref, draftId: fx.draft.draftId });
  await fx.api.cancelSetupOperation(fx.ref);
  assert.equal((await fx.api.runSetupAction(command)).resources[0].presence.known, false);
  assert.equal((await fx.world()).creates, 1);
  const current = await fx.world();
  await fx.update({ allocation: current.pendingAllocation, resources: {
    ...current.resources, tunnel: current.pendingAllocation.id,
  } });
  const recoverable = await fx.restartRead();
  assert.equal(recoverable.state, 'cancelled');
  assert.equal(recoverable.nextAction.step.purpose, 'remove-resource');
  const removed = await fx.api.runSetupAction(fx.command(recoverable));
  assert.equal(removed.resources[0].removal, 'confirmed');
  assert.equal((await fx.world()).creates, 1);
});

test('persistence failures before dispatch and after provider success preserve admission boundaries', async t => {
  for (const when of ['before', 'after']) {
    await t.test(when, async t => {
      const fx = await fixture(t, 'owned');
      const run = fx.command(await fx.begin());
      await fx.update({ journalFault: when });
      await assert.rejects(fx.api.runSetupAction(run));
      const journal = join(fx.ref.home, 'embedding-state.json');
      await rmdir(journal);
      await rename(journal + '.saved', journal);
      const expected = when === 'before' ? 0 : 1;
      assert.equal((await fx.world()).creates, expected);
      await fx.update({ journalFault: null });
      const restored = await fx.restartRead();
      assert.equal(restored.resources.length, expected);
      await fx.api.runSetupAction(run);
      assert.equal((await fx.world()).creates, 1);
    });
  }
});

test('installed CLI and package API drive a randomized provider from the same safe offers', async t => {
  const fx = await fixture(t, 'browser');
  const manifest = join(fx.ref.home, 'manifest.json');
  const request = join(fx.ref.home, 'request.json');
  await writeFile(manifest, JSON.stringify(fx.registry.manifest));
  const drive = async (verb, data, ...flags) => {
    await writeFile(request, JSON.stringify(data), { mode: 0o600 });
    const response = await exec(process.execPath, [cli.pathname, 'setup-operation', verb,
      '--request-file', request, '--registry-file', manifest, '--registry-root', fx.registry.root, '--json', ...flags]);
    return JSON.parse(response.stdout);
  };
  const reserved = await drive('reserve', fx.start);
  assertShape('SetupOperation', reserved);
  assert.equal(reserved.nextAction.href, undefined);
  const handoff = await drive('read', fx.ref, '--browser-handoff');
  assertShape('InteractiveSetupOperation', handoff);
  assert.ok(handoff.nextAction.href);
  assert.equal(handoff.nextAction.consent.disclosures.action.href, undefined);
  await fx.update({ grant: 'verified' });
  const choice = await drive('read', fx.ref);
  const intake = await drive('run', fx.command(choice, { value: choice.nextAction.step.options[0].value }));
  const secretFile = join(fx.ref.home, 'secret.txt');
  const credential = 'cli-canary-' + randomUUID();
  await writeFile(secretFile, credential, { mode: 0o600 });
  const admin = await drive('run', fx.command(intake), '--secret-file', secretFile);
  assert.equal(admin.nextAction.step.actor, 'administrator');
  assert.ok(!JSON.stringify(admin).includes(credential));
  const cancelled = await drive('cancel', fx.ref);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal((await fx.world()).creates, 0);
});

test('a replaced allocation cannot rearm the original intent after exact absence', async t => {
  const fx = await fixture(t, 'owned');
  const command = fx.command(await fx.begin());
  const created = await fx.api.runSetupAction(command);
  assert.equal(created.resources[0].ownership, 'owned');
  const world = await fx.world();
  const replacement = 'foreign-replacement';
  await fx.update({ offerAgain: true, resources: { ...world.resources, tunnel: replacement } });
  const missing = await fx.api.readSetupOperation(fx.ref);
  assert.equal(missing.resources[0].removal, 'confirmed');
  assert.equal((await fx.api.readSetupOperation(fx.ref)).nextAction, null);
  await fx.api.runSetupAction(command);
  assert.equal((await fx.world()).creates, 1);
  assert.equal((await fx.world()).resources.tunnel, replacement);
});

test('an unknown adapter can report workflow completion with missing or foreign evidence without publishing', async t => {
  const fx = await fixture(t, 'complete');
  await fx.begin();
  for (const completion of ['missing', 'foreign']) {
    await fx.update({ completion });
    const view = await fx.api.readSetupOperation(fx.ref);
    assertShape('SetupOperation', view);
    assert.equal(view.state, 'complete');
    assert.deepEqual(view.evidence, { known: false, reason: 'setup-evidence-unavailable' });
    assert.deepEqual(view.resources, []);
    const [candidate] = (await fx.api.catalogRoutes(fx.q)).candidates;
    assert.equal(candidate.candidateToken, null);
    await assert.rejects(fx.api.expose({ ...fx.q, operationId: fx.ref.operationId, wait: 'verified' }), { code: 'consent_required' });
    assert.deepEqual((await fx.world()).calls, []);
  }
});
