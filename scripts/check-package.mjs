import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function exportTargets(entry) {
  if (typeof entry === 'string') return [entry.replace(/^\.\//, '')];
  if (entry === null || entry === undefined) return [];
  return Object.values(entry).flatMap(exportTargets);
}

// Validate actual pack member names, not package.json globs.
export function assertReleaseClosure(files, pkg, manifest, notices, artifacts = []) {
  const required = [
    'LICENSE', 'THIRD-PARTY-NOTICES.md', 'third-party/manifest.json', 'adapters/manifest.json',
    ...exportTargets(pkg.exports), ...exportTargets(pkg.bin), ...exportTargets(pkg.types),
    ...(pkg.files ?? []).filter(path => path.startsWith('docs/') && !/[*?]/.test(path)),
    ...manifest.providers.flatMap(provider => [
      `adapters/${provider.module}`, `adapters/${provider.definition}`, `adapters/${provider.id}.definition.json`,
    ]),
    ...notices.packages.flatMap(pkg => pkg.files.map(file => file.path)),
    ...artifacts,
  ];
  const missing = [...new Set(required)].filter(path => !files.has(path));
  if (missing.length) throw new Error(`The package archive is missing: ${missing.join(', ')}`);
}

async function inventory(directory) {
  const entries = await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? inventory(path) : [path];
  }));
  return nested.flat();
}

async function checkPackage() {
  const { loadCore } = await import('../packages/gozar-node/core.mjs');
  // Pack must fail before it can produce an archive with missing generated artifacts.
  const metadata = JSON.parse(await readFile(new URL('../packages/gozar-core/generated/package.json', import.meta.url)));
  if (metadata.type !== 'commonjs') throw new Error('Generated Node WASM glue requires CommonJS metadata');
  if (metadata.license !== 'Apache-2.0') throw new Error('Generated package metadata must declare Apache-2.0');
  const wasm = await readFile(new URL('../packages/gozar-core/generated/gozar_core_bg.wasm', import.meta.url));
  if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Invalid core WASM artifact');
  await loadCore();
  
  // Every registry module and definition, and every public type and runtime schema, must be in the archive.
  // --ignore-scripts keeps this prepack check from running itself again.
  
  const root = fileURLToPath(new URL('../', import.meta.url));
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
  const output = JSON.parse(packed.stdout);
  const files = new Set((Array.isArray(output) ? output[0] : Object.values(output)[0]).files.map(file => file.path));
  const manifest = JSON.parse(await readFile(new URL('../adapters/manifest.json', import.meta.url), 'utf8'));
  const required = ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'third-party/manifest.json', 'examples/provider-lifecycle-fixture.mjs', 'examples/remote-access-screen.mjs', 'adapters/manifest.json', 'packages/gozar-node/route-contract.d.ts', 'packages/gozar-node/adapter-contract.d.ts',
    'packages/gozar-node/testing.mjs', 'runtime/route-catalog.schema.json', 'runtime/adapter.schema.json', 'runtime/error-normalization.json', 'runtime/plain-copy.json', 'runtime/plain-copy.schema.json',
    'packages/gozar-node/plain-copy.mjs',
    'docs/design/durable-routes.md', 'docs/architecture.md', 'adapters/INTEGRATION.md', 'harness/README.md',
    ...manifest.providers.flatMap(provider => [`adapters/${provider.module}`, `adapters/${provider.definition}`, `adapters/${provider.id}.definition.json`])];
  const missing = required.filter(path => !files.has(path));
  if (missing.length) throw new Error(`The package archive is missing: ${missing.join(', ')}`);
  const notices = JSON.parse(await readFile(new URL('../third-party/manifest.json', import.meta.url), 'utf8'));
  const lockHash = createHash('sha256').update(await readFile(new URL('../Cargo.lock', import.meta.url))).digest('hex');
  if (notices.cargoLockSha256 !== lockHash) throw new Error('Third-party notices must be regenerated for Cargo.lock');
  for (const pkg of notices.packages) for (const license of pkg.files) {
    if (!files.has(license.path)) throw new Error(`Missing packaged third-party notice: ${license.path}`);
    const bytes = await readFile(new URL(`../${license.path}`, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== license.sha256) throw new Error(`Third-party notice changed: ${license.path}`);
  }
  
  // Every subpath export must point at a file that is in the archive.
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const artifacts = [
    ...(await inventory('adapters')).filter(path => path.endsWith('.json') || path.startsWith('adapters/providers/')),
    ...(await inventory('packages/gozar-core/generated')).filter(path => /\.(?:js|mjs|cjs|ts|wasm|json)$/.test(path)),
    ...(await inventory('packages/gozar-node')).filter(path => path.endsWith('.mjs') || path.endsWith('.d.ts')),
    'docs/service-routes.md', 'docs/providers.md', 'docs/migration-0.4.md',
    'docs/release-0.4-license-audit.md', 'docs/live-provider-walk.md', 'docs/ngrok-stream-protocols.md',
    'docs/design/0.4.0-state-contract.md', 'docs/testing-effects.md', 'docs/embedding-contract.md',
    'docs/proof-and-cleanup-0.4.md', 'docs/release-0.4-interface-coverage.md',
  ];
  assertReleaseClosure(files, pkg, manifest, notices, artifacts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkPackage();
}
