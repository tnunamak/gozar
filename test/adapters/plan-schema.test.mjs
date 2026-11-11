import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('adapters/manifest.json');
const records = await Promise.all(manifest.normalizedDefinitions.map(async path => (await json(`adapters/${path}`)).definition));
const contract = await json('adapters/plan-contract.json');
const captureTypes = new Set(['bool', 'port', 'dns-name', 'opaque-ref', 'origin', 'mount', 'record', 'port-set']);
const assertionOps = new Set(['all', 'not', 'equals', 'exists', 'verified', 'private-file', 'port-unoccupied', 'exact-route', 'owned-ledger-match', 'owned-route-absent']);
function checkAssertion(rule) {
  assert.ok(assertionOps.has(rule.op), `unsupported assertion ${rule.op}`);
  if (rule.op === 'all') for (const child of rule.items ?? rule.rules ?? rule.predicates) checkAssertion(child);
  if (rule.op === 'not') checkAssertion(rule.predicate ?? rule.rule);
  if (['port-unoccupied', 'exact-route', 'owned-ledger-match', 'owned-route-absent'].includes(rule.op)) {
    assert.equal(typeof rule.source, 'string'); assert.equal(typeof rule.pointer, 'string');
  }
  if (rule.op === 'exact-route') assert.ok(Object.hasOwn(rule, 'expected'));
  if (['equals', 'exists'].includes(rule.op)) assert.equal(typeof rule.pointer, 'string');
}
function checkCapture(spec) {
  assert.ok(captureTypes.has(spec.type));
  if (spec.type === 'port-set') { assert.ok(spec.paths.length); return; }
  assert.equal(typeof spec.pointer, 'string');
  if (spec.type === 'record') for (const child of Object.values(spec.fields)) checkCapture(child);
}
for (const record of records) {
  test(`normalized schema ${record.id}`, () => {
    assert.equal(record.planVersion, 1);
    assert.ok(record.admission.requiredFeatures.length);
    for (const operation of ['create', 'remove']) {
      const recipe = record.recipes[operation];
      if (!recipe) { assert.equal(record.ownership, 'external-owned'); continue; }
      for (const side of ['before', 'after']) {
        assert.ok(recipe[side].length <= 16);
        assert.equal(new Set(recipe[side].map(step => step.id)).size, recipe[side].length);
        for (const step of recipe[side]) {
          assert.deepEqual(Object.keys(step).filter(key => !['id', 'recipe', 'captures', 'assert'].includes(key)), []);
          assert.equal(step.recipe.before, undefined); assert.equal(step.recipe.after, undefined);
          for (const capture of Object.values(step.captures ?? {})) checkCapture(capture);
          if (step.assert) checkAssertion(step.assert);
        }
      }
      for (const rule of recipe.requires) checkAssertion(rule);
      assert.equal(recipe.assertions, undefined);
      if (recipe.process) assert.ok(Object.keys(recipe.process).every(key => ['mode', 'stdin', 'lifetimeMs', 'collectMs'].includes(key)));
    }
  });
}

test('all listener maps feed private selection; fixed occupied ports are never candidates', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  assert.deepEqual(record.bindings.port.candidates, [9444, 9445]);
  assert.deepEqual(record.bindings.port.protectedPorts, [443, 10000]);
  assert.deepEqual(record.recipes.create.before.find(step => step.id === 'config').captures.occupiedPorts.paths, contract.captures.rawPortMaps);
  assert.ok(!record.bindings.port.candidates.includes(9443));
  assert.ok(!record.bindings.port.candidates.includes(8444));
});

test('blocked private materialization plans stay wrapped and denied', () => {
  for (const [id, features] of Object.entries(contract.blocked)) {
    const record = records.find(record => record.id === id);
    assert.equal(record.admission.state, 'blocked');
    for (const feature of features) assert.ok(record.admission.requiredFeatures.includes(feature));
  }
});

test('Tailscale readback checks whole raw records before whitelist capture', () => {
  for (const id of ['tailscale-funnel', 'tailscale-private']) {
    const record = records.find(record => record.id === id);
    const readback = record.recipes.create.after[0];
    const rules = readback.assert.items;
    const prefix = id === 'tailscale-funnel' ? '/Foreground/*' : '';
    assert.ok(rules.some(rule => rule.op === 'equals' && rule.pointer === `${prefix}/TCP/{port}` && Object.keys(rule.value).length === 1));
    assert.deepEqual(rules.find(rule => rule.op === 'equals' && rule.pointer === `${prefix}/Web/{dnsName}:{port}`).value, { Handlers: { '/': { Proxy: '{loopbackTarget}' } } });
    assert.deepEqual(Object.keys(readback.captures.route.fields).sort(), ['funnel', 'https', 'proxy']);
    if (id === 'tailscale-funnel') assert.equal(record.recipes.remove.kind, 'owned-process');
    else assert.ok(record.recipes.remove.requires.some(rule => rule.op === 'owned-ledger-match' && rule.source === 'live' && rule.pointer === '/route'));
  }
});
