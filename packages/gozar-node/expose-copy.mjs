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

// Read the existing trust declarations without adding facts to session replies.
const providers = await Promise.all(manifest.providers.map(async provider =>
  JSON.parse(await readFile(new URL(`../../adapters/${provider.definition}`, import.meta.url), 'utf8')).adapter));
export const trafficFacts = Object.fromEntries(providers.map(provider => [provider.id,
  provider.facts?.find(fact => fact.id === 'payload-readers' && fact.known)?.value]));
export const decisionFacts = Object.fromEntries(providers.map(provider => [provider.id, provider.facts ?? []]));
