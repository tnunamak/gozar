import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export function validateLifetimeMs(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) throw new Error('lifetimeMs must be an integer in 1..2147483647');
  return value;
}

// Forwarding headers an inbound request may carry. The gate never passes them on: whatever a client or an
// intermediary wrote there is not evidence. It writes one normalised header of its own instead.
export const STRIPPED_FORWARDING_HEADERS = Object.freeze(['x-forwarded-for', 'forwarded', 'x-real-ip']);
export const NORMALISED_HEADER = 'x-forwarded-for';

export async function createGate(targetPort, { lifetimeMs = 900_000, onExpire = () => {} } = {}) {
  validateLifetimeMs(lifetimeMs);
  let secretPath = `/.gozar-${randomBytes(24).toString('hex')}`;
  let nonce = randomBytes(32).toString('hex');
  let nonceRef = randomUUID(), verifierRef = randomUUID();
  const sockets = new Set();
  let open = true, closePromise;
  const server = http.createServer((request, response) => {
    if (!open) { response.writeHead(503); response.end(); return; }
    if (request.url === `${secretPath}/identity`) {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ nonce })); return;
    }
    if (request.url === `${secretPath}/stream`) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      response.flushHeaders();
      let sequence = 0;
      const send = () => {
        response.write(`data: ${JSON.stringify({ nonce, sequence: sequence++ })}\n\n`);
        if (sequence === 3) { clearInterval(timer); response.end(); }
      };
      const timer = setInterval(send, 1000); send(); // Stay above short batching intervals; full-response buffering still fails verification.
      response.on('close', () => clearInterval(timer)); return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${targetPort}` };
    for (const name of STRIPPED_FORWARDING_HEADERS) delete headers[name];
    // The only address the gate knows is its own peer; the app learns that one value and nothing a client wrote.
    headers[NORMALISED_HEADER] = String(request.socket.remoteAddress ?? '').replace(/^::ffff:/i, '');
    const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, method: request.method, path: request.url, headers }, result => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy()); response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const matches = value => typeof value === 'string' && value.length === nonce.length && timingSafeEqual(Buffer.from(value), Buffer.from(nonce));
  const expiresAtMs = Date.now() + lifetimeMs;
  const deadline = setTimeout(() => { open = false; for (const socket of sockets) socket.destroy(); onExpire(); }, lifetimeMs);
  deadline.unref();
  return {
    port, lifetimeMs, expiresAtMs, target: `http://127.0.0.1:${port}`,
    get nonceRef() { return nonceRef; }, get verifierRef() { return verifierRef; },
    // The snapshot an Ingress is built from: which header the gate writes and which it strips.
    // The gate-to-app hop is loopback TCP, which proves nothing about the sender, so no boundary is claimed here.
    forwarding: Object.freeze({ header: Object.freeze({ name: NORMALISED_HEADER, format: 'ip-list', sanitization: 'strip-inbound-and-write',
      selection: 'rightmost-untrusted', trustedHops: 0 }), stripped: STRIPPED_FORWARDING_HEADERS }),
    challenge() { return { identityPath: `${secretPath}/identity`, streamPath: `${secretPath}/stream`, nonce }; },
    rotate() {
      secretPath = `/.gozar-${randomBytes(24).toString('hex')}`; nonce = randomBytes(32).toString('hex');
      nonceRef = randomUUID(); verifierRef = randomUUID();
      return { nonceRef, verifierRef };
    },
    // `fetchImpl` is a test seam: the global fetch is the only one production uses.
    async verify(origin, { sse = false, signal, fetch: fetchImpl = fetch } = {}) {
      const identity = await fetchImpl(`${origin}${secretPath}/identity`, { redirect: 'error', signal });
      if (!identity.ok || !identity.headers.get('content-type')?.startsWith('application/json')) throw new Error('Instance identity endpoint unavailable');
      const reader = identity.body.getReader();
      let body = '';
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          if (Buffer.byteLength(body) + value.length > 1024) throw new Error('Identity probe output limit exceeded');
          body += new TextDecoder().decode(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      let identityValue;
      try { identityValue = JSON.parse(body); } catch { throw new Error('Invalid instance proof response'); }
      if (body.length > 1024 || !matches(identityValue.nonce)) throw new Error('Origin points to a different instance');
      let streaming = false;
      if (sse) {
        const response = await fetchImpl(`${origin}${secretPath}/stream`, { redirect: 'error', signal, headers: { accept: 'text/event-stream' } });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Timed SSE endpoint unavailable');
        const reader = response.body.getReader();
        let buffer = '', bytes = 0, sequence = 0, lastAt;
        try {
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.length;
            if (bytes > 4096) throw new Error('Timed SSE output limit exceeded');
            buffer += new TextDecoder().decode(chunk.value, { stream: true });
            while (buffer.includes('\n\n')) {
              const split = buffer.indexOf('\n\n'), frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
              if (!frame.startsWith('data: ')) throw new Error('Unexpected SSE frame');
              let event;
              try { event = JSON.parse(frame.slice(6)); } catch { throw new Error('Invalid timed SSE proof frame'); }
              const at = performance.now();
              if (!matches(event.nonce) || event.sequence !== sequence++ || (lastAt !== undefined && at - lastAt < 80)) throw new Error('Timed SSE frames buffered or instance changed');
              lastAt = at;
            }
          }
          streaming = sequence === 3;
          if (!streaming) throw new Error('Timed SSE sequence incomplete');
        } finally { await reader.cancel().catch(() => {}); }
      }
      return { tls: new URL(origin).protocol === 'https:', instanceMatched: true, sse: streaming, streaming,
        streamableHttp: false, oauthDcr: false };
    },
    close() {
      if (closePromise) return closePromise;
      open = false; clearTimeout(deadline);
      closePromise = new Promise(resolve => server.once('close', resolve)); server.close();
      for (const socket of sockets) socket.destroy();
      return closePromise;
    },
  };
}
