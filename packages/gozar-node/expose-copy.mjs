import { readFile } from 'node:fs/promises';
import manifest from '../../adapters/manifest.json' with { type: 'json' };

// Presentation facts live in adapter definitions, outside the reply contract.
const definitions = await Promise.all(manifest.normalizedDefinitions.map(async reference =>
  JSON.parse(await readFile(new URL(`../../adapters/${reference}`, import.meta.url), 'utf8')).definition));
export const ways = Object.fromEntries(definitions.filter(a => a.copy?.human).map(a => [a.id, a.copy.human]));

export function resolveVia(name) {
  const id = Object.keys(ways).find(id => id === name || ways[id].name === name);
  if (!id) throw new Error(`Unknown way: ${name}. Valid names: ${Object.values(ways).map(way => way.name).join(', ')}`);
  return id;
}
