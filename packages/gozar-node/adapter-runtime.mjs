// Adapter runtime: loads registered adapter modules and wraps existing recipe definitions as Adapters.
//
// One adapter is one directory under adapters/providers/ plus one `{id, module, definition}` entry in
// the manifest `providers` list. Nothing in core, the CLI or an app names a provider. The runtime is a
// uniform layer over the EXISTING admitted recipe engine: it never builds an executable payload. It
// hands recipe references to the contexts the engine supplies (`probe`, `executePlan`,
// `compareAndRemove`) and rejects every method or kind that has no recipe with `unsupported`.
//
// Context fields this runtime reads beyond the frozen types (all optional, additive):
//   ctx.platform  string   host platform, injected so logic never reads process.platform itself
//   ctx.home      string   canonical Gozar home; the durable plan needs it for durablePlanFacts()
//   ctx.generation number  generation recorded on receipts built by an adapter (default 1)
// `ctx.probe(recipe)` resolves `{ ok: boolean }`: the engine ran the recipe and its parser said yes.
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultAdaptersRoot = resolve(packageRoot, 'adapters');
const adapterSchema = JSON.parse(readFileSync(resolve(packageRoot, 'runtime/adapter.schema.json'), 'utf8'));

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// --- Errors -------------------------------------------------------------------------------------------

/** What an adapter operation rejects with. Only the four frozen AdapterEffectError codes are used. */
export function effectError(code, message) { return Object.assign(new Error(message), { code }); }
const effectCodes = new Set(['precondition_failed', 'unsupported', 'provider_unavailable', 'setup_required']);
const isEffectError = error => effectCodes.has(error?.code);
// Provider codes map onto the frozen list (route contract revision 3 (f)). Anything else is a generic
// provider failure: the provider's own message is never forwarded, so it cannot carry a secret.
export function mapProviderError(error) {
  if (isEffectError(error)) return error;
  if (['provider_denied', 'provider_not_running'].includes(error?.code)) return effectError('setup_required', 'The provider needs an operator action before this can proceed');
  if (error?.code === 'provider_unsupported') return effectError('unsupported', 'The provider does not support this operation');
  return effectError('provider_unavailable', 'The provider operation failed');
}
// A load failure is a Gozar fault: the frozen consumer code `internal_error`.
const internalError = 'internal_error';
const loadError = (id, message) => Object.assign(new Error(`Adapter ${id}: ${message}`), { code: internalError, adapterId: id });

// --- Schema validation (only the keywords adapter.schema.json uses) ------------------------------------

const kinds = {
  string: v => typeof v === 'string', number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean', null: v => v === null, array: Array.isArray,
  object: v => typeof v === 'object' && v !== null && !Array.isArray(v),
};
function validate(schema, value, defs, path = '$') {
  const errors = [];
  for (const key of Object.keys(schema)) {
    if (['$schema', '$id', 'title', 'description', '$defs'].includes(key)) continue;
    switch (key) {
      case '$ref': errors.push(...validate(defs[schema.$ref.replace('#/$defs/', '')], value, defs, path)); break;
      case 'type': if (![].concat(schema.type).some(type => kinds[type](value))) errors.push(`${path}: expected ${[].concat(schema.type).join('|')}`); break;
      case 'const': if (!isDeepStrictEqual(value, schema.const)) errors.push(`${path}: expected const`); break;
      case 'enum': if (!schema.enum.some(item => isDeepStrictEqual(item, value))) errors.push(`${path}: not in enum`); break;
      case 'required': if (kinds.object(value)) for (const name of schema.required) if (!(name in value)) errors.push(`${path}: missing ${name}`); break;
      case 'properties': if (kinds.object(value)) for (const [name, sub] of Object.entries(schema.properties)) if (name in value) errors.push(...validate(sub, value[name], defs, `${path}.${name}`)); break;
      case 'additionalProperties': if (kinds.object(value)) for (const name of Object.keys(value)) if (!(name in (schema.properties ?? {}))) errors.push(`${path}: unknown property ${name}`); break;
      case 'items': if (Array.isArray(value)) value.forEach((item, index) => errors.push(...validate(schema.items, item, defs, `${path}[${index}]`))); break;
      case 'minimum': if (typeof value === 'number' && value < schema.minimum) errors.push(`${path}: below minimum`); break;
      case 'pattern': if (typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`); break;
      default: throw new Error(`Unsupported schema keyword ${key}`);
    }
  }
  return errors;
}
/** Errors for a value against one `$defs` shape of runtime/adapter.schema.json; empty means valid. */
export const validateShape = (shape, value) => validate(adapterSchema.$defs[shape], value, adapterSchema.$defs);

/** An AdapterDefinition must validate and its declared lifetimes must equal its supported kinds. */
export function definitionErrors(definition) {
  const errors = validateShape('AdapterDefinition', definition);
  if (errors.length) return errors;
  const kindsDeclared = [...definition.supportedKinds].sort(), lifetimes = [...definition.capabilities.lifetimes].sort();
  if (new Set(kindsDeclared).size !== kindsDeclared.length) errors.push('supportedKinds has duplicates');
  if (!isDeepStrictEqual(kindsDeclared, lifetimes)) errors.push('capabilities.lifetimes must equal supportedKinds');
  return errors;
}

// --- Loading -------------------------------------------------------------------------------------------

const methods = ['detect', 'properties', 'setupActions', 'setup', 'plan', 'create', 'observe', 'verify', 'remove', 'runtimeFacts'];

async function inside(root, path, label, id) {
  const providers = await realpath(resolve(root, 'providers')).catch(() => { throw loadError(id, 'providers directory is missing'); });
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root, 'providers') + sep)) throw loadError(id, `${label} is outside providers/`);
  const real = await realpath(target).catch(() => { throw loadError(id, `${label} is missing`); });
  if (!real.startsWith(providers + sep)) throw loadError(id, `${label} resolves outside providers/`);
  return real;
}

/**
 * Loads every `providers` entry of a manifest. An entry that is invalid, incomplete or missing is a load
 * error, never a skipped adapter. `manifest` is a path, an object `{providers}` or omitted (the packaged
 * adapters/manifest.json). `root` is the directory holding `providers/`; it defaults to the manifest's
 * directory. Only files that resolve inside `<root>/providers/` are loadable.
 */
export async function loadAdapters({ manifest, root } = {}) {
  let data = manifest, base = root;
  if (data === undefined || typeof data === 'string') {
    const path = resolve(data ?? resolve(defaultAdaptersRoot, 'manifest.json'));
    data = JSON.parse(await readFile(path, 'utf8'));
    base ??= dirname(path);
  }
  base = resolve(base ?? defaultAdaptersRoot);
  if (!Array.isArray(data?.providers)) throw loadError('(manifest)', 'manifest has no providers list');
  const adapters = [], seen = new Set();
  for (const entry of data.providers) {
    const id = entry?.id ?? '(unnamed)';
    const entryErrors = validateShape('ProviderEntry', entry);
    if (entryErrors.length) throw loadError(id, `invalid registry entry: ${entryErrors.join('; ')}`);
    if (seen.has(id)) throw loadError(id, 'duplicate registry id');
    seen.add(id);
    const modulePath = await inside(base, entry.module, 'module', id);
    const definitionPath = await inside(base, entry.definition, 'definition', id);
    let file;
    try { file = JSON.parse(await readFile(definitionPath, 'utf8')); } catch { throw loadError(id, 'definition is not readable JSON'); }
    const errors = definitionErrors(file?.adapter);
    if (errors.length) throw loadError(id, `invalid definition: ${errors.join('; ')}`);
    let adapter;
    try { adapter = (await import(pathToFileURL(modulePath).href)).default; } catch (error) { throw loadError(id, `module failed to load: ${error?.code ?? 'error'}`); }
    const missing = methods.filter(name => typeof adapter?.[name] !== 'function');
    if (missing.length) throw loadError(id, `incomplete adapter, missing ${missing.join(', ')}`);
    if (adapter.id !== id || file.adapter.id !== id || !isDeepStrictEqual(adapter.definition, file.adapter)) throw loadError(id, 'registry entry, module and definition disagree');
    adapters.push(adapter);
  }
  return adapters;
}

// --- recipeAdapter ------------------------------------------------------------------------------------

const defaultPlatform = () => process.platform; // the one place the host platform is read; callers inject ctx.platform
const durableState = { load: () => import('./durable-route.mjs'), serve: () => import('./tailscale-localapi.mjs') };
/** Test seam: replace the durable engine / LocalAPI loaders. Returns a restore function. */
export function setDurableDepsForTest(deps) {
  const saved = { ...durableState };
  Object.assign(durableState, deps);
  return () => Object.assign(durableState, saved);
}

const toAction = (action, disclosure) => {
  const body = { id: action.id, kind: action.url ? 'open-url' : 'instructions', label: action.label, disclosure,
    ...(action.url ? { href: action.url } : { instructions: action.command ? `${action.reason} Run: ${action.command.join(' ')}` : action.reason }) };
  return { ...body, digest: sha(body) };
};

/** Reads `<definition file>`: `{ wraps?, adapter }`. `wraps` names the existing recipe definition it wraps. */
function readDefinition(location) {
  const url = typeof location === 'string' ? pathToFileURL(location) : location;
  const file = JSON.parse(readFileSync(url, 'utf8'));
  const errors = definitionErrors(file.adapter);
  if (errors.length) throw loadError(file.adapter?.id ?? '(unknown)', `invalid definition: ${errors.join('; ')}`);
  let wrapped = null;
  if (file.wraps) {
    if (!/^(\.\/|(\.\.\/)+)[A-Za-z0-9_.-]+\.definition\.json$/.test(file.wraps)) throw loadError(file.adapter.id, 'wraps must name an adapters/*.definition.json file');
    wrapped = JSON.parse(readFileSync(new URL(file.wraps, url), 'utf8')).definition;
    if (wrapped?.id !== file.adapter.id) throw loadError(file.adapter.id, 'wrapped recipe definition has a different id');
  }
  return { adapter: file.adapter, wrapped };
}

const requireReceipt = (plan, receipt, id) => {
  if (receipt?.schemaVersion !== 1 || receipt.adapterId !== id || receipt.resourceKey !== plan.resourceKey || !Number.isSafeInteger(receipt.generation)) {
    throw effectError('provider_unavailable', 'The engine returned a receipt that does not match the plan');
  }
  return receipt;
};

/**
 * Implements every Adapter method through the existing admitted recipe engine. `extend({base, ...})`
 * returns method replacements for providers with a custom protocol (they still receive the frozen contexts).
 * Options: `definition` (URL or path of definition.json), `excludeActions` (definition action ids that
 * are consent steps, covered by the consent token, not setup), `externalOwned` (the route is owner-managed;
 * nothing is created or deleted), `platform` (default host platform provider, used only when the context
 * carries none).
 */
export function recipeAdapter({ definition: location, excludeActions = [], externalOwned = false, platform = defaultPlatform, extend = null }) {
  const { adapter: definition, wrapped } = readDefinition(location);
  const recipes = wrapped?.recipes ?? {};
  const platformOf = ctx => ctx?.platform ?? platform();
  const kinds = new Set(definition.supportedKinds);
  const durableRecipe = wrapped?.durableRecipe ?? null;
  const allActions = (wrapped?.actions ?? []).map(action => toAction(action, definition.disclosure));
  const shown = allActions.filter(action => !excludeActions.includes(action.id));
  const unsupported = what => effectError('unsupported', `${definition.id} does not support ${what}`);

  async function listener(request) {
    const { getServeConfig } = await durableState.serve();
    let reply;
    try { reply = await getServeConfig(); } catch (error) { throw mapProviderError(error); }
    const { config, etag } = reply;
    if (!request.origin) return { present: false, resourceKey: wrapped.providerResource, identity: null, revision: etag };
    const url = new URL(request.origin), port = url.port || '443', hostPort = `${url.hostname}:${port}`;
    const live = { tcp: config.TCP?.[port] ?? null, web: config.Web?.[hostPort] ?? null, funnel: config.AllowFunnel?.[hostPort] ?? null };
    const wanted = JSON.parse(JSON.stringify(durableRecipe.listener).replaceAll('{target}', request.target));
    const present = isDeepStrictEqual(live, { tcp: wanted.tcp, web: wanted.web, funnel: wanted.funnel ?? null });
    const occupied = Object.values(live).some(value => value !== null);
    return { present, resourceKey: `${wrapped.providerResource}:${port}`, identity: { hostPort, occupied, matches: present }, revision: etag };
  }

  const adapter = {
    id: definition.id,
    definition,

    async detect(ctx) {
      const os = platformOf(ctx);
      if (os !== 'linux') return { state: 'unsupported', facts: { platform: os, detected: false, setupNeeded: false } };
      if (externalOwned) return { state: 'ready', facts: { platform: os, detected: true, setupNeeded: false, externalOwned: true } };
      if (!recipes.detect) return { state: 'unknown', facts: { platform: os, detected: null, setupNeeded: false } };
      let result;
      try { result = await ctx.probe(recipes.detect); } catch { return { state: 'unknown', facts: { platform: os, detected: null, setupNeeded: false } }; }
      const detected = result?.ok === true;
      const setupNeeded = !detected && shown.length > 0;
      return { state: detected ? 'ready' : setupNeeded ? 'action-required' : 'unsupported', facts: { platform: os, detected, setupNeeded } };
    },

    properties: () => structuredClone(definition.capabilities),

    setupActions: facts => (facts?.setupNeeded ? structuredClone(shown) : []),

    async setup(ctx, actionId) {
      const action = allActions.find(item => item.id === actionId);
      if (!action) throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
      return { state: 'pending', nextAction: structuredClone(action) };
    },

    async plan(ctx, request) {
      const kind = request?.usage?.kind;
      if (platformOf(ctx) !== 'linux') throw unsupported('this platform');
      if (!kinds.has(kind)) throw unsupported(`the ${kind} kind`);
      if (kind === 'durable') {
        if (!durableRecipe) throw unsupported('the durable kind');
        if (typeof ctx.home !== 'string') throw effectError('provider_unavailable', 'A durable plan needs the Gozar home');
        const engine = await durableState.load();
        if (typeof engine.durablePlanFacts !== 'function') throw unsupported('the durable engine');
        let facts, seen;
        try { facts = await engine.durablePlanFacts({ home: ctx.home, adapterId: definition.id, target: request.target, origin: request.origin }); seen = await listener(request); }
        catch (error) { throw mapProviderError(error); }
        return { digest: facts.planDigest, origin: facts.origin ?? request.origin, resourceKey: facts.observedResource, effects: [],
          readback: { kind: 'durable', origin: facts.origin ?? request.origin, target: request.target }, cleanup: { kind: 'durable' }, precondition: { revision: seen.revision } };
      }
      if (externalOwned) {
        if (!request.origin) throw effectError('setup_required', 'Provide the owner-managed HTTPS origin first');
      } else if (!recipes.create) throw unsupported('create');
      const effects = externalOwned ? [] : [{ adapterId: definition.id, operation: 'create', recipeRef: 'create/execute' }];
      const resourceKey = `${definition.id}:${sha({ target: request.target, origin: request.origin }).slice(0, 16)}`;
      const body = { adapterId: definition.id, kind, target: request.target, origin: request.origin, effects, resourceKey };
      return { digest: sha(body), origin: request.origin, resourceKey, effects, readback: { kind, origin: request.origin, target: request.target },
        cleanup: externalOwned ? { kind: 'external-owned' } : { operation: 'remove', recipeRef: 'remove/execute' }, precondition: null };
    },

    async create(ctx, plan) {
      if (plan?.readback?.kind === 'durable') throw unsupported('create for the durable kind: the durable engine owns it');
      if (!externalOwned && !recipes.create) throw unsupported('create');
      if (!kinds.has(plan?.readback?.kind)) throw unsupported('this kind');
      try { await ctx.assertGeneration(); return requireReceipt(plan, await ctx.executePlan(plan), definition.id); }
      catch (error) { throw mapProviderError(error); }
    },

    async observe(ctx, request) {
      if (request?.usage?.kind === 'durable' && durableRecipe) return listener(request);
      const resourceKey = `${definition.id}:${sha({ target: request.target, origin: request.origin }).slice(0, 16)}`;
      return { present: false, resourceKey, identity: null, revision: null };
    },

    async verify(ctx, receipt) {
      const { origin, target } = receipt?.readback ?? {};
      if (typeof origin !== 'string' || typeof target !== 'string') return { status: 'unverified', checkedAt: null };
      return ctx.verifyChallenge(origin, target);
    },

    async remove(ctx, receipt, observed) {
      if (receipt?.readback?.kind === 'durable') throw unsupported('remove for the durable kind: the durable engine owns it');
      if (externalOwned) return { removed: true, debt: null };
      if (!recipes.remove) throw unsupported('remove');
      try { await ctx.assertGeneration(); return await ctx.compareAndRemove(receipt, observed); }
      catch (error) { throw mapProviderError(error); }
    },

    async runtimeFacts() {
      const idle = wrapped?.idleTimeoutMs ?? null;
      return { properties: structuredClone(definition.capabilities), ingress: null,
        limits: { recommendedPollIntervalMs: idle ? Math.max(1000, Math.floor(idle / 2)) : 60000, idleTimeoutMs: idle } };
    },
  };
  return extend ? Object.assign(adapter, extend({ base: { ...adapter }, definition, wrapped, allActions, platformOf, unsupported })) : adapter;
}

// --- AdmittedEffectContext -----------------------------------------------------------------------------

/**
 * Builds the AdmittedEffectContext an engine hands to adapters. It holds no ownership logic. It honours
 * `plan.precondition` (executePlan) and the observed revision (compareAndRemove): when the provider
 * revision moved, nothing is changed and the call rejects with `precondition_failed`.
 *   readRevision(resourceKey) -> string | null   the provider's current revision
 *   applyPlan(plan) -> { identity, readback }    the engine's admitted effect (the only writer)
 *   cleanupPlan(plan) -> void                    undo a partly applied effect
 *   removeResource(receipt, observed) -> Removal the engine's identity-checked removal
 *   journal { begin(plan), commit(receipt), abort(resourceKey) }  intent first, then a complete receipt
 * After a failure the state is clean (cleanup ran, intent aborted) or an intent stays as recorded debt;
 * a receipt is only ever written whole.
 */
export function createAdmittedContext({ read, adapterId, generation = 1, assertGeneration = async () => {}, readRevision, applyPlan, cleanupPlan, removeResource, journal }) {
  return {
    ...read,
    generation,
    assertGeneration,
    async executePlan(plan) {
      if (plan.precondition) {
        const current = await readRevision(plan.resourceKey);
        if (current !== plan.precondition.revision) throw effectError('precondition_failed', 'The provider revision moved; nothing was changed');
      }
      await assertGeneration();
      await journal.begin(plan);
      try {
        const applied = await applyPlan(plan);
        const receipt = { schemaVersion: 1, adapterId, resourceKey: plan.resourceKey, generation, identity: applied.identity,
          readback: { ...plan.readback, ...(applied.readback ?? {}) } };
        await journal.commit(receipt);
        return receipt;
      } catch (error) {
        let clean = true;
        try { await cleanupPlan(plan); } catch { clean = false; }
        if (clean) await journal.abort(plan.resourceKey);
        throw mapProviderError(error);
      }
    },
    async compareAndRemove(receipt, observed) {
      const current = await readRevision(receipt.resourceKey);
      if (current !== (observed?.revision ?? null)) throw effectError('precondition_failed', 'The provider revision moved; nothing was removed');
      return removeResource(receipt, observed);
    },
  };
}
