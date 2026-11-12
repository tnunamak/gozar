import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseArgs } from '../../bin/gozar.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { serve, launch, control } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { fixture, effect, persist } from './helpers.mjs';

test('daemon gate remains open beyond the default lifetime until the host deadline', async t => {
  const { directory } = await fixture(t, {});
  const adapter = { id: 'external-fixture', planVersion: 1, audience: 'public', ownership: 'external-owned', capabilities: { https: null },
    admission: { state: 'admitted', requiredFeatures: ['typed-bindings', 'probe-assertions', 'client-vantage-probe'] },
    bindings: { externalOrigin: { type: 'credential-free-https-origin' } }, endpointTemplate: '{externalOrigin}', recipes: {}, setup: { requiresProxyTarget: true } };
  await atomicWrite(join(directory, 'bootstrap.json'), { adapters: [adapter], requirements: { clientReach: 'internet', httpsRequired: true }, targetPort: 18765,
    adapterId: adapter.id, origin: 'https://owner.fixture.invalid', consent: true, lifetimeMs: 1_800_000 });
  const originalSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 900_000 || delay === 1_800_000) {
      const timer = { callback: () => callback(...args), delay, unref() {} };
      timers.push(timer); return timer;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  t.after(() => { globalThis.setTimeout = originalSetTimeout; });
  const running = await serve(directory);
  t.after(() => running.terminate());
  const advance = ms => { for (const timer of timers.filter(timer => timer.delay <= ms)) timer.callback(); };
  advance(900_001);
  const identity = await fetch(`${running.gate.target}${running.gate.challenge().identityPath}`);
  assert.equal(identity.status, 200);
  assert.equal(timers[0].delay, 1_800_000);
  const status = await control(directory, { type: 'status' });
  assert.equal(status.lifetimeMs, 1_800_000);
  assert.equal(running.controller.driver.lifetimeMs, 1_800_000);
  assert.ok(Number.isInteger(status.expiresAtMs));
  running.gate.rotate();
  assert.equal((await control(directory, { type: 'status' })).expiresAtMs, status.expiresAtMs);
  assert.equal(running.gate.expiresAtMs, status.expiresAtMs);
  advance(1_800_000);
  const expired = await fetch(`${running.gate.target}${running.gate.challenge().identityPath}`).then(response => response.status, () => 'closed');
  assert.ok(expired === 503 || expired === 'closed');
});


test('lifetime boundaries are enforced by CLI, launch, daemon, and gate', async t => {
  const { directory } = await fixture(t, {});
  for (const value of [0, -1, 1.5, 2_147_483_648, '12', null]) {
    await assert.rejects(createGate(1, { lifetimeMs: value }), /lifetimeMs/);
    await assert.rejects(launch(directory, { lifetimeMs: value }), /lifetimeMs/);
    await atomicWrite(join(directory, 'bootstrap.json'), { lifetimeMs: value });
    await assert.rejects(serve(directory), /lifetimeMs/);
  }
  for (const value of ['0', '-1', '1.5', '2147483648', 'abc']) assert.throws(() => parseArgs(['expose', '--lifetime-ms', value]), /lifetime/);
  assert.throws(() => parseArgs(['status', '--lifetime-ms', '1']), /lifetime/);
  for (const value of [1, 2_147_483_647]) {
    assert.equal(parseArgs(['expose', '--lifetime-ms', String(value)]).lifetimeMs, value);
    const gate = await createGate(1, { lifetimeMs: value });
    assert.equal(gate.lifetimeMs, value);
    await gate.close();
  }
  const gate = await createGate(1);
  assert.equal(gate.lifetimeMs, 900_000);
  await gate.close();
});


test('host lifetime overrides the admitted owned-process timer without changing its recipe', async t => {
  const recipe = { kind: 'spawn', program: process.execPath, args: ['-e', 'process.stdout.write("ok");setInterval(()=>{},1000)'], timeoutMs: 1000, maxOutputBytes: 100, longRunning: true, collectMs: 20, lifetimeMs: 900_000 };
  const { driver } = await fixture(t, { create: recipe });
  driver.lifetimeMs = 1_800_000;
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (callback, delay, ...args) => { if (delay === 900_000 || delay === 1_800_000) delays.push(delay); return originalSetTimeout(callback, delay, ...args); };
  t.after(() => { globalThis.setTimeout = originalSetTimeout; });
  await persist(driver);
  assert.equal((await driver.execute(effect(recipe, 'create', 'child'))).ok, true);
  assert.deepEqual(delays, [1_800_000]);
  assert.equal(driver.adapters[0].recipes.create.lifetimeMs, 900_000);
});

test('own-address local origin remains admissible at minute 16 while supplied authority still expires', async t => {
  const { loadDefinition } = await import('../../packages/gozar-node/catalog.mjs');
  const { prepareHost } = await import('../../packages/gozar-node/host.mjs');
  const { admitPlanEffect, expandPlan } = await import('../../packages/gozar-node/plan.mjs');
  const { fileURLToPath } = await import('node:url');
  const adapter = await loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), 'own-address');
  const { driver } = await fixture(t, {});
  let now = 1_000_000;
  driver.nowMs = () => now;
  driver.lifetimeMs = 1_800_000;
  const gate = { nonceRef: 'nonce', verifierRef: 'verifier', expiresAtMs: now + 1_800_000 };
  const prepare = authorities => prepareHost(driver, adapter, { origin: 'https://owner.example', gate, probeExecutor: {}, authorities });
  const host = await prepare({});
  const makeEffect = binding => {
    const bindings = { externalOrigin: binding };
    const recipe = Object.fromEntries(Object.entries(adapter.recipes.detect).filter(([key]) => key !== 'parser'));
    return { ...expandPlan(recipe, bindings), id: 'detect', sessionId: 'test', generation: 1, adapterId: adapter.id,
      operation: 'detect', recipeRef: 'detect/execute', stepId: 'execute', stage: 'execute', bindings, bindingRefs: { externalOrigin: binding.authorityRef } };
  };
  const context = host => ({ adapters: [adapter], sessionId: 'test', targetPort: driver.targetPort, features: host.features, host, nowMs: now });
  const localEffect = makeEffect(host.bindings.externalOrigin);
  assert.doesNotThrow(() => admitPlanEffect(localEffect, context(host)));
  const supplied = { ...host.bindings.externalOrigin, authorityRef: 'supplied', expiresAtMs: now + 900_000 };
  const suppliedFact = { value: true, sessionId: 'test', generation: 1, authorityRef: 'supplied-fact', observedAtMs: now, expiresAtMs: now + 900_000 };
  const suppliedHost = await prepare({ bindings: { externalOrigin: supplied }, facts: { externalProof: suppliedFact } });
  assert.equal(suppliedHost.facts.externalProof.expiresAtMs, suppliedFact.expiresAtMs);
  now += 960_000;
  assert.doesNotThrow(() => admitPlanEffect(localEffect, context(host)));
  assert.throws(() => admitPlanEffect(makeEffect(supplied), context(suppliedHost)), /stale/);
  assert.equal(host.probe.expiresAtMs, 1_900_000);
});
