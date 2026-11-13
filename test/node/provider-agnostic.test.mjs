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
// An identifier is split with a marker that real text never holds: at each lower-to-upper step (`ngrokToken`), before the
// last capital of a capital run (`NGROKToken`), and between letters and digits (`ngrok2`). A capital run followed by
// lower case is ambiguous (`NGROKtoken` or `HTTPServer`), so the text is also read split after the whole run, and a name
// found in either reading counts. A hyphenated id then matches as one compound whose parts are joined by `-`, `_`, the
// marker or nothing (`own-address`, `ownAddress`, `OWN_ADDRESS`), while prose that happens to hold the same words with a
// space between them ("its own address") does not.
const MARK = '\u0001';
const digits = text => text.replace(/([A-Za-z])(\d)/g, `$1${MARK}$2`).replace(/(\d)([A-Za-z])/g, `$1${MARK}$2`);
const readings = text => {
  const steps = text.replace(/([a-z0-9])([A-Z])/g, `$1${MARK}$2`);
  return [steps.replace(/([A-Z]+)([A-Z][a-z])/g, `$1${MARK}$2`), steps.replace(/([A-Z]{2,})([a-z])/g, `$1${MARK}$2`)].map(digits);
};
const escape = part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findNames = (text, names) => {
  const texts = readings(text);
  return names.filter(word => {
    const pattern = new RegExp(`(^|[^a-z0-9])${word.split('-').map(escape).join(`[-_${MARK}]?`)}([^a-z0-9]|$)`, 'i');
    return texts.some(split => pattern.test(split));
  });
};

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
  assert.deepEqual(findNames('const ngrokToken = readTailscaleStatus();', words).sort(), ['ngrok', 'tailscale'], 'camelCase is split');
  assert.deepEqual(findNames('class TailscaleFunnelAdapter {}', words).sort(), ['tailscale', 'tailscale-funnel'], 'PascalCase is split');
  // A hyphenated id with a short head is caught in its identifier spellings, and not in prose.
  for (const text of ['const ownAddress = 1;', 'OwnAddress', 'OWN_ADDRESS', 'own_address', 'OWNADDRESS']) assert.deepEqual(findNames(text, words), ['own-address'], text);
  assert.deepEqual(findNames('it keeps its own address', words), []);
  // An all-capitals head and a digit next to the name are split too.
  for (const text of ['NGROKToken', 'ngrok2', 'ngrok2Token', 'v2ngrok', 'Ngrok2']) assert.deepEqual(findNames(text, words), ['ngrok'], text);
  assert.deepEqual(findNames('CLOUDFLARENamed', words).sort(), ['cloudflare', 'cloudflare-named']);
  // A capital run followed by lower case is read both ways.
  for (const text of ['NGROKtoken', 'TLSngrok']) assert.deepEqual(findNames(text, words), ['ngrok'], text);
  assert.deepEqual(findNames('OWNaddress', words), ['own-address']);
  assert.deepEqual(findNames('TAILSCALEfunnel', words).sort(), ['tailscale', 'tailscale-funnel']);
  assert.deepEqual(findNames('const HTTPServer = new URLSearchParams();', words), []);
});

test('registry compatibility arrays and provider docs are generated from `providers` and are current', () => {
  for (const script of ['sync-adapter-registry.mjs', 'generate-adapter-docs.mjs', 'generate-error-normalization.mjs']) {
    execFileSync(process.execPath, [here(`../../scripts/${script}`), '--check'], { stdio: 'pipe' });
  }
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

// The core is provider-neutral: no vendor word from the registry appears in any source or type file under
// packages/gozar-node/ (subdirectories included) or in the CLI entry point. There are no holdouts.
const SOURCE = /\.(mjs|cjs|js|d\.ts)$/;
function coreFiles() {
  const root = here('../../packages/gozar-node');
  const files = readdirSync(root, { recursive: true }).map(String).filter(name => SOURCE.test(name) && !name.split('/').includes('node_modules'))
    .map(name => join(root, name));
  return [...files, here('../../bin/gozar.mjs')];
}

test('zero census: no module of packages/gozar-node, and not the CLI entry point, names a provider', () => {
  const words = providerWords();
  const files = coreFiles();
  assert.ok(files.length > 40 && files.some(file => file.endsWith('durable-route.mjs')) && files.some(file => file.endsWith('route-contract.d.ts')) && files.some(file => file.endsWith('bin/gozar.mjs')), 'the scan reads the real core');
  const named = Object.fromEntries(files.map(file => [file.slice(file.indexOf('/packages/') >= 0 ? file.indexOf('/packages/') + 1 : file.indexOf('/bin/') + 1), findNames(readFileSync(file, 'utf8'), words)])
    .filter(([, found]) => found.length));
  assert.deepEqual(named, {});
});
