// Where a recipe's `program` runs from. Recipes name a bare program; the effect driver resolves it in
// this one place, at spawn. The recipe, its digest and the consent bound to it are not changed.
//
// A fallback is data: { program, platform, path }, read from adapters/providers/_shared/program-fallbacks.json.
// It applies when the platform matches, no executable `program` is in any absolute PATH entry, and the fallback
// path is present and executable. In every other case the program is returned unchanged. A provider whose CLI
// ships inside an app bundle adds one row there; this file does not change.
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

const defaultFallbacks = JSON.parse(readFileSync(new URL('../../adapters/providers/_shared/program-fallbacks.json', import.meta.url), 'utf8')).fallbacks;

const executableFile = path => {
  try { if (!statSync(path).isFile()) return false; accessSync(path, constants.X_OK); return true; } catch { return false; }
};

/** The first executable `program` in an absolute PATH entry, or null. */
export const findOnPath = (program, pathValue, isExecutable = executableFile) => String(pathValue ?? '').split(delimiter)
  .filter(entry => entry && isAbsolute(entry)).map(entry => join(entry, program)).find(isExecutable) ?? null;

/**
 * Returns resolve(program, env?) -> the program to spawn. `platform`, `isExecutable` and `fallbacks` are
 * replaceable for tests. `env.PATH` is the PATH the child will get.
 */
export function createProgramResolver({ platform = process.platform, isExecutable = executableFile, fallbacks = defaultFallbacks } = {}) {
  return (program, env = process.env) => {
    const fallback = fallbacks.find(item => item.program === program && item.platform === platform);
    if (!fallback) return program;
    if (findOnPath(program, env.PATH, isExecutable) !== null || !isExecutable(fallback.path)) return program;
    return fallback.path;
  };
}
