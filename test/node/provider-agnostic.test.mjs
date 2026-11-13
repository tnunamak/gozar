// The consumer contract names no provider, and the registry, its compatibility arrays and its docs are generated, not
// hand-kept. The gate reads provider names from the registry itself, so a new provider is covered with no edit here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const read = path => readFileSync(here(path), 'utf8');
const manifest = JSON.parse(read('../../adapters/manifest.json'));

/** Vendor words: each hyphenated registry id, and its leading segment when that is a proper name (four or more letters).
 * A bare common word such as `lan` is also a contract value (a reach), so it is not a vendor name. */
function providerWords() {
  const words = new Set();
  for (const { id } of manifest.providers) {
    if (id.includes('-')) words.add(id);
    const [head] = id.split('-');
    if (head.length >= 4) words.add(head);
  }
  return [...words];
}
const findNames = (text, words) => words.filter(word => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text));

test('red gate: no provider name appears in the consumer type file or the consumer schema', () => {
  const words = providerWords();
  assert.ok(words.includes('tailscale') && words.includes('ngrok'), 'the gate reads the real registry');
  for (const path of ['../../packages/gozar-node/route-contract.d.ts', '../../runtime/route-catalog.schema.json']) {
    assert.deepEqual(findNames(read(path), words), [], `${path} names a provider`);
  }
});

test('the gate itself catches a provider name (a clean pass is not an empty scan)', () => {
  const words = providerWords();
  assert.deepEqual(findNames('export type Adapter = "tailscale-funnel";', words).sort(), ['tailscale', 'tailscale-funnel']);
  assert.deepEqual(findNames('route through Ngrok when ready', words), ['ngrok']);
  assert.deepEqual(findNames('the lan and own address words alone are not vendor names', words), []);
});

test('registry compatibility arrays and provider docs are generated from `providers` and are current', () => {
  for (const script of ['sync-adapter-registry.mjs', 'generate-adapter-docs.mjs', 'generate-error-normalization.mjs']) {
    execFileSync(process.execPath, [here(`../../scripts/${script}`), '--check'], { stdio: 'pipe' });
  }
  assert.equal(manifest.providers.length, 10);
  for (const entry of manifest.providers) {
    assert.deepEqual(Object.keys(entry).sort(), ['definition', 'id', 'module'], entry.id);
    assert.equal(entry.module, `providers/${entry.id}/index.mjs`);
    assert.equal(entry.definition, `providers/${entry.id}/definition.json`);
  }
});

test('red: a hand-edited compatibility array fails the registry check', async t => {
  const dir = await mkdtemp(join(homedir(), '.tmp', 'gozar-registry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stale = structuredClone(manifest);
  stale.definitions = stale.definitions.slice(1);
  const file = join(dir, 'manifest.json');
  await writeFile(file, JSON.stringify(stale));
  assert.throws(() => execFileSync(process.execPath, [here('../../scripts/sync-adapter-registry.mjs'), '--check', '--manifest', file], { stdio: 'pipe' }), /differs from providers/);
  await writeFile(file, JSON.stringify(manifest));
  execFileSync(process.execPath, [here('../../scripts/sync-adapter-registry.mjs'), '--check', '--manifest', file], { stdio: 'pipe' });
});

// The core is provider-neutral: no vendor word from the registry appears in any module of packages/gozar-node/.
// There are no holdouts.
test('zero census: no module of packages/gozar-node names a provider', () => {
  const words = providerWords();
  const directory = here('../../packages/gozar-node');
  const holdouts = new Set();
  const files = readdirSync(directory).filter(name => name.endsWith('.mjs'));
  assert.ok(files.length > 40 && files.includes('durable-route.mjs'), 'the scan reads the real core');
  const named = Object.fromEntries(files.filter(name => !holdouts.has(name))
    .map(name => [name, findNames(readFileSync(join(directory, name), 'utf8'), words)]).filter(([, found]) => found.length));
  assert.deepEqual(named, {});
});
