import { mkdir, readFile, readdir, unlink, link, lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { atomicWrite } from './journal.mjs';

const challengePath = '/.well-known/gozar/service';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noncePattern = /^[0-9a-f]{64}$/;
const defaultHome = () => process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
function originValue(value) {
  if (typeof value !== 'string') throw new Error('Invalid service origin');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid service origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname || (value !== url.origin && value !== url.origin + '/'))
    throw new Error('Invalid service origin');
  return url.origin;
}
function targetValue(value) {
  if (typeof value !== 'string') throw new Error('Invalid service target');
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+):([0-9]+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 ||
      !Number.isInteger(Number(match[2]))) throw new Error('Invalid service target');
  const host = match[1];
  if (host.startsWith('[') && isIP(host.slice(1, -1)) !== 6) throw new Error('Invalid service target');
  if (!host.startsWith('[') && !isIP(host) && (host.length > 253 ||
      /^[0-9.]+$/.test(host) || !host.replace(/\.$/, '').split('.').every(label =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) throw new Error('Invalid service target');
  return value;
}
function config({ origin, target, verifyCmd = null }) {
  if (verifyCmd !== null && (typeof verifyCmd !== 'string' || !verifyCmd.trim() || verifyCmd.includes('\0')))
    throw new Error('Invalid verification command');
  const route = { schemaVersion: 1, origin: originValue(origin), target: targetValue(target),
    adapterId: 'own-address', ownership: 'external-owned', verifyCmd };
  if (Buffer.byteLength(JSON.stringify(route)) > 65536) throw new Error('Service record exceeds size limit');
  return route;
}
const hash = origin => createHash('sha256').update(origin).digest('hex');
const directory = home => join(home, 'services');
const filename = origin => hash(origin) + '.json';
async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077)) throw new Error('Invalid service state directory');
}
async function stored(path, name) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 ||
      stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) throw new Error('Invalid service record');
  const value = JSON.parse(await readFile(path, 'utf8'));
  const checked = config(value);
  if (value.schemaVersion !== 1 || value.adapterId !== checked.adapterId ||
      value.ownership !== checked.ownership || value.origin !== checked.origin ||
      name !== filename(checked.origin) || Object.keys(value).sort().join() !== Object.keys(checked).sort().join())
    throw new Error('Invalid service record');
  return checked;
}
async function mutate(home, origin, action) {
  const dir = directory(resolve(home));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await privateDirectory(dir);
  // Kernel locks release on process exit/reboot. Keep the lock inode: unlinking it
  // could let a second process lock a different inode for the same origin.
  const locks = join(dir, '.locks');
  await mkdir(locks, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await privateDirectory(locks);
  const holder = spawn('flock', ['--exclusive', '--nonblock', join(locks, hash(origin)),
    process.execPath, '-e', "process.stdout.write('locked');process.stdin.resume()"],
    { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = new Promise(resolveExit => {
    holder.once('error', () => resolveExit());
    holder.once('close', () => resolveExit());
  });
  try {
    await new Promise((ready, reject) => {
      holder.once('error', () => reject(new Error('Service mutation requires flock (util-linux)')));
      holder.once('close', () => reject(new Error('Service mutation busy or lock unavailable')));
      holder.stdout.once('data', chunk => chunk.toString() === 'locked' ? ready() : reject(new Error('Service lock failed')));
    });
    return await action(dir);
  } finally {
    holder.stdin.on('error', () => {});
    holder.stdin.end();
    await exited;
  }
}
// HTTPS authority semantics on both the direct HTTP and public HTTPS witness.
function canonicalAuthority(value) {
  if (typeof value !== 'string' || !value || /[\s\\/@?#%,]/.test(value)) throw new Error('Invalid service Host');
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match) throw new Error('Invalid service Host');
  const hostname = match[1];
  if (hostname.startsWith('[')) {
    if (isIP(hostname.slice(1, -1)) !== 6) throw new Error('Invalid service Host');
  } else if (!isIP(hostname) && (hostname.length > 253 || /^[0-9.]+$/.test(hostname) ||
      !hostname.replace(/\.$/, '').split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) {
    throw new Error('Invalid service Host');
  }
  if (match[2] !== undefined && (!Number.isInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > 65535))
    throw new Error('Invalid service Host');
  return new URL('https://' + value).host;
}
const transcript = (nonce, instanceId, authority, localPort) =>
  JSON.stringify(['gozar-service-proof', 2, nonce, instanceId, authority, localPort]);

function readChallenge(url, host, targetPort, nonce, signal) {
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
function commandCheck(route, nonce, signal) {
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
async function verification(route) {
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
async function present(route) { return { ...route, verification: await verification(route) }; }
export async function addService({ origin, target, verifyCmd = null, home = defaultHome() }) {
  const route = config({ origin, target, verifyCmd });
  await mutate(home, route.origin, async dir => {
    const name = filename(route.origin), path = join(dir, name);
    try {
      const existing = await stored(path, name);
      if (JSON.stringify(existing) !== JSON.stringify(route)) throw new Error('Service ownership conflict');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const staging = join(dir, hash(route.origin) + '.' + randomUUID() + '.pending');
    try {
      await atomicWrite(staging, route);
      // Atomic exclusive publication: never replace an existing origin record.
      await link(staging, path);
      const fd = await open(dir, 'r');
      try { await fd.sync(); } finally { await fd.close(); }
    } finally { await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
  return { schemaVersion: 1, route: await present(route) };
}
export async function statusServices({ origin, home = defaultHome() } = {}) {
  const normalized = origin === undefined ? null : originValue(origin);
  let names;
  try { await privateDirectory(directory(home)); names = await readdir(directory(home)); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, routes: [] }; throw error; }
  const routes = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || (normalized && name !== filename(normalized))) continue;
    routes.push(await stored(join(directory(home), name), name));
  }
  return { schemaVersion: 1, routes: await Promise.all(routes.map(present)) };
}
export async function removeService({ origin, home = defaultHome() }) {
  origin = originValue(origin);
  const removed = await mutate(home, origin, async dir => {
    const name = filename(origin), path = join(dir, name);
    try { await stored(path, name); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    await unlink(path);
    const fd = await open(dir, 'r');
    try { await fd.sync(); } finally { await fd.close(); }
    return true;
  });
  return { schemaVersion: 1, origin, removed };
}
export function createServiceVerifier() {
  const instanceId = randomUUID();
  const secret = randomBytes(32);
  return (req, res) => {
    if (req.method !== 'GET' || typeof req.url !== 'string') return false;
    const match = /^\/\.well-known\/gozar\/service\?nonce=([0-9a-f]{64})$/.exec(req.url);
    if (!match || !noncePattern.test(match[1])) return false;
    let authority;
    try {
      if (!Array.isArray(req.rawHeaders) || req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1) return false;
      authority = canonicalAuthority(req.headers.host);
    } catch { return false; }
    const localPort = req.socket?.localPort;
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) return false;
    const proof = createHmac('sha256', secret).update(transcript(match[1], instanceId, authority, localPort), 'utf8').digest('hex');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ schemaVersion: 2, nonce: match[1], instanceId, authority, localPort, proof }));
    return true;
  };
}
