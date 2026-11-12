import { readFile } from 'node:fs/promises';
import { loadCore } from '../packages/gozar-node/core.mjs';

// Pack must fail before it can produce an archive with missing generated artifacts.
const metadata = JSON.parse(await readFile(new URL('../packages/gozar-core/generated/package.json', import.meta.url)));
if (metadata.type !== 'commonjs') throw new Error('Generated Node WASM glue requires CommonJS metadata');
const wasm = await readFile(new URL('../packages/gozar-core/generated/gozar_core_bg.wasm', import.meta.url));
if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Invalid core WASM artifact');
await loadCore();
