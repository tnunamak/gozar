// Topic branch only. Run with node --test test/acceptance/provider-setup.red.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createGozar } from '@tnunamak/gozar';
import { fakeRegistry } from '@tnunamak/gozar/testing';
import { assertShape, query, scratch } from '../node/route-schema-check.mjs';

const exec = promisify(execFile);
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
      'expected red on 0.4: reserving a setup operation needs no approval and makes no provider write');
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
  return { api, ref, start, q, first, world, update, begin, command, restartRead };
}

test('expected red: a browser return remains pending across host restart, and denial or expiry is authoritative', async t => {
  for (const terminal of ['denied', 'expired']) {
    await t.test(terminal, async t => {
      const fx = await fixture(t, 'browser');
      const initial = await fx.begin();
      assert.equal(initial.nextAction.step.actor, 'owner');
      assert.equal(initial.nextAction.kind, 'open-url');
      assert.equal(initial.nextAction.href, undefined);
      const handoff = await fx.api.readSetupOperation({ ...fx.ref, includeBrowserHandoff: true });
      assert.equal(new URL(handoff.nextAction.href).protocol, 'https:');
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

test('expected red: verified grant offers choices, secret intake and admin verification without authorizing provisioning', async t => {
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

test('expected red: an unscoped setup approval at revision zero causes no external write', async t => {
  const fx = await fixture(t, 'owned');
  // An old root-catalog snapshot has no operation binding. The actual legacy
  // executor can create with this approval, so this guards the overload boundary.
  const outcome = await fx.api.runSetupAction({ ...fx.start, approval: approvalFor(fx.first) })
    .then(() => 'accepted', error => error.code);
  assert.equal((await fx.world()).creates, 0, 'expected red on 0.4: an unscoped approval performed a create');
  assert.equal(outcome, 'invalid_input');
});

test('expected red: operation-only provision is refused on the legacy setup path', async t => {
  const fx = await fixture(t, 'owned');
  const { home, owner, providerId, expectedConfigurationRevision, actionId } = fx.start;
  const outcome = await fx.api.runSetupAction({ home, owner, providerId, expectedConfigurationRevision,
    actionId, approval: approvalFor(fx.first) }).then(() => 'accepted', error => error.code);
  assert.equal((await fx.world()).creates, 0, 'expected red on 0.4: legacy setup bypassed the operation journal');
  assert.equal(outcome, 'setup_required');
});

test('expected red: restart and replay reconcile a lost create before cleanup, preserving foreign resources', async t => {
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
