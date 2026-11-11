import assert from 'node:assert/strict';

// Receipt shape validation. Socket/DNS authority comes from the actual Node host transport.
export function validatePublicRelayProof(receipt, { origin, authorization, isPublicIp, nowMs = Date.now() }) {
  assert.equal(authorization?.allowPublicRelay, true, 'trusted host must opt into this proof class');
  assert.equal(typeof isPublicIp, 'function', 'use the host public-address classifier');
  assert.equal(receipt?.origin, origin); assert.equal(new URL(origin).protocol, 'https:');
  assert.equal(receipt.nonceRef, authorization.nonceRef); assert.equal(receipt.verifierRef, authorization.verifierRef);
  assert.equal(receipt.vantage, 'public'); assert.equal(receipt.networkPath, 'public-relay');
  assert.equal(receipt.remote, false, 'public relay path is not remote execution'); assert.equal(receipt.publicDns, true);
  assert.equal(isPublicIp(receipt.resolvedIp), true, 'private, CGNAT, loopback and reserved addresses are forbidden');
  assert.equal(receipt.tls, true); assert.equal(receipt.instanceMatched, true); assert.equal(receipt.sse, true);
  assert.ok(receipt.observedAtMs <= nowMs && receipt.expiresAtMs > nowMs && receipt.expiresAtMs <= authorization.expiresAtMs, 'fresh scoped relay proof required');
  return receipt;
}
