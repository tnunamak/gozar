// Run against the shared setup runtime plus the provider adapters.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { query, scratch } from '../node/route-schema-check.mjs';

const owner = 'provider-setup-fixture';
const approval = action => ({ kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
  consentFactsDigest: action.consent.consentFactsDigest });

async function setup(t, providerId, effects, home, { secretBackend, draft = false, initialAgent } = {}) {
  const startFactory = async () => {
    const harness = await createTestingGozar({ effects, secretBackend });
    t.after(harness.close);
    return harness;
  };
  const harness = await startFactory();
  const api = harness.gozar, ref = { home, owner, providerId, operationId: randomUUID() };
  const { providers } = await api.listProviders({ home, owner });
  const provider = providers.find(row => row.providerId === providerId);
  assert.ok(provider, 'shipped provider is discoverable');
  const entry = provider.prerequisites.find(row => row.remedy?.id.endsWith('-setup'))?.remedy;
  assert.equal(entry?.kind, 'gozar-runs');
  let configuration = provider.configuration;
  if (initialAgent) {
    const auth = configuration.actions.find(action => action.id === 'auth');
    const request = { home, owner, providerId, expectedConfigurationRevision: configuration.revision };
    const { handle } = await api.storeSecret({ ...request, scopeId: configuration.scopeId, inputId: 'auth', bytes: Buffer.from(initialAgent) });
    configuration = (await api.runSetupAction({ ...request, actionId: auth.id, approval: approval(auth), secretHandle: handle })).configuration;
  }
  const draftId = draft ? (await api.beginConfigurationDraft({ ...ref, expectedConfigurationRevision: configuration.revision })).draftId : undefined;
  if (draftId) configuration = (await api.readConfigurationDraft({ ...ref, draftId })).configuration;
  const view = await api.runSetupAction({ ...ref, ...(draftId && { draftId }), expectedSetupRevision: 0,
    expectedConfigurationRevision: configuration.revision, actionId: entry.id });
  assert.equal(view.nextAction.id, entry.id);
  const command = (current, values = {}) => ({ ...ref, ...(draftId && { draftId }), expectedSetupRevision: current.revision,
    expectedConfigurationRevision: current.scope.configurationRevision, actionId: current.nextAction.id,
    approval: approval(current.nextAction), ...values });
  const advance = (current, values) => api.runSetupAction(command(current, values));
  const secret = async (current, value) => {
    const { handle: secretHandle } = await api.storeSecret({ ...ref, ...(draftId && { draftId }), inputId: current.nextAction.inputId,
      scopeId: current.scope.scopeId, expectedConfigurationRevision: current.scope.configurationRevision, bytes: Buffer.from(value) });
    return advance(current, { secretHandle });
  };
  return { api, ref, harness, view, advance, secret, command, draftId, startFactory };
}

for (const [providerId, vantage] of [
  ['tailscale-private', 'independent tailnet client'],
  ['tailscale-funnel', 'independent public internet client'],
]) test(`public ${providerId} setup reserves inertly, redacts its handoff, and verifies the exact node`, async t => {
  const home = await scratch(t), state = join(home, 'provider.json');
  const save = value => writeFile(state, JSON.stringify(value));
  const read = async () => JSON.parse(await readFile(state, 'utf8'));
  const account = 'owner@example.invalid', tailnet = 'fixture.ts.net', dnsName = 'host.fixture.ts.net';
  const href = `https://login.tailscale.com/a/public-handoff-canary-${providerId}`;
  await save({ status: { BackendState: 'NeedsLogin' }, writes: 0 });
  const effects = [
    { kind: 'recipe', operation: 'probe', handle: async ({ recipe }) => {
      if (recipe.program !== 'tailscale') return { exitCode: 1, stderr: '', stdout: '' };
      const current = await read();
      return { exitCode: 0, stderr: '', stdout: JSON.stringify(recipe.args[0] === 'status' ? current.status : {}) };
    } },
    { kind: 'spawn', operation: 'run', handle: async ({ program, args, longRunning }) => {
      assert.equal(program, 'tailscale');
      assert.deepEqual(args, ['up', '--timeout=12s', '--json']);
      assert.equal(longRunning, false);
      const data = await read();
      data.status.AuthURL = href;
      data.writes += 1;
      await save(data);
      return { exitCode: 1, stderr: 'timed out', stdout: JSON.stringify(data.status) };
    } },
  ];
  const { api, ref, harness, advance, view } = await setup(t, providerId, effects, home);
  assert.equal((await read()).writes, 0);
  const user = await advance(view);
  assert.equal(user.nextAction.id, 'tailscale-account');
  const intended = await advance(user, { value: account });
  assert.equal(intended.nextAction.id, 'tailscale-tailnet');
  const login = await advance(intended, { value: tailnet });
  assert.equal(login.nextAction.id, 'tailscale-login');
  const browser = await advance(login);
  assert.equal(browser.state, 'pending');
  assert.equal(browser.nextAction.href, undefined);
  assert.doesNotMatch(JSON.stringify(browser), /public-handoff-canary/);
  assert.equal((await api.readSetupOperation({ ...ref, includeBrowserHandoff: true })).nextAction.href, href);
  assert.equal((await advance(browser)).state, 'pending');
  assert.equal((await read()).writes, 1);
  await assert.rejects(api.readSetupOperation({ ...ref, owner: 'foreign', includeBrowserHandoff: true }));
  await save({ status: { BackendState: 'NeedsMachineAuth' }, writes: 1 });
  const administrator = await api.readSetupOperation(ref);
  assert.equal(administrator.nextAction.step.actor, 'administrator');
  assert.equal(administrator.state, 'pending');
  await save({ writes: 1, status: {
    BackendState: 'Running', Self: { ID: 'fixture-node', UserID: 7, DNSName: dnsName + '.', CapMap: { https: null, funnel: null, 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': null } },
    User: { 7: { ID: 7, LoginName: account } }, CurrentTailnet: { MagicDNSSuffix: tailnet, MagicDNSEnabled: true }, CertDomains: [dnsName],
  } });
  const node = await api.readSetupOperation(ref);
  assert.equal(node.nextAction.id, 'tailscale-node');
  const ready = await advance(node, { value: node.nextAction.step.options[0].value });
  assert.equal(ready.state, 'complete');
  assert.equal(ready.evidence.known, true);
  assert.ok(ready.evidence.value.summary.includes(vantage));
  const cancelled = await api.cancelSetupOperation(ref);
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(cancelled.resources, []);
  assert.equal((await read()).writes, 1);
  assert.doesNotMatch(JSON.stringify(harness.events), /public-handoff-canary/);
});

for (const draft of [false, true]) test(`public ngrok disconnect after ${draft ? 'discarded draft and factory restart' : 'cancellation'} removes only local inventory custody`, async t => {
  const home = await scratch(t);
  let sdk = false, reads = 0;
  const agent = 'public-agent-canary', key = 'public-management-canary', name = 'agent.ngrok.app';
  const byteStore = await scratch(t);
  const handles = new Map(), secretReads = [], deletes = [];
  const secretBackend = {
    async put({ bytes, inputId }) {
      const handle = randomUUID();
      await writeFile(join(byteStore, handle), bytes, { mode: 0o600 });
      handles.set(inputId, handle);
      return { handle };
    },
    async withSecret({ handle }, use) {
      secretReads.push(handle);
      return use(await readFile(join(byteStore, handle)));
    },
    async presence({ handle }) {
      try { await stat(join(byteStore, handle)); return { known: true, value: true }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return { known: true, value: false }; }
    },
    async delete({ handle }) {
      deletes.push(handle);
      await unlink(join(byteStore, handle));
      return { deleted: true };
    },
  };
  const effects = [
    { kind: 'sdk-listener', operation: 'detect', handle: async () => ({ available: sdk }) },
    { kind: 'network', operation: 'fetch', handle: async ({ url, method, headers }) => {
      assert.equal(url, 'https://api.ngrok.com/reserved_domains');
      assert.equal(method, 'GET');
      assert.equal(headers.Authorization, 'Bearer ' + key);
      reads += 1;
      const data = Buffer.from(JSON.stringify({ reserved_domains: [{ id: 'rd_fixture', domain: name }], next_page_uri: null }));
      return { status: 200, headers: {}, chunks: [{ data: data.toString('base64'), delayMs: 0 }] };
    } },
  ];
  const { api, ref, harness, advance, secret, view, command, draftId, startFactory } =
    await setup(t, 'ngrok-https-edge', effects, home, { secretBackend, draft, initialAgent: draft ? agent : undefined });
  const dependency = await advance(view);
  assert.equal(dependency.nextAction.kind, 'install-artifact');
  assert.match(dependency.nextAction.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await advance(dependency)).state, 'blocked', 'without a host installer the SDK is still missing');
  sdk = true;
  const afterSDK = await api.readSetupOperation(ref);
  if (!draft) assert.equal(afterSDK.nextAction.inputId, 'auth');
  const source = draft ? afterSDK : await secret(afterSDK, agent);
  assert.equal(source.nextAction.id, 'ngrok-domain-source');
  const management = await advance(source, { value: 'inventory' });
  assert.equal(management.nextAction.inputId, 'ngrok-management-key');
  const domain = await secret(management, key);
  assert.deepEqual(domain.nextAction.step.options, [{ label: name, value: name }]);
  await assert.rejects(advance(domain, { value: 'foreign.ngrok.app' }), { code: 'invalid_input' });
  const complete = await advance(domain, { value: name });
  assert.equal(complete.state, 'complete');
  assert.ok(reads >= 1);
  const provider = (await api.listProviders({ home, owner })).providers.find(row => row.providerId === ref.providerId);
  assert.deepEqual(provider.configuration.credentials, { auth: { known: true, value: true } });
  assert.doesNotMatch(JSON.stringify({ complete, provider, events: harness.events }), /public-(agent|management)-canary/);
  const inventoryHandle = handles.get('ngrok-management-key'), agentHandle = handles.get('auth');
  assert.notEqual(inventoryHandle, undefined);
  assert.notEqual(agentHandle, undefined);
  assert.equal(await readFile(join(byteStore, inventoryHandle), 'utf8'), key);
  const journalPath = join(home, 'embedding-state.json');
  assert.ok((await readFile(journalPath, 'utf8')).includes(inventoryHandle));
  const networkCount = reads, secretReadCount = secretReads.filter(handle => handle === inventoryHandle).length;

  let resumed = api, recovered;
  if (draft) {
    await api.discardConfigurationDraft({ ...ref, draftId });
    await harness.close();
    resumed = (await startFactory()).gozar;
    recovered = await resumed.readSetupOperation(ref);
  } else {
    recovered = await api.cancelSetupOperation(ref);
    assert.equal(recovered.state, 'cancelled');
  }
  assert.equal(recovered.nextAction?.id, 'ngrok-disconnect-inventory');
  assert.equal(recovered.nextAction.kind, 'gozar-runs');
  assert.equal(recovered.nextAction.step.purpose, 'disconnect');
  const request = command(recovered);
  await assert.rejects(resumed.runSetupAction({ ...request, owner: 'foreign-owner' }), { code: 'configuration_stale' });
  await assert.rejects(resumed.runSetupAction({ ...request, approval: approval(domain.nextAction) }), { code: 'consent_mismatch' });
  assert.deepEqual(deletes, []);
  assert.equal(await readFile(join(byteStore, inventoryHandle), 'utf8'), key);

  const disconnected = await resumed.runSetupAction(request);
  const readback = await resumed.readSetupOperation(ref);
  for (const result of [disconnected, readback]) {
    assert.equal(result.nextAction, null);
    assert.equal(result.evidence.known, true);
    assert.match(result.evidence.value.summary, /No local domain inventory key/);
    assert.doesNotMatch(JSON.stringify(result), /public-(agent|management)-canary/);
  }
  assert.deepEqual(deletes, [inventoryHandle]);
  await assert.rejects(readFile(join(byteStore, inventoryHandle)), { code: 'ENOENT' });
  assert.ok(!(await readFile(journalPath, 'utf8')).includes(inventoryHandle));
  assert.equal(await readFile(join(byteStore, agentHandle), 'utf8'), agent);
  assert.equal(reads, networkCount, 'cleanup requires no ngrok management requests');
  assert.equal(secretReads.filter(handle => handle === inventoryHandle).length, secretReadCount,
    'retained custody is observed without reading the secret bytes');
});

test('LAN operation discovery preserves observed choices and refuses a legacy bypass of the entry', async t => {
  const home = await scratch(t), address = '192.0.2.15';
  const { api, ref, harness, view, advance } = await setup(t, 'lan', [
    { kind: 'recipe', operation: 'probe', handle: async () => ({ exitCode: 0, stderr: '',
      stdout: JSON.stringify({ interfaces: { eth0: [{ address, family: 'IPv4', internal: false }] } }) }) },
  ], home);
  const { operationId: _operationId, ...legacy } = ref;
  await assert.rejects(api.runSetupAction({ ...legacy, expectedConfigurationRevision: view.scope.configurationRevision,
    actionId: view.nextAction.id, approval: approval(view.nextAction) }), { code: 'setup_required' });
  const pick = await advance(view);
  assert.deepEqual(pick.nextAction.step.options, [{ value: address, label: `eth0 (${address})` }]);
  await assert.rejects(advance(pick, { value: '192.0.2.99' }), { code: 'invalid_input' });
  const allow = await advance(pick, { value: address });
  assert.equal(allow.nextAction.id, 'firewall');
  const ready = await advance(allow, { value: address });
  assert.equal(ready.state, 'complete');
  assert.equal(ready.nextAction, null);
  assert.match(ready.evidence.value.summary, /client reach are still unverified/);
  assert.ok(!harness.events.some(event => event.kind === 'process-runtime' && event.operation === 'open'));
});

test('own-address setup completes before route creation and retains descriptive mapping guidance', async t => {
  const home = await scratch(t);
  const { api, ref, view, advance } = await setup(t, 'own-address', [], home);
  const pick = await advance(view);
  assert.equal(pick.nextAction.id, 'origin');
  await assert.rejects(advance(pick, { value: 'http://owner.example.test' }), { code: 'invalid_input' });
  const mapping = await advance(pick, { value: 'https://owner.example.test' });
  assert.equal(mapping.state, 'complete');
  assert.equal(mapping.evidence.known, true);
  assert.equal(mapping.evidence.value.source, 'host');
  assert.equal(mapping.nextAction.id, 'map-adopted-origin');
  assert.equal(mapping.nextAction.kind, 'instructions');
  assert.match(mapping.nextAction.instructions, /https:\/\/owner\.example\.test/);
  assert.match(mapping.nextAction.instructions, /Start the Gozar route and wait for its exact loopback gate target/);
  assert.deepEqual(mapping.resources, []);
  assert.equal((await advance(mapping)).state, 'complete', 'acknowledgement does not create or prove a route');
  const routeRequest = query({ home, owner: ref.owner, providerId: ref.providerId });
  await assert.rejects(api.expose({ ...routeRequest, wait: 'verified' }), { code: 'consent_required' });
});
