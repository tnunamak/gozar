// Identity is content, never a package installation path. The child verifies it again.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalConsentValue } from './consent-facts.mjs';
const defaultRoot = fileURLToPath(new URL('../../adapters/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function registryIdentity({ manifest, root, adapters } = {}) {
  if (adapters) return `registry-v1:${digest(JSON.stringify(canonicalConsentValue(adapters.map(a => a.definition))))}`;
  const manifestPath = typeof manifest === 'string' ? resolve(manifest) : join(defaultRoot, 'manifest.json');
  const data = typeof manifest === 'object' ? manifest : JSON.parse(await readFile(manifestPath, 'utf8'));
  const base = resolve(root ?? dirname(manifestPath));
  const files = [];
  async function walk(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), name);
      else if (entry.isFile() && /\.mjs$/.test(name)) files.push([`providers/${name}`, digest(await readFile(join(directory, entry.name)))]);
      else if (entry.isSymbolicLink()) throw Object.assign(new Error('Registry identity requires regular provider files'), {code:'artifact_integrity_failed'});
    }
  }
  await walk(join(base, 'providers'));
  for (const entry of data.providers) {
    const definitionPath = resolve(base, entry.definition);
    const definition = JSON.parse(await readFile(definitionPath, 'utf8'));
    files.push([entry.definition,digest(await readFile(definitionPath))]);
    if (definition.wraps) files.push([`wrapped:${entry.id}`, digest(await readFile(resolve(dirname(definitionPath), definition.wraps)))]);
  }
  return `registry-v1:${digest(JSON.stringify(canonicalConsentValue({ manifest: data, files })))}`;
}
