import assert from 'node:assert/strict';
import { createPinnedPublicRequest, isPublicIp } from '../packages/gozar-node/public-relay.mjs';
import { validatePublicRelayProof } from './public-relay-proof.mjs';
import { probe } from './probe.mjs';

export async function verifyPublicRelayService({ origin, serviceNonce, toolEcho, toolName, validation, authorization }) {
  const receipt = validation?.probeReceipt;
  validatePublicRelayProof(receipt, { origin, authorization, isPublicIp });
  assert.equal(receipt.tlsServername, new URL(origin).hostname);
  assert.ok(receipt.resolver?.startsWith('https:'), 'record the pinned public resolver');
  const request = createPinnedPublicRequest({ origin, resolvedIp: receipt.resolvedIp, timeoutMs: 10000 });
  try {
    const service = await probe({ origin, nonce: serviceNonce, toolEcho, toolName, request });
    assert.ok(request.evidence.length >= 5, 'identity, initialize, tool list/call and stream must all cross the public pin');
    for (const item of request.evidence) {
      assert.equal(item.resolvedIp, receipt.resolvedIp); assert.equal(isPublicIp(item.resolvedIp), true);
      assert.equal(item.tlsServername, new URL(origin).hostname); assert.equal(item.status, 200);
      assert.match(item.tlsProtocol, /^TLS/);
    }
    return { networkPath: 'public-relay', remote: false, publicDns: true, resolver: receipt.resolver,
      resolvedIp: receipt.resolvedIp, tlsServername: receipt.tlsServername, gateProof: receipt,
      service, requests: request.evidence, relayHeaders: request.evidence.map(item => item.relayHeaders) };
  } catch (error) {
    error.publicRelayEvidence = { networkPath: 'public-relay', remote: false, publicDns: true, resolver: receipt.resolver,
      resolvedIp: receipt.resolvedIp, tlsServername: receipt.tlsServername, requests: request.evidence };
    throw error;
  }
}
