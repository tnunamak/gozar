// Initial route proof over a constant forwarding gate. There is deliberately no refresh():
// switching an already published TLS listener to a proof service would intercept app traffic.
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
});
const closeServer = server => new Promise(resolve => server.close(resolve));
const port = server => server.address().port;
export function streamAddress(value, scheme) {
  try {
    const url = new URL(value.includes('://') ? value : `tcp://${value}`);
    if ((scheme && url.protocol !== `${scheme}:`) || !url.hostname || !url.port || url.username || url.password ||
        !['', '/'].includes(url.pathname) || url.search || url.hash) return null;
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port), origin: `${url.protocol}//${url.host}` };
  } catch { return null; }
}

// A fresh key is never sent to ngrok or stored as user configuration. Only this initial
// proof server uses it; the app's subsequent TLS bytes pass through untouched.
export async function ephemeralProofCertificate() {
  const directory = await mkdtemp(join(tmpdir(), 'gozar-proof-'));
  try {
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'),
      '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=Gozar synthetic route proof'], { timeout: 5000, maxBuffer: 32768 });
    return { key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function hasProofCertificateTool() {
  try { await run('openssl', ['version'], { timeout: 2000, maxBuffer: 4096 }); return true; } catch { return false; }
}

export async function prepareStreamProof(ctx, request, initialAttempt, { transport, certificate = ephemeralProofCertificate } = {}) {
  const target = streamAddress(request.target);
  if (!target || !['tcp', 'tls'].includes(transport) || typeof initialAttempt?.id !== 'string' || !initialAttempt.id ||
      typeof initialAttempt.nonce !== 'string' || !initialAttempt.nonce || Buffer.byteLength(initialAttempt.nonce) > 256 ||
      !Number.isFinite(initialAttempt.deadlineMs) || initialAttempt.deadlineMs <= ctx.now() || initialAttempt.signal?.aborted) throw new Error('Invalid stream proof request');
  const credentials = transport === 'tls' ? await certificate() : null;
  if (initialAttempt.signal?.aborted || initialAttempt.deadlineMs <= ctx.now()) throw new Error('Stream proof was cancelled or expired');
  const pinned = credentials ? new X509Certificate(credentials.cert).fingerprint256 : null;
  let closed = false, used = false, active = null, closing;
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; };
  const gate = net.createServer({ allowHalfOpen: true }, socket => {
    track(socket);
    if (active) {
      // During the unpublished initial proof only, new streams go to the echo listener.
      const upstream = track(net.connect({ host: '127.0.0.1', port: active.port }));
      socket.pipe(upstream).pipe(socket);
      upstream.once('error', () => socket.destroy()); socket.once('close', () => upstream.destroy());
    } else {
      const upstream = track(net.connect(target));
      socket.pipe(upstream).pipe(socket);
      upstream.once('error', () => socket.destroy()); socket.once('close', () => upstream.destroy());
    }
  });
  await listen(gate);
  const close = () => closing ??= (async () => {
    closed = true;
    initialAttempt.signal?.removeEventListener('abort', onAbort);
    active?.cancel();
    for (const socket of sockets) socket.destroy();
    await closeServer(gate);
  })();
  const onAbort = () => { void close(); };
  initialAttempt.signal?.addEventListener('abort', onAbort, { once: true });
  if (initialAttempt.signal?.aborted) { await close(); throw new Error('Stream proof was cancelled'); }

  return {
    target: `127.0.0.1:${port(gate)}`,
    close,
    async verify({ origin, receipt, attempt }) {
      const checkedAt = () => new Date(ctx.now()).toISOString();
      const result = (okay, facts = []) => ({ status: okay ? 'verified' : 'unverified', checkedAt: checkedAt(),
        attemptId: attempt?.id, endpoint: origin, vantage: 'public',
        checks: okay ? (transport === 'tls' ? ['tls', 'nonce'] : ['nonce']) : [], facts });
      const endpoint = streamAddress(origin, transport);
      if (used || closed || !endpoint || endpoint.origin !== origin || receipt?.origin !== origin ||
          receipt?.readback?.target !== request.target || attempt?.id !== initialAttempt.id ||
          attempt?.nonce !== initialAttempt.nonce || attempt.signal?.aborted || attempt.deadlineMs <= ctx.now()) return result(false);
      used = true;
      const expected = Buffer.from(`GOZAR-PROOF/1 ${attempt.nonce}\n`);
      let witnessed = false;
      const proofSockets = new Set();
      const echo = socket => {
        proofSockets.add(socket); socket.on('error', () => {}); socket.once('close', () => proofSockets.delete(socket));
        let bytes = Buffer.alloc(0);
        socket.setTimeout(3000, () => socket.destroy());
        socket.on('data', chunk => {
          if (chunk.length > expected.length - bytes.length) return socket.destroy();
          bytes = Buffer.concat([bytes, chunk]);
          if (bytes.length > expected.length || !expected.subarray(0, bytes.length).equals(bytes)) return socket.destroy();
        });
        socket.on('end', () => {
          if (bytes.equals(expected)) { witnessed = true; socket.end(expected); }
          else socket.destroy();
        });
      };
      const server = transport === 'tls' ? tls.createServer({ ...credentials, allowHalfOpen: true }, echo) : net.createServer({ allowHalfOpen: true }, echo);
      // TLS's secure-connection callback excludes peers stalled in the handshake.
      // Track raw accepted sockets too so teardown cannot wait forever for those peers.
      server.on('connection', socket => { proofSockets.add(socket); socket.once('close', () => proofSockets.delete(socket)); });
      server.on('tlsClientError', () => {});
      let socket, timer, abort, cancel, passed = false, peer;
      try {
        await listen(server);
        if (closed || attempt.signal?.aborted) return result(false);
        const response = new Promise(resolve => {
          let done = false, bytes = Buffer.alloc(0);
          cancel = () => finish(false);
          const finish = okay => { if (!done) { done = true; resolve(okay); } };
          active = { port: port(server), cancel };
          timer = setTimeout(cancel, Math.max(1, Math.min(5000, attempt.deadlineMs - ctx.now())));
          abort = cancel;
          attempt.signal?.addEventListener('abort', abort, { once: true });
          const connected = () => {
            if (transport === 'tls') {
              peer = socket.getPeerCertificate();
              if (peer.fingerprint256 !== pinned) return finish(false);
            }
            socket.end(expected);
          };
          socket = transport === 'tls' ? tls.connect({ ...endpoint, ...(net.isIP(endpoint.host) ? {} : { servername: endpoint.host }), rejectUnauthorized: false }, connected)
            : net.connect(endpoint, connected);
          socket.on('error', cancel);
          socket.on('data', chunk => {
            if (chunk.length > expected.length - bytes.length) return finish(false);
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length > expected.length || !expected.subarray(0, bytes.length).equals(bytes)) finish(false);
          });
          socket.on('end', () => finish(bytes.equals(expected) && witnessed));
          socket.on('close', () => finish(false));
          if (closed || attempt.signal?.aborted) cancel();
        });
        passed = await response;
      } catch { passed = false; }
      finally {
        // Restore the configured target BEFORE returning success. Never change the SDK route.
        active = null; clearTimeout(timer); attempt.signal?.removeEventListener('abort', abort);
        socket?.destroy(); for (const accepted of proofSockets) accepted.destroy();
        await closeServer(server);
      }
      passed = passed && !closed && !attempt.signal?.aborted && attempt.deadlineMs > ctx.now();
      const facts = passed && peer ? [
        { id: 'proof-certificate-subject', label: 'Synthetic proof certificate subject', value: JSON.stringify(peer.subject), known: true, group: 'verification', affectsConsent: false, source: 'initial-route-proof' },
        { id: 'proof-certificate-issuer', label: 'Synthetic proof certificate issuer', value: JSON.stringify(peer.issuer), known: true, group: 'verification', affectsConsent: false, source: 'initial-route-proof' },
        { id: 'identityTrusted', label: 'Application certificate identity trusted', value: false, known: true, group: 'verification', affectsConsent: false, source: 'initial-route-proof' },
      ] : [];
      return result(passed, facts.map(fact => ({ ...fact, asOf: checkedAt() })));
    },
  };
}
