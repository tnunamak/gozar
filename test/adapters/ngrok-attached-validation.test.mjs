// Attached publication validation: the SDK is a stub, and so is the edge. The edge is a local HTTP proxy that
// stands in for the provider's public origin; an injected fetch maps the public origin onto it.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';
import { runAttachedController, controlAttached } from '../../packages/gozar-node/attached-route.mjs';
import { createAttachedEffectContext } from '../../packages/gozar-node/adapter-runtime.mjs';
import { storeSecret } from '../../packages/gozar-node/secret-store.mjs';
import { bindSetupValue, bindSetupText } from '../../packages/gozar-node/adapter-configuration.mjs';

const DOMAIN = 'reserved.example.ngrok.app';
const ORIGIN = `https://${DOMAIN}`;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });

/** A stub SDK. Each forward() opens a local "edge" that proxies to `addr`; with `buffer` it holds a response until it ends. */
function stubSdk({ buffer }) {
  const sdk = { edges: [], opened: [] };
  sdk.forward = async ({ addr }) => {
    const [host, port] = addr.split(':');
    const edge = http.createServer((request, response) => {
      const upstream = http.request({ host, port: Number(port), path: request.url, method: request.method, headers: { ...request.headers, host: DOMAIN } }, result => {
        if (!buffer) { response.writeHead(result.statusCode, result.headers); result.pipe(response); return; }
        const chunks = []; // the failure being modelled: the whole body is held until the upstream ends
        result.on('data', chunk => chunks.push(chunk));
        result.on('end', () => { const { 'transfer-encoding': _chunked, ...headers } = result.headers;
          response.writeHead(result.statusCode, { ...headers, 'content-length': String(Buffer.concat(chunks).length) }); response.end(Buffer.concat(chunks)); });
      });
      upstream.on('error', () => { response.writeHead(502); response.end(); });
      request.pipe(upstream);
    });
    const edgePort = await listen(edge);
    const listener = { closed: false, edgePort, url: () => ORIGIN, close: async () => { listener.closed = true; await close(edge); } };
    sdk.opened.push(listener);
    return listener;
  };
  sdk.open = () => sdk.opened.filter(listener => !listener.closed);
  return sdk;
}

async function world(t, { buffer }) {
  const dir = await mkdtemp(join(tmpdir().replace(/^\/tmp$/, process.env.HOME + '/.tmp'), 'gozar-attached-'));
  const app = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('app'); });
  const appPort = await listen(app);
  const sdk = stubSdk({ buffer });
  const adapter = createNgrokAdapter({ loadSdk: async () => sdk });
  // The controller reads the values the way production does: the ones this adapter's setup actions recorded.
  await bindSetupValue({ home: dir, adapterId: adapter.id, actionId: 'auth', handle: (await storeSecret({ home: dir, value: 'stub-token' })).handle });
  await bindSetupText({ home: dir, adapterId: adapter.id, actionId: 'reserved-domain', value: DOMAIN });
  t.after(async () => { for (const listener of sdk.open()) await listener.close(); await close(app); await rm(dir, { recursive: true, force: true }); });
  const read = { now: () => Date.now(), home: dir, platform: 'linux', configuration: async () => ({ auth: 'stub-token', 'reserved-domain': DOMAIN }),
    probe: async () => ({ ok: true }), verifyChallenge: async () => { throw new Error('the controller supplies its own verifier'); } };
  const request = { target: `127.0.0.1:${appPort}`, origin: null, usage: { kind: 'attached' }, configurationRef: null,
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: ['sse'] } };
  const plan = await adapter.plan(read, request);
  const directory = join(dir, 'att_0123456789abcdef');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify({ schemaVersion: 1, id: 'att_0123456789abcdef', home: dir, platform: 'linux', adapterId: adapter.id, request, plan, leaseExpiryMs: 60_000 }));
  // The public origin is mapped to the edge the SDK opened.
  const fetchThroughEdge = (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, ORIGIN);
    return fetch(`http://127.0.0.1:${sdk.opened.at(-1).edgePort}${target.pathname}${target.search}`, init);
  };
  const runtime = { adapters: [adapter], readContext: read, effectContext: createAttachedEffectContext, fetch: fetchThroughEdge };
  return { dir, directory, sdk, runtime, adapter };
}

test('a route whose stream arrives unbuffered is validated, published and removable', async t => {
  const { directory, sdk, runtime } = await world(t, { buffer: false });
  const finished = runAttachedController(directory, runtime);
  const ready = async () => { try { const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')); return state.phase === 'usable' ? state : null; } catch { return null; } };
  let state = null;
  for (let i = 0; i < 100 && !(state = await ready()); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(state, 'the route became usable');
  assert.equal(state.lastView.published, ORIGIN);
  assert.equal(state.lastView.verification.status, 'verified');
  const closed = await controlAttached(directory, { type: 'close' }, 30_000);
  assert.equal(closed.view.state, 'released');
  await finished;
  assert.equal(sdk.open().length, 0, 'the listener was closed');
});

test('red: a stub SDK whose stream buffers makes the route fail to publish, and the listener is withdrawn', async t => {
  const { directory, sdk, runtime } = await world(t, { buffer: true });
  const view = await runAttachedController(directory, runtime);
  assert.equal(view.published, null, 'nothing was published');
  assert.notEqual(view.state, 'usable');
  const failure = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8'));
  assert.equal(failure.code, 'verification_failed');
  assert.equal(sdk.opened.length, 1, 'the SDK listener was opened');
  assert.equal(sdk.open().length, 0, 'and withdrawn');
});
