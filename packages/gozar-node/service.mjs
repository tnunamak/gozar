import { readdir, unlink, link, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { atomicWrite } from './journal.mjs';
import { noncePattern, trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock,
  canonicalAuthority, transcript, verification } from './service-state.mjs';

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
async function stored(path, name) {
  const value = await readRecord(path);
  const checked = config(value);
  if (value.schemaVersion !== 1 || value.adapterId !== checked.adapterId ||
      value.ownership !== checked.ownership || value.origin !== checked.origin ||
      name !== filename(checked.origin) || Object.keys(value).sort().join() !== Object.keys(checked).sort().join())
    throw new Error('Invalid service record');
  return checked;
}
async function mutate(home, origin, action) {
  const dir = directory(await canonicalHome(home, true));
  await trustedDirectory(dir, true);
  await privateDirectory(dir);
  // Keep the lock inode: unlinking it could split concurrent mutations.
  const locks = join(dir, '.locks');
  await trustedDirectory(locks, true);
  await privateDirectory(locks);
  return withExclusiveLock(join(locks, hash(origin)), () => action(dir));
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
  try {
    home = await canonicalHome(home);
    await trustedDirectory(directory(home));
    await privateDirectory(directory(home));
    names = await readdir(directory(home));
  }
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
