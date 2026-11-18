// Attached publication validation: the SDK is a stub, and so is the edge. The edge is a local HTTP proxy that
// stands in for the provider's public origin; an injected fetch maps the public origin onto it.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
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
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify({ schemaVersion: 1, id: 'att_0123456789abcdef', home: dir, platform: 'linux', adapterId: adapter.id, request, plan, leaseExpiryMs: 60_000,
    // 0.4 binds a verified route to the registered controller instance; a production controller gets this from the host resolver.
    identity: { instanceId: randomUUID(), bootId: randomUUID() } }));
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

test('ngrok edge metadata distinguishes domain choices and conditional app OAuth from transport proof', async () => {
  const {adapter, evidence} = JSON.parse(await readFile(new URL('../../adapters/providers/ngrok-https-edge/definition.json', import.meta.url), 'utf8'));
  const fact = id => adapter.facts.find(item => item.id === id);
  assert.equal(adapter.prerequisites.find(item => item.id === 'domain').label, 'Assigned development or reserved domain');
  for (const text of [adapter.capabilities.cost.summary, fact('cost-detail').value,
    adapter.capabilities.address.conditions[0], fact('address-condition-0').value]) {
    assert.match(text, /Free/);
    assert.match(text, /assigned development domain/);
    assert.match(text, /reserved ngrok-branded/i);
    assert.match(text, /bring-your-own/);
    assert.doesNotMatch(text, /\$\d|Pay-as-you-go \(/);
  }
  assert.equal(adapter.capabilities.cost.kind, 'unknown');
  assert.deepEqual(Object.keys(adapter.capabilities.cost).sort(), ['kind', 'summary']);
  assert.deepEqual(adapter.capabilities.proof, {vantage:'public', checks:['tls','nonce','sse']});
  assert.equal(adapter.capabilities.protocols.oauthDcr, true);
  assert.match(evidence.protocols.oauthDcr, /configured app/);
  assert.match(evidence.protocols.oauthDcr, /client registration/);
  assert.match(evidence.protocols.oauthDcr, /authorization/);
  assert.match(evidence.protocols.oauthDcr, /does not prove/);
  for (const source of [adapter.capabilities.traffic.evidenceRef, fact('payload-readers').source]) {
    assert.match(source, /adapter architecture/);
    assert.match(source, /terminates TLS/);
    assert.match(source, /HTTP/);
    assert.doesNotMatch(source, /ngrok\.com\/(?:pricing|tos|privacy)/);
  }
  assert.equal(adapter.disclosure.revision, 'disc-da9c3b77b850');
  assert.equal(adapter.disclosure.text, 'Serve this app through an ngrok HTTPS listener on your assigned development or permitted reserved domain while the app runs. The ngrok edge terminates TLS and can read payloads. Credential custody stays with the configured host backend.');
  for (const id of ['entitlement','quota','mapping','remote-termination','remote-logging','account-authorization']) {
    assert.equal(fact(id).known, false, id);
    assert.equal(fact(id).value, null, id);
    assert.equal(fact(id).reason, 'needs-provider-call', id);
  }
});

test('ngrok domain setup help is specific and remains part of its action digest', async () => {
  const source = await readFile(new URL('../../adapters/providers/ngrok-https-edge/index.mjs', import.meta.url), 'utf8');
  const domainAction = source.slice(source.indexOf('const domainAction ='), source.indexOf('const installAction ='));
  assert.match(domainAction, /assigned development domain/);
  assert.match(domainAction, /Free/);
  assert.match(domainAction, /reserved ngrok-branded/);
  assert.match(domainAction, /bring-your-own/);
  assert.doesNotMatch(domainAction, /reserved\/custom/);
  assert.match(domainAction, /digest: sha\(body\)/);
  assert.match(domainAction, /disclosure: definition\.disclosure/);
});

test('generated ngrok provider row exactly matches the scoped generator format', async () => {
  const {adapter} = JSON.parse(await readFile(new URL('../../adapters/providers/ngrok-https-edge/definition.json', import.meta.url), 'utf8'));
  const document = await readFile(new URL('../../docs/providers.md', import.meta.url), 'utf8');
  const c = adapter.capabilities;
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const flag = value => value ? 'yes' : 'no';
  const list = value => value?.length ? value.join(', ') : 'provider assigns';
  const byKind = (field, shown) => Object.entries(adapter.byUsage ?? {}).filter(([, facts]) => Object.hasOwn(facts, field)).map(([kind, facts]) => kind + ': ' + shown(facts[field]));
  const ports = [list(c.address.ports), ...byKind('ports', list)].join('; ');
  const needs = [adapter.needs ?? '', ...byKind('needs', String)].join(' ');
  const proof = c.proof ? c.proof.vantage + ': ' + (c.proof.checks.join(', ') || 'no checks') : 'none';
  const payload = c.traffic.providerCanReadPayload === null ? 'unknown' : c.traffic.providerCanReadPayload ? 'provider can read' : 'endpoint only';
  const expected = '| '+String.fromCharCode(96)+adapter.id+String.fromCharCode(96)+' | '+cell(adapter.label)+' | '+cell(needs)+' | '+(adapter.supportedKinds.join(', ') || 'none yet')+' | '+c.reach+' | '+c.address.stability+' | '+ports+' | '+proof+' | '+payload+' | '+flag(c.protocols.sse)+' / '+flag(c.protocols.streamableHttp)+' / '+flag(c.protocols.oauthDcr)+' | '+cell(c.cost.summary)+' |';
  const rows = document.split('\n').filter(line => line.startsWith('| '+String.fromCharCode(96)+'ngrok-https-edge'+String.fromCharCode(96)+' |'));
  assert.deepEqual(rows, [expected]);
});
