import test from 'node:test';
import assert from 'node:assert/strict';
import { createProbeChallenge, executeTrustedProbe } from '../../harness/probe-receipt.mjs';
import { probe } from '../../harness/probe.mjs';
import { startDummy } from '../../harness/dummy-server.mjs';

test('fresh challenge labels alone cannot manufacture an external executor capability', async () => {
  const challenge = createProbeChallenge({ origin: 'https://proof.invalid', nonce: 'fixture', vantage: 'public', executorId: 'fixture-executor' });
  await assert.rejects(executeTrustedProbe(challenge, { identity: challenge.executorId, vantage: 'public', remote: true }), /capability/);
  await assert.rejects(executeTrustedProbe(challenge, { identity: challenge.executorId, vantage: 'public', execute() {} }), /remote/);
});

test('actual plain HTTP/MCP/timed SSE receipt cannot be promoted to public TLS', async () => {
  const server = await startDummy();
  try {
    const challenge = createProbeChallenge({ origin: server.origin, nonce: server.nonce, vantage: 'public', executorId: 'claimed-fixture-executor' });
    const receipt = await probe(challenge);
    assert.equal(receipt.tls, false); assert.equal(receipt.vantage, 'local');
    await assert.rejects(executeTrustedProbe(challenge, { identity: challenge.executorId, vantage: 'public', remote: true, execute: async () => receipt }), /vantage/);
  } finally { await server.close(); }
});

test('receipt conversion binds exact nonce/verifier/origin, expiry, remote execution and protocol observations', async () => {
  // Synthetic validator evidence only: this test never claims a real outside observation.
  const now = Date.now();
  const challenge = createProbeChallenge({ origin: 'https://fixture.invalid', nonce: 'fixture', vantage: 'public', executorId: 'fixture-job', nowMs: now - 1000 });
  const receipt = { ...challenge, remote: true, startedAt: now - 900, finishedAt: now - 100,
    observedAtMs: now - 100, expiresAtMs: now + 1000, tls: true, identity: true, mcp: true, toolCall: true, toolResult: { nonce: challenge.nonce, echo: challenge.toolEcho },
    events: [{ nonce: 'fixture', sequence: 1, timestamp: now - 800, receivedAt: now - 700 }, { nonce: 'fixture', sequence: 2, timestamp: now - 500, receivedAt: now - 400 }] };
  const capability = { identity: 'fixture-job', vantage: 'public', remote: true, execute: async () => receipt };
  const result = await executeTrustedProbe(challenge, capability);
  assert.equal(result.probeReceipt.remote, true); assert.equal(result.probeReceipt.sse, true); assert.equal(result.probeReceipt.oauthDcr, false);
  for (const patch of [{ nonceRef: 'stale' }, { verifierRef: 'other' }, { remote: false }, { expiresAtMs: now - 1 }, { origin: 'https://wrong.invalid' }]) {
    await assert.rejects(executeTrustedProbe(challenge, { ...capability, execute: async () => ({ ...receipt, ...patch }) }));
  }
});
