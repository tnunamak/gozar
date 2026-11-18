import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { attachedScratch, scratch } from './route-schema-check.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fifo = () => { const hooks = []; return { hooks, after: hook => hooks.push(hook) }; };
async function record(home, over = {}, id = 'att_0000000000000001') {
  const directory = join(home, 'attached', id);
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'control.json');
  await writeFile(file, JSON.stringify({ pid: 123456, startIdentity: 'owned-start', nonce: 'synthetic', ...over }));
  return file;
}
const missing = path => assert.rejects(access(path), { code: 'ENOENT' });

test('legacy FIFO scratch removal hides the control record from a later reaper', async () => {
  const t = fifo(), home = await scratch(t);
  await record(home);
  let observed;
  t.after(async () => { observed = await readdir(join(home, 'attached')).catch(() => []); });
  for (const hook of t.hooks) await hook();
  assert.deepEqual(observed, []);
  await missing(home);
});

test('attached teardown reads ownership and awaits retirement before removing home', async () => {
  const t = fifo(), reached = deferred(), retired = deferred(), calls = [];
  let reads = 0;
  const home = await attachedScratch(t, {
    identity: async pid => {
      calls.push(['identity', pid]);
      if (++reads === 1) return 'owned-start';
      reached.resolve();
      return retired.promise;
    },
    signal: (pid, signal) => calls.push(['signal', pid, signal]),
  });
  const file = await record(home);
  assert.equal(t.hooks.length, 1, 'one owned teardown, not independent FIFO removals');
  let settled = false;
  const cleaning = t.hooks[0]().finally(() => { settled = true; });
  // Attach a rejection observer immediately, even while the test holds retirement.
  const observed = cleaning.then(() => null, error => error);
  try {
    assert.equal(await Promise.race([reached.promise.then(() => true), observed.then(() => false)]), true,
      'cleanup must reach retirement before settling or losing the record');
    assert.equal(settled, false);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).startIdentity, 'owned-start');
    assert.deepEqual(calls, [['identity', 123456], ['signal', 123456, 'SIGKILL'], ['identity', 123456]]);
  } finally {
    retired.resolve(null);
    const error = await observed;
    if (error) throw error;
  }
  await missing(home);
});

test('a changed PID identity is never signaled and its evidence is retained', async () => {
  const t = fifo(), signals = [];
  const home = await attachedScratch(t, { identity: async () => 'different-start', signal: (...args) => signals.push(args) });
  const file = await record(home);
  try {
    await assert.rejects(t.hooks[0](), /identity changed/);
    assert.deepEqual(signals, []);
    await access(file);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('unreadable identity preserves the exact error and recovery record', async () => {
  const t = fifo(), failure = new Error('identity unavailable'), signals = [];
  const home = await attachedScratch(t, { identity: async () => { throw failure; }, signal: (...args) => signals.push(args) });
  const file = await record(home);
  try {
    await assert.rejects(t.hooks[0](), error => error === failure);
    assert.deepEqual(signals, []);
    await access(file);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('signal failure is not masked by disposal and retains recovery evidence', async () => {
  const t = fifo(), failure = new Error('signal refused');
  const home = await attachedScratch(t, { identity: async () => 'owned-start', signal: () => { throw failure; } });
  const file = await record(home);
  try {
    await assert.rejects(t.hooks[0](), error => error === failure);
    await access(file);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('retirement timeout preserves home instead of claiming process absence', async () => {
  const t = fifo(), signals = [];
  let time = 0;
  const home = await attachedScratch(t, {
    identity: async () => 'owned-start', signal: (...args) => signals.push(args),
    now: () => time, wait: async () => { time += 5000; }, timeoutMs: 5000,
  });
  const file = await record(home);
  try {
    await assert.rejects(t.hooks[0](), /did not retire/);
    assert.deepEqual(signals, [[123456, 'SIGKILL']]);
    await access(file);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('invalid control PIDs are never signaled', async () => {
  for (const pid of [0, -1, 1.5, '123456']) {
    const t = fifo(), signals = [];
    const home = await attachedScratch(t, { identity: async () => { throw new Error('must not inspect'); }, signal: (...args) => signals.push(args) });
    const file = await record(home, { pid });
    try {
      await assert.rejects(t.hooks[0](), /invalid controller identity/);
      assert.deepEqual(signals, []);
      await access(file);
    } finally { await rm(home, { recursive: true, force: true }); }
  }
});

test('already-gone controllers need no signal and ordinary scratch stays unchanged', async () => {
  const t = fifo(), signals = [];
  const home = await attachedScratch(t, { identity: async () => null, signal: (...args) => signals.push(args) });
  await record(home);
  await t.hooks[0]();
  assert.deepEqual(signals, []);
  await missing(home);
  const ordinary = fifo(), dir = await scratch(ordinary);
  assert.equal(ordinary.hooks.length, 1);
  await ordinary.hooks[0]();
  await missing(dir);
});

test('a present recordless attempt is unresolved even when an identity seam reports a live process', async () => {
  const t = fifo(), calls = [];
  const home = await attachedScratch(t, {
    identity: async pid => { calls.push(['identity', pid]); return 'still-live'; },
    signal: (...args) => calls.push(['signal', ...args]),
  });
  const directory = join(home, 'attached', 'att_0000000000000001');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify({ pid: 123456 }));
  try {
    await assert.rejects(t.hooks[0](), { code: 'ENOENT' });
    assert.deepEqual(calls, [], 'neither a directory name nor bootstrap PID grants signal authority');
    await access(join(directory, 'bootstrap.json'));
  } finally { await rm(home, { recursive: true, force: true }); }
});

for (const fault of ['missing', 'invalid']) for (const invalidFirst of [true, false]) {
  test(`${fault} control does not skip independent retirement (invalid first: ${invalidFirst})`, { timeout: 3000 }, async () => {
    const t = fifo(), reached = deferred(), retired = deferred(), signals = [];
    let reads = 0;
    const home = await attachedScratch(t, {
      identity: async pid => {
        assert.equal(pid, 123456);
        if (++reads === 1) return 'owned-start';
        reached.resolve();
        return retired.promise;
      },
      signal: (...args) => signals.push(args),
    });
    const bad = invalidFirst ? 'att_0000000000000001' : 'att_0000000000000002';
    const good = invalidFirst ? 'att_0000000000000002' : 'att_0000000000000001';
    // Create in reverse lexical order: traversal must not depend on creation order.
    for (const id of [bad, good].sort().reverse()) {
      if (id === good) await record(home, {}, id);
      else if (fault === 'invalid') await record(home, { pid: 0 }, id);
      else await mkdir(join(home, 'attached', id), { recursive: true });
    }
    let settled = false;
    const observed = t.hooks[0]().then(() => null, error => error).finally(() => { settled = true; });
    try {
      assert.equal(await Promise.race([reached.promise.then(() => true), observed.then(() => false)]), true);
      assert.equal(settled, false, 'do not report failures before independently owned controller retires');
      await access(join(home, 'attached', good, 'control.json'));
      retired.resolve(null);
      const failure = await observed;
      if (fault === 'missing') assert.equal(failure?.code, 'ENOENT');
      else assert.match(failure?.message ?? '', /invalid controller identity/);
      assert.deepEqual(signals, [[123456, 'SIGKILL']]);
      await access(join(home, 'attached', bad));
      await access(join(home, 'attached', good, 'control.json'));
    } finally {
      retired.resolve(null);
      await observed;
      await rm(home, { recursive: true, force: true });
    }
  });
}

test('multiple failures aggregate in sorted order only after safe later retirement', { timeout: 3000 }, async () => {
  const t = fifo(), first = new Error('first identity unreadable'), second = new Error('second signal refused');
  const reached = deferred(), retired = deferred(), signals = [], identities = [];
  let healthyReads = 0;
  const home = await attachedScratch(t, {
    identity: async pid => {
      identities.push(pid);
      if (pid === 101) throw first;
      if (pid === 102) return 'owned-start';
      if (++healthyReads === 1) return 'owned-start';
      reached.resolve();
      return retired.promise;
    },
    signal: (pid, sig) => { signals.push([pid, sig]); if (pid === 102) throw second; },
  });
  for (const n of [3, 2, 1]) await record(home, { pid: 100 + n }, `att_000000000000000${n}`);
  let settled = false;
  const observed = t.hooks[0]().then(() => null, error => error).finally(() => { settled = true; });
  try {
    assert.equal(await Promise.race([reached.promise.then(() => true), observed.then(() => false)]), true);
    assert.equal(settled, false);
    retired.resolve(null);
    const failure = await observed;
    assert.ok(failure instanceof AggregateError);
    assert.deepEqual(failure.errors, [first, second]);
    assert.equal(failure.errors[0], first);
    assert.equal(failure.errors[1], second);
    assert.deepEqual(identities, [101, 102, 103, 103]);
    assert.deepEqual(signals, [[102, 'SIGKILL'], [103, 'SIGKILL']]);
    for (const n of [1, 2, 3]) await access(join(home, 'attached', `att_000000000000000${n}`, 'control.json'));
  } finally {
    retired.resolve(null);
    await observed;
    await rm(home, { recursive: true, force: true });
  }
});

test('identity change after the exact signal retains evidence without signaling replacement', async () => {
  const t = fifo(), signals = [];
  let reads = 0;
  const home = await attachedScratch(t, {
    identity: async () => ++reads === 1 ? 'owned-start' : 'replacement-start',
    signal: (...args) => signals.push(args),
  });
  const file = await record(home);
  try {
    await assert.rejects(t.hooks[0](), /identity changed/);
    assert.deepEqual(signals, [[123456, 'SIGKILL']]);
    await access(file);
  } finally { await rm(home, { recursive: true, force: true }); }
});
