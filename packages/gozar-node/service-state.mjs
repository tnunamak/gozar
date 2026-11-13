// Private state and service-challenge helpers shared by service routes and durable routes.
// Internal module: not a package export.
import { mkdir, lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { acquireProcessLock } from './process-lock.mjs';
import { isIP } from 'node:net';

export const challengePath = '/.well-known/gozar/service';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const noncePattern = /^[0-9a-f]{64}$/;
// Check from the filesystem root before creating or using anything below it.
// Home aliases are resolved first; directories below that home must stay real.
export async function trustedDirectory(path, create = false) {
  const parent = dirname(path);
  if (parent !== path) await trustedDirectory(parent, create);
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    stat = await lstat(path);
  }
  const rootSticky = stat.uid === 0 && (stat.mode & 0o1000);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Object.assign(new Error(`Unsafe service state path ${path}: use a real directory, not a symlink`), { code: 'unsafe_state_path' });
  if ((stat.uid !== 0 && stat.uid !== process.getuid()) || ((stat.mode & 0o022) && !rootSticky))
    throw Object.assign(new Error(`Unsafe service state path ${path}: set owner to the invoking user or root and chmod go-w (only root-owned sticky directories may be writable)`), { code: 'unsafe_state_path' });
}
// Resolve once, including the nearest existing ancestor of a missing home.
// Never return to the requested alias after choosing its canonical location.
export async function canonicalHome(home, create = false) {
  const requested = resolve(home);
  const missing = [];
  let ancestor = requested, canonical;
  const aliasError = () => new Error(`Cannot resolve service home ${requested}: repair dangling or looping symlinks`);
  while (true) {
    try { canonical = await realpath(ancestor); break; }
    catch (error) {
      if (error.code === 'ELOOP') throw aliasError();
      if (error.code !== 'ENOENT') throw error;
      // ENOENT also describes dangling aliases. Do not treat those as new state.
      let stat;
      try { stat = await lstat(ancestor); }
      catch (error) {
        if (error.code === 'ELOOP') throw aliasError();
        if (error.code !== 'ENOENT') throw error;
      }
      if (stat?.isSymbolicLink()) throw aliasError();
      const parent = dirname(ancestor);
      if (parent === ancestor) throw aliasError();
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  canonical = join(canonical, ...missing);
  // Root-down checks validate the existing ancestry before creating children,
  // then validate each new component before proceeding further.
  await trustedDirectory(canonical, create);
  return canonical;
}
export async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077)) throw new Error(`Invalid service state directory ${path}: use an owner-owned directory with chmod 700`);
}
export async function checkedFile(path, flags, kind) {
  let file;
  try {
    file = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600)
      throw new Error(`Invalid service ${kind} ${path}: use an owner-owned regular file with chmod 600`);
    return file;
  } catch (error) {
    if (file) await file.close();
    if (['ELOOP', 'EISDIR'].includes(error.code))
      throw new Error(`Invalid service ${kind} ${path}: use an owner-owned regular file with chmod 600`);
    throw error;
  }
}
// Bounded read through the same non-symlink descriptor whose ownership and mode were checked.
export async function readRecord(path) {
  const file = await checkedFile(path, constants.O_RDONLY, 'record');
  try {
    // One extra byte detects growth beyond the limit without an unbounded read.
    const bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65536) throw new Error('Invalid service record: exceeds size limit');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { await file.close(); }
}
// Run action while holding an exclusive lock named by a private lock file.
// Without waitSeconds a held lock fails at once as busy; with it, acquisition blocks up to that bound.
// A holder that dies, even by SIGKILL, loses the lock; a live holder never does (see process-lock.mjs).
export async function withExclusiveLock(path, action, { waitSeconds = 0, identity } = {}) {
  // The lock file itself stays the private anchor that is checked for owner and mode.
  const anchor = await checkedFile(path, constants.O_RDWR | constants.O_CREAT, 'lock');
  await anchor.close();
  let release;
  try { release = await acquireProcessLock(path, { waitMs: waitSeconds * 1000, ...(identity ? { identity } : {}) }); }
  catch (error) {
    if (error.code === 'busy') throw Object.assign(new Error('Service mutation busy or lock unavailable'), { code: 'busy' });
    throw error;
  }
  try { return await action(); } finally { await release(); }
}
// HTTPS authority semantics on both the direct HTTP and public HTTPS witness.
export function canonicalAuthority(value) {
  if (typeof value !== 'string' || !value || /[\s\\/@?#%,]/.test(value)) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  const hostname = match[1];
  if (hostname.startsWith('[')) {
    if (isIP(hostname.slice(1, -1)) !== 6) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  } else if (!isIP(hostname) && (hostname.length > 253 || /^[0-9.]+$/.test(hostname) ||
      !hostname.replace(/\.$/, '').split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) {
    throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  }
  if (match[2] !== undefined && (!Number.isInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > 65535))
    throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  return new URL('https://' + value).host;
}
export const transcript = (nonce, instanceId, authority, localPort) =>
  JSON.stringify(['gozar-service-proof', 2, nonce, instanceId, authority, localPort]);

export function readChallenge(url, host, targetPort, nonce, signal) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url,
      { headers: { Host: host, Accept: 'application/json' }, signal }, res => {
        if (res.statusCode !== 200) { res.destroy(); reject(new Error('Verification failed')); return; }
        let bytes = 0; const chunks = [];
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 4096) { res.destroy(new Error('Verification failed')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (body.schemaVersion !== 2 || body.nonce !== nonce || !uuid.test(body.instanceId) || !noncePattern.test(body.proof) ||
                body.authority !== host || canonicalAuthority(body.authority) !== body.authority || body.localPort !== targetPort)
              throw new Error('Verification failed');
            resolve(`${body.instanceId}:${body.proof}`);
          } catch { reject(new Error('Verification failed')); }
        });
      });
    req.on('error', reject);
  });
}
export function commandCheck(route, nonce, signal) {
  // Explicitly trusted owner shell code. Status executes it. Never retain child output.
  // A detached POSIX group lets timeout cleanup kill shell descendants, not just the shell.
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(route.verifyCmd, { shell: true, stdio: 'ignore', detached: grouped,
      env: { ...process.env, GOZAR_SERVICE_ORIGIN: route.origin,
        GOZAR_SERVICE_TARGET: route.target, GOZAR_SERVICE_NONCE: nonce } });
    let done = false;
    const kill = () => {
      if (!child.pid) return;
      try { if (grouped) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const finish = error => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      try { kill(); } catch { error = new Error('Verification cleanup failed'); }
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error('Verification timed out'));
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(new Error('Verification failed')));
    child.once('exit', code => finish(code === 0 ? null : new Error('Verification failed')));
    if (signal.aborted) abort();
  });
}
export async function verification(route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const method = route.verifyCmd === null ? 'challenge' : 'host-command';
  let status = 'verified', error = null;
  try {
    const nonce = randomBytes(32).toString('hex');
    const authority = route.verifyCmd === null ? canonicalAuthority(new URL(route.origin).host) : null;
    const targetPort = Number(route.target.slice(route.target.lastIndexOf(':') + 1));
    const work = route.verifyCmd !== null ? commandCheck(route, nonce, controller.signal) : Promise.all([
      readChallenge(new URL('http://' + route.target + challengePath + '?nonce=' + nonce),
        authority, targetPort, nonce, controller.signal),
      readChallenge(new URL(route.origin + challengePath + '?nonce=' + nonce),
        authority, targetPort, nonce, controller.signal)
    ]).then(([local, publicId]) => { if (local !== publicId) throw new Error('Verification failed'); });
    await Promise.race([work, new Promise((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new Error('Verification timed out')), { once: true }))]);
  } catch { status = 'failed'; error = 'Service verification failed'; }
  finally { clearTimeout(timer); controller.abort(); }
  // checkedAt is the UTC ISO-8601 completion time of this fresh observation, not saved readiness.
  return { status, method, checkedAt: new Date().toISOString(), error,
    scope: method === 'challenge' ? 'controller-origin' : 'host-command' };
}
