// The registry's `providers` list is the source of truth. The older `definitions` and `normalizedDefinitions`
// arrays of adapters/manifest.json are compatibility views of it, generated here and never hand-edited.
// `--check` fails when they differ, or when a provider's module or definition file is missing.
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// `--manifest FILE` checks another manifest (a test uses it); provider files are always read from adapters/.
const custom = process.argv.indexOf('--manifest');
const path = custom > 0 ? process.argv[custom + 1] : fileURLToPath(new URL('../adapters/manifest.json', import.meta.url));
const manifest = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(manifest.providers) || !manifest.providers.length) { console.error('adapters/manifest.json has no providers'); process.exit(1); }
const views = manifest.providers.map(provider => `${provider.id}.definition.json`);
const problems = [];
for (const provider of manifest.providers) {
  for (const key of ['module', 'definition']) {
    try { await access(new URL(`../adapters/${provider[key]}`, import.meta.url)); } catch { problems.push(`${provider.id}: ${key} ${provider[key]} is missing`); }
  }
  try { await access(new URL(`../adapters/${provider.id}.definition.json`, import.meta.url)); } catch { problems.push(`${provider.id}: wrapped definition ${provider.id}.definition.json is missing`); }
}
for (const key of ['definitions', 'normalizedDefinitions']) {
  if (JSON.stringify(manifest[key]) !== JSON.stringify(views)) problems.push(`${key} differs from providers`);
}
if (process.argv.includes('--check')) {
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
} else {
  manifest.definitions = views; manifest.normalizedDefinitions = [...views];
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  if (problems.some(problem => !/differs/.test(problem))) { console.error(problems.filter(problem => !/differs/.test(problem)).join('\n')); process.exit(1); }
}
