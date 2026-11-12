// Fake Tailscale LocalAPI on a unix socket, for durable-route tests. It models what durable
// routes use: GET/POST /localapi/v0/serve-config with an Etag that changes on every write and
// 412 on a stale If-Match (an absent If-Match writes unconditionally, as in tailscaled), and GET /localapi/v0/status?peers=false. State lives in memory in
// the test process, so tests read and edit it directly.
//
// Hooks: beforePost(state) runs when a POST arrives, before the ETag check, so a test can
// inject a foreign edit between Gozar's GET and its POST. crash ('before-apply' | 'after-apply')
// kills the client process around the write. createProxy makes the provider store a different
// proxy than requested, to model a readback mismatch. failure selects a typed transport failure.
import http from 'node:http';

export async function startFakeLocalApi(socketPath, initial = {}) {
  const state = { dnsName: 'node.tailnet.test', backendState: 'Running', funnelPorts: [8443], config: {}, etag: 1,
    requests: [], writes: [], crash: null, createProxy: null, createDelayMs: 0, beforePost: null, failure: null, client: null, ...initial };
  const etag = () => `"fake-${state.etag}"`;
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(body); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      state.requests.push({ method: req.method, path: req.url });
      if (req.headers.host !== 'local-tailscaled.sock') return send(res, 403, 'invalid localapi request');
      if (state.failure === 'denied') return send(res, 403, 'serve config denied');
      if (state.failure === 'missing-endpoint') return send(res, 404, '404 page not found');
      if (req.url === '/localapi/v0/status?peers=false' && req.method === 'GET') {
        const capMap = { funnel: null, https: null };
        if (state.funnelPorts.length) capMap[`https://tailscale.com/cap/funnel-ports?ports=${state.funnelPorts.join(',')}`] = null;
        return send(res, 200, JSON.stringify({ BackendState: state.backendState, Self: { ID: 'node-1', DNSName: state.dnsName + '.', CapMap: capMap } }));
      }
      if (req.url !== '/localapi/v0/serve-config') return send(res, 404, '404 page not found');
      if (req.method === 'GET') {
        if (state.failure === 'bad-shape') return send(res, 200, '[1,2]', { Etag: etag() });
        const empty = !Object.keys(state.config).length;
        return send(res, 200, empty ? 'null' : JSON.stringify(state.config), state.failure === 'no-etag' ? {} : { Etag: etag() });
      }
      if (req.method !== 'POST') return send(res, 405, 'method not allowed');
      if (state.beforePost) { const hook = state.beforePost; if (!state.beforePostAlways) state.beforePost = null; hook(state); state.etag++; }
      // As in tailscaled (ipn/ipnlocal/serve.go), an absent If-Match is an unconditional write.
      if (req.headers['if-match'] && req.headers['if-match'] !== etag()) return send(res, 412, 'etag mismatch');
      let config;
      try { config = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 500, '{"error":"decoding config"}'); }
      if (state.createDelayMs) await new Promise(resolve => setTimeout(resolve, state.createDelayMs));
      if (state.crash === 'before-apply') { state.crash = null; state.client?.kill('SIGKILL'); return req.socket.destroy(); }
      if (state.createProxy) {
        for (const [hostPort, web] of Object.entries(config.Web ?? {}))
          if (!state.config.Web?.[hostPort]) web.Handlers['/'].Proxy = state.createProxy;
      }
      state.config = config ?? {};
      state.writes.push(structuredClone(state.config));
      state.etag++;
      if (state.crash === 'after-apply') { state.crash = null; state.client?.kill('SIGKILL'); return req.socket.destroy(); }
      send(res, 200, '');
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  return { state, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

// Where the provider would forward a request for dnsName:port, or null. A listener needs a TCP
// HTTPS handler and a web handler; a public (Funnel) request also needs AllowFunnel.
export function forwardTarget(config, dnsName, port, { publicVantage = false } = {}) {
  const hostPort = `${dnsName}:${port}`;
  if (config.TCP?.[port]?.HTTPS !== true) return null;
  if (publicVantage && config.AllowFunnel?.[hostPort] !== true) return null;
  return config.Web?.[hostPort]?.Handlers?.['/']?.Proxy ?? null;
}
