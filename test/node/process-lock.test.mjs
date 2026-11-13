import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireProcessLock } from '../../packages/gozar-node/process-lock.mjs';
import { withExclusiveLock } from '../../packages/gozar-node/service-state.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';

const holderScript = fileURLToPath(new URL('./fixtures/lock-holder.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scratch(t) {
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gozar-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// A holder in its own process, so SIGKILL really is a crash.
async function startHolder(t, path) {
  const child = spawn(process.execPath, [holderScript, path], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { child.kill('SIGKILL'); await exited; });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', () => reject(new Error('holder exited before holding the lock')));
  });
  return { child, exited };
}

test('two concurrent holders never overlap', async t => {
  const path = join(await scratch(t), 'a.lock');
  let inside = 0, peak = 0, finished = 0;
  const worker = async () => {
    const release = await acquireProcessLock(path, { waitMs: 20_000 });
    inside++; peak = Math.max(peak, inside);
    await sleep(15);
    inside--; finished++;
    await release();
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  assert.equal(finished, 12);
  assert.equal(peak, 1);
  assert.deepEqual((await readdir(join(path, '..'))).filter(name => name.startsWith('a.lock.')), [], 'no lock or claim files are left behind');
});

test('a holder killed with SIGKILL loses the lock to the next caller', async t => {
  const path = join(await scratch(t), 'b.lock');
  const { child, exited } = await startHolder(t, path);
  await assert.rejects(acquireProcessLock(path, { waitMs: 0 }), { code: 'busy' });
  child.kill('SIGKILL');
  await exited;
  const release = await acquireProcessLock(path, { waitMs: 0 });
  await release();
});

test('a waiting caller takes over when the holder dies during the wait', async t => {
  const path = join(await scratch(t), 'c.lock');
  const { child, exited } = await startHolder(t, path);
  const waiting = acquireProcessLock(path, { waitMs: 10_000 });
  await sleep(150);
  child.kill('SIGKILL');
  await exited;
  await (await waiting)();
});

test('many waiters on a dead holder: exactly one wins at a time', async t => {
  const path = join(await scratch(t), 'd.lock');
  const { child, exited } = await startHolder(t, path);
  child.kill('SIGKILL');
  await exited;
  let inside = 0, peak = 0, finished = 0;
  const worker = async () => {
    const release = await acquireProcessLock(path, { waitMs: 20_000 });
    inside++; peak = Math.max(peak, inside);
    await sleep(10);
    inside--; finished++;
    await release();
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  assert.equal(finished, 8);
  assert.equal(peak, 1, 'two waiters both took over the same stale lock');
});

test('a live holder is never broken, and non-blocking acquisition returns busy at once', async t => {
  const path = join(await scratch(t), 'e.lock');
  const release = await acquireProcessLock(path, { waitMs: 0 });
  const started = Date.now();
  await assert.rejects(acquireProcessLock(path, { waitMs: 0 }), { code: 'busy' });
  assert.ok(Date.now() - started < 1000);
  // A bounded wait ends in busy as well, and still does not break the holder.
  await assert.rejects(acquireProcessLock(path, { waitMs: 300 }), { code: 'busy' });
  await assert.rejects(acquireProcessLock(path, { waitMs: 0 }), { code: 'busy' });
  await release();
  await (await acquireProcessLock(path, { waitMs: 0 }))();
});

test('a recorded holder whose PID now has a different start time no longer holds the lock', async t => {
  // Same PID, different start time: the old holder is dead, a PID reuse must not keep the lock.
  const path = join(await scratch(t), 'f.lock');
  let ticks = 'start-1';
  const identity = pid => pid === process.pid ? Promise.resolve(ticks) : processIdentity(pid);
  const release = await acquireProcessLock(path, { waitMs: 0, identity });
  assert.ok(release);
  await assert.rejects(acquireProcessLock(path, { waitMs: 0, identity }), { code: 'busy' });
  ticks = 'start-2'; // the recorded holder's PID now belongs to a process that started later
  const second = await acquireProcessLock(path, { waitMs: 0, identity });
  await second();
});

test('a process that cannot read its own identity does not take locks', async t => {
  const path = join(await scratch(t), 'g.lock');
  await assert.rejects(acquireProcessLock(path, { waitMs: 0, identity: async () => null }), /Cannot verify this process identity/);
});

test('a lock record that is not ours is never broken', async t => {
  const directory = await scratch(t);
  const path = join(directory, 'h.lock');
  await writeFile(`${path}.owner`, 'not json', { mode: 0o600 });
  await assert.rejects(acquireProcessLock(path, { waitMs: 0 }), { code: 'busy', message: /unreadable/ });
  assert.equal(await readFile(`${path}.owner`, 'utf8'), 'not json');
});

test('withExclusiveLock keeps its contract: busy code, bounded wait, private anchor file', async t => {
  const path = join(await scratch(t), 'i.lock');
  let nested;
  await withExclusiveLock(path, async () => {
    nested = await withExclusiveLock(path, async () => 'inner').catch(error => error);
  });
  assert.equal(nested.code, 'busy');
  assert.equal(await withExclusiveLock(path, async () => 'free again', { waitSeconds: 1 }), 'free again');
  // The action's own errors pass through untouched, and the lock is released.
  await assert.rejects(withExclusiveLock(path, async () => { throw Object.assign(new Error('boom'), { code: 'busy-ish' }); }), { message: 'boom', code: 'busy-ish' });
  await withExclusiveLock(path, async () => {});
  // A lock file with loose permissions is refused, as before.
  await writeFile(join(path, '..', 'loose.lock'), '', { mode: 0o644 });
  await assert.rejects(withExclusiveLock(join(path, '..', 'loose.lock'), async () => {}), /chmod 600/);
});
