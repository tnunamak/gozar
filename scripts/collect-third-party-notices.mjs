// Copy the locked Rust closure's actual license/notice files, including build dependencies, into the release.
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// cargo metadata reports `license: null` for a crate that declares only a
// `license-file` (e.g. `license-file = "LICENSE"`). Retain that declared
// file in the manifest label instead of dropping the available declaration.
export function licenseLabel(pkg) {
  if (typeof pkg.license === 'string' && pkg.license) return pkg.license;
  if (typeof pkg.license_file === 'string' && pkg.license_file)
    return `license-file: ${basename(pkg.license_file)}`;
  throw new Error(`No license declared for ${pkg.name}`);
}

// Importing this module must not run cargo or rewrite release artifacts: the
// collection runs only when the script is executed directly (same guard as
// scripts/check-patch.mjs).
export async function collectThirdPartyNotices() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version=1'], { cwd: root, encoding: 'utf8' }));
  const declarations = metadata.packages.filter(pkg => pkg.source).sort((a, b) => a.name.localeCompare(b.name))
    .map(pkg => ({ pkg, license: licenseLabel(pkg) }));
  const packages = [];
  for (const { pkg, license } of declarations) {
    const source = dirname(pkg.manifest_path), directory = `third-party/rust/${pkg.name}-${pkg.version}`;
    const names = new Set((await readdir(source, { withFileTypes: true }))
      .filter(entry => !entry.isDirectory() && /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)/i.test(entry.name))
      .map(entry => entry.name));
    if (typeof pkg.license_file === 'string' && pkg.license_file) {
      const declared = relative(source, resolve(source, pkg.license_file));
      if (!declared || isAbsolute(declared) || declared === '..' || declared.startsWith('..' + sep))
        throw new Error(`Declared license file is outside ${pkg.name}`);
      names.add(declared.split(sep).join('/'));
    }
    const files = [];
    for (const name of [...names].sort()) {
      const bytes = await readFile(join(source, name));
      const destination = join(root, directory, name);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(source, name), destination);
      files.push({ path: `${directory}/${name}`, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    if (!files.length) throw new Error(`No license text found for ${pkg.name}`);
    packages.push({ name: pkg.name, version: pkg.version, license, files });
  }
  const lockHash = createHash('sha256').update(await readFile(join(root, 'Cargo.lock'))).digest('hex');
  await writeFile(join(root, 'third-party/manifest.json'), JSON.stringify({ cargoLockSha256: lockHash, packages }, null, 2) + '\n');
  await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), `# Third-party notices\n\nThe distributed WASM and generated glue include Rust dependencies. Actual license\nand notice texts from the locked source packages are included below. Both texts\nare retained for dual-licensed packages; additional Unicode notices are retained.\nBuild dependencies are included conservatively.\n\n| Package | Declared license | Included texts |\n| --- | --- | --- |\n${packages.map(pkg => `| ${pkg.name} ${pkg.version} | ${pkg.license} | ${pkg.files.map(file => `[${file.path.split('/').at(-1)}](${file.path})`).join(', ')} |`).join('\n')}\n\nThe optional native SDK is an external peer and is not bundled in this archive.\nIts separate distribution and license evidence are recorded in\n[the release audit](docs/release-0.4-license-audit.md).\n\nRegenerate with \`node scripts/collect-third-party-notices.mjs\`. The manifest records\nthe Cargo.lock digest and SHA-256 of every copied file.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await collectThirdPartyNotices();
