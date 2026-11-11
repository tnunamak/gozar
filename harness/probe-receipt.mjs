import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateReceipt } from './probe.mjs';

export function createProbeChallenge({ origin, nonce, vantage, executorId, nowMs = Date.now(), lifetimeMs = 30_000 }) {
  assert.equal(new URL(origin).origin, origin);
  assert.ok(['public', 'tailnet', 'lan', 'local'].includes(vantage));
  assert.ok(Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= 60_000);
  return { origin, nonce, vantage, executorId, toolEcho: randomUUID(), issuedAt: nowMs, nonceRef: `nonce:${randomUUID()}`,
    verifierRef: `verifier:${randomUUID()}`, expiresAtMs: nowMs + lifetimeMs };
}

// Only the caller holding this explicit executor capability may submit remote observations.
// This is a trusted transport interface, not proof that a supplied program runs remotely.
export async function executeTrustedProbe(challenge, capability, { now = Date.now, requireTls = true } = {}) {
  assert.ok(capability && typeof capability.execute === 'function', 'explicit trusted executor capability required');
  assert.equal(capability.identity, challenge.executorId, 'known executor identity mismatch');
  assert.equal(capability.vantage, challenge.vantage);
  if (challenge.vantage !== 'local') assert.equal(capability.remote, true, 'actual remote executor required');
  assert.ok(now() < challenge.expiresAtMs, 'probe challenge expired');
  const receipt = await capability.execute(Object.freeze({ ...challenge }));
  validateReceipt(receipt, { ...challenge, requireTls });
  assert.equal(receipt.nonceRef, challenge.nonceRef); assert.equal(receipt.verifierRef, challenge.verifierRef);
  assert.equal(receipt.remote, challenge.vantage !== 'local');
  assert.ok(receipt.observedAtMs >= challenge.issuedAt && receipt.observedAtMs <= now());
  assert.ok(receipt.expiresAtMs > now() && receipt.expiresAtMs <= challenge.expiresAtMs);
  return { receipt, probeReceipt: { nonceRef: challenge.nonceRef, verifierRef: challenge.verifierRef,
    origin: challenge.origin, vantage: challenge.vantage, remote: receipt.remote,
    observedAtMs: receipt.observedAtMs, expiresAtMs: receipt.expiresAtMs, tls: receipt.tls,
    instanceMatched: receipt.identity === true, sse: true, streamableHttp: receipt.mcp === true, oauthDcr: receipt.oauthDcr === true } };
}
