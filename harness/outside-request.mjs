// The local channel's receiptKey and requestId never cross this boundary.
export function sanitizeOutsideRequest(raw, context) {
  return {
    origin: raw.origin, vantage: raw.vantage,
    authorization: { nonceRef: raw.authorization?.nonceRef, verifierRef: raw.authorization?.verifierRef, expiresAtMs: raw.authorization?.expiresAtMs },
    challenge: { identityPath: raw.challenge?.identityPath, streamPath: raw.challenge?.streamPath, nonce: raw.challenge?.nonce },
    requirements: { httpsRequired: raw.requirements?.httpsRequired !== false, sse: raw.requirements?.sse === true, streamableHttp: raw.requirements?.streamableHttp === true, oauthDcr: raw.requirements?.oauthDcr === true },
    serviceNonce: context.serviceNonce, toolEcho: context.toolEcho,
  };
}
