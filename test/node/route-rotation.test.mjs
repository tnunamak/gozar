import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve, control } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite, processIdentity } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const A = 'https://first.lhr.life', B = 'https://second.lhr.life';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await check()) return; await wait(10); }
  assert.fail(`Timed out: ${label}`);
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function session(t, { approveOrigin = false } = {}) {
  const { directory } = await fixture(t, {});
  const adapter = structuredClone(await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'localhost-run'));
  const command = join(directory, 'output.json'), executable = join(directory, 'relay');
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');console.log(${JSON.stringify(A)});let last='';setInterval(()=>{try{const text=fs.readFileSync(${JSON.stringify(command)},'utf8');if(text!==last){last=text;const parts=JSON.parse(text);process.stdout.write(parts[0]);if(parts[1])setTimeout(()=>process.stdout.write(parts[1]),40);}}catch{}},10);\n`, { mode: 0o700 });
  adapter.recipes.create.program = executable;
  adapter.recipes.create.process.collectMs = 20;
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters: [adapter], adapterId: adapter.id, targetPort: 18765,
    requirements: { clientReach: 'internet', httpsRequired: true, sse: true }, consent: true, approveOrigin, lifetimeMs: 60000 });
  const requests = [];
  let outputs = 0;
  let block;
  const probeExecutor = { vantages: ['public'], async verify(request) {
    requests.push(request);
    if (block) await block.promise;
    const now = Math.floor(performance.timeOrigin + performance.now());
    return { probeReceipt: { ...request.authorization, origin: request.origin, vantage: 'public', remote: true,
      observedAtMs: now, expiresAtMs: now + 30000, tls: true, instanceMatched: true, sse: true } };
  } };
  const running = await serve(directory, { probeExecutor, processOutputObserver: () => { outputs++; } });
  t.after(async () => { block?.resolve(); await running.terminate(); });
  const emit = async (...parts) => { const count = outputs; await writeFile(command, JSON.stringify(parts)); await until(() => outputs > count, 'owned child line'); await wait(60); };
  return { ...running, directory, requests, emit, block: value => { block = value; } };
}

// The child owns the output pipe; only the outside verifier is injected. serve() loads the built WASM.
test('owned relay rotation survives health generations and requires fresh proof and exact approval', async t => {
  const s = await session(t);
  const { controller: c } = s;
  assert.equal(c.state.candidate, A);
  assert.equal(s.requests.length, 1, 'startup line must not cause another probe');
  await c.approve();
  for (let i = 0; i < 3; i++) { await c.command({ type: 'health' }); await c.approve(); }
  const generation = c.state.generation, previous = s.requests.at(-1);
  const owned = Object.values(c.journal.value.owned).find(value => value.kind === 'process');
  assert.ok(generation > owned.generation);
  const hold = deferred(); s.block(hold);
  await s.emit('https://second.', 'lhr.life\n');
  await until(() => s.requests.length === 5, 'replacement probe');
  assert.equal(c.state.published, null, 'A withdrawn while new proof is pending');
  assert.equal(c.state.candidate, B);
  const request = s.requests.at(-1);
  assert.equal(request.origin, B);
  assert.notEqual(request.authorization.nonceRef, previous.authorization.nonceRef);
  assert.notEqual(request.challenge.nonce, previous.challenge.nonce);
  assert.equal(request.requirements.httpsRequired, true); assert.equal(request.requirements.sse, true);
  hold.resolve(); s.block(undefined);
  await until(() => c.state.phase === 'candidate-ready', 'replacement validated');
  await c.command({ type: 'approve-origin', origin: A, generation: c.state.generation });
  assert.equal(c.state.published, null);
  await c.command({ type: 'approve-origin', origin: B, generation });
  assert.equal(c.state.published, null);
  await c.approve(); assert.equal(c.state.published, B);
  const change = { oldOrigin: A, newOrigin: B, generation: c.state.generation };
  assert.deepEqual((await control(s.directory, { type: 'status' })).snapshot.lastRouteChange, change);
  const count = s.requests.length, nonce = s.gate.challenge().nonce;
  for (const text of [B + '\n', 'https://foreign.example\n', 'https://third.lhr.life https://fourth.lhr.life\n', 'x'.repeat(4097) + ' https://third.lhr.life\n']) await s.emit(text);
  assert.equal(s.requests.length, count); assert.equal(s.gate.challenge().nonce, nonce);
  assert.equal(c.state.published, B);
  assert.deepEqual((await control(s.directory, { type: 'status' })).snapshot.lastRouteChange, change);
  const stopped = await c.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped'); assert.deepEqual(stopped.localCleanupFailures, []);
  assert.deepEqual(c.journal.value.owned, {}); assert.equal(await processIdentity(owned.pid), null);
});

for (const boundary of ['continuity', 'probe']) test(`stop during rotation ${boundary} prevents later proof from restoring publication`, async t => {
  const s = await session(t, { approveOrigin: true });
  const c = s.controller, hold = deferred();
  assert.equal(c.state.published, A);
  let entered = false;
  if (boundary === 'continuity') {
    const original = c.driver.continuity.bind(c.driver);
    c.driver.continuity = async (...args) => { c.driver.continuity = original; entered = true; await hold.promise; return original(...args); };
  } else s.block(hold);
  await s.emit(B + '\n');
  await until(() => boundary === 'continuity' ? entered : s.requests.length === 2, 'held rotation');
  const oldProbe = s.requests.at(-1);
  const stopped = await c.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped');
  hold.resolve(); s.block(undefined); await wait(100);
  assert.equal(c.state.published, null); assert.equal(c.state.stopRequested, true);
  assert.deepEqual(c.journal.value.owned, {}); assert.deepEqual(stopped.localCleanupFailures, []);
  if (boundary === 'probe') assert.equal(oldProbe.signal.aborted, true);
  if (boundary === 'continuity') assert.equal(s.requests.length, 1, 'stopped continuity must not issue B probe');
});

test('late health proof from the old generation cannot republish the retired origin', async t => {
  const s = await session(t, { approveOrigin: true }), c = s.controller;
  const hold = deferred(); s.block(hold);
  const health = c.command({ type: 'health' });
  await until(() => s.requests.length === 2, 'old health probe');
  const oldGeneration = c.state.generation;
  s.block(undefined);
  await s.emit(B + '\n');
  await until(() => c.state.published === B, 'replacement published');
  const generation = c.state.generation;
  assert.ok(generation > oldGeneration);
  hold.resolve(); await health;
  assert.equal(c.state.published, B); assert.equal(c.state.generation, generation);
  assert.equal(c.state.lastRouteChange.newOrigin, B);
  const stopped = await c.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped'); assert.deepEqual(stopped.localCleanupFailures, []);
  assert.deepEqual(c.journal.value.owned, {});
});

test('invalid internal allocation observation fails closed without publishing its origin', async t => {
  const s = await session(t, { approveOrigin: true }), c = s.controller;
  const resource = Object.values(c.journal.value.owned).find(value => value.kind === 'process');
  assert.equal(c.state.published, A, 'startup publication');
  const result = await c.command({ type: 'owned-process-origin', sessionId: c.sessionId, adapterId: 'localhost-run',
    resourceId: resource.id, allocationGeneration: resource.generation + 1, continuityRef: resource.continuityRef, origin: B, line: B });
  assert.notEqual(result.snapshot.published, B);
  assert.equal(result.snapshot.candidate, A);
  assert.ok(result.snapshot.limitations.includes('Owned route resource identity mismatch'));
  assert.equal(s.requests.length, 1, 'rejected allocation must not issue a replacement probe');
});
