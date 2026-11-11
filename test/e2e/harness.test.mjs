import test from 'node:test';
import assert from 'node:assert/strict';
import { startDummy } from '../../harness/dummy-server.mjs';
import { probe, validateReceipt } from '../../harness/probe.mjs';
import { runFakeEffects } from '../../harness/core-fixtures.mjs';

test('real local HTTP/MCP and unbuffered bounded SSE identify a fresh instance', async () => {
  const dummy = await startDummy(); const other = await startDummy();
  try {
    assert.notEqual(dummy.nonce, other.nonce);
    const issuedAt = Date.now();
    const receipt = await probe({ origin: dummy.origin, nonce: dummy.nonce, issuedAt, vantage: 'public', executorId: 'invented-remote' });
    assert.equal(receipt.toolCall, true); assert.equal(receipt.toolResult.nonce, dummy.nonce);
    assert.equal(receipt.executorId, 'local-node');
    assert.equal(receipt.vantage, 'local'); assert.equal(receipt.tls, false);
    assert.throws(() => validateReceipt(receipt, { origin: dummy.origin, nonce: dummy.nonce, issuedAt, vantage: 'public' }), /vantage/);
    await assert.rejects(probe({ origin: other.origin, nonce: dummy.nonce }), /wrong server instance/);
    assert.throws(() => validateReceipt({ ...receipt, events: receipt.events.map(event => ({ ...event, receivedAt: receipt.finishedAt })) }, { origin: dummy.origin, nonce: dummy.nonce, issuedAt, vantage: 'local', requireTls: false }), /buffered/);
    assert.throws(() => validateReceipt(receipt, { origin: dummy.origin, nonce: dummy.nonce, issuedAt: receipt.finishedAt + 1, vantage: 'local', requireTls: false }), /challenge/);
    assert.throws(() => validateReceipt({ ...receipt, startedAt: issuedAt - 1 }, { origin: dummy.origin, nonce: dummy.nonce, issuedAt, vantage: 'local', requireTls: false }), /fresh/);
  } finally { await dummy.close(); await other.close(); }
  await assert.rejects(fetch(dummy.origin, { signal: AbortSignal.timeout(1000) }));
});

test('actual WASM core invariants with explicitly fake effect results', async () => {
  const result = await runFakeEffects();
  assert.equal(result.realRoute, false); assert.equal(result.outsideProof, false);
  assert.ok(result.trace.length > 10);
});

test('trusted-receipt boundary rejects origin, TLS, ordering, freshness and executor substitutions', () => {
  const now = Date.now();
  // Synthetic evidence tests the validator only; it proves no real remote route.
  const request = { origin: 'https://proof.invalid', nonce: 'fixture-nonce', issuedAt: now - 1000, vantage: 'public', executorId: 'fixture-validator-only' };
  const receipt = { ...request, executorId: 'fixture-validator-only', startedAt: now - 900, finishedAt: now,
    tls: true, identity: true, mcp: true, toolCall: true, toolResult: { nonce: request.nonce, echo: 'synthetic-validator-echo' }, events: [
      { nonce: request.nonce, sequence: 1, timestamp: now - 800, receivedAt: now - 700 },
      { nonce: request.nonce, sequence: 2, timestamp: now - 500, receivedAt: now - 400 },
    ] };
  validateReceipt(receipt, request);
  for (const patch of [{ origin: 'https://other.invalid' }, { nonce: 'stale' }, { vantage: 'local' }, { executorId: 'local-node' }, { tls: false }, { mcp: false }, { toolCall: false }, { toolResult: { nonce: 'other-instance', echo: 'echo' } }, { startedAt: now - 2000 }, { events: receipt.events.toReversed() }]) {
    assert.throws(() => validateReceipt({ ...receipt, ...patch }, request));
  }
});

test('host HTTP probe cannot claim requested public vantage from local execution', async () => {
  const { EffectDriver } = await import('../../packages/gozar-node/driver.mjs');
  const dummy = await startDummy();
  try {
    const driver = new EffectDriver({ adapters: [], journal: { directory: '.', value: { owned: {} } }, sessionId: 'vantage-regression' });
    await assert.rejects(driver.probe({ url: dummy.origin + '/identity', vantage: 'public', timeoutMs: 1000 }), error => error.code === 'needs-validation');
    const result = await driver.probe({ url: dummy.origin + '/identity', vantage: 'local', timeoutMs: 1000 });
    assert.equal(result.vantage, 'local');
    const firstEvent = await driver.probe({ url: dummy.origin + '/events', vantage: 'local', sse: true, timeoutMs: 1000 });
    assert.notEqual(firstEvent.streaming, true, 'one SSE event cannot prove timed streaming');
  } finally { await dummy.close(); }
});
