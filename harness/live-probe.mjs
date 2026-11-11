// Run this observer on the chosen machine. It never infers remote execution from input labels.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { probe } from './probe.mjs';

export async function observeLive({ origin, authorization, challenge, serviceNonce, toolEcho }) {
  assert.equal(new URL(origin).protocol, 'https:', 'Drop1a requires real HTTPS');
  assert.ok(authorization?.nonceRef && authorization.verifierRef && authorization.expiresAtMs > Date.now());
  assert.ok(challenge?.identityPath?.startsWith('/.gozar-') && challenge.streamPath?.startsWith('/.gozar-') && challenge.nonce);
  const startedAt = Date.now();
  const get = async path => {
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200); return response;
  };
  const identity = await (await get(challenge.identityPath)).json();
  assert.equal(identity.nonce, challenge.nonce, 'Gozar gate nonce mismatch');
  const response = await get(challenge.streamPath);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  let buffer = '', bytes = 0; const events = [];
  for await (const chunk of response.body) {
    bytes += chunk.length; assert.ok(bytes <= 4096); buffer += new TextDecoder().decode(chunk);
    while (buffer.includes('\n\n')) {
      const end = buffer.indexOf('\n\n'); const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      assert.ok(frame.startsWith('data: '));
      const data = JSON.parse(frame.slice(6)); assert.equal(data.nonce, challenge.nonce);
      events.push({ ...data, receivedAt: Date.now() });
    }
  }
  assert.deepEqual(events.map(event => event.sequence), [0, 1, 2]);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].receivedAt - events[i - 1].receivedAt >= 80, 'gate SSE buffered');
  const service = await probe({ origin, nonce: serviceNonce, toolEcho, issuedAt: startedAt });
  return { origin, authorization, startedAt, finishedAt: Date.now(), observerVantage: 'local-to-execution-machine', gate: { identityMatched: true, events }, service };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length <= 32_768); }
  try { console.log(JSON.stringify(await observeLive(JSON.parse(input)))); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
