import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDrop1aReceipt } from '../../harness/drop1a-receipt.mjs';

test('Drop1a receipt requires exact actual gate challenge, tool result, timed delivery and trusted job identity', () => {
  // Synthetic validator fixture; never an outside execution receipt.
  const now = Date.now();
  const request = { origin: 'https://fixture.invalid', vantage: 'public', authorization: { nonceRef: 'nonce-ref', verifierRef: 'verifier-ref', expiresAtMs: now + 30_000 }, challenge: { nonce: 'gate-nonce' } };
  const context = { executorId: 'fixture-executor', serviceNonce: 'service-nonce', toolEcho: 'fresh-echo', nowMs: now };
  const envelope = { executorId: context.executorId, jobId: 'synthetic-validator-job', probeReceipt: { ...request.authorization, origin: request.origin, vantage: 'public', remote: true, tls: true, instanceMatched: true, sse: true, streamableHttp: true, observedAtMs: now - 10, expiresAtMs: now + 1000 },
    observations: { origin: request.origin, authorization: request.authorization, startedAt: now - 1000, finishedAt: now - 100,
      gate: { identityMatched: true, events: [0, 1, 2].map((sequence, index) => ({ nonce: 'gate-nonce', sequence, receivedAt: now - 900 + index * 150 })) },
      service: { origin: request.origin, nonce: context.serviceNonce, vantage: 'local', executorId: 'local-node', issuedAt: now - 1000, startedAt: now - 900, finishedAt: now - 100, tls: true, identity: true, mcp: true, toolCall: true, toolResult: { nonce: context.serviceNonce, echo: context.toolEcho },
        events: [{ nonce: context.serviceNonce, sequence: 1, timestamp: now - 800, receivedAt: now - 700 }, { nonce: context.serviceNonce, sequence: 2, timestamp: now - 500, receivedAt: now - 400 }] } } };
  validateDrop1aReceipt(envelope, request, context);
  const bad = mutate => { const copy = structuredClone(envelope); mutate(copy); assert.throws(() => validateDrop1aReceipt(copy, request, context)); };
  bad(value => { value.jobId = ''; });
  bad(value => { value.probeReceipt.nonceRef = 'old'; });
  bad(value => { value.observations.gate.events[1].nonce = 'wrong-instance'; });
  bad(value => { value.observations.gate.events[1].receivedAt = value.observations.gate.events[0].receivedAt; });
  bad(value => { value.observations.service.toolCall = false; });
  bad(value => { value.observations.service.toolResult.echo = 'wrong-echo'; });
  // Synthetic LAN evidence is HTTP only; it cannot relax public or tailnet TLS.
  const lanRequest = { ...request, origin: 'http://192.0.2.10:12345', vantage: 'lan', requirements: { httpsRequired: false } };
  const lan = structuredClone(envelope);
  lan.probeReceipt.origin = lan.observations.origin = lan.observations.service.origin = lanRequest.origin;
  lan.probeReceipt.vantage = 'lan'; lan.probeReceipt.tls = lan.observations.service.tls = false;
  validateDrop1aReceipt(lan, lanRequest, context);
  for (const vantage of ['public', 'tailnet']) assert.throws(() => validateDrop1aReceipt(lan, { ...lanRequest, vantage }, context), /LAN/);
  assert.throws(() => validateDrop1aReceipt(lan, { ...lanRequest, requirements: {} }, context), /LAN/);
});
