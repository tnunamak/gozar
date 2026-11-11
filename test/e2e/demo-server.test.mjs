import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

for (const entry of [{ name: 'standalone', file: '../../harness/dummy-server.mjs', args: [] }, { name: 'gozar demo-server', file: '../../bin/gozar.mjs', args: ['demo-server'] }])
for (const signal of ['SIGINT', 'SIGTERM']) test(`${entry.name} serves echo MCP at root and /mcp and stops on ${signal}`, { timeout: 10000 }, async t => {
  const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gozar-demo-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'demo.mjs');
  await symlink(fileURLToPath(new URL(entry.file, import.meta.url)), script);
  const child = spawn(process.execPath, [script, ...entry.args, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const output = [];
  lines.on('line', line => output.push(line));
  const [ready] = await once(lines, 'line', { signal: AbortSignal.timeout(3000) });
  const match = /port (\d+): (http:\/\/127\.0\.0\.1:\d+)$/.exec(ready);
  assert.ok(match, ready); const origin = match[2];
  assert.equal(new URL(origin).port, match[1]);
  const identity = await (await fetch(origin)).json();
  assert.equal(typeof identity.nonce, 'string');
  for (const path of ['/', '/mcp']) {
    const rpc = async input => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', ...input }), signal: AbortSignal.timeout(2000) });
    const initialize = await (await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'demo-test', version: '1' } } })).json();
    assert.equal(initialize.id, 1); assert.equal(initialize.result.protocolVersion, '2025-03-26');
    const notified = await rpc({ method: 'notifications/initialized' });
    assert.equal(notified.status, 202); assert.equal(await notified.text(), '');
    assert.deepEqual((await (await rpc({ id: 2, method: 'ping' })).json()).result, {});
    const listed = await (await rpc({ id: 3, method: 'tools/list' })).json();
    assert.deepEqual(listed.result.tools.map(tool => tool.name), ['echo']);
    const called = await (await rpc({ id: 4, method: 'tools/call', params: { name: 'echo', arguments: { echo: 'hello MCP' } } })).json();
    assert.equal(called.id, 4); assert.equal(called.result.isError, false);
    assert.deepEqual(JSON.parse(called.result.content[0].text), { nonce: identity.nonce, echo: 'hello MCP' });
    const stream = await fetch(origin + path, { headers: { accept: 'text/event-stream' }, signal: AbortSignal.timeout(2000) });
    assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
    const received = []; let buffered = '';
    for await (const chunk of stream.body) {
      buffered += new TextDecoder().decode(chunk);
      let end;
      while ((end = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2);
        const message = JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
        assert.equal(message.method, 'notifications/message'); assert.equal(message.params.data.nonce, identity.nonce);
        received.push({ sequence: message.params.data.sequence, at: Date.now() });
      }
    }
    assert.deepEqual(received.map(event => event.sequence), [1, 2]);
    assert.ok(received[1].at - received[0].at >= 100);
  }
  child.kill(signal);
  const [code, exitSignal] = await exited;
  assert.equal(code, 0, stderr); assert.equal(exitSignal, null);
  assert.equal(output.length, 1);
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
});
