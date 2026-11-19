// Trusted host declarations of packaged runtime modules (0.5.2).
//
// An embedding host that cannot install optional peer dependencies at runtime (a packaged
// AppImage, a read-only installation) declares where a TESTED bundle of such a module lives.
// The declaration is a trusted factory option, never request data: it names the package, the
// exact version Gozar's adapter was tested with, and an absolute host-resolved module
// directory. Nothing here grants authority to arbitrary worker-supplied paths: the declaration
// crosses to a detached controller only as data in the private bootstrap, and every load
// re-validates the package identity, the exact version and the load itself.
//
// The declaration only satisfies a declared runtime prerequisite (for ngrok-https-edge, the
// optional @ngrok/ngrok SDK). It is not a claim about an account, a route or a provider state,
// and Gozar never installs, writes or restarts anything for it. A host that instead wants the
// runtime-install step declares `{ kind: 'runtime-install' }`: the existing approved artifact
// machinery (host executor, installer.execute capability, pinned SHA-256) keeps owning that.
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gozarError } from './error-normalizer.mjs';

const packagePattern = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$|^[a-z0-9][a-z0-9._-]*$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const MAX_PACKAGE_JSON = 64 * 1024;

/** Structural validation of one host declaration. The per-use load check follows in loadBundledModule. */
export function validatedRuntimeModuleDeclaration(packageName, declaration) {
  if (typeof packageName !== 'string' || !packagePattern.test(packageName))
    throw gozarError('invalid_input', `Runtime module declaration needs a valid package name for '${String(packageName).slice(0, 64)}'`);
  if (declaration === null || typeof declaration !== 'object') throw gozarError('invalid_input', `Runtime module declaration for ${packageName} must be an object`);
  if (declaration.kind === 'runtime-install') return { kind: 'runtime-install', package: packageName };
  if (declaration.kind !== 'bundled')
    throw gozarError('invalid_input', `Runtime module declaration for ${packageName} needs kind 'bundled' or 'runtime-install'`);
  if (typeof declaration.version !== 'string' || !versionPattern.test(declaration.version))
    throw gozarError('invalid_input', `The bundled declaration for ${packageName} needs an exact release version`);
  if (typeof declaration.path !== 'string' || !isAbsolute(declaration.path) || declaration.path.includes('\0'))
    throw gozarError('invalid_input', `The bundled declaration for ${packageName} needs an absolute module directory path`);
  return { kind: 'bundled', package: packageName, version: declaration.version, path: resolve(declaration.path) };
}

const readPackageJson = async path => {
  let text;
  try { text = await readFile(join(path, 'package.json'), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw gozarError('provider_unavailable', 'The declared bundled runtime module has no package manifest');
    throw gozarError('provider_unavailable', 'The declared bundled runtime module is unreadable');
  }
  if (text.length > MAX_PACKAGE_JSON) throw gozarError('provider_unavailable', 'The declared bundled runtime module has an oversized manifest');
  try { return JSON.parse(text); } catch { throw gozarError('provider_unavailable', 'The declared bundled runtime module has an invalid manifest'); }
};

/** The module entry of a package directory: the `exports['.']` entry first, then `main`, then index.js. */
export function moduleEntryPoint(manifest) {
  const dot = manifest?.exports?.['.'];
  if (typeof dot === 'string') return dot;
  if (dot && typeof dot === 'object' && !Array.isArray(dot)) {
    for (const condition of ['import', 'require', 'node', 'default'])
      if (typeof dot[condition] === 'string') return dot[condition];
    // An object-of-objects shape (`{ ".": { "types": ..., "import": {...} } }`) is not supported:
    // the host bundles the module it tested; Gozar loads the plain entry, never subpath maps.
  }
  if (typeof manifest?.main === 'string' && manifest.main) return manifest.main;
  return 'index.js';
}

const loadCache = new Map();
const failure = message => { throw gozarError('provider_unavailable', message); };

/**
 * Loads a host-declared bundled module and proves it is the exact declared package. The identity
 * and version come from the bundle's own manifest; the load proves the module is importable in
 * THIS process (the host factory and the detached controller both load through here). A failed
 * load refuses the provider; it never falls back to a different location or installs anything.
 */
export async function loadBundledModule({ package: packageName, version, path }, { expectedVersion } = {}) {
  const key = `${packageName}@${version}:${path}`;
  if (loadCache.has(key)) {
    const cached = loadCache.get(key);
    if (cached.error) throw cached.error;
    return cached.module;
  }
  const manifest = await readPackageJson(path);
  if (manifest?.name !== packageName) failure('The declared bundled runtime module names a different package');
  if (manifest?.version !== version) failure('The declared bundled runtime module has a different version');
  if (expectedVersion !== undefined && version !== expectedVersion)
    failure('The declared bundled runtime module does not match the tested SDK version');
  let module;
  try { module = await import(pathToFileURL(join(path, moduleEntryPoint(manifest))).href); }
  catch { failure('The declared bundled runtime module could not be loaded'); }
  const exports = module?.default && typeof module.default === 'object' ? module.default : module;
  loadCache.set(key, { module: exports });
  return exports;
}
