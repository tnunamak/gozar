import { createPublicRelayTransport } from '../packages/gozar-node/public-relay.mjs';

// Negative evidence only. This never approves a core origin or claims a passed route.
export async function diagnosePublicRelayCandidate({ origin, serviceNonce, gateChallenge }, { createTransport = createPublicRelayTransport } = {}) {
  const report = { origin, networkPath: 'public-relay', remote: false, outsideProof: false, result: 'diagnostic-only', recordedAtMs: Date.now() };
  let transport;
  try {
    transport = await createTransport(origin, { timeoutMs: 5000 });
    Object.assign(report, { resolver: transport.resolver, publicDns: transport.publicDns, resolvedIp: transport.resolvedIp, tlsServername: transport.tlsServername });
    const path = gateChallenge?.identityPath ?? '/identity';
    report.identityKind = gateChallenge ? 'gozar-gate' : 'harness-service-through-gozar-gate';
    const expectedNonce = gateChallenge?.nonce ?? serviceNonce;
    const response = await transport.request(origin + path, { maxResponseBytes: 8192 });
    report.status = response.status;
    report.headers = Object.fromEntries(response.headers.entries());
    let body = Buffer.alloc(0);
    try {
      for await (const chunk of response.body) {
        const remaining = 4096 - body.length;
        body = Buffer.concat([body, Buffer.from(chunk).subarray(0, remaining)]);
        if (chunk.length > remaining) { report.bodyTruncated = true; break; }
      }
    } catch (error) { report.bodyError = error.message; }
    report.body = body.toString('utf8');
    try { report.identityMatched = response.status === 200 && typeof expectedNonce === 'string' && expectedNonce.length > 0 && JSON.parse(report.body).nonce === expectedNonce; }
    catch { report.identityMatched = false; }
    if (!gateChallenge) report.gateNonceLimitation = 'CLI did not expose its private gate challenge; the observed nonce belongs to the harness service.';
  } catch (error) { report.error = error.message; }
  if (transport) report.requests = transport.evidence;
  return report;
}
