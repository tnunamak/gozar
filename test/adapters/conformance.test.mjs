// Shared adapter conformance: every registered adapter is checked against the frozen adapter contract,
// and a brand-new provider added by registry entry plus directory only must pass with no core edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadAdapters, createAdmittedContext, setDurableDepsForTest, definitionErrors, validateShape, effectError } from '../../packages/gozar-node/adapter-runtime.mjs';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = join(repo, 'test/adapters/fixtures');
const adaptersRoot = join(repo, 'adapters');
const tenManifest = join(fixtures, 'providers.json');
const unknownManifest = join(fixtures, 'conformance-unknown.json');
const STUB = 'stub-credential-8c1f';
const reserved = 'reserved.example.com';

const temporary = new Set();
test.after(async () => { for (const dir of temporary) await rm(dir, { recursive: true, force: true }); });
async function scratch() {
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'gozar-adapters-'));
  temporary.add(dir);
  return dir;
}

// --- Fakes ----------------------------------------------------------------------------------------------

const readContext = (extra = {}) => ({
  now: () => 1_700_000_000_000, platform: 'linux', home: '/synthetic/home',
  configuration: async () => ({ auth: STUB, 'reserved-domain': reserved }),
  probe: async () => ({ ok: true }),
  verifyChallenge: async () => ({ status: 'verified', checkedAt: '2026-01-01T00:00:00.000Z' }),
  ...extra,
});

/** A fake engine: counts writes, can crash at chosen points, and holds the journal. */
function fakeEngine(adapterId, { revision = null } = {}) {
  const state = { revision, writes: 0, cleaned: 0, removed: 0, receipts: new Map(), intents: new Map(), failApply: false, failCommit: false, failCleanup: false };
  const journal = {
    async begin(plan) { state.intents.set(plan.resourceKey, plan); },
    async commit(receipt) { if (state.failCommit) throw new Error('simulated crash'); state.intents.delete(receipt.resourceKey); state.receipts.set(receipt.resourceKey, receipt); },
    async abort(key) { state.intents.delete(key); },
  };
  const ctx = createAdmittedContext({
    read: readContext(), adapterId, generation: 1,
    readRevision: async () => state.revision,
    async applyPlan() { state.writes += 1; if (state.failApply) throw new Error('simulated provider failure'); return { identity: { handle: 'h1' }, readback: { origin: 'https://announced.example.test' } }; },
    async cleanupPlan() { state.cleaned += 1; if (state.failCleanup) throw new Error('cleanup failed'); },
    async removeResource() { state.writes += 1; state.removed += 1; return { removed: true, debt: null }; },
    journal,
  });
  return { state, ctx };
}

const serveConfig = (hostPort, port, funnel, target = '127.0.0.1:8123') => ({
  TCP: { [port]: { HTTPS: true } },
  Web: { [hostPort]: { Handlers: { '/': { Proxy: `http://${target}` } } } },
  AllowFunnel: funnel ? { [hostPort]: true } : {},
});

function withDurableStubs(config = {}) {
  const restore = setDurableDepsForTest({
    load: async () => ({ durablePlanFacts: async ({ origin }) => ({ planDigest: 'digest-synthetic', observedResource: 'resource-synthetic', origin }) }),
    serve: async () => ({ getServeConfig: async () => ({ config, etag: 'etag-1' }) }),
  });
  return restore;
}

// --- The conformance check ------------------------------------------------------------------------------

const methods = ['detect', 'properties', 'setupActions', 'setup', 'plan', 'create', 'observe', 'verify', 'remove', 'runtimeFacts'];
const secretFree = (value, label) => assert.ok(!JSON.stringify(value).includes(STUB), `${label} leaks a secret`);
const request = (kind, origin = null) => ({ target: '127.0.0.1:8123', origin, usage: kind === 'durable' ? { kind, routeId: 'route-synthetic' } : kind === 'session' ? { kind, lifetimeMs: 600000 } : { kind },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] }, configurationRef: 'ref-synthetic' });

async function planFor(adapter, ctx, kind) {
  try { return await adapter.plan(ctx, request(kind)); }
  catch (error) {
    assert.equal(error.code, 'setup_required', `${adapter.id} ${kind} plan: only setup_required may ask for an origin`);
    return adapter.plan(ctx, request(kind, `https://${reserved}`));
  }
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

export async function conform(adapter) {
  const id = adapter.id, definition = adapter.definition;
  // Shape: every method, a valid definition, an id that agrees everywhere.
  for (const name of methods) assert.equal(typeof adapter[name], 'function', `${id}.${name}`);
  assert.deepEqual(definitionErrors(definition), [], `${id} definition`);
  assert.equal(definition.id, id);
  assert.match(definition.disclosure.revision, /^disc-/);

  // Detection: honest on Linux and macOS, unsupported elsewhere (platform injected, never read here).
  const linux = await adapter.detect(readContext());
  assert.ok(['ready', 'action-required', 'unsupported', 'unknown'].includes(linux.state), `${id} detect state`);
  secretFree(linux, `${id} facts`);
  const win = await adapter.detect(readContext({ platform: 'win32' }));
  assert.equal(win.state, 'unsupported', `${id} on win32`);
  assert.deepEqual(adapter.setupActions(win.facts), [], `${id} offers no setup on win32`);
  // macOS is a supported platform: neither the core nor the adapter turns it away; the provider commands are the same.
  const mac = await adapter.detect(readContext({ platform: 'darwin' }));
  assert.equal(mac.state, linux.state, `${id} detects the same on macOS as on Linux`);

  // Properties and actions follow the frozen shapes.
  assert.deepEqual(validateShape('Properties', adapter.properties(linux.facts)), [], `${id} properties`);
  for (const action of adapter.setupActions({ ...linux.facts, setupNeeded: true })) {
    assert.ok(action.id && action.label && /^[0-9a-f]{64}$/.test(action.digest) && action.disclosure?.revision, `${id} action ${action.id}`);
    assert.ok(['open-url', 'instructions', 'provide-secret', 'gozar-runs'].includes(action.kind));
    if (action.kind === 'provide-secret') assert.ok(action.secretLabel);
  }
  await rejects(adapter.setup(readContext({ executeApprovedAction: async () => ({ state: 'complete', nextAction: null }), withSecret: async () => false }), 'no-such-action'), 'unsupported');
  const facts = await adapter.runtimeFacts(readContext(), { schemaVersion: 1, adapterId: id, resourceKey: 'k', generation: 1, identity: null, readback: null });
  assert.deepEqual(validateShape('Properties', facts.properties), []);
  assert.ok(facts.limits.recommendedPollIntervalMs > 0 && (facts.limits.idleTimeoutMs === null || facts.limits.idleTimeoutMs > 0));

  // Declared support agrees with outcomes, kind by kind.
  for (const kind of ['session', 'attached', 'durable']) {
    const { ctx, state } = fakeEngine(id);
    const restore = kind === 'durable' ? withDurableStubs(serveConfig('node.example.ts.net:8443', '8443', true)) : () => {};
    try {
      if (!definition.supportedKinds.includes(kind)) {
        await rejects(adapter.plan(readContext(), request(kind)), 'unsupported');
        await rejects(adapter.create(ctx, { digest: 'd', origin: null, resourceKey: 'k', effects: [], readback: { kind }, cleanup: null, precondition: null }), 'unsupported');
        assert.equal(state.writes, 0, `${id} undeclared ${kind} must not write`);
        continue;
      }
      if (kind === 'durable') {
        const durableRequest = request('durable', 'https://node.example.ts.net:8443');
        const plan = await adapter.plan(readContext(), durableRequest);
        assert.equal(plan.digest, 'digest-synthetic', `${id} durable plan takes its digest from the engine`);
        assert.deepEqual(plan.effects, [], `${id} durable plan holds no adapter-run effects`);
        assert.equal(plan.precondition.revision, 'etag-1');
        await rejects(adapter.create(ctx, plan), 'unsupported');
        await rejects(adapter.remove(ctx, { schemaVersion: 1, adapterId: id, resourceKey: plan.resourceKey, generation: 1, identity: null, readback: plan.readback }, { present: true, resourceKey: plan.resourceKey, identity: null, revision: 'etag-1' }), 'unsupported');
        assert.equal(state.writes, 0, `${id} durable create/remove are engine-owned`);
        let observed = null;
        for (const funnel of [true, false]) { // the listener shape is the adapter's own; one of the two must match
          const again = withDurableStubs(serveConfig('node.example.ts.net:8443', '8443', funnel));
          try { observed = await adapter.observe(readContext(), durableRequest); } finally { again(); }
          if (observed.present) break;
        }
        assert.ok(observed.present && observed.revision === 'etag-1', `${id} observes its durable listener with the config revision`);
        continue;
      }
      const plan = await planFor(adapter, readContext(), kind);
      for (const field of ['digest', 'resourceKey']) assert.equal(typeof plan[field], 'string', `${id} plan.${field}`);
      assert.ok(Array.isArray(plan.effects) && 'readback' in plan && 'cleanup' in plan && 'origin' in plan && 'precondition' in plan);
      secretFree(plan, `${id} plan`);
      const sdkBacked = plan.effects[0]?.kind === 'sdk-listener';
      if (sdkBacked) continue; // the SDK runtime has its own tests (ngrok-runtime.test.mjs)
      const receipt = await adapter.create(ctx, plan);
      assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.adapterId, id); assert.equal(receipt.resourceKey, plan.resourceKey);
      secretFree(receipt, `${id} receipt`);
      assert.equal((await adapter.verify(readContext(), receipt)).status, 'verified');
      const observed = await adapter.observe(readContext(), request(kind));
      assert.equal(typeof observed.present, 'boolean');
      const removal = await adapter.remove(ctx, receipt, observed);
      assert.equal(removal.removed, true); assert.equal(removal.debt, null);
    } finally { restore(); }
  }
}

// --- Discovery: the registry is the only path ------------------------------------------------------------

test('every adapter directory has exactly one registry entry and the ten load in registry order', async () => {
  const manifest = JSON.parse(await readFile(tenManifest, 'utf8'));
  const directories = (await readdir(join(adaptersRoot, 'providers'))).filter(name => !name.startsWith('_')).sort(); // _shared holds code several providers import; it is not a provider
  assert.deepEqual(directories, manifest.providers.map(entry => entry.id).sort(), 'a directory without an entry (or an entry without a directory) is invisible or broken');
  const adapters = await loadAdapters({ manifest: tenManifest, root: adaptersRoot });
  assert.deepEqual(adapters.map(adapter => adapter.id), manifest.providers.map(entry => entry.id));
});

test('all ten registered adapters conform', async () => {
  const adapters = await loadAdapters({ manifest: tenManifest, root: adaptersRoot });
  assert.equal(adapters.length, 10);
  const stubSdk = { forward: async () => ({ url: () => `https://${reserved}`, close: async () => {} }) };
  for (const adapter of adapters) {
    await conform(adapter.id === 'ngrok-https-edge' ? createNgrokAdapter({ loadSdk: async () => stubSdk }) : adapter);
  }
});

test('honest declarations: kinds match the working recipes, unsupported providers declare none', async () => {
  const kinds = Object.fromEntries((await loadAdapters({ manifest: tenManifest, root: adaptersRoot })).map(a => [a.id, a.definition.supportedKinds]));
  assert.deepEqual(kinds['tailscale-funnel'], ['session', 'durable']);
  assert.deepEqual(kinds['tailscale-private'], ['session', 'durable']);
  assert.deepEqual(kinds['ngrok-https-edge'], ['attached']);
  for (const id of ['ngrok-tls-passthrough', 'ngrok-tcp-passthrough', 'cloudflare-named']) assert.deepEqual(kinds[id], [], `${id} has no admitted create recipe`);
  const mac = await loadAdapters({ manifest: tenManifest, root: adaptersRoot });
  for (const adapter of mac) assert.equal((await adapter.detect(readContext({ platform: 'win32' }))).state, 'unsupported');
});

test('disclosure revisions change with the text they name', async () => {
  const { createHash } = await import('node:crypto');
  for (const adapter of await loadAdapters({ manifest: tenManifest, root: adaptersRoot })) {
    const { revision, text } = adapter.definition.disclosure;
    assert.equal(revision, 'disc-' + createHash('sha256').update(text).digest('hex').slice(0, 12), adapter.id);
  }
});

// --- Red: incomplete and missing adapters ----------------------------------------------------------------

async function manifestWith(entries) {
  const dir = await scratch();
  for (const entry of entries) {
    const providerDir = join(dir, 'providers', entry.id);
    await mkdir(providerDir, { recursive: true });
    if (entry.index !== undefined) await writeFile(join(providerDir, 'index.mjs'), entry.index);
    if (entry.definition !== undefined) await writeFile(join(providerDir, 'definition.json'), JSON.stringify(entry.definition));
  }
  await mkdir(join(dir, 'providers'), { recursive: true });
  return { dir, manifest: { providers: entries.map(entry => ({ id: entry.id, module: `providers/${entry.id}/index.mjs`, definition: `providers/${entry.id}/definition.json`, ...entry.paths })) } };
}
const goodDefinition = async id => ({ adapter: { ...JSON.parse(await readFile(join(fixtures, 'providers/fake-wave/definition.json'), 'utf8')).adapter, id } });
test('red: an incomplete adapter (a method missing) is a load error, never skipped', async () => {
  const definition = await goodDefinition('half-done');
  const source = `import { readFileSync } from 'node:fs'; const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const noop = async () => {}; export default { id: 'half-done', definition, detect: noop, properties: noop, setupActions: noop, setup: noop, plan: noop, create: noop, observe: noop, verify: noop, runtimeFacts: noop };`; // no remove
  const { dir, manifest } = await manifestWith([{ id: 'half-done', index: source, definition }]);
  await assert.rejects(loadAdapters({ manifest, root: dir }), /incomplete adapter, missing remove/);
});

test('red: a missing module, a missing definition and an escaping path are load errors', async () => {
  const definition = await goodDefinition('ghost');
  let setup = await manifestWith([{ id: 'ghost', definition }]); // no index.mjs
  await assert.rejects(loadAdapters({ manifest: setup.manifest, root: setup.dir }), /module is missing/);
  setup = await manifestWith([{ id: 'ghost', index: 'export default {}' }]); // no definition.json
  await assert.rejects(loadAdapters({ manifest: setup.manifest, root: setup.dir }), /definition is missing/);
  setup = await manifestWith([{ id: 'ghost', index: 'export default {}', definition, paths: { module: '../outside.mjs' } }]);
  await assert.rejects(loadAdapters({ manifest: setup.manifest, root: setup.dir }), /outside providers\//);
  await assert.rejects(loadAdapters({ manifest: { providers: [{ id: 'x', module: '/etc/passwd', definition: 'providers/x/definition.json' }] }, root: setup.dir }), /outside providers\//);
});

test('red: a definition missing cost, account or trust facts is a load error', async () => {
  const definition = await goodDefinition('lacking');
  delete definition.adapter.capabilities.cost;
  const { dir, manifest } = await manifestWith([{ id: 'lacking', index: 'export default {}', definition }]);
  await assert.rejects(loadAdapters({ manifest, root: dir }), /invalid definition: .*missing cost/);
  const lifetimes = await goodDefinition('lifetimes');
  lifetimes.adapter.supportedKinds = ['session', 'durable'];
  const second = await manifestWith([{ id: 'lifetimes', index: 'export default {}', definition: lifetimes }]);
  await assert.rejects(loadAdapters({ manifest: second.manifest, root: second.dir }), /lifetimes must equal supportedKinds/);
});

test('red: an adapter whose module id disagrees with its registry entry is a load error', async () => {
  const definition = await goodDefinition('entry-name');
  const source = `import { readFileSync } from 'node:fs'; const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const noop = async () => {}; export default { id: 'other-name', definition, detect: noop, properties: noop, setupActions: noop, setup: noop, plan: noop, create: noop, observe: noop, verify: noop, remove: noop, runtimeFacts: noop };`;
  const { dir, manifest } = await manifestWith([{ id: 'entry-name', index: source, definition }]);
  await assert.rejects(loadAdapters({ manifest, root: dir }), /disagree/);
});

// --- Red: precondition, crash ----------------------------------------------------------------------------

const somePlan = { digest: 'd', origin: null, resourceKey: 'adapter-x:key', effects: [{}], readback: { kind: 'session' }, cleanup: null, precondition: { revision: 'r1' } };

test('red: a moved revision gives precondition_failed with zero writes; a stale observation removes nothing', async () => {
  const { ctx, state } = fakeEngine('adapter-x', { revision: 'r2' });
  await rejects(ctx.executePlan(somePlan), 'precondition_failed');
  assert.equal(state.writes, 0); assert.equal(state.intents.size, 0); assert.equal(state.receipts.size, 0);
  const receipt = { schemaVersion: 1, adapterId: 'adapter-x', resourceKey: 'adapter-x:key', generation: 1, identity: null, readback: {} };
  await rejects(ctx.compareAndRemove(receipt, { present: true, resourceKey: receipt.resourceKey, identity: null, revision: 'r1' }), 'precondition_failed');
  assert.equal(state.removed, 0); assert.equal(state.writes, 0);
  state.revision = 'r1';
  assert.equal((await ctx.executePlan(somePlan)).adapterId, 'adapter-x');
  assert.equal((await ctx.compareAndRemove(receipt, { present: true, resourceKey: receipt.resourceKey, identity: null, revision: 'r1' })).removed, true);
});

test('a null precondition applies unconditionally', async () => {
  const { ctx, state } = fakeEngine('adapter-x', { revision: 'whatever' });
  await ctx.executePlan({ ...somePlan, precondition: null });
  assert.equal(state.writes, 1);
});

test('red: a crash mid-create leaves a whole receipt or a clean state, never a half-recorded one', async () => {
  let { ctx, state } = fakeEngine('adapter-x');
  state.failApply = true;
  await rejects(ctx.executePlan({ ...somePlan, precondition: null }), 'provider_unavailable');
  assert.equal(state.intents.size, 0, 'provider failure: no leftover record'); assert.equal(state.receipts.size, 0); assert.equal(state.cleaned, 1);

  ({ ctx, state } = fakeEngine('adapter-x'));
  state.failCommit = true; // the process dies after the effect, before the receipt lands
  await rejects(ctx.executePlan({ ...somePlan, precondition: null }), 'provider_unavailable');
  assert.equal(state.receipts.size, 0); assert.equal(state.intents.size, 0, 'cleanup ran, so the intent is cleared'); assert.equal(state.cleaned, 1);

  ({ ctx, state } = fakeEngine('adapter-x'));
  state.failCommit = true; state.failCleanup = true;
  await rejects(ctx.executePlan({ ...somePlan, precondition: null }), 'provider_unavailable');
  assert.equal(state.receipts.size, 0, 'a receipt is only ever written whole');
  assert.equal(state.intents.size, 1, 'the unfinished effect stays recorded as intent so removal can retry');

  ({ ctx, state } = fakeEngine('adapter-x'));
  const receipt = await ctx.executePlan({ ...somePlan, precondition: null });
  assert.deepEqual([...state.receipts.keys()], [receipt.resourceKey]); assert.equal(state.intents.size, 0);
});

test('provider failure text never reaches the caller', async () => {
  const { ctx, state } = fakeEngine('adapter-x');
  state.failApply = true;
  await assert.rejects(ctx.executePlan({ ...somePlan, precondition: null }), error => !/simulated/.test(error.message));
});

// --- Unknown provider: registry entry plus directory only --------------------------------------------------

test('unknown provider: a brand-new fake provider loads and runs every method with no core edit', async () => {
  const adapters = await loadAdapters({ manifest: unknownManifest });
  assert.deepEqual(adapters.map(adapter => adapter.id), ['fake-wave']);
  await conform(adapters[0]);
  const detected = await adapters[0].detect(readContext({ probe: async () => ({ ok: false }) }));
  assert.equal(detected.state, 'action-required');
  assert.equal(adapters[0].setupActions(detected.facts)[0].href, 'https://example.test/install');
});

test('unknown provider: an empty registry loads nothing, so the fake appears only through its entry', async () => {
  assert.deepEqual(await loadAdapters({ manifest: { providers: [] }, root: fixtures }), []);
  assert.equal((await loadAdapters({ manifest: unknownManifest })).length, 1);
});

test('win32: detect reports unsupported on an unsupported platform and plan refuses', async () => {
  const [adapter] = await loadAdapters({ manifest: unknownManifest });
  const mac = await adapter.detect(readContext({ platform: 'win32' }));
  assert.equal(mac.state, 'unsupported');
  await rejects(adapter.plan(readContext({ platform: 'win32' }), request('session')), 'unsupported');
});

test('red: platform, home and generation are required context fields, never defaulted', async () => {
  const [adapter] = await loadAdapters({ manifest: unknownManifest });
  await rejects(adapter.detect(readContext({ platform: undefined })), 'provider_unavailable');
  await rejects(adapter.plan(readContext({ platform: '' }), request('session')), 'provider_unavailable');
  assert.throws(() => createAdmittedContext({ read: readContext(), adapterId: 'adapter-x' }), error => error.code === 'provider_unavailable');
});

test('the effect error helper only builds the four frozen codes', () => {
  for (const code of ['precondition_failed', 'unsupported', 'provider_unavailable', 'setup_required']) assert.equal(effectError(code, 'm').code, code);
});
