import { readFile } from 'node:fs/promises';
import { loadCore } from '../packages/gozar-node/core.mjs';

// Pack must fail before it can produce an archive with missing generated artifacts.
const metadata = JSON.parse(await readFile(new URL('../packages/gozar-core/generated/package.json', import.meta.url)));
if (metadata.type !== 'commonjs') throw new Error('Generated Node WASM glue requires CommonJS metadata');
const wasm = await readFile(new URL('../packages/gozar-core/generated/gozar_core_bg.wasm', import.meta.url));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Invalid core WASM artifact');
await loadCore();

// Every registry module and definition, and every public type and runtime schema, must be in the archive.
// --ignore-scripts keeps this prepack check from running itself again.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
const output = JSON.parse(packed.stdout);
const files = new Set((Array.isArray(output) ? output[0] : Object.values(output)[0]).files.map(file => file.path));
const manifest = JSON.parse(await readFile(new URL('../adapters/manifest.json', import.meta.url), 'utf8'));
const required = ['adapters/manifest.json', 'packages/gozar-node/route-contract.d.ts', 'packages/gozar-node/adapter-contract.d.ts',
  'packages/gozar-node/testing.mjs', 'runtime/route-catalog.schema.json', 'runtime/adapter.schema.json', 'runtime/error-normalization.json',
  ...manifest.providers.flatMap(provider => [`adapters/${provider.module}`, `adapters/${provider.definition}`, `adapters/${provider.id}.definition.json`])];
const missing = required.filter(path => !files.has(path));
if (missing.length) throw new Error(`The package archive is missing: ${missing.join(', ')}`);

// Every subpath export must point at a file that is in the archive.
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const exported = Object.values(pkg.exports).flatMap(entry => typeof entry === 'string' ? [entry] : Object.values(entry)).map(path => path.replace(/^\.\//, ''));
const absent = exported.filter(path => !files.has(path));
if (absent.length) throw new Error(`An export points at a file that is not in the archive: ${absent.join(', ')}`);
