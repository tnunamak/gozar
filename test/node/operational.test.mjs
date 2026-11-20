// The operational recipe path on the bounded allocation primitive: real core, real driver and journal. The allocation allocates, holds the
// core's probe for the session controller to request, and removes; it starts no timer and publishes nothing.
// The health, expiry-callback and late-probe tests of the earlier engine tested timer and republication policy that now belongs to the session
// controller alone (see session-lifecycle and the attached-route suites); the delivery report's matrix says where each of them went.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { SessionAllocation } from '../../packages/gozar-node/session-allocation.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { prepareHost, LOCAL_PLAN_FEATURES } from '../../packages/gozar-node/host.mjs';
import { fixture } from './helpers.mjs';

async function operationalFixture(t, { external = false, shortProof = false } = {}) {
  const app = http.createServer((request, response) => response.end('app-fixture'));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.closeAllConnections(); app.close(); });
  const gate = await createGate(app.address().port); t.after(() => gate.close());
  const { journal } = await fixture(t, {});
  const adapter = { id: 'plan-fixture', planVersion: 1, audience: 'local', ownership: external ? 'external-owned' : 'owned', capabilities: { https: false },
    admission: { state: 'admitted', requiredFeatures: [...LOCAL_PLAN_FEATURES, 'probe-assertions'] },
    bindings: external ? {} : { gatePort: { type: 'loopback-port' }, listenPort: { type: 'reserved-unused-port', value: 0 } },
    ...(external ? { endpoint: gate.target } : {}), recipes: external ? {} : {
      create: { kind: 'local-forwarder', bindAddress: '127.0.0.1', port: '{listenPort}', targetHost: '127.0.0.1', targetPort: '{gatePort}',
        parser: { kind: 'json', pointer: '/origin' }, before: [], requires: [], after: [],
        ledger: { bindAddress: '127.0.0.1', targetHost: '127.0.0.1', targetPort: '{gatePort}', scheme: 'http' } },
      remove: { kind: 'local-forwarder', before: [], requires: [], after: [], parser: { kind: 'exit-code' } },
    } };
  const controller = new SessionAllocation({ step: await loadCore(), journal, adapters: [adapter], requirements: { clientReach: 'this-device', sse: false }, targetPort: gate.port, sessionId: 'test' });
  await prepareHost(controller.driver, adapter, { gate });
  if (shortProof) controller.driver.host.probe.expiresAtMs = controller.driver.nowMs() + 1500;
  t.after(() => controller.shutdown());
  return { controller, adapter, gate, journal };
}

test('real operational WASM + driver allocates and holds the probe, runs it only when asked for the announced origin, then removes the owned resource', async t => {
  const { controller, journal } = await operationalFixture(t);
  const startedAt = Date.now();
  const output = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  assert.equal(output.snapshot.phase, 'validating', JSON.stringify(output.snapshot));
  assert.ok(output.snapshot.candidate, 'the allocation named its origin');
  assert.ok(Date.now() - startedAt < 2000, 'start must not wait on any proof or lease');
  assert.ok(controller.heldProbe, 'the core asked for a probe, and it is held, not run');
  assert.equal(controller.driver.acceptedProbeReceipt, undefined, 'no probe ran during allocation');
  assert.equal(controller.driver.timers.size, 0, 'the allocation starts no timer');
  assert.equal(output.snapshot.published, null, 'the allocation never publishes');
  const candidate = output.snapshot.candidate;
  assert.equal(await (await fetch(candidate)).text(), 'app-fixture');
  const proof = await controller.prove({ origin: candidate });
  assert.equal(proof.vantage, 'local');
  assert.equal(proof.probeReceipt.origin, new URL(candidate).origin);
  assert.equal(controller.last.snapshot.published, null, 'a proof does not publish: the session controller does');
  const stopped = await controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot));
  assert.equal(Object.keys(journal.value.owned).length, 0);
  assert.equal(controller.driver.timers.size, 0);
});

test('owned handle remains attributable through after-removal readback and retires only after core confirmation', async t => {
  const { controller, adapter, journal } = await operationalFixture(t);
  const after = { id: 'absent', recipe: { kind: 'spawn', program: process.execPath, args: ['-p', 'null'], timeoutMs: 1000,
    parser: { kind: 'json-document', predicate: { op: 'equals', pointer: '', value: null } } }, assert: { op: 'equals', pointer: '', value: null } };
  adapter.recipes.remove.after = [after];
  controller.adapters = [adapter]; controller.driver.adapters = structuredClone([adapter]);
  await controller.command({ type: 'start', adapterId: adapter.id, consent: true });
  const stopped = await controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot));
  assert.equal(stopped.snapshot.resources[0].cleanup, 'removed');
  assert.equal(Object.keys(journal.value.owned).length, 0);
});

// The pending-probe hypothesis at the allocation level, on the real core and driver: the core cannot be advanced past `validating` without
// an observed probe result, so a stop there must clean up from the recorded ownership alone, and must not need or invent a proof.
test('a stop while the core still waits for its probe removes the owned resource from the ledger, with no proof run and none invented', async t => {
  const { controller, journal } = await operationalFixture(t);
  const output = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  assert.equal(output.snapshot.phase, 'validating');
  assert.equal(Object.keys(journal.value.owned).length, 1, 'one owned resource is recorded before any proof');
  const transitions = [];
  const step = controller.step;
  controller.step = input => { transitions.push(input.command.effectId ?? input.command.type); return step(input); };
  const stopped = await controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot));
  assert.equal(stopped.snapshot.resources[0].cleanup, 'removed');
  assert.equal(Object.keys(journal.value.owned).length, 0);
  assert.equal(controller.driver.acceptedProbeReceipt, undefined, 'no probe receipt exists for a proof that never ran');
  assert.equal(journal.value.validation ?? null, null);
  assert.equal(stopped.snapshot.published, null);
  assert.ok(controller.heldProbe?.id, 'the probe effect the core asked for was held');
  assert.equal(transitions.includes(controller.heldProbe.id), false, `the core was never fed a result for its probe: ${transitions}`);
  await assert.rejects(controller.prove({ origin: output.snapshot.candidate }), /No core probe is held/, 'a stopped allocation proves nothing');
});

test('a proof is run only for the origin the core asked about', async t => {
  const { controller } = await operationalFixture(t);
  const output = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  await assert.rejects(controller.prove({ origin: 'https://foreign.example' }), /not the origin the core asked/);
  assert.equal(controller.driver.acceptedProbeReceipt, undefined, 'a refused request leaves no receipt');
  const proof = await controller.prove({ origin: output.snapshot.candidate });
  assert.equal(proof.probeReceipt.origin, new URL(output.snapshot.candidate).origin);
});
