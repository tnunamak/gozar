import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
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

function dialFixtureGate(port, signal) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({host:'127.0.0.1',port,signal});
    socket.once('error', reject);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.setTimeout(2_000, () => socket.destroy(new Error('fixture gate dial timed out')));
  });
}

async function prepareFixtureProof(adapter, origin, request) {
  for (let tries = 0; tries < 4; tries += 1) {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    try {
      return await adapter.prepareProof({
        platform:'linux', now:Date.now,
        configuration:async () => ({token:'fixture-only', origin, 'gate-port':String(port)}),
      }, request);
    } catch (error) {
      const occupied = error?.code === 'EADDRINUSE' ||
        (error?.code === 'provider_unavailable' && error?.cause?.code === 'gate_port_in_use');
      if (!occupied || tries === 3) throw error;
    }
  }
}

test('proof fixture retries a real occupied-port failure before binding cleanly', async t => {
  const app = createServer((_request, response) => response.end('fixture app'));
  const occupied = createServer();
  for (const server of [app, occupied]) {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  }
  const adapter = createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>assert.fail('no connector')});
  let calls = 0;
  const firstOccupied = {async prepareProof(ctx, request) {
    calls += 1;
    if (calls !== 1) return adapter.prepareProof(ctx, request);
    const configured = await ctx.configuration();
    return adapter.prepareProof({...ctx, configuration:async()=>({
      ...configured, 'gate-port':String(occupied.address().port),
    })}, request);
  }};
  const proof = await prepareFixtureProof(firstOccupied, 'https://named.example.invalid', {
    target:'127.0.0.1:'+app.address().port, usage:{kind:'attached'}, requirements:{protocols:[]},
  });
  t.after(() => proof.close());
  assert.ok(calls >= 2 && calls <= 4, 'the real occupied-port refusal must retry within the fixture budget');
  assert.equal(await (await fetch('http://'+proof.target)).text(), 'fixture app');
});

for (const {protocols, buffered} of [
  {protocols:['sse','streamable-http'],buffered:false},
  {protocols:['sse','streamable-http'],buffered:true},
  {protocols:['sse'],buffered:false},
  {protocols:['sse'],buffered:true},
  {protocols:['streamable-http'],buffered:false},
]) {
  test('named attached proof for '+protocols.join('+')+' ('+(buffered?'buffering proxy':'streaming proxy')+')', async t => {
    const requiresSse = protocols.includes('sse');
    const shouldReject = requiresSse && buffered;
    // Redirect transport only; use the real gate nonce and timed-stream verifier.
    const app = createServer((_request, response) => response.end('fixture app'));
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
    const adapter = createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>{throw new Error('proof must not start a connector');}});
    const origin = 'https://named.example.invalid';
    const request = {target:'127.0.0.1:'+app.address().port,usage:{kind:'attached'},requirements:{protocols}};
    const proof = await prepareFixtureProof(adapter, origin, request);
    const gatePort = Number(proof.target.split(':').at(-1));
    let closing;
    const closeGate = () => (closing ??= Promise.resolve().then(() => proof.close()));
    t.after(closeGate);
    const realFetch = globalThis.fetch;
    let streamResponses = 0;
    let bufferedResponses = 0;
    globalThis.fetch = async (input, init) => {
      const requested = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      assert.equal(requested.origin, origin, 'fixture never contacts a provider');
      const local = new URL(requested.pathname + requested.search, 'http://127.0.0.1:'+gatePort);
      const response = await realFetch(local, init);
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        streamResponses += 1;
        if (buffered) {
          bufferedResponses += 1;
          return new Response(await response.arrayBuffer(), {status:response.status,headers:response.headers});
        }
      }
      return response;
    };
    t.after(() => { globalThis.fetch = realFetch; });
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(new Error('fixture proof deadline')), 10_000);
    t.after(() => { clearTimeout(timeout); stop.abort(); });
    const attempt = {id:'named-stream-proof',signal:stop.signal,deadlineMs:Date.now()+10_000};
    const result = await proof.verify({origin,attempt});
    if (requiresSse) assert.ok(streamResponses > 0, 'SSE must reach the real timed stream request');
    else assert.equal(streamResponses, 0, 'Streamable HTTP alone does not need a timed SSE observation');
    assert.equal(result.attemptId, attempt.id);
    assert.equal(result.endpoint, origin);
    assert.equal(result.vantage, 'this-device');
    assert.equal(bufferedResponses, buffered ? streamResponses : 0, 'only timed SSE responses can be buffered');
    assert.equal(result.status, shouldReject ? 'unverified' : 'verified');
    assert.deepEqual(result.checks, shouldReject ? [] : requiresSse ? ['tls','nonce','sse'] : ['tls','nonce']);
    if (shouldReject) assert.notEqual(result.status, 'verified', 'no successful proof may authorize publication');
    await dialFixtureGate(gatePort);
    const canceledObservation = new AbortController();
    canceledObservation.abort();
    await assert.rejects(dialFixtureGate(gatePort, canceledObservation.signal), {code:'ABORT_ERR'});
    await dialFixtureGate(gatePort);
    await closeGate();
    await assert.rejects(dialFixtureGate(gatePort), {code:'ECONNREFUSED'});
    const stillRunning = await realFetch('http://127.0.0.1:'+app.address().port, {signal:AbortSignal.timeout(2_000)});
    assert.equal(stillRunning.status, 200);
    assert.equal(await stillRunning.text(), 'fixture app');
  });
}

test('aborting an in-flight named proof stops its observation but not the owned gate', {timeout: 15000}, async t => {
  const app = createServer((_request, response) => response.end('fixture app'));
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    app.closeAllConnections();
    app.close(resolve);
  }));

  const origin = 'https://named.example.invalid';
  const adapter = createNamedAdapter({
    detectBinary: async () => true,
    startConnector: async () => { throw new Error('proof must not start a connector'); },
  });
  const request = {
    target: '127.0.0.1:' + app.address().port,
    usage: {kind:'attached'},
    requirements: {protocols:['streamable-http']},
  };
  const proof = await prepareFixtureProof(adapter, origin, request);
  const gatePort = Number(proof.target.split(':').at(-1));
  let closing;
  const closeGate = () => (closing ??= Promise.resolve().then(() => proof.close()));
  t.after(closeGate);
  await dialFixtureGate(gatePort);

  const realFetch = globalThis.fetch;
  const stop = new AbortController();
  const reason = new Error('synthetic in-flight proof abort');
  let entered, release;
  const observation = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, origin);
    assert.match(url.pathname, /\/identity$/);
    const signal = init?.signal;
    entered(signal);
    return new Promise((resolve, reject) => {
      const failed = () => reject(signal.reason);
      if (signal?.aborted) { failed(); return; }
      signal?.addEventListener('abort', failed, {once:true});
      void held.then(() => {
        signal?.removeEventListener('abort', failed);
        resolve(new Response(null, {status:503}));
      });
    });
  };

  async function bounded(promise, label) {
    let timer;
    try {
      return await Promise.race([
        promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), 1500);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const attempt = {id:'named-inflight-abort', signal:stop.signal, deadlineMs:Date.now()+10000};
  const verification = proof.verify({origin, attempt});
  void verification.catch(() => {});
  try {
    const forwarded = await bounded(observation, 'proof did not reach its network observation');
    assert.ok(forwarded && !forwarded.aborted);
    stop.abort(reason);
    const result = await bounded(verification, 'proof did not settle on attempt abort');
    assert.equal(forwarded.reason, reason);
    assert.equal(requests, 1);
    assert.equal(result.attemptId, attempt.id);
    assert.equal(result.endpoint, origin);
    assert.equal(result.vantage, 'this-device');
    assert.equal(result.status, 'unverified');
    assert.deepEqual(result.checks, []);
    await dialFixtureGate(gatePort);
    await closeGate();
    await assert.rejects(dialFixtureGate(gatePort), {code:'ECONNREFUSED'});
    const stillRunning = await realFetch('http://127.0.0.1:'+app.address().port, {signal:AbortSignal.timeout(2000)});
    assert.equal(await stillRunning.text(), 'fixture app');
  } finally {
    stop.abort(reason);
    release();
    try { await bounded(verification.catch(() => {}), 'proof did not clean up'); }
    finally { globalThis.fetch = realFetch; }
  }
});
