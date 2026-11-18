import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { deriveProof } from '../../scripts/sync-adapter-registry.mjs';
import { createNamedAdapter } from '../../adapters/providers/cloudflare-named/index.mjs';

test('named connector uses saved input, scopes cleanup to its runtime and never returns a token', async () => {
  const ledger=new Set(), secret='unique-named-secret-canary', calls=[];
  const adapter=createNamedAdapter({ detectBinary:async()=>true, startConnector:async input=>{
    calls.push(input);ledger.add('owned');return {alive:()=>ledger.has('owned'),close:async()=>{ledger.delete('owned');}};
  }});
  const context={platform:'linux',now:Date.now,configuration:async()=>({token:secret,origin:'https://named.example.invalid','gate-port':'18479'}),generation:1,assertGeneration:async()=>{}};
  const detected=await adapter.detect(context);assert.equal(detected.state,'ready');
  const request={target:'127.0.0.1:3000',origin:null,usage:{kind:'attached'},requirements:{protocols:[]}};
  const plan=await adapter.plan(context,request);assert.ok(!JSON.stringify(plan).includes(secret));
  const receipt=await adapter.create(context,plan);assert.equal(ledger.size,1);assert.equal(calls[0].token,secret);
  assert.ok(!JSON.stringify(receipt).includes(secret));
  const observed=await adapter.observe(context,request);
  assert.equal((await adapter.remove(context,receipt,observed)).removed,true);assert.equal(ledger.size,0);
  assert.equal((await adapter.remove(context,receipt,observed)).removed,true);
});

test('named connector refuses incomplete inputs before starting and reports uncertain cleanup', async () => {
  let starts=0;
  const adapter=createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>{starts++;return {alive:()=>true,close:async()=>{throw new Error('private-runtime-diagnostic');}};}});
  const base={platform:'linux',now:Date.now,generation:1,assertGeneration:async()=>{}};
  await assert.rejects(adapter.plan({...base,configuration:async()=>({token:'present'})},{usage:{kind:'attached'},target:'127.0.0.1:3000'}),e=>e.code==='setup_required');assert.equal(starts,0);
  const ctx={...base,configuration:async()=>({token:'present',origin:'https://named.example.invalid','gate-port':'18479'})};
  const request={usage:{kind:'attached'},target:'127.0.0.1:3000'}, plan=await adapter.plan(ctx,request), receipt=await adapter.create(ctx,plan);
  const removal=await adapter.remove(ctx,receipt,{});assert.equal(removal.removed,false);assert.equal(removal.debt.reason,'listener-absence-unconfirmed');assert.ok(!JSON.stringify(removal).includes('private-runtime-diagnostic'));
});

test('a resolving close is not absence when the owned connector remains alive', async () => {
  const adapter=createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>({alive:()=>true,close:async()=>{}})});
  const ctx={platform:'linux',now:Date.now,generation:1,assertGeneration:async()=>{},configuration:async()=>({token:'fake-secret',origin:'https://named.example.invalid','gate-port':'18479'})};
  const plan=await adapter.plan(ctx,{target:'127.0.0.1:3000',usage:{kind:'attached'}}),receipt=await adapter.create(ctx,plan);
  assert.equal((await adapter.remove(ctx,receipt,{})).removed,false);
});

test('named advertised transport matches the attached proof boundary and generated docs', async () => {
  const {adapter, evidence} = JSON.parse(await readFile(new URL('../../adapters/providers/cloudflare-named/definition.json', import.meta.url), 'utf8'));
  const {definition} = JSON.parse(await readFile(new URL('../../adapters/cloudflare-named.definition.json', import.meta.url), 'utf8'));
  assert.deepEqual(adapter.capabilities.protocols, {sse:true,streamableHttp:true,oauthDcr:false});
  assert.deepEqual(adapter.capabilities.proof, deriveProof(definition, adapter.capabilities.transport));
  assert.equal(adapter.capabilities.proof.vantage, 'this-device');
  assert.deepEqual(adapter.capabilities.proof.checks, ['tls','nonce','sse']);
  assert.doesNotMatch(evidence.protocols['sse/streamableHttp'], /no admitted recipe|creates no route/i);
  assert.doesNotMatch(evidence.protocols.oauthDcr, /detected only|nothing is published/i);
  assert.match(evidence.protocols.oauthDcr, /not verified/i);
  assert.ok(definition.capabilityRecords.every(row => row.capabilities.oauthDcr !== true));
  const docs = await readFile(new URL('../../docs/providers.md', import.meta.url), 'utf8');
  const row = docs.split('\n').find(line => line.startsWith('| `cloudflare-named` |'));
  assert.ok(row);
  assert.match(row, /\| this-device: tls, nonce, sse \|/);
  assert.match(row, /\| yes \/ yes \/ no \|/);
});

async function assertConnectionRefused(url, signal = AbortSignal.timeout(1000)) {
  // A fresh connection, never undici's pooled socket from the proof request.
  // A stale pooled socket can report "other side closed" without a new dial.
  let request, closed;
  const probe = new Promise((resolve, reject) => {
    request = get(url, {agent:false, signal}, response => {
      response.destroy();
      resolve();
    });
    closed = new Promise(resolveClose => request.once('close', resolveClose));
    request.once('error', reject);
  });
  try {
    await assert.rejects(probe, error =>
      error?.code === 'ECONNREFUSED' &&
      error?.name !== 'AbortError' && error?.name !== 'TimeoutError',
    );
  } finally {
    request?.destroy();
    await closed;
  }
}

test('gate absence rejects an aborted live listener and accepts a closed port', {timeout:5000}, async () => {
  const sockets = new Set();
  let observedRequest;
  const requested = new Promise(resolve => { observedRequest = resolve; });
  const server = createServer(() => observedRequest());
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const stop = new AbortController();
  let watchdog, url, absence;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    url = 'http://127.0.0.1:'+server.address().port;
    absence = assertConnectionRefused(url, stop.signal).then(
      () => ({passed:true}),
      error => ({passed:false,error}),
    );
    await Promise.race([
      requested,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('live-listener request deadline')), 2000);
      }),
    ]);
    clearTimeout(watchdog);
    assert.equal(server.listening, true);
    assert.ok(sockets.size > 0, 'the absence probe must reach the owned listener');
    stop.abort(new DOMException('fixture abort after observed request', 'AbortError'));
    const outcome = await absence;
    assert.equal(outcome.passed, false, 'client abort must not prove listener absence');
    assert.ok(outcome.error instanceof assert.AssertionError);
  } finally {
    clearTimeout(watchdog);
    stop.abort();
    const socketCloses = [...sockets].map(socket => new Promise(resolve => {
      socket.once('close', resolve);
      socket.destroy();
    }));
    await Promise.all([
      ...socketCloses,
      new Promise((resolve, reject) => {
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      }),
    ]);
    await absence;
  }
  assert.equal(server.listening, false);
  // The exact same port has an independently awaited server/socket close.
  await assertConnectionRefused(url);
});

for (const protocols of [['sse'], ['streamable-http'], ['sse', 'streamable-http']]) {
for (const buffered of [false, true]) {
  test('named initial proof for '+protocols.join('+')+' with '+(buffered?'buffered':'incremental')+' delivery', async t => {
    // This adapter supplies prepareProof: unlike the generic controller fallback,
    // its initial verifier requests SSE only when that requirement is explicit.
    const checksSse = protocols.includes('sse');
    // Redirect transport only; use the real gate nonce and timed-stream verifier.
    const app = createServer((_request, response) => response.end('fixture app'));
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const gatePort = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const adapter = createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>{throw new Error('proof must not start a connector');}});
    const origin = 'https://named.example.invalid';
    const context = {platform:'linux',now:Date.now,configuration:async()=>({token:'fixture-only',origin,'gate-port':String(gatePort)})};
    const supported = adapter.properties().protocols;
    for (const protocol of protocols) {
      const capability = protocol === 'streamable-http' ? 'streamableHttp' : 'sse';
      assert.equal(supported[capability], true, protocol+' must independently remain declared supported');
    }
    const request = {target:'127.0.0.1:'+app.address().port,usage:{kind:'attached'},requirements:{protocols}};
    const proof = await adapter.prepareProof(context, request);
    let closingProof;
    const closeProof = () => closingProof ??= proof.close();
    t.after(closeProof);
    const realFetch = globalThis.fetch;
    let streamResponses = 0;
    globalThis.fetch = async (input, init) => {
      const requested = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.equal(requested.origin, origin, 'fixture never contacts a provider');
      const local = new URL(requested.pathname + requested.search, 'http://127.0.0.1:'+gatePort);
      const response = await realFetch(local, init);
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        streamResponses += 1;
        if (buffered) return new Response(await response.arrayBuffer(), {status:response.status,headers:response.headers});
      }
      return response;
    };
    t.after(() => { globalThis.fetch = realFetch; });
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(new Error('fixture proof deadline')), 10_000);
    t.after(() => { clearTimeout(timeout); stop.abort(); });
    const attempt = {id:'named-stream-proof',signal:stop.signal,deadlineMs:Date.now()+10_000};
    const result = await proof.verify({origin,attempt});
    if (checksSse) assert.ok(streamResponses > 0, 'explicit SSE must reach the real timed stream request');
    else assert.equal(streamResponses, 0, 'Streamable HTTP alone does not request a timed SSE proof in this adapter');
    assert.equal(result.attemptId, attempt.id);
    assert.equal(result.endpoint, origin);
    assert.equal(result.vantage, 'this-device');
    const rejected = buffered && checksSse;
    assert.equal(result.status, rejected ? 'unverified' : 'verified');
    assert.deepEqual(result.checks, rejected ? [] : ['tls','nonce', ...(checksSse ? ['sse'] : [])]);
    if (rejected) assert.notEqual(result.status, 'verified', 'failed timed proof must not authorize publication');
    // Exercise exact local gate teardown, without stopping the independent app.
    await closeProof();
    await assertConnectionRefused('http://127.0.0.1:'+gatePort);
    assert.equal(await (await realFetch('http://127.0.0.1:'+app.address().port)).text(), 'fixture app');
    // No connector is allocated here. This is proof/gate coverage, not a
    // controller publication/withdrawal or remote Cloudflare TLS/client receipt.
  });
}
}
