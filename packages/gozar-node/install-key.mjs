import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function checkedDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700)
    throw new Error('Installation identity directory ownership or mode mismatch');
}

async function readIdentity(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 16384)
      throw new Error('Installation identity ownership or mode mismatch');
    const content = await file.readFile('utf8');
    if (!content.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')) throw new Error('Invalid installation identity');
    return content;
  } finally { await file.close(); }
}

// Only called after consent. Competing first uses publish by hard link, so neither
// can replace the identity selected by the first successful publisher.
export async function installIdentity(home) {
  const dir = join(home, 'identities');
  await checkedDirectory(dir);
  const path = join(dir, 'ed25519');
  try { return await readIdentity(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = await mkdtemp(join(dir, '.new-'));
  try {
    const generated = join(temp, 'key');
    await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', generated], {
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, timeout: 10000, maxBuffer: 65536,
    });
    await readIdentity(generated);
    await link(generated, path).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return await readIdentity(path);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
