import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
async function invoke(home, ...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, 'service', ...args, '--json'], { env: { ...process.env, GOZAR_HOME: home } });
    assert.equal(stderr, '');
    return { code: 0, reply: JSON.parse(stdout) };
  } catch (error) {
    if (!error.stdout) throw error;
    return { code: error.code, reply: JSON.parse(error.stdout) };
  }
}

test('CLI add/status/remove across separate processes preserves config and recomputes checks', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-service-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const origin = 'https://service.example';
  const command = 'test "$GOZAR_SERVICE_ORIGIN" = "https://service.example" && test "$GOZAR_SERVICE_TARGET" = "127.0.0.1:3000" && test -n "$GOZAR_SERVICE_NONCE"';
  const added = await invoke(home, 'add', '--origin', origin, '--target', '127.0.0.1:3000', '--verify-cmd', command);
  assert.equal(added.code, 0, JSON.stringify(added));
  assert.equal(added.reply.schemaVersion, 1);
  assert.equal(added.reply.route.verification.status, 'verified');
  const status = await invoke(home, 'status', '--origin', origin);
  assert.equal(status.code, 0);
  assert.equal(status.reply.routes[0].target, '127.0.0.1:3000');
  assert.notEqual(status.reply.routes[0].verification.checkedAt, added.reply.route.verification.checkedAt);
  assert.equal((await invoke(home, 'remove', '--origin', origin)).reply.removed, true);
  assert.equal((await invoke(home, 'remove', '--origin', origin)).reply.removed, false);
  assert.deepEqual((await invoke(home, 'status')).reply, { schemaVersion: 1, routes: [] });
});

test('CLI failed checks exit nonzero and invalid service syntax returns versioned error', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-service-cli-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const args of [['add'], ['remove'], ['status', '--target', 'localhost:3'], ['status', '--origin', 'https://a.test', '--origin', 'https://b.test'], ['wat']]) {
    const result = await invoke(home, ...args);
    assert.equal(result.code, 1);
    assert.equal(result.reply.schemaVersion, 1);
    assert.equal(result.reply.error.code, 'SERVICE_ERROR');
  }
  const failed = await invoke(home, 'add', '--origin', 'https://service.example', '--target', 'localhost:3000', '--verify-cmd', 'exit 7');
  assert.equal(failed.code, 1);
  assert.equal(failed.reply.route.verification.status, 'failed');
  assert.equal((await invoke(home, 'status')).reply.routes.length, 1);
});
