import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePublicRelayCandidate } from '../../harness/public-relay-diagnostic.mjs';

test('failed candidate diagnostic records public pin, HTTP status, headers and body without passing the route', async () => {
  // Synthetic transport response exercises diagnostic recording, never a real relay proof.
  const origin = 'https://fixture.invalid';
  let requested;
  const transport = { resolver: 'https://1.1.1.1/dns-query', publicDns: true, resolvedIp: '8.8.8.8', tlsServername: 'fixture.invalid', evidence: [{ status: 502, resolvedIp: '8.8.8.8' }], request: async value => { requested = value; return new Response('no tunnel', { status: 502, headers: { server: 'fixture-relay' } }); } };
  const result = await diagnosePublicRelayCandidate({ origin, serviceNonce: 'nonce' }, { createTransport: async () => transport });
  assert.equal(requested, origin + '/identity'); assert.equal(result.status, 502); assert.equal(result.body, 'no tunnel');
  assert.equal(result.headers.server, 'fixture-relay'); assert.equal(result.resolvedIp, '8.8.8.8');
  assert.equal(result.result, 'diagnostic-only'); assert.equal(result.outsideProof, false); assert.equal(result.identityMatched, false);
  assert.equal(result.identityKind, 'harness-service-through-gozar-gate');
});

test('diagnostic bounds response bytes and uses an actual supplied gate challenge without claiming success', async () => {
  const createTransport = async () => ({ evidence: [], request: async url => {
    assert.equal(url, 'https://fixture.invalid/.gozar-test/identity');
    return new Response('x'.repeat(5000), { status: 502 });
  } });
  const result = await diagnosePublicRelayCandidate({ origin: 'https://fixture.invalid', gateChallenge: { identityPath: '/.gozar-test/identity', nonce: 'gate' } }, { createTransport });
  assert.equal(Buffer.byteLength(result.body), 4096); assert.equal(result.bodyTruncated, true); assert.equal(result.identityKind, 'gozar-gate');
  assert.equal(result.result, 'diagnostic-only'); assert.equal(result.outsideProof, false);
});
