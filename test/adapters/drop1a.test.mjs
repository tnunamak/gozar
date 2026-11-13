import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as core from '../../packages/gozar-core/generated/gozar_core.js';
import { loadCatalog } from '../../packages/gozar-node/catalog.mjs';
const root = new URL('../../', import.meta.url);
if (typeof core.default === 'function') await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('adapters/manifest.json');
const observed = await json('test/adapters/fixtures/drop1a-machine.json');
const fixture = await json('test/adapters/fixtures/plan-v1.json');
const records = await loadCatalog(new URL(root).pathname, { operational: true });
const step = input => JSON.parse(core.step(JSON.stringify(input)));

test('Drop1 catalog keeps five defaults and admits an opt-in stable relay', () => {
  assert.deepEqual(manifest.activeDrop1a, ['localhost-run', 'tailscale-funnel', 'tailscale-private', 'lan', 'own-address']);
  assert.deepEqual(records.filter(record => record.planVersion === 1).map(record => record.id).sort(), [...manifest.activeDrop1a, 'tunnl-gg'].sort());
  assert.equal(records.length, 10);
  for (const record of records) {
    if (record.id === 'tunnl-gg') { assert.equal(record.originPolicy, 'immutable'); }
    else if (!manifest.activeDrop1a.includes(record.id)) { assert.equal(record.drop, 'next'); assert.equal(record.recipes.create, undefined); }
    else if (['localhost-run', 'tailscale-funnel'].includes(record.id)) assert.deepEqual(record.clientProfile.clientRequirements, { httpsRequired: true, sse: true });
  }
});

test('machine-derived Funnel preflight reaches durable intent without fabricated profile or permission facts', () => {
  const record = records.find(record => record.id === 'tailscale-funnel');
  assert.equal(record.bindings.profileId, undefined);
  assert.equal(record.recipes.create.args.includes('--bg'), false);
  assert.equal(record.recipes.remove.kind, 'owned-process');
  const host = structuredClone(fixture.host); host.facts = {}; delete host.bindings.profileId;
  let output = step({ adapters: [record], host, command: { type: 'start', sessionId: fixture.sessionId, adapterId: record.id, consent: true }, requirements: manifest.drop1aRequirements });
  for (let count = 0; count < 8 && output.effects[0]?.stage === 'before'; count++) {
    const effect = output.effects[0];
    const raw = effect.stepId === 'config' ? { TCP: Object.fromEntries(observed.occupiedPorts.map(port => [String(port), { HTTPS: true }])) } : observed.status;
    output = step({ state: output.state, host, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: true, result: { exitCode: 0, stdout: JSON.stringify(raw), stderr: '', observation: { sessionId: fixture.sessionId, authorityRef: 'fixture-readonly-observation', observedAtMs: host.nowMs, expiresAtMs: 100000 } } } });
  }
  assert.equal(output.effects[0]?.kind, 'persist', JSON.stringify(output.snapshot));
  assert.equal(output.effects[0].record.bindings.port.value, 8443);
  assert.equal(output.effects[0].record.bindings.nodeId.value, observed.status.Self.ID);
  assert.equal(output.effects[0].record.bindings.tailnetSuffix.value, observed.status.CurrentTailnet.MagicDNSSuffix);
  assert.ok(!('tailnetId' in output.effects[0].record.bindings), 'no tailnet StableID: Tailscale 1.102.5 does not report it');
  assert.ok(!JSON.stringify(output.effects).includes('current-profile'));
  // No intent acknowledgement or execute effect is delivered by this read-only test.
  assert.equal(output.snapshot.resources.length, 0);
});
