#!/usr/bin/env node
// Read-only check of how Gozar reaches Tailscale on this machine, for the Tailscale macOS apps.
// Run: node adapters/providers/_shared/check-tailscale-app.mjs
// It sends two GET requests to the LocalAPI (status and serve-config) and changes nothing. It prints no
// token, no DNS name and no serve config: the loopback port, the app variant and pass or fail only.
import { pathToFileURL } from 'node:url';
import { discoverAppLocalApi } from './tailscale-app-discovery.mjs';
import { getNode, getServeConfig } from './tailscale-localapi.mjs';
import { createProgramResolver, findOnPath, tailscaleAppBundleCli } from './tailscale-program.mjs';

const variants = { 'app-store': 'App Store app', standalone: 'standalone app' };

/** Returns { lines, ok }. Every effect is replaceable for tests. */
export async function checkTailscaleApp({ platform = process.platform, env = process.env, discover = discoverAppLocalApi, node = getNode, serveConfig = getServeConfig,
  resolve = createProgramResolver() } = {}) {
  const lines = ['Gozar Tailscale check (read-only)', `platform: ${platform}`];
  const cli = findOnPath('tailscale', env.PATH) ? 'on PATH' : resolve('tailscale', env) === tailscaleAppBundleCli ? 'the Tailscale app bundle' : 'not found';
  lines.push(`tailscale CLI: ${cli}`);
  if (platform === 'darwin') {
    const app = await discover();
    lines.push(`Tailscale app LocalAPI: ${app ? `${variants[app.variant] ?? 'app'} on loopback port ${app.port}` : 'not found'} (a unix socket is used first when one exists)`);
  }
  let ok = true;
  for (const [name, call] of [['status', node], ['serve-config', serveConfig]]) {
    try { await call(); lines.push(`LocalAPI ${name}: ok`); }
    catch (error) { ok = false; lines.push(`LocalAPI ${name}: ${error.code ?? 'failed'}${error.nextAction ? ` (${error.nextAction})` : ''}`); }
  }
  lines.push(ok ? 'result: reachable' : 'result: not reachable');
  return { lines, ok };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { lines, ok } = await checkTailscaleApp();
  console.log(lines.join('\n'));
  process.exitCode = ok ? 0 : 1;
}
