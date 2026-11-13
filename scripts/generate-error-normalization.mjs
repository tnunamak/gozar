// Generates runtime/error-normalization.json from the frozen fixture's errorNormalization table.
// `--check` fails if the shipped file differs; test/node/error-normalizer.test.mjs runs the same comparison.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('test/fixtures/route-contract.json', root), 'utf8'));
const map = {};
for (const [code, entry] of Object.entries(fixture.errorNormalization)) map[code] = entry.target;
const generated = JSON.stringify({ schemaVersion: 1, generatedFrom: 'test/fixtures/route-contract.json', frozenErrorCodes: fixture.frozenErrorCodes, map }, null, 2) + '\n';
const path = fileURLToPath(new URL('runtime/error-normalization.json', root));
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8').catch(() => '') !== generated) { console.error('runtime/error-normalization.json is stale: run scripts/generate-error-normalization.mjs'); process.exit(1); }
} else await writeFile(path, generated);
