// Run against the shared setup runtime plus the provider adapters.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch } from '../node/route-schema-check.mjs';

const owner = 'provider-setup-fixture';
const approval = action => ({ kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
  consentFactsDigest: action.consent.consentFactsDigest });

async function setup(t, providerId, effects, home) {
  const harness = await createTestingGozar({ effects });
  t.after(harness.close);
  const api = harness.gozar, ref = { home, owner, providerId, operationId: randomUUID() };
  const { providers } = await api.listProviders({ home, owner });
  const provider = providers.find(row => row.providerId === providerId);
  assert.ok(provider, 'shipped provider is discoverable');
  const entry = provider.prerequisites.find(row => row.remedy?.id.endsWith('-setup'))?.remedy;
  assert.equal(entry?.kind, 'gozar-runs');
  const view = await api.runSetupAction({ ...ref, expectedSetupRevision: 0,
    expectedConfigurationRevision: provider.configuration.revision, actionId: entry.id });
  assert.equal(view.nextAction.id, entry.id);
  const advance = (current, values = {}) => api.runSetupAction({ ...ref, expectedSetupRevision: current.revision,
    expectedConfigurationRevision: current.scope.configurationRevision, actionId: current.nextAction.id,
    approval: approval(current.nextAction), ...values });
  const secret = async (current, value) => {
    const { handle: secretHandle } = await api.storeSecret({ ...ref, inputId: current.nextAction.inputId,
      scopeId: current.scope.scopeId, expectedConfigurationRevision: current.scope.configurationRevision, bytes: Buffer.from(value) });
    return advance(current, { secretHandle });
  };
  return { api, ref, harness, view, advance, secret };
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

test('public ngrok setup pins the SDK action, retains management privately and binds only the agent input', async t => {
  const home = await scratch(t);
  let sdk = false, reads = 0;
  const agent = 'public-agent-canary', key = 'public-management-canary', name = 'agent.ngrok.app';
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
  const { api, ref, harness, advance, secret, view } = await setup(t, 'ngrok-https-edge', effects, home);
  const dependency = await advance(view);
  assert.equal(dependency.nextAction.kind, 'install-artifact');
  assert.match(dependency.nextAction.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await advance(dependency)).state, 'blocked', 'without a host installer the SDK is still missing');
  sdk = true;
  const auth = await api.readSetupOperation(ref);
  assert.equal(auth.nextAction.inputId, 'auth');
  const source = await secret(auth, agent);
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
  assert.equal((await api.cancelSetupOperation(ref)).state, 'cancelled');
});
