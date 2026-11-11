import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readLocalProbeKey } from '../../harness/local-probe-key.mjs';

test('local signing key requires exact adjacent file, modes, ownership and request/executor identity', async () => {
  const base = (process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gz-key-'));
  try {
    const path = join(directory, 'fixture.request.json'), keyPath = `${path}.key.json`;
    const key = randomBytes(32).toString('base64url');
    const request = { requestId: 'fixture', executorId: 'trusted-worker', authentication: { algorithm: 'hmac-sha256', keyPath } };
    await writeFile(path, JSON.stringify(request), { mode: 0o600 });
    await writeFile(keyPath, JSON.stringify({ key, requestId: 'fixture', executorId: 'trusted-worker' }), { mode: 0o600 });
    assert.equal((await readLocalProbeKey(path, 'trusted-worker')).key, key);
    await assert.rejects(readLocalProbeKey(path, 'other-worker'));
    await chmod(keyPath, 0o644); await assert.rejects(readLocalProbeKey(path, 'trusted-worker')); await chmod(keyPath, 0o600);
    await writeFile(path, JSON.stringify({ ...request, authentication: { ...request.authentication, keyPath: '/outside/private/key' } }));
    await assert.rejects(readLocalProbeKey(path, 'trusted-worker'), /exact adjacent/);
    await writeFile(path, JSON.stringify(request));
    const realKey = join(directory, 'real-key'); await writeFile(realKey, JSON.stringify({ key, requestId: 'fixture', executorId: 'trusted-worker' }), { mode: 0o600 });
    await unlink(keyPath); await symlink(realKey, keyPath); await assert.rejects(readLocalProbeKey(path, 'trusted-worker'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
