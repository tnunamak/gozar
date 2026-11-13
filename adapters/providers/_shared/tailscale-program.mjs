// The Tailscale CLI fallback on macOS: the app ships its CLI inside the app bundle. It is on PATH only after the
// user installs the CLI integration. The Tailscale CLI documentation (https://tailscale.com/kb/1080/cli, macOS section)
// says: "If you installed the macOS client through the App Store, the CLI is bundled inside the Tailscale app",
// and runs it as /Applications/Tailscale.app/Contents/MacOS/Tailscale <command>. The standalone app installs
// its CLI integration at /usr/local/bin/tailscale (PATH) and has the same bundle path.
// The path is data (program-fallbacks.json); the generic resolver lives in packages/gozar-node/program-resolution.mjs.
import { readFileSync } from 'node:fs';
import { createProgramResolver as createGenericResolver, findOnPath } from '../../../packages/gozar-node/program-resolution.mjs';

export { findOnPath };
const row = JSON.parse(readFileSync(new URL('./program-fallbacks.json', import.meta.url), 'utf8')).fallbacks.find(item => item.program === 'tailscale');
export const tailscaleAppBundleCli = row.path;

/** `bundleCli` replaces the bundle path (tests). Other options are the generic resolver's. */
export const createProgramResolver = ({ bundleCli = tailscaleAppBundleCli, ...options } = {}) =>
  createGenericResolver({ ...options, fallbacks: [{ program: 'tailscale', platform: 'darwin', path: bundleCli }] });
