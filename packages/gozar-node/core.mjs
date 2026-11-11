import { readFile } from 'node:fs/promises';

export async function loadCore(moduleUrl = new URL('../gozar-core/generated/gozar_core.js', import.meta.url)) {
  let module;
  try {
    module = await import(moduleUrl.href);
    if (typeof module.default === 'function') {
      const bytes = await readFile(new URL('./gozar_core_bg.wasm', moduleUrl));
      await module.default({ module_or_path: bytes });
    }
  } catch (error) {
    throw new Error(`Core WASM unavailable: ${error.message}. Build the core WASM artifact before running expose.`, { cause: error });
  }
  if (typeof module.step !== 'function') throw new Error('Core module must export step(string)');
  return input => {
    const output = JSON.parse(module.step(JSON.stringify(input)));
    if (!output.state || !output.snapshot || !Array.isArray(output.effects)) throw new Error('Invalid core output');
    return output;
  };
}
