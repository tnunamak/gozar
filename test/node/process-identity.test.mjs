import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { processIdentity as fromJournal } from '../../packages/gozar-node/journal.mjs';

// ps -o lstart=,stat= -p <pid>, as macOS prints it.
const psTable = rows => ({ platform: 'darwin', run: async pid => ({ stdout: rows[pid] ?? '' }) });

test('darwin: a live process has a stable identity, a missing PID and a zombie have none', async () => {
  const deps = psTable({ 100: 'Thu Nov 12 17:47:28 2026     S   \n', 200: 'Thu Nov 12 17:47:29 2026     Z+  \n' });
  const first = await processIdentity(100, deps);
  assert.equal(typeof first, 'string');
  assert.ok(first);
  assert.equal(await processIdentity(100, deps), first);
  assert.equal(await processIdentity(999, deps), null);
  assert.equal(await processIdentity(200, deps), null);
});

test('darwin: the same PID with a different start time has a different identity', async () => {
  const before = await processIdentity(100, psTable({ 100: 'Thu Nov 12 17:47:28 2026     S   ' }));
  const after = await processIdentity(100, psTable({ 100: 'Thu Nov 12 17:47:29 2026     S   ' }));
  assert.notEqual(before, after);
  // The identity does not depend on the process state column.
  assert.equal(await processIdentity(100, psTable({ 100: 'Thu Nov 12 17:47:28 2026     R+  ' })), before);
  // A single-digit day is padded with extra spaces by ps; that is the same instant.
  assert.equal(await processIdentity(1, psTable({ 1: 'Sun Nov  1 09:00:00 2026   S' })), await processIdentity(1, psTable({ 1: 'Sun Nov 1 09:00:00 2026 S' })));
});

test('darwin: unreadable ps output is an error, never a dead process', async () => {
  await assert.rejects(processIdentity(100, psTable({ 100: 'something unexpected' })), /unrecognized ps output/);
  await assert.rejects(processIdentity(100, { platform: 'darwin', run: async () => { throw new Error('Cannot read process identity: ps failed (timed out)'); } }), /timed out/);
});

test('other platforms and invalid PIDs have no identity, as before', async () => {
  assert.equal(await processIdentity(100, { platform: 'win32' }), null);
  assert.equal(await processIdentity(0, psTable({ 0: 'Thu Nov 12 17:47:28 2026 S' })), null);
  assert.equal(await processIdentity(-5, { platform: 'darwin' }), null);
  assert.equal(await processIdentity(1.5, { platform: 'darwin' }), null);
});

test('linux: the identity is the /proc stat start-tick field, as it always was', { skip: process.platform !== 'linux' }, async () => {
  const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const expected = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  assert.equal(await processIdentity(process.pid), expected);
  assert.equal(await fromJournal(process.pid), expected);
  // A name with spaces and parentheses must not shift the field.
  const odd = `4242 (a b) c) S ${Array.from({ length: 18 }, (_, i) => i + 1).join(' ')} 99887766 23 24`;
  assert.equal(await processIdentity(4242, { platform: 'linux', readProc: async () => odd }), '99887766');
  assert.equal(await processIdentity(4242, { platform: 'linux', readProc: async () => odd.replace(') S ', ') Z ') }), null);
  assert.equal(await processIdentity(4242, { platform: 'linux', readProc: async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } }), null);
});

test('linux: a live child has an identity and an exited child has none', { skip: process.platform !== 'linux' }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const first = await processIdentity(child.pid);
    assert.ok(first);
    assert.equal(await processIdentity(child.pid), first);
  } finally { child.kill('SIGKILL'); await exited; }
  assert.equal(await processIdentity(child.pid), null);
});
