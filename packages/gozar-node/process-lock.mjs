import { constants } from 'node:fs';
import { link as linkCallback } from 'node:fs';
import { open, readdir, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { processIdentity } from './process-identity.mjs';

// One exclusive lock for Linux and macOS, with no flock(1) and no native code.
//
// Held means: `<path>.owner` exists and its recorded process is alive, proven by the process identity
// (PID + start time, so a reused PID is not mistaken for the holder). A holder that exits or is killed
// leaves its record behind; the next acquirer sees a dead identity and takes the lock over. A lock is
// never broken while its holder is alive.
//
// Acquire is link(2) of a fully written candidate onto the owner path: it succeeds for exactly one caller
// and the record is never seen half-written.
//
// Taking over a stale record is the hard part: unlink-then-link is unsafe, because two waiters can both
// judge the same stale record dead, one can unlink it and take the lock, and the other can then unlink
// that live lock. So a breaker first claims the right to break THAT record, by exclusively creating
// `<path>.break-<stale token>-<n>`. Names are unique per stale record, so no claim can ever touch another
// record. Claims form a chain: claim n+1 may be created only when the holder of claim n is proven dead, so
// at most one live breaker exists per stale record. The record can only change through such a breaker (its
// holder is dead and cannot release), so a live breaker that re-reads the record and sees its token may
// unlink it, and nothing else can have replaced it in between.
//
// This is the design of lockfile tools that record an owner PID (for example `lockfile(1)`, `proper-lockfile`
// with its mtime staleness replaced by exact identity). It needs a filesystem with hard links.

// The callback form, so that nothing that wraps fs/promises.link (tests that stop a process mid-publication) sees lock traffic.
const link = promisify(linkCallback);
const pollMinMs = 5, pollMaxMs = 50;
const breakContentionCapMs = 2000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const busy = message => Object.assign(new Error(message), { code: 'busy' });

async function readRecord(path) {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600)
      throw new Error(`Lock record ${path} is not an owner-owned private regular file`);
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) return { invalid: true };
    try {
      const record = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
      return Number.isSafeInteger(record?.pid) && record.pid > 0 && typeof record.identity === 'string' && record.identity &&
        typeof record.token === 'string' ? record : { invalid: true };
    } catch { return { invalid: true }; }
  } finally { await file.close(); }
}

async function writePrivate(path, value) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value)); } finally { await file.close(); }
}

const removeQuietly = path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });

/**
 * Acquire the lock at `path`. Resolves with a release function. Rejects with code 'busy' when a live holder
 * keeps it for the whole wait. waitMs 0 fails at once while a live holder has it.
 */
export async function acquireProcessLock(path, { waitMs = 0, identity = processIdentity } = {}) {
  const ownerPath = `${path}.owner`;
  const directory = dirname(path), prefix = `${basename(path)}.break-`;
  const self = await identity(process.pid);
  // A process that cannot identify itself cannot be told apart from a dead one by others: fail closed.
  if (!self) throw new Error('Cannot verify this process identity for lock ownership');
  const token = randomUUID();
  const record = { version: 1, token, pid: process.pid, identity: self };
  const candidatePath = `${path}.cand-${token}`;
  const deadline = Date.now() + waitMs;
  let contentionDeadline = null;
  await writePrivate(candidatePath, record);
  const alive = value => identity(value.pid).then(current => current === value.identity);
  let delay = pollMinMs, retries = 0;
  try {
    for (;;) {
      const outcome = await attempt();
      if (outcome === 'held') { await sweep().catch(() => {}); return release; }
      if (outcome === 'retry' && ++retries < 100) continue; // the record changed under us: look again at once
      // A live holder stops a non-blocking caller at once. A break in progress is brief: wait it out.
      if (outcome === 'contended') contentionDeadline ??= Date.now() + breakContentionCapMs;
      else contentionDeadline = null;
      const limit = outcome === 'contended' ? Math.max(deadline, contentionDeadline) : deadline;
      if (Date.now() >= limit) throw busy(outcome === 'invalid' ? `Lock record ${ownerPath} is unreadable; remove it if no process holds the lock` : 'Lock is held by a running process');
      await sleep(Math.min(delay, Math.max(1, limit - Date.now())));
      delay = Math.min(pollMaxMs, delay * 2);
    }
  } catch (error) {
    await removeQuietly(candidatePath);
    throw error;
  }

  async function attempt() {
    try { await link(candidatePath, ownerPath); await removeQuietly(candidatePath); return 'held'; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const holder = await readRecord(ownerPath);
    if (holder === null) return 'retry'; // released between our link and our read
    if (holder.invalid) return 'invalid';
    if (await alive(holder)) return 'live';
    return breakStale(holder);
  }

  async function claims(stale) {
    const stem = `${prefix}${stale.token}-`;
    const names = (await readdir(directory)).filter(name => name.startsWith(stem));
    return names.map(name => ({ name, n: Number(name.slice(stem.length)) })).filter(entry => Number.isSafeInteger(entry.n)).sort((a, b) => a.n - b.n);
  }

  async function breakStale(stale) {
    const existing = await claims(stale);
    let n = 0;
    if (existing.length) {
      const last = existing.at(-1);
      const claimant = await readRecord(join(directory, last.name));
      if (claimant === null) return 'retry'; // cleared while we looked
      if (claimant.invalid) return 'invalid';
      if (await alive(claimant)) return 'contended';
      n = last.n + 1;
    }
    const claimPath = join(directory, `${prefix}${stale.token}-${n}`);
    // Linking the finished candidate makes the claim appear complete, so a dead creator never leaves half a claim.
    try { await link(candidatePath, claimPath); }
    catch (error) { if (error.code === 'EEXIST') return 'contended'; throw error; }
    try {
      // We are the only live breaker of this record. Confirm it is still the record we judged dead.
      const current = await readRecord(ownerPath);
      if (!current || current.invalid || current.token !== stale.token) return 'retry';
      await removeQuietly(ownerPath);
      try { await link(candidatePath, ownerPath); await removeQuietly(candidatePath); return 'held'; }
      catch (error) { if (error.code === 'EEXIST') return 'retry'; throw error; } // an ordinary acquirer won the gap
    } finally {
      // This attempt is over, so our claim stops mattering. If the stale record is gone, every claim on it is moot.
      await removeQuietly(claimPath);
      const current = await readRecord(ownerPath).catch(() => null);
      if (!current || current.token !== stale.token) for (const entry of await claims(stale)) await removeQuietly(join(directory, entry.name));
    }
  }

  // Leftovers of holders that died mid-protocol. Every name carries a unique token, so removing one
  // that belongs to a dead process (or to a record that is gone for good) can never touch anything live.
  async function sweep() {
    const names = await readdir(directory);
    const stem = basename(path);
    for (const name of names) {
      if (name.startsWith(`${stem}.cand-`) && name !== basename(candidatePath)) {
        const other = await readRecord(join(directory, name)).catch(() => null);
        if (other && !other.invalid && !await alive(other)) await removeQuietly(join(directory, name));
      } else if (name.startsWith(prefix)) {
        const stale = /^(.+)-\d+$/.exec(name.slice(prefix.length))?.[1];
        const current = await readRecord(ownerPath).catch(() => null);
        if (stale && current && !current.invalid && current.token !== stale) {
          const claimant = await readRecord(join(directory, name)).catch(() => null);
          if (claimant && !claimant.invalid && !await alive(claimant)) await removeQuietly(join(directory, name));
        }
      }
    }
  }

  async function release() {
    const current = await readRecord(ownerPath).catch(() => null);
    if (current?.token === token) await removeQuietly(ownerPath);
  }
}

export async function withProcessLock(path, action, options) {
  const release = await acquireProcessLock(path, options);
  try { return await action(); } finally { await release(); }
}
