import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startDummy } from '../../harness/dummy-server.mjs';

test('dummy MCP echo preserves UTF-8 split across HTTP body writes', async t => {
  const service = await startDummy({toolName:'echo'});
  t.after(() => service.close());
  const body = Buffer.from(JSON.stringify({jsonrpc:'2.0', id:1, method:'tools/call',
    params:{name:'echo',arguments:{echo:'caf\u00e9'}}}));
  const split = body.indexOf(Buffer.from('\u00e9')) + 1;
  assert.ok(split > 0);
  const result = await new Promise((resolve,reject) => {
    const req = request(service.origin + '/mcp', {method:'POST'}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.write(body.subarray(0,split), () => setImmediate(() => req.end(body.subarray(split))));
  });
  assert.equal(result.result.structuredContent.echo, 'caf\u00e9');
});
