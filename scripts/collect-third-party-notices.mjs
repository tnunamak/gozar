// Copy the locked Rust closure's actual license/notice files, including build dependencies, into the release.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version=1'], { cwd: root, encoding: 'utf8' }));
const packages = [];
for (const pkg of metadata.packages.filter(pkg => pkg.source).sort((a, b) => a.name.localeCompare(b.name))) {
  const source = dirname(pkg.manifest_path), directory = `third-party/rust/${pkg.name}-${pkg.version}`;
  await mkdir(join(root, directory), { recursive: true });
  const files = [];
  for (const name of (await readdir(source)).filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)/i.test(name)).sort()) {
    const bytes = await readFile(join(source, name));
    await copyFile(join(source, name), join(root, directory, name));
    files.push({ path: `${directory}/${name}`, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (!files.length) throw new Error(`No license text found for ${pkg.name}`);
  packages.push({ name: pkg.name, version: pkg.version, license: pkg.license, files });
}
const lockHash = createHash('sha256').update(await readFile(join(root, 'Cargo.lock'))).digest('hex');
await writeFile(join(root, 'third-party/manifest.json'), JSON.stringify({ cargoLockSha256: lockHash, packages }, null, 2) + '\n');
await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), `# Third-party notices\n\nThe distributed WASM and generated glue include Rust dependencies. Actual license\nand notice texts from the locked source packages are included below. Both texts\nare retained for dual-licensed packages; additional Unicode notices are retained.\nBuild dependencies are included conservatively.\n\n| Package | Declared license | Included texts |\n| --- | --- | --- |\n${packages.map(pkg => `| ${pkg.name} ${pkg.version} | ${pkg.license} | ${pkg.files.map(file => `[${file.path.split('/').at(-1)}](${file.path})`).join(', ')} |`).join('\n')}\n\nThe optional native SDK is an external peer and is not bundled in this archive.\nIts separate distribution and license evidence are recorded in\n[the release audit](docs/release-0.4-license-audit.md).\n\nRegenerate with \`node scripts/collect-third-party-notices.mjs\`. The manifest records\nthe Cargo.lock digest and SHA-256 of every copied file.\n`);
