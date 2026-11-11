import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { startIndependentIngress } from '../../harness/independent-ingress.mjs';
import { startDummy } from '../../harness/dummy-server.mjs';
import { probe } from '../../harness/probe.mjs';
import { processIdentity } from '../../packages/gozar-node/journal.mjs';

test('independent ingress retains its own process and target until its owner changes them', async () => {
  // Fixture process only: no provider command, outside observation or TLS evidence.
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'independent-ingress-fixture-'));
  const first = await startDummy(), second = await startDummy();
  let ingress, before;
  try {
    ingress = await startIndependentIngress({ directory, target: first.origin, recipe: {
      program: process.execPath, args: ['-e', "console.log('https://fixture.invalid');setInterval(()=>{},1000)"], timeoutMs: 2000, maxOutputBytes: 4096,
      parser: { constraints: { hostnamePattern: '^fixture\\.invalid$' } },
    } });
    before = await ingress.snapshot();
    assert.throws(() => ingress.retarget('http://fixture.invalid'), /127.0.0.1/);
    await probe({ origin: before.localOrigin, nonce: first.nonce });
    assert.deepEqual(await ingress.snapshot(), before);
    ingress.retarget(second.origin);
    await probe({ origin: before.localOrigin, nonce: second.nonce });
    const after = await ingress.snapshot();
    assert.equal(after.target, second.origin); assert.equal(after.pid, before.pid); assert.equal(after.startIdentity, before.startIdentity);
    assert.equal(after.knownHosts, before.knownHosts);
  } finally {
    if (ingress) await ingress.close();
    await first.close(); await second.close();
    await rm(directory, { recursive: true, force: true });
  }
  assert.notEqual(await processIdentity(before.pid), before.startIdentity);
  await assert.rejects(fetch(before.localOrigin, { signal: AbortSignal.timeout(1000) }));
});
