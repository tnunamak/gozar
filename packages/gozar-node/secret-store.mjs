// Gozar's private secret store: one 0600 file per secret under <home>/secrets. A handle (sec_ + 32 hex) is the
// only thing that travels; the value is read back through `withSecret` and never placed in a return value.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { canonicalHome, trustedDirectory, privateDirectory, checkedFile } from './service-state.mjs';
import { gozarError } from './error-normalizer.mjs';

export const handlePattern = /^sec_[0-9a-f]{32}$/;
const maxSecretBytes = 65_536;

async function secretDirectory(home, create) {
  const directory = join(await canonicalHome(home, create), 'secrets');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}

/** Stores one secret 0600 in Gozar's private store and returns its handle. The handle is the only thing that travels. */
export async function storeSecret({ home, value }) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value ?? []);
  if (!bytes.length || bytes.length > maxSecretBytes) throw gozarError('invalid_input', 'A secret must be 1..65536 bytes');
  const directory = await secretDirectory(home, true);
  const handle = `sec_${randomBytes(16).toString('hex')}`;
  const file = await open(join(directory, handle), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); bytes.fill(0); }
  return { handle };
}

/** Hands one secret to `use` and clears its copy afterwards. The handle is validated before it reaches a path. */
export async function withSecret(home, handle, use) {
  if (typeof handle !== 'string' || !handlePattern.test(handle)) throw gozarError('invalid_input', 'secretHandle is not a Gozar secret handle');
  const directory = await secretDirectory(home, false).catch(error => { throw error.code === 'ENOENT' ? gozarError('setup_required', 'The secret is not in the private store') : error; });
  let file;
  try { file = await checkedFile(join(directory, handle), constants.O_RDONLY, 'secret'); }
  catch (error) { throw error.code === 'ENOENT' ? gozarError('setup_required', 'The secret is not in the private store') : error; }
  const buffer = Buffer.alloc(maxSecretBytes + 1);
  try {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxSecretBytes) throw gozarError('invalid_input', 'The stored secret is too large');
    return await use(new Uint8Array(buffer.subarray(0, bytesRead)));
  } finally { buffer.fill(0); await file.close(); }
}

/** Deletes one secret file. A secret that is already gone is not an error. */
export async function deleteSecret(home, handle) {
  if (typeof handle !== 'string' || !handlePattern.test(handle)) throw gozarError('invalid_input', 'secretHandle is not a Gozar secret handle');
  let directory;
  try { directory = await secretDirectory(home, false); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await unlink(join(directory, handle)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
