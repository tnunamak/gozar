import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function probe({ origin, nonce, issuedAt = Date.now(), toolEcho = randomUUID(), toolName = 'identity', request = fetch }) {
  // A caller label cannot move this fetch to another machine/network.
  const vantage = 'local', executorId = 'local-node';
  const url = new URL(origin);
  assert.equal(url.origin, origin, 'exact origin required');
  const startedAt = Date.now();
  assert.equal(typeof request, 'function');
  const responses = [];
  const get = async (path, options = {}) => {
    const response = await request(origin + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const names = ['server', 'via', 'date', 'cf-ray', 'x-cache', 'x-served-by', 'x-request-id', 'x-envoy-upstream-service-time', 'content-type'];
    responses.push({ path, status: response.status, headers: Object.fromEntries(names.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null)) });
    assert.equal(response.status, 200);
    return response;
  };
  const identity = await (await get('/identity')).json();
  assert.equal(identity.nonce, nonce, 'wrong server instance');
  assert.equal(identity.protocol, 'gozar-harness-v1');
  const mcp = await (await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'harness', version: '1' } } }) })).json();
  assert.equal(mcp.result.serverInfo.nonce, nonce);
  assert.equal(mcp.result.protocolVersion, '2025-03-26');
  const rpc = async (id, method, params) => {
    const reply = await (await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).json();
    assert.equal(reply.jsonrpc, '2.0'); assert.equal(reply.id, id); assert.equal(reply.error, undefined); return reply.result;
  };
  const listed = await rpc(2, 'tools/list', {});
  assert.ok(listed.tools.some(tool => tool.name === toolName));
  const called = await rpc(3, 'tools/call', { name: toolName, arguments: { echo: toolEcho } });
  assert.notEqual(called.isError, true);
  const toolResult = JSON.parse(called.content.find(item => item.type === 'text').text);
  assert.deepEqual(toolResult, { nonce, echo: toolEcho }, 'actual MCP tool result must match the fresh instance and echo challenge');
  const response = await get('/mcp', { headers: { accept: 'text/event-stream', 'mcp-protocol-version': '2025-03-26' } });
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const events = []; let buffer = ''; let bytes = 0;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    bytes += chunk.length; assert.ok(bytes <= 16_384, 'bounded stream');
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').find(line => line.startsWith('data: '));
      if (data) {
        const message = JSON.parse(data.slice(6));
        assert.equal(message.jsonrpc, '2.0'); assert.equal(message.method, 'notifications/message');
        events.push({ ...message.params.data, receivedAt: Date.now() });
      }
    }
  }
  const receipt = { origin, nonce, vantage, executorId, issuedAt, startedAt, finishedAt: Date.now(), tls: url.protocol === 'https:', identity: true, mcp: true, toolCall: true, toolResult, responses, events };
  validateReceipt(receipt, { origin, nonce, issuedAt, vantage, requireTls: url.protocol === 'https:' });
  return receipt;
}

export function validateReceipt(receipt, { origin, nonce, issuedAt, vantage, executorId, toolEcho, requireTls = true }) {
  assert.equal(receipt.origin, origin); assert.equal(receipt.nonce, nonce); assert.equal(receipt.issuedAt, issuedAt, 'challenge timestamp mismatch');
  assert.equal(receipt.vantage, vantage, 'appropriate remote vantage required');
  if (vantage !== 'local') {
    assert.ok(executorId && executorId !== 'local-node', 'pin the trusted remote executor identity');
    assert.equal(receipt.executorId, executorId, 'trusted executor identity mismatch');
  } else assert.equal(receipt.executorId, 'local-node');
  assert.ok(receipt.startedAt >= issuedAt && receipt.finishedAt >= receipt.startedAt && receipt.finishedAt <= Date.now() + 5000, 'fresh receipt required');
  assert.ok(receipt.finishedAt - receipt.startedAt <= 30_000, 'bounded probe required');
  if (requireTls) { assert.equal(new URL(origin).protocol, 'https:'); assert.equal(receipt.tls, true); }
  assert.equal(receipt.identity, true); assert.equal(receipt.mcp, true); assert.equal(receipt.toolCall, true, 'actual MCP tool call required');
  assert.equal(receipt.toolResult?.nonce, nonce); assert.ok(typeof receipt.toolResult?.echo === 'string' && receipt.toolResult.echo.length > 0);
  if (toolEcho !== undefined) assert.equal(receipt.toolResult.echo, toolEcho);
  assert.equal(receipt.events?.length, 2);
  const [first, second] = receipt.events;
  for (const event of receipt.events) { assert.equal(event.nonce, nonce); assert.ok(event.timestamp >= issuedAt && event.receivedAt >= receipt.startedAt && event.receivedAt <= receipt.finishedAt); }
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  assert.ok(second.timestamp - first.timestamp >= 150, 'server events must be separated');
  assert.ok(second.receivedAt - first.receivedAt >= 100, 'buffered SSE is insufficient');
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16_384) throw new Error('Input too large'); }
  try { console.log(JSON.stringify(await probe(JSON.parse(input)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
