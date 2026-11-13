// Tailscale LocalAPI transport for durable routes: a unix socket (Linux, and open-source tailscaled on
// macOS) or, for the macOS apps, a loopback TCP port with a token.
//
// Reference: the official Go client and handler at tailscale v1.104.6:
//   client/local/serve.go    GetServeConfig (GET, Etag response header), SetServeConfig (POST, If-Match)
//   client/local/local.go    Host "local-tailscaled.sock", 403 -> AccessDeniedError,
//                            412 -> PreconditionsFailedError (IsPreconditionsFailedError)
//   ipn/localapi/serve.go    serve-config handler: 403 without read/write permission, 412 on ETag mismatch
//   ipn/serve.go             ServeConfig { TCP, Web, Services, AllowFunnel, Foreground }
// The macOS app transport and its discovery are in tailscale-app-discovery.mjs, with the upstream files they follow.
//
// Fail closed: every failure is a typed error that names the next action. There is no
// fallback to the `tailscale` CLI, whose read-modify-write is not conditional on our read.
import http from 'node:http';
import { lstat } from 'node:fs/promises';
import { discoverAppLocalApi } from './tailscale-app-discovery.mjs';

const host = 'local-tailscaled.sock';
const linuxSockets = ['/var/run/tailscale/tailscaled.sock', '/run/tailscale/tailscaled.sock'];
// Open-source tailscaled on macOS (including Homebrew's) listens on /var/run/tailscaled.socket:
//   tailscale/paths/paths.go   DefaultTailscaledSocket: `if runtime.GOOS == "darwin" { return "/var/run/tailscaled.socket" }`
// The Mac App Store and standalone Tailscale apps run tailscaled inside the app and expose no such socket.
// Their LocalAPI is a loopback TCP port plus a token (tailscale/safesocket/safesocket_darwin.go). With no socket,
// the request goes to that port; see tailscale-app-discovery.mjs.
const darwinSockets = ['/var/run/tailscaled.socket', ...linuxSockets];
export const defaultSocketCandidates = (platform = process.platform) => platform === 'darwin' ? darwinSockets : linuxSockets;
const replyLimit = 4 * 1024 * 1024;
const timeoutMs = 10000;

// Generic provider error codes: apps react to the code, `provider` and `nextAction`, and need no
// provider knowledge. `provider` is the provider family; this layer does not know the adapter id.
const provider = 'tailscale';
const typed = (code, message, nextAction) => Object.assign(new Error(message), { code, provider, nextAction });
const unavailable = () => (platformNow() === 'darwin'
  ? typed('provider_unavailable', 'Tailscale LocalAPI is unavailable: open the Tailscale app and sign in (or start tailscaled), then retry', 'open the Tailscale app, or start tailscaled')
  : typed('provider_unavailable', 'Tailscale LocalAPI is unavailable: start tailscaled, then retry', 'start tailscaled'));
const denied = () => typed('provider_denied', 'Tailscale LocalAPI denied access: run `sudo tailscale set --operator=$USER`, then retry', 'sudo tailscale set --operator=$USER');
// The Tailscale app refused the token. The token is never in this message; the file it came from names the running app.
const deniedByApp = () => typed('provider_denied', 'The Tailscale app refused the LocalAPI credentials: quit and reopen the Tailscale app, then retry', 'quit and reopen the Tailscale app');
const unsupported = () => typed('provider_unsupported', 'Tailscale LocalAPI does not offer serve config with an ETag: upgrade tailscaled', 'upgrade tailscaled');
export const conflict = () => typed('provider_conflict', 'Another program keeps changing the Tailscale serve config: retry later', 'retry later');

// Platform and app discovery are replaceable so that tests run the macOS path on any host.
// Overrides are for tests only; production uses `process.platform` and the real discovery.
let overrides = {};
const platformNow = () => overrides.platform?.() ?? process.platform;
/** Test seam: replace the platform, the socket candidates and the app discovery effects (see tailscale-app-discovery.mjs). Returns a restore function. */
export function setTransportEffectsForTest(effects) {
  const saved = overrides;
  overrides = { ...saved, ...effects };
  return () => { overrides = saved; };
}

// Where the request goes. `{ socket }` is a unix socket. `{ port, token }` is the macOS app's loopback port:
// the token is the Basic-auth password for this one request and is not kept.
// GOZAR_TAILSCALED_SOCKET (a test seam and non-default installs) names one socket path and overrides everything.
// Otherwise a unix socket comes first, then, on macOS only, the app's loopback port, as Tailscale's own CLI finds it.
async function locate() {
  const platform = platformNow();
  const override = process.env.GOZAR_TAILSCALED_SOCKET;
  for (const path of override ? [override] : overrides.socketCandidates?.() ?? defaultSocketCandidates(platform)) {
    try { if ((await lstat(path)).isSocket()) return { socket: path }; }
    catch (error) { if (error.code === 'EACCES') throw denied(); if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw unavailable(); }
  }
  if (!override) {
    const app = await discoverAppLocalApi(overrides);
    if (app) return app;
  }
  throw unavailable();
}

function request(path, { method = 'GET', headers = {}, body = null } = {}) {
  return locate().then(where => new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    // Basic auth as in tailscale client/local DoLocalRequest: SetBasicAuth("", token).
    const route = where.socket ? { socketPath: where.socket } : { host: '127.0.0.1', port: where.port };
    const auth = where.socket ? {} : { Authorization: 'Basic ' + Buffer.from(':' + where.token).toString('base64') };
    const req = http.request({ ...route, path, method, timeout: timeoutMs,
      headers: { Host: host, ...auth, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > replyLimit) { res.destroy(); reject(unsupported()); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(unavailable()));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), app: !where.socket }));
    });
    req.on('timeout', () => req.destroy(typed('ETIMEDOUT', 'timeout', 'retry')));
    req.on('error', error => reject(['EACCES', 'EPERM'].includes(error.code) ? denied() : unavailable()));
    req.end(payload ?? undefined);
  }));
}
function checkStatus(reply) {
  if (reply.status === 401 || reply.status === 403) throw reply.app ? deniedByApp() : denied();
  if (reply.status === 404 || reply.status === 405) throw unsupported();
}
const isMap = value => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value));

// GET serve-config: the whole config and its ETag. An empty config is JSON null.
export async function getServeConfig() {
  const reply = await request('/localapi/v0/serve-config');
  checkStatus(reply);
  if (reply.status !== 200) throw unavailable();
  const etag = reply.headers.etag;
  if (typeof etag !== 'string' || !etag) throw unsupported();
  let config;
  try { config = JSON.parse(reply.body); } catch { throw unsupported(); }
  if (config === null) config = {};
  if (!isMap(config) || !['TCP', 'Web', 'AllowFunnel', 'Foreground', 'Services'].every(key => isMap(config[key]))) throw unsupported();
  return { config, etag };
}

// POST serve-config with If-Match. Returns false on 412 (another program changed the
// config after our read); the caller must re-read and re-decide, never repeat the write.
export async function setServeConfig(config, etag) {
  if (typeof etag !== 'string' || !etag) throw typed('invalid_input', 'Serve config write requires the ETag of a read', 'read the serve config first');
  const reply = await request('/localapi/v0/serve-config', { method: 'POST', headers: { 'If-Match': etag }, body: config });
  checkStatus(reply);
  if (reply.status === 412) return false;
  if (reply.status !== 200) throw typed('provider_failed', 'Tailscale rejected the serve config change; nothing else was changed', 'retry; check the tailscaled logs if it persists');
  return true;
}

// Node DNS name and funnel-ports capability. Read only; callers never print them.
const funnelPortsKey = /^https:\/\/tailscale\.com\/cap\/funnel-ports\?ports=([0-9,]+)$/;
export async function getNode() {
  const reply = await request('/localapi/v0/status?peers=false');
  checkStatus(reply);
  if (reply.status !== 200) throw unavailable();
  let status;
  try { status = JSON.parse(reply.body); } catch { throw unsupported(); }
  if (status?.BackendState !== 'Running') throw typed('provider_not_running', 'Tailscale is not running: run `tailscale up`, then retry', 'tailscale up');
  if (typeof status.Self?.DNSName !== 'string' || !status.Self.DNSName) throw unsupported();
  const dnsName = status.Self.DNSName.replace(/\.$/, '').toLowerCase();
  const funnelPorts = Object.keys(status.Self.CapMap ?? {}).flatMap(key => funnelPortsKey.exec(key)?.[1].split(',').map(Number) ?? []);
  return { dnsName, funnelPorts };
}

// --- Listener arithmetic on a serve config (pure) ---
// One implementation of "what is on this port", "is it free", "the config with exactly this
// listener" and "without it". The durable engine and the Tailscale adapters share it, so a
// plan, a receipt and a removal always agree on what a listener is. A listener is the TCP
// handler for the port, the Web handler for `dnsName:port` and, for Funnel, its AllowFunnel flag.
const absentRule = rule => Object.values(rule).every(value => value === null);
const foreground = (config, dnsName, port) => Object.values(config.Foreground ?? {})
  .some(session => session?.TCP?.[port] || session?.Web?.[`${dnsName}:${port}`]);
export const serveListener = {
  ruleAt: (config, dnsName, port) => ({ tcp: config.TCP?.[port] ?? null, web: config.Web?.[`${dnsName}:${port}`] ?? null,
    funnel: config.AllowFunnel?.[`${dnsName}:${port}`] ?? null }),
  absent: absentRule,
  // True when anything at all holds the port, including a bare TCP entry and any foreground session.
  occupied: (config, dnsName, port) => !absentRule(serveListener.ruleAt(config, dnsName, port)) || config.TCP?.[port] !== undefined ||
    foreground(config, dnsName, port),
  foreground,
  withListener(config, dnsName, port, listener) {
    const next = structuredClone(config), hostPort = `${dnsName}:${port}`;
    (next.TCP ??= {})[port] = listener.tcp;
    (next.Web ??= {})[hostPort] = listener.web;
    if (listener.funnel !== null) (next.AllowFunnel ??= {})[hostPort] = listener.funnel;
    return next;
  },
  // The config without exactly one listener; empty maps are dropped.
  without(config, dnsName, port) {
    const next = structuredClone(config);
    for (const [key, field] of [['TCP', String(port)], ['Web', `${dnsName}:${port}`], ['AllowFunnel', `${dnsName}:${port}`]]) {
      if (!next[key]) continue;
      delete next[key][field];
      if (!Object.keys(next[key]).length) delete next[key];
    }
    return next;
  },
};
