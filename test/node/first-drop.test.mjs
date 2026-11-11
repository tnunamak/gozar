import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { expandPlan } from '../../packages/gozar-node/plan.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { fixture } from './helpers.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
for (const adapterId of ['localhost-run', 'tailscale-funnel', 'tailscale-private']) {
  test(`actual ${adapterId} recipe admits and spawns with nonempty process intent ledger (isolated fake executable)`, async t => {
    const { driver, directory, journal } = await fixture(t, {});
    const adapter = structuredClone(await loadDefinition(root, adapterId));
    const fake = join(directory, 'owned-fixture');
    await writeFile(fake, `#!${process.execPath}\nprocess.stdout.write('https://fixture.lhr.life\\n');setInterval(()=>{},1000);\n`, { mode: 0o700 });
    // Keep every real argv, binding, ledger and process-policy field. Only the executable is a fixture.
    adapter.recipes.create.program = fake;
    adapter.recipes.create.process.collectMs = 20;
    driver.adapters = [adapter]; driver.authorize(adapter.id);
    const gate = await createGate(1); t.after(() => gate.close()); driver.targetPort = gate.port;
    await prepareHost(driver, adapter, { gate, probeExecutor: { vantages: ['public'], verify: async () => { throw new Error('No live verifier in fixture'); } } });
    const captured = { dnsName: 'node.fixture.example', nodeId: 'fixture-node', tailnetId: 'fixture-tailnet', tailnetSuffix: 'fixture.example' };
    const bindings = {};
    for (const [name, spec] of Object.entries(adapter.bindings)) {
      if (driver.host.bindings[name]) bindings[name] = driver.host.bindings[name];
      else {
        const value = Object.hasOwn(spec, 'value') ? spec.value : spec.type === 'unused-port' ? spec.candidates[0] : captured[name];
        assert.notEqual(value, undefined, `fixture needs captured ${name}`);
        bindings[name] = { type: spec.type, value, authorityRef: `plan:1:${name}` };
      }
    }
    const recipe = adapter.recipes.create;
    const execute = expandPlan(Object.fromEntries(Object.entries(recipe).filter(([key]) => !['before', 'after', 'requires', 'ledger', 'parser', 'process'].includes(key))), bindings);
    execute.longRunning = true; execute.lifetimeMs = recipe.process.lifetimeMs; execute.collectMs = 20;
    const bindingRefs = Object.fromEntries(Object.entries(bindings).map(([name, binding]) => [name, binding.authorityRef]));
    const scope = { sessionId: 'test', generation: 1, adapterId, resourceId: null, bindings, bindingRefs };
    const persisted = await driver.execute({ ...scope, id: 'intent', kind: 'persist', operation: 'create', recipeRef: 'create/execute', stage: 'persist', stepId: 'intent',
      record: { operation: 'create', adapterId, resourceId: null, sessionId: 'test', generation: 1, recipeRef: 'create/execute', execute, bindings, baseline: {} } });
    assert.equal(persisted.ok, true, JSON.stringify(persisted));
    const created = await driver.execute({ ...execute, ...scope, id: 'spawn', operation: 'create', recipeRef: 'create/execute', stage: 'execute', stepId: 'execute' });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(created.result.ownership.details, expandPlan(recipe.ledger, bindings));
    const resource = journal.value.owned[created.result.resourceId];
    assert.equal(resource.kind, 'process'); assert.ok(resource.pid && resource.startIdentity && resource.nonce && resource.continuityRef);
    assert.equal(created.result.ownership.continuityRef, resource.continuityRef);
  });
}
