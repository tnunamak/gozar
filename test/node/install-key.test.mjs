import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, mkdir, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installIdentity } from '../../packages/gozar-node/install-key.mjs';

test('concurrent first use shares a persistent private Ed25519 identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gozar-key-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const values = await Promise.all(Array.from({ length: 4 }, () => installIdentity(root)));
  assert.ok(values.every(value => value === values[0]));
  assert.match(values[0], /^-----BEGIN OPENSSH PRIVATE KEY-----/);
  assert.equal((await stat(join(root, 'identities'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, 'identities', 'ed25519'))).mode & 0o777, 0o600);
  assert.equal(await installIdentity(root), values[0]);
});

test('rejects a symlink or permissive mode for the identity directory and key', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gozar-key-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'identities'), { mode: 0o700 });
  await symlink('/dev/null', join(root, 'identities', 'ed25519'));
  await assert.rejects(installIdentity(root));
  await rm(join(root, 'identities', 'ed25519'));
  await installIdentity(root);
  await chmod(join(root, 'identities', 'ed25519'), 0o644);
  await assert.rejects(installIdentity(root));
  await chmod(join(root, 'identities', 'ed25519'), 0o600);
  await chmod(join(root, 'identities'), 0o755);
  await assert.rejects(installIdentity(root));
});
