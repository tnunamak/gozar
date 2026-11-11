import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeOutsideRequest } from '../../harness/outside-request.mjs';
test('remote observer input whitelists fields and excludes local MAC key even when nested', () => {
  const secret = 'LOCAL-MAC-KEY-MUST-NOT-LEAVE';
  const request = sanitizeOutsideRequest({ origin: 'https://fixture.invalid', vantage: 'public', requestId: 'private-id', receiptKey: secret,
    authorization: { nonceRef: 'n', verifierRef: 'v', expiresAtMs: 1000, receiptKey: secret }, challenge: { nonce: 'gate', identityPath: '/i', streamPath: '/s', private: secret }, requirements: { sse: true, streamableHttp: true, receiptKey: secret } },
    { serviceNonce: 'service', toolEcho: 'echo', receiptKey: secret });
  assert.ok(!JSON.stringify(request).includes(secret)); assert.ok(!JSON.stringify(request).includes('receiptKey')); assert.ok(!JSON.stringify(request).includes('private-id'));
  assert.deepEqual(Object.keys(request).sort(), ['authorization', 'challenge', 'origin', 'requirements', 'serviceNonce', 'toolEcho', 'vantage']);
});

test('actual remote script bundler preserves the local private request and excludes its MAC key', async () => {
  const { mkdir, mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { homedir } = await import('node:os'); const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url'); const { command } = await import('../../harness/process.mjs');
  const base = (process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gz-bundle-'));
  try {
    const secret = 'PRIVATE-MAC-KEY-FIXTURE';
    const privatePath = join(directory, 'private.request.json');
    const raw = { origin: 'https://127.0.0.1:1', vantage: 'public', receiptKey: secret, requestId: 'local-private-id', authorization: { nonceRef: 'n', verifierRef: 'v', expiresAtMs: Date.now() + 30000 }, challenge: { nonce: 'gate', identityPath: '/.gozar-x/identity', streamPath: '/.gozar-x/stream' }, requirements: { sse: true, streamableHttp: true } };
    await writeFile(privatePath, JSON.stringify(raw), { mode: 0o600 });
    await writeFile(join(directory, 'service-context.json'), JSON.stringify({ serviceNonce: 'service', toolEcho: 'echo' }));
    const built = await command(process.execPath, [fileURLToPath(new URL('../../harness/make-outside-probe.mjs', import.meta.url)), directory, privatePath]);
    assert.equal(built.code, 0, built.stderr);
    const script = await readFile(join(directory, 'outside-probe.mjs'), 'utf8');
    const sanitized = await readFile(join(directory, 'probe-request.json'), 'utf8');
    for (const value of [script, sanitized, built.stdout]) { assert.ok(!value.includes(secret)); assert.ok(!value.includes('local-private-id')); }
    assert.equal(JSON.parse(await readFile(privatePath, 'utf8')).receiptKey, secret);
    assert.equal((await command(process.execPath, ['--check', join(directory, 'outside-probe.mjs')])).code, 0);
    const isolated = await mkdtemp(join(base, 'gz-standalone-'));
    try {
      const isolatedPath = join(isolated, 'observer.mjs'); await writeFile(isolatedPath, script);
      const executed = await command(process.execPath, [isolatedPath], { timeoutMs: 5000 });
      assert.equal(executed.code, 1); assert.match(executed.stderr, /fetch failed/);
      assert.doesNotMatch(executed.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
      assert.ok(script.split('\n').filter(line => line.startsWith('import ')).every(line => line.includes("'node:")));
    } finally { await rm(isolated, { recursive: true, force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
