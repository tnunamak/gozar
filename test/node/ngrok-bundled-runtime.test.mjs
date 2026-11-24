// 0.5.2 defect 2: ngrok dependency modes must be explicit. A host that cannot install optional peers at
// runtime (a packaged AppImage) declares a TESTED read-only @ngrok/ngrok bundle; Gozar proves the bundle's
// package identity and exact version, loads it in the host factory process AND in the real detached route
// controller, and marks the declared install prerequisite satisfied without installing, writing or
// restarting anything. A host that explicitly says its install location is writable keeps the approved
// runtime-install step; a host-managed host gets a fixed plain reason and no impossible install action.
// Without any declaration the documented npm optional-peer flow is unchanged. The ngrok CLI is not a
// supported substitute for the SDK listener on this adapter (proposal pending; not implemented here).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';
import { listenerSdk } from '../../adapters/providers/_shared/listener-effects.mjs';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { scratch, attachedScratch } from './route-schema-check.mjs';

const settle = outcome => outcome.then(value => ({ value }), error => ({ error }));

// A canned TESTED bundle: a real module on disk with the exact manifest identity Gozar checks. Its
// forward() writes a mark naming the process that loaded it, so a detached controller loading it is
// observable as evidence, never asserted through fixture dispatch.
async function cannedBundle(t, { version = '1.7.0', name = '@ngrok/ngrok', withShape = true } = {}) {
  const dir = await scratch(t), path = join(dir, 'bundled', name), marks = join(dir, 'marks.jsonl');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }));
  const entry = withShape ? `
const { appendFileSync } = require('node:fs');
module.exports = {
  forward: async options => {
    appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ pid: process.pid, domain: options?.domain }) + '\\n');
    return { id: () => 'canned-listener', url: () => 'https://' + options.domain, close: async () => {} };
  },
  getListenerByUrl: async () => null,
  getListener: async () => null,
};
` : 'module.exports = {};\n';
  await writeFile(join(path, 'index.cjs'), entry);
  return { path, marks };
}

const setupContext = (runtimeModules, extras = {}) => ({
  now: () => Date.parse('2026-11-18T00:00:00Z'),
  platform: 'linux',
  ...(runtimeModules ? { runtimeModules } : {}),
  configuration: async () => ({}),
  hasManagementSecret: () => false,
  configurationPresence: async () => ({ scopeId: 'fixture-scope', values: {}, credentials: { auth: { known: true, value: false } } }),
  ...extras,
});
const operation = { id: 'operation-1', cancelled: false, resources: [], connectorInputs: [], lastActionId: 'check-prerequisites' };
const observeSetup = (adapter, ctx) => adapter.observeSetup(ctx, operation);

test('synthetic listener detection without availability stops before allocation', async () => {
  const calls = [];
  let loads = 0;
  const dispatchEffect = async effect => { calls.push(effect); return { available: false }; };
  const loadSdk = async () => { loads++; throw new Error('unexpected SDK load'); };
  await assert.rejects(listenerSdk({ dispatchEffect }, loadSdk), { code: 'setup_required' });
  assert.deepEqual(calls, [{ kind: 'sdk-listener', operation: 'detect', input: {} }]);
  assert.equal(loads, 0);
});

test('synthetic listener reads distinguish explicit absence from unknown presence', async () => {
  const calls = [];
  let loads = 0;
  const dispatchEffect = async effect => {
    calls.push(effect);
    if (effect.operation === 'detect') return { available: true };
    if (effect.operation === 'read') return effect.input.handle === 'absent' ? { present: false } : {};
    assert.fail('unexpected listener effect: ' + effect.operation);
  };
  const loadSdk = async () => { loads++; throw new Error('unexpected SDK load'); };
  const sdk = await listenerSdk({ dispatchEffect }, loadSdk);
  assert.equal(await sdk.getListener('absent'), null);
  await assert.rejects(sdk.getListener('unknown'), { code: 'provider_unavailable' });
  assert.deepEqual(calls, [
    { kind: 'sdk-listener', operation: 'detect', input: {} },
    { kind: 'sdk-listener', operation: 'read', input: { handle: 'absent' } },
    { kind: 'sdk-listener', operation: 'read', input: { handle: 'unknown' } },
  ]);
  assert.equal(loads, 0);
});

test('cold and incomplete observations offer SDK installation only with explicit writable authority', () => {
  const adapter = createNgrokAdapter({ loadSdk: async () => { throw new Error('module missing'); } });
  for (const runtimeInstall of [undefined, null, false, 'true', 0, 1]) {
    const actions = adapter.setupActions({ setupNeeded: true, runtimeInstall });
    assert.ok(!actions.some(action => action.id === 'install-sdk'), 'unknown writability cannot offer installation');
    assert.ok(actions.some(action => action.id === 'auth'), 'cold observations still offer credential intake');
  }
  assert.ok(adapter.setupActions({ setupNeeded: true, runtimeInstall: true }).some(action => action.id === 'install-sdk'));
  assert.ok(!adapter.setupActions({ setupNeeded: true, sdk: true, runtimeInstall: true }).some(action => action.id === 'install-sdk'));
});

test('red: a declared valid bundle satisfies the ngrok SDK prerequisite in catalog and managed setup, with no install step and no artifact work', async t => {
  const bundle = await cannedBundle(t);
  const adapters = await loadAdapters();
  const ngrok = adapters.find(adapter => adapter.id === 'ngrok-https-edge');
  const ctx = setupContext({ '@ngrok/ngrok': { kind: 'bundled', version: '1.7.0', path: bundle.path } });
  const detected = await ngrok.detect(ctx);
  assert.equal(detected.state, 'action-required');
  assert.equal(detected.facts.sdk, true, 'the bundled module satisfies the SDK fact');
  assert.equal(detected.facts.runtimeInstall, false);
  const actions = ngrok.setupActions(detected.facts);
  assert.ok(!actions.some(action => action.id === 'install-sdk'), 'no install action while the bundle provides the SDK');
  assert.ok(actions.some(action => action.id === 'auth') && actions.some(action => action.id === 'reserved-domain'));
  // The managed setup operation sees the same boundary: no install-sdk step, the next step is the credential.
  const setup = await observeSetup(ngrok, ctx);
  assert.equal(setup.state, 'authorization-required');
  assert.equal(setup.nextAction.id, 'auth', 'managed setup offers the credential, not an install step');
  // The declaration is a trusted factory option: an invalid one is refused before any provider runs.
  assert.throws(() => createRouteApi({ runtimeModules: { '@ngrok/ngrok': { kind: 'bundled', path: bundle.path } } }), { code: 'invalid_input' });
  assert.throws(() => createRouteApi({ runtimeModules: { '@ngrok/ngrok': { kind: 'wrong' } } }), { code: 'invalid_input' });
  assert.doesNotThrow(() => createRouteApi({ runtimeModules: { '@ngrok/ngrok': { kind: 'host-managed' } } }), 'host-managed is an advertised declaration');
});

test('red: a wrong-version or missing bundle leaves the provider unavailable with a fixed plain reason and no install action', async t => {
  const good = await cannedBundle(t);
  const adapters = await loadAdapters();
  const ngrok = adapters.find(adapter => adapter.id === 'ngrok-https-edge');
  for (const declaration of [
    { kind: 'bundled', version: '1.0.0', path: good.path },                     // bundle is 1.7.0: version mismatch
    { kind: 'bundled', version: '1.7.0', path: join(good.path, 'not-there') },   // missing bundle
  ]) {
    const ctx = setupContext({ '@ngrok/ngrok': declaration });
    const detected = await ngrok.detect(ctx);
    assert.equal(detected.facts.sdk, false, 'an unloadable bundle does not satisfy the SDK');
    assert.equal(detected.facts.runtimeInstall, false, 'the host declared no writable install location');
    assert.equal(detected.facts.sdkReason, 'The declared bundled ngrok SDK is unavailable in this host installation');
    assert.ok(!ngrok.setupActions(detected.facts).some(action => action.id === 'install-sdk'), 'no impossible install action');
    const setup = await observeSetup(ngrok, ctx);
    assert.equal(setup.state, 'blocked');
    assert.equal(setup.nextAction, null, 'managed setup offers no install step either');
    assert.match(setup.evidence.summary, /unavailable in this host installation/);
    assert.equal(setup.evidence.stepId, 'ngrok-sdk');
  }
  // A bundle with the right identity but the wrong interface is unavailable too, never half-ready.
  const shapeless = await cannedBundle(t, { withShape: false });
  const detected = await ngrok.detect(setupContext({ '@ngrok/ngrok': { kind: 'bundled', version: '1.7.0', path: shapeless.path } }));
  assert.equal(detected.facts.sdk, false);
  assert.equal(detected.facts.sdkReason, 'The declared bundled ngrok SDK is unavailable in this host installation', 'the interface is validated at load, refused with the fixed reason');
});

test('red: a host-managed host gets the fixed plain reason with no install action; a runtime-install host keeps the approved install step', async t => {
  const adapters = await loadAdapters();
  const ngrok = adapters.find(adapter => adapter.id === 'ngrok-https-edge');
  const managed = setupContext({ '@ngrok/ngrok': { kind: 'host-managed' } });
  const detected = await ngrok.detect(managed);
  assert.equal(detected.facts.sdk, false);
  assert.equal(detected.facts.runtimeInstall, false);
  assert.ok(!ngrok.setupActions(detected.facts).some(action => action.id === 'install-sdk'));
  const setup = await observeSetup(ngrok, managed);
  assert.equal(setup.state, 'blocked');
  assert.equal(setup.nextAction, null);
  assert.match(setup.evidence.summary, /Gozar cannot install it here/);
  // Mode (c): the host explicitly said its install location is writable; the approved artifact step stays.
  const installable = setupContext({ '@ngrok/ngrok': { kind: 'runtime-install' } });
  const allowed = await ngrok.detect(installable);
  assert.equal(allowed.facts.sdk, false);
  assert.equal(allowed.facts.runtimeInstall, true);
  assert.ok(ngrok.setupActions(allowed.facts).some(action => action.id === 'install-sdk'));
  const offered = await observeSetup(ngrok, installable);
  assert.equal(offered.nextAction.id, 'install-sdk');
  assert.equal(offered.nextAction.kind, 'install-artifact');
  assert.match(offered.nextAction.artifact.sha256, /^[0-9a-f]{64}$/);
});

test('omission or a host-managed declaration never authorizes an install; only an explicit writable declaration does', async () => {
  const adapter = createNgrokAdapter({ loadSdk: async () => { throw Object.assign(new Error('module missing'), { code: 'ERR_MODULE_NOT_FOUND' }); } });
  for (const declaration of [null, { '@ngrok/ngrok': { kind: 'host-managed', package: '@ngrok/ngrok' } }]) {
    const ctx = setupContext(declaration);
    const detected = await adapter.detect(ctx);
    assert.equal(detected.facts.sdk, false);
    assert.equal(detected.facts.runtimeInstall, false, 'no explicit writable declaration');
    assert.ok(!adapter.setupActions(detected.facts).some(action => action.id === 'install-sdk'), 'no impossible install action');
    const setup = await observeSetup(adapter, ctx);
    assert.equal(setup.state, 'blocked');
    assert.equal(setup.nextAction, null);
  }
  const writable = setupContext({ '@ngrok/ngrok': { kind: 'runtime-install', package: '@ngrok/ngrok' } });
  const detected = await adapter.detect(writable);
  assert.equal(detected.facts.runtimeInstall, true);
  assert.ok(adapter.setupActions(detected.facts).some(action => action.id === 'install-sdk'), 'the existing writable install path is preserved');
  const setup = await observeSetup(adapter, writable);
  assert.equal(setup.nextAction.id, 'install-sdk');
  assert.equal(setup.nextAction.kind, 'install-artifact');
});

test('red: a real detached controller loads the host-declared bundle: the allocation comes from the bundled module in the child', async t => {
  const bundle = await cannedBundle(t);
  const home = await attachedScratch(t), owner = 'fixture-owner';
  const api = createRouteApi({
    runtimeModules: { '@ngrok/ngrok': { kind: 'bundled', version: '1.7.0', path: bundle.path } },
    embeddingServices: { ...(await import('../../packages/gozar-node/embedding-services.mjs')).createEmbeddingServices({ registryId: await registryIdentity({}) }) },
    expose: { startTimeoutMs: 60_000 },
  });
  const provider = (await api.listProviders({ home, owner })).providers.find(p => p.providerId === 'ngrok-https-edge');
  assert.ok(provider, 'the shipped registry lists ngrok-https-edge');
  assert.ok(!provider.configuration.actions.some(action => action.id === 'install-sdk'), 'no install action in the inventory');
  let config = provider.configuration;
  for (const requirement of config.inputRequirements) {
    const action = config.actions.find(a => a.id === requirement.actionId);
    let input;
    if (requirement.secret) {
      const { handle } = await api.storeSecret({ home, owner, providerId: provider.providerId, inputId: requirement.id,
        scopeId: config.scopeId, expectedConfigurationRevision: config.revision, bytes: new TextEncoder().encode('synthetic-canary') });
      input = { secretHandle: handle };
    } else input = { value: 'canned.example' };
    config = (await api.runSetupAction({ home, owner, providerId: provider.providerId, expectedConfigurationRevision: config.revision,
      actionId: action.id, ...input, approval: { kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision,
        consentFactsDigest: action.consent.consentFactsDigest } })).configuration;
  }
  const q = { schemaVersion: 1, owner, operationId: 'bundle-fixture-op', providerId: provider.providerId, usage: { kind: 'attached' },
    target: '127.0.0.1:8799', home,
    requirements: { reach: provider.reach, transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } };
  const candidate = (await api.catalogRoutes(q)).candidates[0];
  assert.equal(candidate.eligible, true, JSON.stringify(candidate.unmet));
  const request = { ...q, wait: 'verified', approval: { kind: 'route', consentFactsDigest: candidate.consentFactsDigest,
    candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } };
  const outcome = await settle(api.expose(request));
  // The bundled module has no real ngrok edge behind it, so publication verification fails; the allocation
  // itself must come from the bundled module loaded in the DETACHED child, proven by its own mark.
  assert.ok(outcome.error, 'the canned bundle cannot pass real publication verification');
  assert.equal(outcome.error.code, 'verification_failed');
  assert.equal(outcome.error.route?.origin, 'https://canned.example', 'the allocated origin came from the bundled module');
  assert.equal(outcome.error.route?.published ?? null, null);
  assert.equal(outcome.error.route?.cleanup?.state, 'confirmed', 'the canned listener was removed exactly');
  const marks = (await readFile(bundle.marks, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(marks.length >= 1, 'the bundled module was loaded');
  assert.notEqual(marks.at(-1).pid, process.pid, 'the bundle was loaded by the detached controller process, not this one');
  assert.equal(marks.at(-1).domain, 'canned.example');
  await api.closeRoute({ home, handle: outcome.error.route.handle, mode: 'remove' }).catch(() => {});
});

import { symlink } from 'node:fs/promises';
import { loadBundledModule } from '../../packages/gozar-node/runtime-modules.mjs';

test('red: the version is validated before any cached module is reused, and the entry stays inside the bundle directory', async t => {
  const bundle = await cannedBundle(t);
  const declaration = { package: '@ngrok/ngrok', version: '1.7.0', path: bundle.path };
  const loaded = await loadBundledModule(declaration, { expectedVersion: '1.7.0', requiredFunctions: ['forward'] });
  assert.equal(typeof loaded.forward, 'function');
  // Same anchor and declared version, an INCOMPATIBLE consumer: its expected version is checked on every call, before reuse.
  assert.equal((await settle(loadBundledModule(declaration, { expectedVersion: '1.6.0' }))).error?.code, 'provider_unavailable');
  // The bundle is replaced after the first load: the cached module must not be served under the old identity.
  await writeFile(join(bundle.path, 'package.json'), JSON.stringify({ name: '@ngrok/ngrok', version: '1.7.1', main: 'index.cjs' }));
  assert.equal((await settle(loadBundledModule(declaration, { expectedVersion: '1.7.0' }))).error?.code, 'provider_unavailable');
  // An entry that resolves outside the canonical bundle directory (a symlink out) is refused.
  const outside = await cannedBundle(t);
  const escaping = await scratch(t);
  await mkdir(join(escaping, 'pkg'), { recursive: true });
  await writeFile(join(escaping, 'pkg', 'package.json'), JSON.stringify({ name: '@ngrok/ngrok', version: '1.7.0', main: 'link.cjs' }));
  await symlink(join(outside.path, 'index.cjs'), join(escaping, 'pkg', 'link.cjs'));
  assert.equal((await settle(loadBundledModule({ ...declaration, path: join(escaping, 'pkg') }, { expectedVersion: '1.7.0' }))).error?.code, 'provider_unavailable');
  // A shapeless module (native layer not usable) is refused when the adapter's interface is required.
  const shapeless = await cannedBundle(t, { withShape: false });
  assert.equal((await settle(loadBundledModule({ ...declaration, path: shapeless.path }, { expectedVersion: '1.7.0', requiredFunctions: ['forward'] }))).error?.code, 'provider_unavailable');
});
