import assert from 'node:assert/strict';
import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
async function privateJson(path, maximum = 32768) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    assert.ok(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600 && stat.size <= maximum, 'local private file ownership/mode/size invalid');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}
export async function readLocalProbeKey(privateRequestPath, executorId) {
  const path = resolve(privateRequestPath); const parent = await lstat(dirname(path));
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === process.getuid() && (parent.mode & 0o777) === 0o700, 'private channel directory scope invalid');
  const raw = await privateJson(path);
  assert.equal(raw.executorId, executorId);
  assert.equal(raw.authentication?.algorithm, 'hmac-sha256');
  assert.equal(raw.authentication.keyPath, `${path}.key.json`, 'key path must be exact adjacent private file');
  const material = await privateJson(raw.authentication.keyPath, 4096);
  assert.equal(material.requestId, raw.requestId); assert.equal(material.executorId, executorId);
  assert.ok(typeof material.key === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(material.key), 'invalid local MAC key');
  return { raw, key: material.key };
}
