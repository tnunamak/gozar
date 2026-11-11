import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIp } from '../../packages/gozar-node/public-relay.mjs';
import { validatePublicRelayProof } from '../../harness/public-relay-proof.mjs';

test('public-relay proof is a separate host-opted-in class and cannot self-upgrade local or remote labels', () => {
  // Synthetic receipt-shape fixture only; no network observation is claimed.
  const nowMs = Date.now();
  const authorization = { allowPublicRelay: true, nonceRef: 'fresh-nonce', verifierRef: 'verifier', expiresAtMs: nowMs + 30000 };
  const receipt = { origin: 'https://fixture.invalid', ...authorization, vantage: 'public', networkPath: 'public-relay', remote: false, publicDns: true, resolvedIp: '8.8.8.8', tls: true, instanceMatched: true, sse: true, observedAtMs: nowMs - 10, expiresAtMs: nowMs + 1000 };
  const context = { origin: receipt.origin, authorization, nowMs, isPublicIp };
  validatePublicRelayProof(receipt, context);
  assert.throws(() => validatePublicRelayProof(receipt, { ...context, authorization: { ...authorization, allowPublicRelay: false } }), /host must opt/);
  for (const patch of [{ remote: true }, { networkPath: 'local' }, { publicDns: false }, { nonceRef: 'old' }, { origin: 'https://other.invalid' }, { tls: false }, { sse: false }, { expiresAtMs: nowMs - 1 }]) assert.throws(() => validatePublicRelayProof({ ...receipt, ...patch }, context));
  for (const resolvedIp of ['100.64.0.1', '100.127.255.255', '127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.0.1', '::1', 'fc00::1', '::ffff:8.8.8.8', '192.0.2.1', '2001:db8::1']) assert.throws(() => validatePublicRelayProof({ ...receipt, resolvedIp }, context), /forbidden/);
});
