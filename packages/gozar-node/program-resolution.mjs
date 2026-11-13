// Where a recipe's `program` runs from. Recipes name a bare program such as `tailscale`; the effect driver
// resolves it in this one place, at spawn. The recipe, its digest and the consent bound to it are not changed.
//
// macOS: the Tailscale app ships its CLI inside the app bundle. It is on PATH only after the user installs
// the CLI integration. The Tailscale CLI documentation (https://tailscale.com/kb/1080/cli, macOS section)
// says: "If you installed the macOS client through the App Store, the CLI is bundled inside the Tailscale app",
// and runs it as /Applications/Tailscale.app/Contents/MacOS/Tailscale <command>. The standalone app installs
// its CLI integration at /usr/local/bin/tailscale (PATH) and has the same bundle path.
//
// The fallback is exact: darwin, the program `tailscale`, no executable `tailscale` in any PATH entry, and the
// bundle binary present and executable. In every other case the program is returned unchanged.
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export const tailscaleAppBundleCli = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

const executableFile = path => {
  try { if (!statSync(path).isFile()) return false; accessSync(path, constants.X_OK); return true; } catch { return false; }
};

/** The first executable `program` in an absolute PATH entry, or null. */
export const findOnPath = (program, pathValue, isExecutable = executableFile) => String(pathValue ?? '').split(delimiter)
  .filter(entry => entry && isAbsolute(entry)).map(entry => join(entry, program)).find(isExecutable) ?? null;

/**
 * Returns resolve(program, env?) -> the program to spawn. `platform`, `isExecutable` and `bundleCli` are
 * replaceable for tests. `env.PATH` is the PATH the child will get.
 */
export function createProgramResolver({ platform = process.platform, isExecutable = executableFile, bundleCli = tailscaleAppBundleCli } = {}) {
  return (program, env = process.env) => {
    if (platform !== 'darwin' || program !== 'tailscale') return program;
    if (findOnPath(program, env.PATH, isExecutable) !== null || !isExecutable(bundleCli)) return program;
    return bundleCli;
  };
}
