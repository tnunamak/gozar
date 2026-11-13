// Test helpers for an app that uses Gozar: a route API with no network, a fake provider, and a fake read context.
// Import them from '@tnunamak/gozar/testing'. Nothing here starts a tunnel, calls a provider or reads real credentials.
//
//   const registry = await fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
//   const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
//   ...catalogRoutes, then expose with the candidate's token...
//   await registry.cleanup();
//
// A fake with kind 'durable' also keeps a rule store, a JSON file in the registry's own directory, so that separate
// processes see the same state. Pass `fakeReadContext({ verified })` to the route API and the durable route check answers as told.
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteApi as createCoreRouteApi } from './route-api.mjs';
import { createReadContext } from './adapter-runtime.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gozarError } from './error-normalizer.mjs';
import { projectSession, projectDurable, projectAttached } from './route-view.mjs';
import { enrichRoute } from './embedding-state.mjs';

export { createReadContext };

/** Deterministic lifecycle projections for every admitted usage kind; no provider or process is started. */
export function fakeRouteScenarios({ target = '127.0.0.1:18765', now = Date.parse('2026-11-13T12:00:00Z') } = {}) {
  const properties = { reach: 'internet', transport: 'https', traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
    address: { stability: 'stable', scope: 'fixture', conditions: [], ports: null }, cost: { kind: 'free', summary: 'Fixture', currency: null, amount: null, period: null },
    needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller', protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'this-device', checks: ['nonce', 'tls'] } };
  const origin = 'https://screen.example.invalid', checkedAt = new Date(now).toISOString(), future = new Date(now + 60_000).toISOString();
  return ['session', 'attached', 'durable'].flatMap(kind => ['detected', 'verified', 'expired', 'cleanup-unconfirmed'].map(state => {
    const handle = { kind, id: `fixture-${kind}`, generation: 1 }, verified = state !== 'detected';
    const expiry = state === 'expired' ? new Date(now - 1).toISOString() : future;
    const options = { handle, properties, now };
    const route = kind === 'durable' ? projectDurable({ state: verified ? 'usable' : 'unverified', origin, target, verification: { status: verified ? 'verified' : 'unverified', checkedAt, validUntil: expiry }, expiresAt: expiry }, options)
      : kind === 'attached' ? projectAttached({ state: verified ? 'usable' : 'unverified', origin, target, properties, checkedAtMs: now, expiresAt: expiry }, options)
      : projectSession({ snapshot: { phase: verified ? 'published-ready' : 'candidate-ready', candidate: origin, published: verified ? origin : null, target, expiresAt: expiry } }, options);
    return enrichRoute({ ...route, cleanup: { state: state === 'cleanup-unconfirmed' ? 'unconfirmed' : 'none' } }, { target, expiresAt: expiry, validUntil: expiry, now });
  }));
}

/**
 * A read context whose probe and verification answer as told. `probeOk` is the detect verdict (default true);
 * `verified` is the outcome of a route check (default true). The testing `createRouteApi` also uses `verified` for the
 * challenge check of a durable route, so a durable fake answers as told too.
 */
export function fakeReadContext({ home, probeOk = true, verified = true, now = Date.now } = {}) {
  return createReadContext({
    home, platform: 'linux', now,
    configuration: async () => null,
    probe: async () => ({ ok: probeOk }),
    verifyChallenge: async () => ({ status: verified ? 'verified' : 'unverified', checkedAt: verified ? new Date(now()).toISOString() : null }),
  });
}

// An expose of kind session starts a controller process. A fake provider has none, so the testing API starts no process
// and answers as a controller that has a candidate address ready. A test may replace it with `expose: { startSession }`.
const fakeStartSession = options => ({ snapshot: { sessionId: `fake-${options.port}`, phase: 'candidate-ready', candidate: options.origin ?? 'https://fake.example.invalid', expiresAtMs: Date.now() + (options.lifetimeMs ?? 60_000) } });

/** The route API with no process or network: sessions are answered in memory. Same options as the package's own factory. */
export function createRouteApi(deps = {}) {
  // A durable route is checked by the challenge verifier. With a read context given, that verifier is the context's.
  const verify = deps.verify ?? (deps.readContext && (async ({ origin, target }) => {
    const checked = await deps.readContext.verifyChallenge(origin, target);
    return { method: 'challenge', error: checked.status === 'verified' ? null : 'fake', scope: 'controller-origin', ...checked };
  }));
  return createCoreRouteApi({ platform: 'linux', ...deps, ...(verify ? { verify } : {}), expose: { startSession: fakeStartSession, ...deps.expose } });
}

const KINDS = ['session', 'durable'];
const REACHES = ['internet', 'tailnet', 'lan', 'this-device'];

const moduleSource = (actions = []) => `// A fake provider written by @tnunamak/gozar/testing. It does nothing outside memory.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export default {
  id: definition.id,
  definition,
  async detect(ctx) { const seen = await ctx.probe({ fake: true }); return { state: seen?.ok === true ? 'ready' : 'unknown', facts: { fake: true, setupNeeded: false } }; },
  properties: () => structuredClone(definition.capabilities),
  setupActions: () => ${JSON.stringify(actions)},
  async setup() { return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) {
    const resourceKey = definition.id + ':' + sha({ target: request.target }).slice(0, 16);
    return { digest: sha({ id: definition.id, target: request.target, usage: request.usage?.kind }), origin: request.origin ?? null, resourceKey, effects: [],
      readback: { kind: request.usage?.kind, origin: request.origin ?? null, target: request.target }, cleanup: { kind: 'fake' }, precondition: null };
  },
  async create(ctx, plan) {
    return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation ?? 1, identity: null, readback: plan.readback, origin: plan.origin ?? 'https://' + definition.id + '.example.invalid' };
  },
  async observe(ctx, request) { return { present: false, resourceKey: definition.id + ':' + sha({ target: request.target }).slice(0, 16), identity: null, revision: null }; },
  async verify(ctx, receipt) { return ctx.verifyChallenge(receipt?.readback?.origin ?? receipt?.origin ?? '', receipt?.readback?.target ?? ''); },
  async remove() { return { removed: true, debt: null }; },
  async runtimeFacts() { return { properties: structuredClone(definition.capabilities), ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
};
`;

// The module of a fake that also has the durable kind. It keeps the session methods above, and answers the durable
// ones through the engine's own adapter, with a facet whose rule store is `store.json` next to the module: a version
// counter is the compare-and-set token, and a write is a rename, so another process sees whole states only.
const durableModuleSource = runtime => `// A fake durable provider written by @tnunamak/gozar/testing. Its rule store is the file store.json beside this module.
import { recipeAdapter } from ${JSON.stringify(runtime)};
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
// The session methods live in plain.mjs, written beside this file; it is loaded by URL so the text of this template is
// never mistaken for an import of the testing module itself.
const { default: plain } = await import(new URL('./plain.mjs', import.meta.url));

const storePath = new URL('./store.json', import.meta.url);
const read = () => JSON.parse(readFileSync(storePath, 'utf8'));
const write = state => { const temporary = new URL('./store.json.tmp', import.meta.url); writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, storePath); };
const slotIds = ['a', 'b', 'c'];

function durableFacet(definition) {
  return {
    family: 'fake',
    definition,
    async observe() { const state = read(); return { identity: state.identity, snapshot: state.entries, version: String(state.version) }; },
    slots: () => slotIds.map(slot => ({ slot, origin: 'https://' + slot + '.' + plain.id + '.invalid', permitted: true })),
    read: (snapshot, slot) => snapshot[slot]?.rule ?? null,
    foreign: (snapshot, slot) => snapshot[slot]?.foreign === true,
    occupied: (snapshot, slot) => snapshot[slot] !== undefined,
    expand: target => ({ forward: target }),
    expiresAt: () => null,
    async put(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version)) return 'conflict';
      state.entries[slot] = { rule }; state.version += 1; write(state);
      return 'written';
    },
    async delete(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version) || !isDeepStrictEqual(state.entries[slot]?.rule, rule)) return 'conflict';
      delete state.entries[slot]; state.version += 1; write(state);
      return 'written';
    },
  };
}

const base = recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ wrapped }) => ({ durable: durableFacet(wrapped) }) });
const isDurable = value => value === 'durable';
export default {
  ...plain,
  durable: base.durable,
  plan: (ctx, request) => (isDurable(request.usage?.kind) ? base.plan(ctx, request) : plain.plan(ctx, request)),
  observe: (ctx, request) => (isDurable(request.usage?.kind) ? base.observe(ctx, request) : plain.observe(ctx, request)),
  verify: (ctx, receipt) => (isDurable(receipt?.readback?.kind) ? base.verify(ctx, receipt) : plain.verify(ctx, receipt)),
  remove: (ctx, receipt, ...rest) => (isDurable(receipt?.readback?.kind) ? base.remove(ctx, receipt, ...rest) : plain.remove(ctx, receipt, ...rest)),
};
`;
// The Query's protocol words; a fake inspects no traffic, so it can carry each of them.
const PROTOCOLS = ['sse', 'streamable-http', 'oauth-dcr'];
const runtimeUrl = pathToFileURL(fileURLToPath(new URL('./adapter-runtime.mjs', import.meta.url))).href;

/**
 * Writes a one-provider registry to a scratch directory and returns `{ manifest, root, cleanup }`, which is what
 * `createRouteApi({ manifest, root })` loads. `kinds` is any of 'session' and 'durable'. A durable fake keeps its
 * rules in `<root>/providers/<id>/store.json` (read it to see what the provider holds; a rule is `entries.<slot>.rule`), so
 * another process sees the same state. The fake never touches the network. `id` is the id the catalog shows as `providerId`.
 * `protocols` uses the Query's words ('sse', 'streamable-http', 'oauth-dcr'); a fake carries all three unless a test narrows it,
 * so an app's protocol requirements do not make its own fake ineligible.
 */
export async function fakeRegistry({ id, label, kinds, reach, transport = 'https', protocols = PROTOCOLS, dir, facts = [], setupActions = [] } = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw gozarError('invalid_input', 'fakeRegistry needs an id of lowercase letters, digits and hyphens');
  // An attached fake would make expose start a real controller process, so only session and durable fakes exist.
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !KINDS.includes(kind))) throw gozarError('invalid_input', `fakeRegistry kinds must be a non-empty list of ${KINDS.join(' and ')}: only session and durable fakes are supported`);
  if (!REACHES.includes(reach)) throw gozarError('invalid_input', `fakeRegistry reach must be one of ${REACHES.join(', ')}`);
  if (!['https', 'http'].includes(transport)) throw gozarError('invalid_input', "fakeRegistry transport must be 'https' or 'http'");
  if (!Array.isArray(protocols) || protocols.some(item => !PROTOCOLS.includes(item))) throw gozarError('invalid_input', `fakeRegistry protocols must be a list of ${PROTOCOLS.join(', ')}`);
  const own = dir === undefined;
  const root = dir ?? await mkdtemp(join(tmpdir(), 'gozar-fake-'));
  const folder = join(root, 'providers', id);
  await mkdir(folder, { recursive: true });
  const definition = {
    schemaVersion: 1, id, label: label ?? `Fake ${id}`, needs: 'Needs nothing: this is a test fake.',
    capabilities: {
      reach, transport,
      traffic: { tlsTermination: transport === 'https' ? 'provider' : 'unknown', providerCanReadPayload: false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
      address: { stability: 'unknown', scope: 'a fake address that exists only in memory', conditions: [], ports: null },
      cost: { kind: 'free', summary: 'A fake costs nothing.', currency: null, amount: null, period: null },
      needsAccount: false, lifetimes: [...kinds], supervision: 'controller',
      protocols: { sse: protocols.includes('sse'), streamableHttp: protocols.includes('streamable-http'), oauthDcr: protocols.includes('oauth-dcr') },
      proof: { vantage: 'this-device', checks: ['nonce'] },
    },
    supportedKinds: [...kinds], facts,
    disclosure: { revision: `disc-${id}`, text: 'A fake provider used in tests. Nothing leaves this process.', links: [] },
    ownership: 'gozar-owned',
  };
  await writeFile(join(folder, 'definition.json'), JSON.stringify({ adapter: definition }, null, 2));
  if (kinds.includes('durable')) {
    // The durable engine reads the provider's durable recipe from the wrapped definition of the recipe adapter.
    definition.capabilities.address.stability = 'stable';
    await writeFile(join(folder, 'definition.json'), JSON.stringify({ wraps: './wrapped.definition.json', adapter: definition }, null, 2));
    await writeFile(join(folder, 'wrapped.definition.json'), JSON.stringify({ schemaVersion: 1, definition: {
      id, planVersion: 1, idleTimeoutMs: null, providerResource: `${id}-slot`, addressStability: 'stable', durableLifetime: 'provider-persistent',
      actions: [], recipes: {}, durableRecipe: { mode: 'fake', slots: ['a', 'b', 'c'], listener: { forward: '{target}' } } } }, null, 2));
    await writeFile(join(folder, 'store.json'), JSON.stringify({ identity: `store-${id}`, version: 1, entries: {} }));
    await writeFile(join(folder, 'plain.mjs'), moduleSource(setupActions));
    await writeFile(join(folder, 'index.mjs'), durableModuleSource(runtimeUrl));
  } else {
    await writeFile(join(folder, 'index.mjs'), moduleSource(setupActions));
  }
  return {
    manifest: { providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] },
    root,
    cleanup: async () => { await rm(own ? root : join(root, 'providers', id), { recursive: true, force: true }); if (!own) await rmdir(join(root, 'providers')).catch(error => { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(error.code)) throw error; }); },
  };
}
