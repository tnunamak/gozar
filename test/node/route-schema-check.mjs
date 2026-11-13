// Shared by the consumer-side route tests: the same schema keywords route-contract.test.mjs enforces, checked
// against runtime/route-catalog.schema.json, plus synthetic adapters. Not a test file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = JSON.parse(readFileSync(join(root, 'runtime/route-catalog.schema.json'), 'utf8'));
export const fixtures = JSON.parse(readFileSync(join(root, 'test/fixtures/route-contract.json'), 'utf8'));
const annotations = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const kinds = { string: v => typeof v === 'string', number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v), boolean: v => typeof v === 'boolean',
  null: v => v === null, array: Array.isArray, object: v => typeof v === 'object' && v !== null && !Array.isArray(v) };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validate(node, value, defs, path = '$') {
  const errors = [];
  for (const key of Object.keys(node)) {
    if (annotations.has(key)) continue;
    switch (key) {
      case '$ref': errors.push(...validate(defs[/^#\/\$defs\/(\w+)$/.exec(node.$ref)[1]], value, defs, path)); break;
      case 'type': if (![].concat(node.type).some(type => kinds[type](value))) errors.push(`${path}: expected ${node.type}`); break;
      case 'const': if (!same(value, node.const)) errors.push(`${path}: expected const ${JSON.stringify(node.const)}`); break;
      case 'enum': if (!node.enum.some(item => same(item, value))) errors.push(`${path}: not in enum`); break;
      case 'minimum': if (typeof value === 'number' && value < node.minimum) errors.push(`${path}: below minimum`); break;
      case 'pattern': if (typeof value === 'string' && !new RegExp(node.pattern).test(value)) errors.push(`${path}: pattern mismatch`); break;
      case 'required': if (kinds.object(value)) for (const name of node.required) if (!(name in value)) errors.push(`${path}: missing ${name}`); break;
      case 'properties': if (kinds.object(value)) for (const [name, sub] of Object.entries(node.properties)) if (name in value) errors.push(...validate(sub, value[name], defs, `${path}.${name}`)); break;
      case 'additionalProperties': if (kinds.object(value)) for (const name of Object.keys(value)) if (!(name in (node.properties ?? {}))) { if (node.additionalProperties === false) errors.push(`${path}: unknown property ${name}`); else errors.push(...validate(node.additionalProperties, value[name], defs, `${path}.${name}`)); } break;
      case 'items': if (Array.isArray(value)) value.forEach((item, i) => errors.push(...validate(node.items, item, defs, `${path}[${i}]`))); break;
      case 'oneOf': { const hits = node.oneOf.filter(sub => validate(sub, value, defs, path).length === 0).length; if (hits !== 1) errors.push(`${path}: matches ${hits} oneOf branches`); break; }
      case 'anyOf': if (!node.anyOf.some(sub => validate(sub, value, defs, path).length === 0)) errors.push(`${path}: matches no anyOf branch`); break;
      default: throw new Error(`Unsupported schema keyword ${key}`);
    }
  }
  return errors;
}
/** Asserts that `value` is a valid instance of the named $defs shape. */
export function assertShape(shape, value) {
  assert.ok(schema.$defs[shape], `no schema shape ${shape}`);
  assert.deepEqual(validate(schema.$defs[shape], value, schema.$defs), [], `${shape} is not valid`);
}
export const frozenCodes = new Set(fixtures.frozenErrorCodes);
/** The code an app would see; asserts it is in the frozen union. */
export async function codeOf(promise) {
  try { await promise; } catch (error) { assert.ok(frozenCodes.has(error.code), `unfrozen code ${error.code}`); return error.code; }
  assert.fail('expected a rejection');
}

const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.tmp', 'gozar-route-tests');
/** A private scratch directory, removed when the test ends. */
export async function scratch(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  await chmod(base, 0o700); // the service state check refuses group-writable ancestors
  const directory = await mkdtemp(join(base, 'route-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// --- Synthetic adapters ---------------------------------------------------------------------------
export const properties = (over = {}) => ({
  reach: 'internet', transport: 'https',
  traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: ['provider'], evidenceRef: 'evidence-synthetic-1' },
  address: { stability: 'stable', scope: 'account', conditions: [] }, cost: { kind: 'free', summary: 'No charge', currency: null, amount: null, period: null },
  needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller',
  protocols: { sse: true, streamableHttp: true, oauthDcr: true }, ...over });
export const disclosure = id => ({ revision: `disc-${id}`, text: `Synthetic disclosure for ${id}.`, links: [] });
export const action = (id, kind = 'gozar-runs', over = {}) => ({ id, kind, label: `Do ${id}`, digest: `sha256:${id}-1`, disclosure: disclosure(id), ...over });

/** An adapter with call counters. `world` is shared provider state that only create/remove/setup may change. */
export function stubAdapter(id, { caps = properties(), kinds = ['session', 'attached', 'durable'], state = 'ready', actions = [], world = { rules: [] }, origin = null, setup } = {}) {
  const calls = { detect: 0, plan: 0, observe: 0, create: 0, remove: 0, setup: 0, verify: 0 };
  const adapter = {
    id, calls, world,
    definition: { schemaVersion: 1, id, label: `Route ${id}`, capabilities: caps, supportedKinds: kinds, disclosure: disclosure(id) },
    async detect() { calls.detect++; return { state, facts: { id } }; },
    properties: () => caps,
    setupActions: () => actions,
    async setup(ctx, actionId, secretHandle) { calls.setup++; return setup ? setup(ctx, actionId, secretHandle) : { state: 'complete', nextAction: null }; },
    async plan(ctx, request) { calls.plan++; return { digest: `plan-${id}-${request.target}`, origin, resourceKey: `res-${id}`, effects: [], readback: null, cleanup: null, precondition: null }; },
    async observe() { calls.observe++; return { present: world.rules.length > 0, resourceKey: `res-${id}`, identity: null, revision: null }; },
    async create(ctx, plan) { calls.create++; world.rules.push(id); return { schemaVersion: 1, adapterId: id, resourceKey: `res-${id}`, generation: ctx.generation ?? 1, identity: { origin: origin ?? 'https://example.invalid' }, readback: null, origin: origin ?? 'https://example.invalid' }; },
    async verify() { calls.verify++; return { status: 'verified', checkedAt: new Date().toISOString() }; },
    async remove() { calls.remove++; world.rules.length = 0; return { removed: true, debt: null }; },
    async runtimeFacts() { return { properties: caps, ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
  };
  return adapter;
}
export const query = (over = {}) => ({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:8799', home: '/nonexistent', usage: { kind: 'session', lifetimeMs: 60_000 },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] }, ...over });
// Token stubs that implement the seam: bound to the whole binding, single use.
export function tokenStubs() {
  const live = new Map(); let n = 0;
  const consentBinding = (q, home, revision) => ({ owner: q.owner, home, target: q.target, usage: q.usage, intent: q.intent ?? 'create', requirements: q.requirements,
    route: q.route ?? null, origin: q.origin ?? null, disclosureRevision: revision });
  const issue = async ({ binding, grant }) => { const token = `tok_synthetic_${++n}`; live.set(token, { binding, grant }); return { token, expiresAt: '2026-11-12T12:10:00.000Z' }; };
  const redeem = async ({ token, binding }) => {
    const entry = live.get(token); live.delete(token);
    if (!entry) throw Object.assign(new Error('unknown'), { code: 'consent_unknown' });
    if (JSON.stringify(entry.binding) !== JSON.stringify(binding)) throw Object.assign(new Error('mismatch'), { code: 'consent_mismatch' });
    return entry.grant;
  };
  return { consentBinding, issue, redeem, live };
}

/** A deep copy of a valid fixture value, so tests start from a shape the contract itself accepts. */
export function fixtureValue(shape, name) {
  const found = fixtures.valid.find(item => item.shape === shape && (name === undefined || item.name === name));
  assert.ok(found, `no fixture ${shape}/${name}`);
  return structuredClone(found.value);
}
