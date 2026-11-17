// The registry's `providers` list is the source of truth. The older `definitions` and `normalizedDefinitions`
// arrays of adapters/manifest.json are compatibility views of it, generated here and never hand-edited.
// `--check` fails when they differ, or when a provider's module or definition file is missing.
//
// It also owns two facts of each provider definition that come from the wrapped plan definition, so that no
// consumer and no core code reads provider recipes:
//   capabilities.address.ports  the plan's port binding `candidates`, in the order Gozar tries them, else null
//   capabilities.proof          the plan's `validation` block: where Gozar checks from, and which checks it makes
//   byUsage.durable.ports       the plan's durable recipe `candidatePorts`, in the order the durable engine tries them
// and the definition's `ownership` ('gozar-owned', or 'external-owned' when the owner keeps the route), which is how
// core tells an owner-run address from a route Gozar creates, so no provider id appears in core.
// A provider that has no wrapped plan declares both in its own definition and is left alone.
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';

const VANTAGES = ['public', 'tailnet', 'lan', 'this-device', 'none'];

/** The public ports a plan definition may use, in order, or null when the provider assigns the port. */
export function derivePorts(wrapped) {
  const candidates = wrapped?.bindings?.port?.candidates;
  return Array.isArray(candidates) && candidates.length && candidates.every(Number.isInteger) ? [...candidates] : null;
}

/**
 * What the plan checks before it publishes. A vantage that is not one of the five words is `this-device` when any check exists.
 * The plan's TLS check applies "when HTTPS", so a provider whose transport is plain HTTP makes no TLS check. The stream
 * check applies "when required": it is listed here as a check the provider can make, and the catalog keeps it only for a
 * request that needs SSE.
 */
export function deriveProof(wrapped, transport) {
  const validation = wrapped?.validation;
  if (!validation || typeof validation !== 'object') return { vantage: 'none', checks: [] };
  const checks = [];
  if (validation.tls !== undefined && transport === 'https') checks.push('tls');
  if (validation.instanceNonce !== undefined) checks.push('nonce');
  if (validation.sse !== undefined) checks.push('sse');
  const vantage = VANTAGES.includes(validation.vantage) ? validation.vantage : checks.length ? 'this-device' : 'none';
  return { vantage, checks };
}

/** The public ports a durable recipe may take, in the order the durable engine tries them, or undefined without one. */
export function deriveDurablePorts(wrapped) {
  const candidates = wrapped?.durableRecipe?.candidatePorts;
  return Array.isArray(candidates) && candidates.length && candidates.every(Number.isInteger) ? [...candidates] : undefined;
}

/** The route's owner, in the words RouteView.ownership uses. */
export const deriveOwnership = wrapped => (wrapped?.ownership === 'external-owned' ? 'external-owned' : 'gozar-owned');

const rootOption = process.argv.indexOf('--root');
const adaptersUrl = rootOption > 0 ? pathToFileURL(resolve(process.argv[rootOption + 1]) + sep) : new URL('../adapters/', import.meta.url);
// `--manifest FILE` checks another manifest (a test uses it); provider files are always read from adapters/.
const custom = process.argv.indexOf('--manifest');
const path = custom > 0 ? process.argv[custom + 1] : fileURLToPath(new URL('manifest.json', adaptersUrl));
const check = process.argv.includes('--check');

async function sync() {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(manifest.providers) || !manifest.providers.length) { console.error('adapters/manifest.json has no providers'); process.exit(1); }
  const views = manifest.providers.map(provider => `${provider.id}.definition.json`);
  const problems = [];
  for (const provider of manifest.providers) {
    for (const key of ['module', 'definition']) {
      try { await access(new URL(provider[key], adaptersUrl)); } catch { problems.push(`${provider.id}: ${key} ${provider[key]} is missing`); }
    }
    const file = new URL(provider.definition, adaptersUrl);
    let text, data;
    try { text = await readFile(file, 'utf8'); data = JSON.parse(text); } catch { continue; }
    if (!data.wraps) continue;
    let wrapped;
    try { wrapped = JSON.parse(await readFile(new URL(data.wraps, file), 'utf8')).definition; }
    catch { problems.push(`${provider.id}: declared wrapped definition is missing`); continue; }
    const capabilities = data.adapter?.capabilities;
    if (!capabilities?.address) continue;
    const ports = derivePorts(wrapped), proof = deriveProof(wrapped, capabilities.transport), ownership = deriveOwnership(wrapped);
    const durablePorts = deriveDurablePorts(wrapped);
    if (JSON.stringify(capabilities.address.ports) === JSON.stringify(ports) && JSON.stringify(capabilities.proof) === JSON.stringify(proof) && data.adapter.ownership === ownership &&
        JSON.stringify(data.adapter.byUsage?.durable?.ports) === JSON.stringify(durablePorts)) continue;
    if (check) { problems.push(`${provider.id}: ports, durable ports, proof or ownership differ from the wrapped plan definition; run node scripts/sync-adapter-registry.mjs`); continue; }
    capabilities.address = { ...capabilities.address, ports };
    capabilities.proof = proof;
    if (durablePorts) data.adapter.byUsage = { ...data.adapter.byUsage, durable: { ...data.adapter.byUsage?.durable, ports: durablePorts } };
    else if (data.adapter.byUsage?.durable) {
      const { ports: _drop, ...rest } = data.adapter.byUsage.durable;
      data.adapter.byUsage = { ...data.adapter.byUsage, durable: rest };
    }
    const { needs, ...rest } = data.adapter, ordered = {};
    for (const [key, value] of Object.entries(rest)) { ordered[key] = value; if (key === 'label') { if (needs !== undefined) ordered.needs = needs; } }
    data.adapter = ordered;
    data.adapter.ownership = ownership;
    await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  }
  for (const key of ['definitions', 'normalizedDefinitions']) {
    if (JSON.stringify(manifest[key]) !== JSON.stringify(views)) problems.push(`${key} differs from providers`);
  }
  if (check) {
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  } else {
    manifest.definitions = views; manifest.normalizedDefinitions = [...views];
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
    if (problems.some(problem => !/differs/.test(problem))) { console.error(problems.filter(problem => !/differs/.test(problem)).join('\n')); process.exit(1); }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await sync();
