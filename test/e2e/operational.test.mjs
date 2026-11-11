import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startDummy } from '../../harness/dummy-server.mjs';
import { operationalFixture, planFeatures } from '../../harness/operational-fixtures.mjs';
import { admitPlanEffect } from '../../packages/gozar-node/plan.mjs';
import { probe } from '../../harness/probe.mjs';
import { processIdentity } from '../../packages/gozar-node/journal.mjs';

async function serverFixture(t) {
  const server = await startDummy(); t.after(() => server.close()); return server;
}
const start = fixture => fixture.controller.command({ type: 'start', adapterId: fixture.adapter.id, consent: true });
const noAllocation = async fixture => { assert.equal(Object.keys(fixture.journal.value.owned).length, 0); await assert.rejects(access(fixture.files.mutation)); };

test('actual WASM + Controller/EffectDriver runs ordered observations, durable intent, allocation and readback', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port });
  const execute = fixture.driver.execute.bind(fixture.driver);
  fixture.driver.execute = async effect => {
    if (effect.stage === 'execute' && effect.operation === 'create') {
      const disk = JSON.parse(await readFile(fixture.journal.path, 'utf8'));
      assert.ok(Object.values(disk.intents).some(record => record.durable && record.operation === 'create'), 'execute requires an actual fsynced intent');
      assert.equal(typeof effect.targetPort, 'number', 'whole typed placeholders preserve numeric type');
      assert.equal(effect.targetPort, server.port);
    }
    return execute(effect);
  };
  const result = await start(fixture);
  assert.deepEqual(fixture.dispatched.map(effect => effect.stage), ['before', 'persist', 'execute', 'after', 'probe'], `operational wire/API mismatch: ${JSON.stringify(result.snapshot)}`);
  assert.ok(fixture.completions.slice(0, 4).every(completion => completion.ok), JSON.stringify(fixture.completions));
  assert.ok(result.snapshot.candidate?.startsWith('http://127.0.0.1:'));
  assert.equal(result.snapshot.published, null, 'missing actual verifier cannot publish');
  const receipt = await probe({ origin: result.snapshot.candidate, nonce: server.nonce });
  assert.equal(receipt.vantage, 'local'); assert.equal(receipt.events.length, 2);
  const stopped = await fixture.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped'); assert.equal(Object.keys(fixture.journal.value.owned).length, 0);
  await assert.rejects(fetch(result.snapshot.candidate, { signal: AbortSignal.timeout(1000) }));
});

test('failed real preflight guard prevents durable intent and all allocation', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port, guard: false });
  const result = await start(fixture);
  assert.equal(fixture.dispatched[0]?.recipeRef, 'create/before/config', 'preflight must actually execute');
  assert.equal(fixture.completions[0]?.ok, true, JSON.stringify(fixture.completions));
  assert.equal(result.snapshot.phase, 'failed');
  assert.ok(!fixture.dispatched.some(effect => ['persist', 'execute'].includes(effect.stage)));
  assert.equal(Object.keys(fixture.journal.value.intents).length, 0); await noAllocation(fixture);
});

test('raw provider document rejects extra handlers before a whitelist capture can discard them', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port });
  const expected = { origin: server.origin, Handlers: { '/': { Proxy: server.origin } } };
  fixture.adapter.recipes.create.before[0].assert = { op: 'equals', pointer: '/route', value: expected };
  fixture.adapter.recipes.create.before[0].captures = { route: { type: 'record', pointer: '/route', fields: { origin: { type: 'origin', pointer: '/origin' } } } };
  fixture.driver.adapters = [structuredClone(fixture.adapter)];
  await writeFile(fixture.files.config, JSON.stringify({ allow: true, route: { ...expected, Handlers: { ...expected.Handlers, '/unrelated': { Proxy: 'http://unrelated.invalid' } } } }));
  const result = await start(fixture);
  assert.equal(fixture.completions[0]?.ok, true, 'must observe the real adversarial config');
  assert.equal(result.snapshot.phase, 'failed');
  assert.equal(fixture.dispatched.filter(effect => effect.stage === 'execute').length, 0);
  assert.equal(Object.keys(fixture.journal.value.intents).length, 0); await noAllocation(fixture);
});

test('exact nested recipeRef and typed authority reject sibling payload and binding substitution', async () => {
  const host = { bindings: {} };
  const observation = { kind: 'spawn', program: process.execPath, args: ['--version'], timeoutMs: 1000 };
  const sibling = { ...observation, args: ['-e', 'throw Error("must not run")'] };
  const adapter = { id: 'plan', planVersion: 1, admission: { state: 'admitted', requiredFeatures: ['recipe-sequence', 'typed-bindings'] },
    bindings: { targetPort: { type: 'loopback-port', value: 8123 } }, recipes: { create: { ...observation, before: [{ id: 'first', recipe: observation }, { id: 'sibling', recipe: sibling }] } } };
  const effect = { ...observation, id: 'scope:1:1', sessionId: 'scope', generation: 1, adapterId: 'plan', operation: 'observe', recipeRef: 'create/before/first', stepId: 'first', stage: 'before',
    bindings: { targetPort: { type: 'loopback-port', value: 8123, authorityRef: 'plan:1:targetPort' } }, bindingRefs: { targetPort: 'plan:1:targetPort' } };
  const context = { adapters: [adapter], sessionId: 'scope', targetPort: 8123, host, features: planFeatures, nowMs: Date.now() };
  admitPlanEffect(effect, context);
  assert.throws(() => admitPlanEffect({ ...effect, args: sibling.args }, context), /exact admitted recipe/);
  assert.throws(() => admitPlanEffect({ ...effect, recipeRef: 'create/before/sibling' }, context), /identity/);
  assert.throws(() => admitPlanEffect({ ...effect, bindings: { targetPort: { ...effect.bindings.targetPort, value: 443 } } }, context), /changed|type|target/);
  assert.throws(() => admitPlanEffect({ ...effect, bindingRefs: { targetPort: 'other-actor' } }, context), /definition/);
});

test('owned long-running process stop preserves an unrelated process', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port, kind: 'process' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); await once(unrelated, 'spawn');
  const identity = await processIdentity(unrelated.pid);
  t.after(async () => { if (unrelated.exitCode === null && unrelated.signalCode === null) { const exited = once(unrelated, 'exit'); unrelated.kill('SIGTERM'); await exited; } });
  await start(fixture);
  const resource = Object.values(fixture.journal.value.owned).find(item => item.kind === 'process');
  assert.ok(resource?.startIdentity, JSON.stringify(fixture.completions));
  assert.equal(await processIdentity(resource.pid), resource.startIdentity);
  const result = await fixture.controller.shutdown(); assert.equal(result.snapshot.phase, 'stopped');
  assert.notEqual(await processIdentity(resource.pid), resource.startIdentity);
  assert.equal(await processIdentity(unrelated.pid), identity);
});

test('external-owned operational origin is observed and never allocated or removed', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port, ownership: 'external-owned' });
  const result = await start(fixture); await fixture.controller.shutdown();
  assert.equal(fixture.dispatched[0]?.kind, 'http-probe', 'external origin must actually be observed');
  assert.equal(result.snapshot.candidate, server.origin);
  assert.ok(fixture.dispatched.every(effect => effect.operation === 'probe'), JSON.stringify(fixture.dispatched));
  await noAllocation(fixture);
  assert.equal((await fetch(server.origin + '/identity')).status, 200, 'external server survives stop');
});

test('unsupported private config materialization fails closed before any mutation', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port });
  fixture.adapter.admission.requiredFeatures.push('private-config-materialization');
  const result = await start(fixture);
  assert.equal(result.snapshot.phase, 'failed'); assert.equal(fixture.dispatched.length, 0);
  assert.match(result.snapshot.limitations.join(' '), /private-config-materialization/, 'must reject the exact unsupported feature');
  await noAllocation(fixture);
});


test('a second actor changing ownership continuity blocks removal of the first actor allocation', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port, kind: 'process' });
  await start(fixture);
  const resource = Object.values(fixture.journal.value.owned).find(item => item.kind === 'process');
  assert.ok(resource?.continuityRef, 'actual allocation must establish immutable continuity');
  const secondActor = JSON.parse(await readFile(fixture.journal.path, 'utf8'));
  secondActor.owned[resource.id].continuityRef = 'second-actor:replacement';
  await writeFile(fixture.journal.path, JSON.stringify(secondActor));
  await fixture.journal.load();
  const boundary = fixture.dispatched.length;
  const stopped = await fixture.controller.command({ type: 'stop' });
  assert.equal(stopped.snapshot.phase, 'cleanup-pending');
  assert.ok(!fixture.dispatched.slice(boundary).some(effect => effect.operation === 'remove' && effect.stage === 'execute'));
  assert.equal(await processIdentity(resource.pid), resource.startIdentity, 'unknown continuity must preserve the allocation');
});


test('actual first observation pending leaves status responsive and unpublished', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port });
  fixture.adapter.recipes.create.before[0].recipe.args[1] = 'observe-slow';
  fixture.driver.adapters = [structuredClone(fixture.adapter)];
  let signal; const began = new Promise(resolve => { signal = resolve; });
  const execute = fixture.driver.execute.bind(fixture.driver);
  fixture.driver.execute = effect => { if (effect.recipeRef === 'create/before/config') signal(); return execute(effect); };
  const starting = start(fixture);
  const observed = await Promise.race([began.then(() => true), starting.then(() => false)]);
  assert.equal(observed, true, 'actual preflight must start before the start command completes');
  const before = performance.now(); const status = await fixture.controller.command({ type: 'status' });
  assert.ok(performance.now() - before < 300, 'status must not wait for the slow child');
  assert.equal(status.snapshot.published, null); assert.equal(Object.keys(fixture.journal.value.owned).length, 0);
  await starting;
});


test('fresh observations do not bypass a false requires predicate', { timeout: 8000 }, async t => {
  const server = await serverFixture(t); const fixture = await operationalFixture(t, { targetPort: server.port });
  fixture.adapter.recipes.create.requires = [{ op: 'equals', source: 'config', pointer: '/allowed', value: false }];
  fixture.driver.adapters = [structuredClone(fixture.adapter)];
  const result = await start(fixture);
  assert.equal(fixture.completions[0]?.ok, true, 'requires must be tested after a real successful observation');
  assert.equal(result.snapshot.phase, 'failed'); assert.ok(fixture.dispatched.every(effect => effect.stage === 'before'));
  await noAllocation(fixture);
});
