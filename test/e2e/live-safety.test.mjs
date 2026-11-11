import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { acquireLiveLock, assertUnusedPort, canonical } from '../../harness/live-safety.mjs';

test('fresh port check includes nested foreground TCP, web and funnel state', () => {
  for (const entry of [{ TCP: { 8443: {} } }, { Web: { 'fixture.invalid:8443': {} } }, { AllowFunnel: { 'fixture.invalid:8443': true } }]) {
    assert.throws(() => assertUnusedPort({ Foreground: { nested: entry } }, 8443), /full fresh/);
  }
  assertUnusedPort({ TCP: { 443: {} }, Foreground: { foreign: { TCP: { 10000: {} } } } }, 8443);
  assert.equal(canonical({ b: { z: 1, a: 2 }, a: 3 }), canonical({ a: 3, b: { a: 2, z: 1 } }));
});

test('live lock refuses another route until the exact owner releases it', async () => {
  const base = join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'lock-fixture-'));
  const previous = process.env.GOZAR_TEST_TMPDIR;
  process.env.GOZAR_TEST_TMPDIR = directory;
  try {
    const release = await acquireLiveLock('fixture-only');
    try { await assert.rejects(acquireLiveLock('other-fixture'), { code: 'EEXIST' }); }
    finally { await release(); }
    await (await acquireLiveLock('other-fixture'))();
  } finally {
    if (previous === undefined) delete process.env.GOZAR_TEST_TMPDIR; else process.env.GOZAR_TEST_TMPDIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
