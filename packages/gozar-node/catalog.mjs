import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only the checkout's admitted catalog is loaded. No executable plugins or user path flags.
export async function loadCatalog(root, { operational = false } = {}) {
  const records = [];
  async function visit(directory) {
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const data = JSON.parse(await readFile(join(directory, entry.name), 'utf8'));
        for (const record of Array.isArray(data) ? data : data.adapters ?? [data]) {
          if (record.id && record.recipes) records.push(record);
        }
      }
    }
  }
  await visit(join(root, 'adapters'));
  if (operational) {
    const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
    const references = manifest.operationalCatalog;
    if (!Array.isArray(references) || !references.length) throw new Error('No operational catalog is admitted in the adapter manifest');
    for (const reference of references) {
      if (typeof reference !== 'string' || !/^[A-Za-z0-9_.-]+\.definition\.json$/.test(reference)) throw new Error('Invalid operational catalog reference');
      const { definition } = JSON.parse(await readFile(join(root, 'adapters', reference), 'utf8'));
      if (definition?.planVersion !== 1 || definition.admission?.state !== 'admitted') throw new Error('Operational catalog contains an unadmitted plan');
      const index = records.findIndex(record => record.id === definition.id);
      if (index >= 0) records[index] = definition; else records.push(definition);
    }
  }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Duplicate adapter IDs');
  return records;
}

export function safeOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Expected a credential-free HTTP(S) origin');
  }
  return url.origin;
}

// Explicit plan selection is distinct from the automatic detection catalog.
export async function loadDefinition(root, adapterId) {
  const directory = join(root, 'adapters');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const references = manifest.normalizedDefinitions ?? manifest.definitions ?? [];
  for (const reference of references) {
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_.-]+\.definition\.json$/.test(reference)) throw new Error('Invalid catalog definition reference');
    const { definition } = JSON.parse(await readFile(join(directory, reference), 'utf8'));
    if (definition?.id === adapterId) return definition;
  }
  throw new Error('Selected route has no declared plan definition');
}

export async function loadActiveDrop(root) {
  const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
  return manifest.activeDrop1a ?? [];
}

export async function loadDropRequirements(root) {
  const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
  return manifest.drop1aRequirements ?? {};
}
