import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { parseArgs } from '../../bin/gozar.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { readFile } from 'node:fs/promises';
import { openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';
import { fixture, effect, persist } from './helpers.mjs';
import { codeOf, query, scratch } from './route-schema-check.mjs';
import { providerWorld } from './session-provider-fixtures.mjs';

test('a session keeps its host deadline beyond the 15-minute default, and its proof gate does not close before it', async t => {
  const lifetimeMs = 1_800_000, before = Date.now();
  const w = await providerWorld(t, 'localhost-run', { lifetimeMs });
  const route = await w.expose(await w.approvedRequest());
  const bootstrap = JSON.parse(await readFile(join(w.home, `port-${w.target.split(':')[1]}`, 'bootstrap.json'), 'utf8'));
  assert.ok(bootstrap.expiresAtMs >= before + lifetimeMs && bootstrap.expiresAtMs <= Date.now() + lifetimeMs, 'the controller holds the host deadline, not the 15-minute default');
  assert.equal(route.verification.status, 'verified');
  assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed');
});

test('lifetime boundaries are enforced by the session request, the CLI parser and the gate', async t => {
  const home = await scratch(t);
  for (const value of [0, -1, 1.5, 2_147_483_648, '12', null]) {
    await assert.rejects(createGate(1, { lifetimeMs: value }), /lifetimeMs/);
    // A refused lifetime reaches no provider effect and starts no controller.
    assert.equal(await codeOf(openSessionRoute(query({ home, usage: { kind: 'session', lifetimeMs: value } }), { adapters: [], platform: 'linux' })), 'invalid_input', String(value));
  }
  for (const value of ['0', '-1', '1.5', '2147483648', 'abc']) assert.throws(() => parseArgs(['expose', '--lifetime-ms', value]), /was removed|Unknown option/);
  for (const value of [1, 2_147_483_647]) {
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
