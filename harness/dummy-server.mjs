import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

// A fresh identity per instance; finite streams make buffering observable.
export async function startDummy({ host = '127.0.0.1', port = 0, intervalMs = 250, tls } = {}) {
  const nonce = randomUUID();
  const timers = new Set();
  const handler = async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/identity' || path === '/') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ nonce, protocol: 'gozar-harness-v1' }));
    }
    if (path === '/events' || (path === '/mcp' && req.method === 'GET')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      const send = sequence => {
        const proof = { nonce, sequence, timestamp: Date.now() };
        const data = path === '/mcp' ? { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: proof } } : proof;
        res.write(`id: ${sequence}\nevent: ${path === '/mcp' ? 'message' : 'proof'}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send(1);
      const timer = setTimeout(() => { timers.delete(timer); send(2); res.end(); }, intervalMs);
      timers.add(timer);
      res.on('close', () => { clearTimeout(timer); timers.delete(timer); });
      return;
    }
    if (path === '/mcp' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16_384) { res.writeHead(413); return res.end(); }
      }
      try {
        const input = JSON.parse(body);
        const result = input.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'gozar-harness', version: '1', nonce } }
          : input.method === 'tools/list' ? { tools: [{ name: 'identity', description: 'Instance identity', inputSchema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'], additionalProperties: false } }] }
          : input.method === 'tools/call' && input.params?.name === 'identity' ? { content: [{ type: 'text', text: JSON.stringify({ nonce, echo: input.params.arguments?.echo }) }], structuredContent: { nonce, echo: input.params.arguments?.echo }, isError: false } : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(result ? { jsonrpc: '2.0', id: input.id, result } : { jsonrpc: '2.0', id: input.id, error: { code: -32601, message: 'Method not found' } }));
      } catch { res.writeHead(400); return res.end(); }
    }
    res.writeHead(404); res.end();
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { nonce, origin: `${tls ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`, port: server.address().port,
    close: async () => { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
