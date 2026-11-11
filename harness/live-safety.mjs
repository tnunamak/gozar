import assert from 'node:assert/strict';
import { mkdir, open, readFile, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { command } from './process.mjs';

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function assertUnusedPort(config, port) {
  const occupied = node => Boolean(node.TCP?.[port] || Object.keys(node.Web ?? {}).some(key => key.endsWith(`:${port}`))
    || Object.keys(node.AllowFunnel ?? {}).some(key => key.endsWith(`:${port}`)) || Object.values(node.Foreground ?? {}).some(occupied));
  assert.equal(occupied(config), false, `:${port} must be absent from the full fresh configuration`);
}

export async function routeBaseline() {
  const result = await command('tailscale', ['serve', 'status', '--json'], { timeoutMs: 5000 });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export async function acquireLiveLock(route) {
  // All harness entry points share this exact path. An existing lock is never stolen.
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const path = join(base, 'gozar-drop1a-live.lock');
  const handle = await open(path, 'wx', 0o600);
  const identity = await handle.stat();
  const token = randomUUID();
  await handle.writeFile(JSON.stringify({ pid: process.pid, route, token }));
  return async () => {
    try {
      const current = await lstat(path);
      assert.equal(current.ino, identity.ino, 'live lock replaced');
      assert.equal(current.dev, identity.dev, 'live lock device changed');
      assert.equal(JSON.parse(await readFile(path, 'utf8')).token, token, 'live lock ownership changed');
      await rm(path);
    } finally { await handle.close(); }
  };
}
