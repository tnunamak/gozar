import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { Controller } from '../../packages/gozar-node/controller.mjs';
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
  const controller = new Controller({ step: await loadCore(), journal, adapters: [adapter], requirements: { clientReach: 'this-device', sse: false }, targetPort: gate.port, sessionId: 'test' });
  await prepareHost(controller.driver, adapter, { gate });
  if (shortProof) controller.driver.host.probe.expiresAtMs = controller.driver.nowMs() + 1500;
  t.after(() => controller.shutdown());
  return { controller, adapter, gate, journal };
}

test('real operational WASM + driver creates, returns before expiry timer, inspects exact handle and removes', async t => {
  const { controller, journal } = await operationalFixture(t);
  const startedAt = Date.now();
  const output = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  assert.equal(output.snapshot.phase, 'candidate-ready', JSON.stringify(output.snapshot));
  assert.ok(Date.now() - startedAt < 2000, 'start must not await lease expiry');
  assert.equal(controller.background.size, 1);
  const ready = await controller.approve();
  assert.equal(ready.snapshot.phase, 'published-ready');
  assert.equal(await (await fetch(ready.snapshot.published)).text(), 'app-fixture');
  const stopped = await controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot));
  assert.equal(Object.keys(journal.value.owned).length, 0);
  assert.equal(controller.driver.timers.size, 0);
  assert.equal(controller.driver.proofExpiries.size, 0);
});

test('operational health rechecks exact instance and withdraws wrong-origin health without mutation', async t => {
  const { controller, gate } = await operationalFixture(t, { external: true });
  const started = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  assert.equal(started.snapshot.phase, 'candidate-ready', JSON.stringify(started.snapshot));
  await controller.approve();
  const generation = controller.state.generation;
  const refreshed = await controller.command({ type: 'health' });
  assert.equal(refreshed.snapshot.phase, 'candidate-ready', JSON.stringify(refreshed.snapshot));
  assert.ok(refreshed.snapshot.generation > generation);
  assert.deepEqual([...controller.driver.proofExpiries.keys()], [refreshed.snapshot.generation]);
  await controller.approve();
  const original = gate.verify;
  gate.verify = async () => { throw new Error('Origin points to a different instance'); };
  const failed = await controller.command({ type: 'health' });
  assert.equal(failed.snapshot.published, null);
  assert.equal(failed.snapshot.phase, 'degraded');
  assert.equal(failed.action.kind, 'external');
  assert.equal(controller.driver.forwarders.size, 0);
  assert.equal(controller.driver.children.size, 0);
  gate.verify = original;
});

test('real expiry callback withdraws readiness while stop cancels future timers promptly', async t => {
  const { controller } = await operationalFixture(t, { external: true, shortProof: true });
  const started = await controller.command({ type: 'start', adapterId: 'plan-fixture', consent: true });
  assert.equal(started.snapshot.phase, 'candidate-ready', JSON.stringify(started.snapshot));
  await controller.approve();
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal(controller.last.snapshot.phase, 'degraded');
  assert.equal(controller.last.snapshot.published, null);
  const start = Date.now(); await controller.shutdown();
  assert.ok(Date.now() - start < 1000);
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

test('late probe completion cannot retain obsolete proof expiry history', async t => {
  const { controller, adapter } = await operationalFixture(t, { external:true });
  adapter.audience = 'public'; adapter.capabilities.https = true; adapter.endpoint = 'https://fixture.invalid';
  controller.adapters = [adapter]; controller.driver.adapters = structuredClone([adapter]);
  controller.requirements = { clientReach:'internet', httpsRequired:true, sse:false };
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  let calls = 0;
  controller.driver.probeExecutor = { vantages:['public'], async verify({authorization,origin,vantage}) {
    const now = controller.driver.nowMs();
    const receipt = {...authorization,origin,vantage,remote:true,observedAtMs:now,expiresAtMs:now+1500,
      tls:true,instanceMatched:true,sse:false,streamableHttp:false,oauthDcr:false};
    if (++calls === 1) { enter(); await blocked; }
    return {probeReceipt:receipt};
  }};
  const start = controller.command({type:'start',adapterId:adapter.id,consent:true});
  await entered;
  const current = await controller.command({type:'health'});
  release(); await start;
  assert.equal(current.snapshot.phase,'candidate-ready');
  assert.deepEqual([...controller.driver.proofExpiries.keys()],[current.snapshot.generation]);
  await new Promise(resolve => setTimeout(resolve,1700));
  assert.equal(controller.driver.timers.size,0);
  assert.equal(controller.driver.proofExpiries.size,0);
  assert.equal(controller.state.published,null);
});
