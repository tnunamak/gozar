import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routeStatus, closeRoute, unknownProperties } from '../../packages/gozar-node/route-view.mjs';

// A persisted proof is historical evidence, not a substitute for a live controller.
test('public attached recovery preserves proof history but withdraws current authority', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gozar-proof-history-'));
  const handle = { kind: 'attached', id: 'att_0123456789abcdef', generation: 1 };
  const directory = join(home, 'attached', handle.id);
  const checkedAt = '2026-01-01T00:00:00.000Z';
  const subject = { instanceId: 'host-instance', bootId: 'old-supervisor-boot',
    handleGeneration: 1, origin: 'https://example.invalid', target: '127.0.0.1:32101' };
  const lastView = {
    schemaVersion: 2, handle, state: 'usable', routeState: 'active',
    origin: subject.origin, published: subject.origin, ownership: 'gozar-owned',
    binding: { target: subject.target }, properties: unknownProperties(),
    ingress: { validUntil: '2099-01-01T00:00:00.000Z' },
    verification: { status: 'verified', checkedAt, observedAt: checkedAt,
      subject, vantage: 'this-device', checks: ['nonce', 'tls'] },
    limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null },
    cleanup: { state: 'none' },
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const bytes = JSON.stringify({ handle, phase: 'usable', lastView, adapterId: 'fixture' });
    await writeFile(join(directory, 'state.json'), bytes, { mode: 0o600 });
    // No control.json: loss is independently represented by absent controller custody.
    // No network, provider, verifier, or daemon fixture is started.
    for (let i = 0; i < 3; i++) {
      const status = await routeStatus({ home, handle });
      assert.equal(status.verification.status, 'unverified');
      assert.equal(status.published, null);
      assert.equal(status.ingress, null);
      assert.equal(status.cleanup.state, 'unconfirmed');
      assert.equal(status.verification.checkedAt, checkedAt);
      assert.equal(status.verification.observedAt, checkedAt);
      assert.deepEqual(status.verification.subject, subject);
      assert.deepEqual(status.verification.checks, []);
      assert.deepEqual(status.handle, handle);
      assert.deepEqual(status.binding, lastView.binding);
    }
    const closed = await closeRoute({ home, handle, mode: 'remove' },
      { attachedDeps: { adapters: [] } });
    assert.equal(closed.cleanup.state, 'unconfirmed');
    assert.equal(closed.verification.status, 'unverified');
    assert.deepEqual(closed.verification.subject, subject);
    assert.equal(closed.verification.observedAt, checkedAt);
    assert.equal(closed.published, null);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), bytes);
    await assert.rejects(routeStatus({ home, handle: { ...handle, generation: 2 } }),
      error => error.code === 'route_conflict');
  } finally { await rm(home, { recursive: true, force: true }); }
});
