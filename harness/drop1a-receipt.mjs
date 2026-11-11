import assert from 'node:assert/strict';
import { validateReceipt } from './probe.mjs';

// Invoke only on a result delivered by the explicitly configured trusted external executor.
export function validateDrop1aReceipt(envelope, request, { serviceNonce, toolEcho, executorId, nowMs = Date.now() }) {
  assert.ok(executorId && executorId !== 'local-node', 'known executor identity required');
  assert.equal(envelope.executorId, executorId);
  assert.ok(typeof envelope.jobId === 'string' && envelope.jobId.length > 0, 'trusted external job identity required');
  const receipt = envelope.probeReceipt, observed = envelope.observations;
  assert.equal(receipt?.origin, request.origin);
  assert.equal(receipt.nonceRef, request.authorization.nonceRef); assert.equal(receipt.verifierRef, request.authorization.verifierRef);
  assert.equal(receipt.vantage, request.vantage); assert.equal(receipt.remote, true);
  assert.equal(receipt.tls, true); assert.equal(receipt.instanceMatched, true); assert.equal(receipt.sse, true); assert.equal(receipt.streamableHttp, true);
  assert.ok(receipt.observedAtMs >= observed.finishedAt && receipt.observedAtMs <= nowMs + 5000);
  assert.ok(receipt.expiresAtMs > nowMs && receipt.expiresAtMs <= request.authorization.expiresAtMs);
  assert.equal(observed.origin, request.origin);
  assert.equal(observed.authorization.nonceRef, request.authorization.nonceRef); assert.equal(observed.authorization.verifierRef, request.authorization.verifierRef);
  assert.equal(observed.gate.identityMatched, true);
  assert.deepEqual(observed.gate.events.map(event => event.sequence), [0, 1, 2]);
  for (let i = 0; i < 3; i++) {
    const event = observed.gate.events[i]; assert.equal(event.nonce, request.challenge.nonce);
    assert.ok(event.receivedAt >= observed.startedAt && event.receivedAt <= observed.finishedAt);
    if (i) assert.ok(event.receivedAt - observed.gate.events[i - 1].receivedAt >= 80, 'gate SSE buffered');
  }
  validateReceipt(observed.service, { origin: request.origin, nonce: serviceNonce, issuedAt: observed.startedAt, vantage: 'local', toolEcho });
  assert.ok(observed.service.finishedAt <= observed.finishedAt);
  return receipt;
}
