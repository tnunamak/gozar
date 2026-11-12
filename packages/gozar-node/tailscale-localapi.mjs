// Tailscale LocalAPI transport for durable routes (Linux unix socket).
//
// Reference: the official Go client and handler at tailscale v1.104.6:
//   client/local/serve.go    GetServeConfig (GET, Etag response header), SetServeConfig (POST, If-Match)
//   client/local/local.go    Host "local-tailscaled.sock", 403 -> AccessDeniedError,
//                            412 -> PreconditionsFailedError (IsPreconditionsFailedError)
//   ipn/localapi/serve.go    serve-config handler: 403 without read/write permission, 412 on ETag mismatch
//   ipn/serve.go             ServeConfig { TCP, Web, Services, AllowFunnel, Foreground }
//
// Fail closed: every failure is a typed error that names the next action. There is no
// fallback to the `tailscale` CLI, whose read-modify-write is not conditional on our read.
import http from 'node:http';
import { lstat } from 'node:fs/promises';

const host = 'local-tailscaled.sock';
const defaultSockets = ['/var/run/tailscale/tailscaled.sock', '/run/tailscale/tailscaled.sock'];
const replyLimit = 4 * 1024 * 1024;
const timeoutMs = 10000;

const typed = (code, message) => Object.assign(new Error(message), { code });
const unavailable = () => typed('tailscale_localapi_unavailable', 'Tailscale LocalAPI is unavailable: start tailscaled, then retry');
const denied = () => typed('tailscale_localapi_denied', 'Tailscale LocalAPI denied access: run `sudo tailscale set --operator=$USER`, then retry');
const unsupported = () => typed('tailscale_localapi_unsupported', 'Tailscale LocalAPI does not offer serve config with an ETag: upgrade tailscaled');
export const conflict = () => typed('tailscale_serve_config_conflict', 'Another program keeps changing the Tailscale serve config: retry later');

// Test seam and non-default installs: GOZAR_TAILSCALED_SOCKET names one socket path.
async function socketPath() {
  const candidates = process.env.GOZAR_TAILSCALED_SOCKET ? [process.env.GOZAR_TAILSCALED_SOCKET] : defaultSockets;
  for (const path of candidates) {
    try { if ((await lstat(path)).isSocket()) return path; }
    catch (error) { if (error.code === 'EACCES') throw denied(); if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw unavailable(); }
  }
  throw unavailable();
}

function request(path, { method = 'GET', headers = {}, body = null } = {}) {
  return socketPath().then(socket => new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath: socket, path, method, timeout: timeoutMs,
      headers: { Host: host, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > replyLimit) { res.destroy(); reject(unsupported()); return; }
        chunks.push(chunk);
      });
      res.on('error', () => reject(unavailable()));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(typed('ETIMEDOUT', 'timeout')));
    req.on('error', error => reject(['EACCES', 'EPERM'].includes(error.code) ? denied() : unavailable()));
    req.end(payload ?? undefined);
  }));
}
function checkStatus(reply) {
  if (reply.status === 401 || reply.status === 403) throw denied();
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
  if (typeof etag !== 'string' || !etag) throw typed('invalid_input', 'Serve config write requires the ETag of a read');
  const reply = await request('/localapi/v0/serve-config', { method: 'POST', headers: { 'If-Match': etag }, body: config });
  checkStatus(reply);
  if (reply.status === 412) return false;
  if (reply.status !== 200) throw typed('tailscale_localapi_failed', 'Tailscale rejected the serve config change; nothing else was changed');
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
  if (status?.BackendState !== 'Running') throw typed('provider_not_running', 'Tailscale is not running: run `tailscale up`, then retry');
  if (typeof status.Self?.DNSName !== 'string' || !status.Self.DNSName) throw unsupported();
  const dnsName = status.Self.DNSName.replace(/\.$/, '').toLowerCase();
  const funnelPorts = Object.keys(status.Self.CapMap ?? {}).flatMap(key => funnelPortsKey.exec(key)?.[1].split(',').map(Number) ?? []);
  return { dnsName, funnelPorts };
}
