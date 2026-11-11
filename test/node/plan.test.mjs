import test from 'node:test';
import assert from 'node:assert/strict';
import { admitPlanEffect, expandPlan, recipeAt, validateBinding } from '../../packages/gozar-node/plan.mjs';

const adapter = { id: 'opaque', planVersion: 1, admission: { state: 'admitted', requiredFeatures: ['recipe-sequence', 'typed-bindings'] }, bindings: { gatePort: { type: 'loopback-port' } }, recipes: {
  create: { kind: 'spawn', program: 'fixture', args: ['{gatePort}'], before: [{ id: 'inspect', recipe: { kind: 'spawn', program: 'fixture', args: ['inspect'] } }], after: [] },
} };
const binding = { type: 'loopback-port', value: 3000, authorityRef: 'host:gate', sessionId: 'one', observedAtMs: 10, expiresAtMs: 100 };
const context = { adapters: [adapter], sessionId: 'one', targetPort: 3000, features: ['recipe-sequence', 'typed-bindings'], host: { bindings: { gatePort: binding } }, nowMs: 20 };
const execute = { id: 'effect', sessionId: 'one', generation: 1, adapterId: 'opaque', operation: 'create', kind: 'spawn', program: 'fixture', args: [3000],
  recipeRef: 'create/execute', stepId: 'execute', stage: 'execute', bindings: { gatePort: binding }, bindingRefs: { gatePort: binding.authorityRef } };

test('plan admission resolves the exact recipeRef, never another nested command', () => {
  assert.equal(admitPlanEffect(execute, context).recipe.program, 'fixture');
  assert.throws(() => admitPlanEffect({ ...execute, recipeRef: 'create/before/inspect', stepId: 'inspect', stage: 'before', operation: 'observe' }, context), /payload differs/);
  assert.throws(() => admitPlanEffect({ ...execute, recipeRef: 'create/before/unlisted', stepId: 'unlisted', stage: 'before', operation: 'observe' }, context), /exact admitted/);
  assert.throws(() => recipeAt(adapter, 'create/before/inspect/execute'), /exact admitted/);
  assert.throws(() => admitPlanEffect({ ...execute, args: ['unapproved'] }, context), /payload differs/);
});

test('binding authority must match exact session, target, reference and freshness', () => {
  for (const patch of [{ sessionId: 'other' }, { expiresAtMs: 15 }, { observedAtMs: 25 }, { value: 3001 }, { authorityRef: 'wrong' }]) {
    const changed = { ...binding, ...patch };
    assert.throws(() => admitPlanEffect({ ...execute, bindings: { gatePort: changed }, bindingRefs: { gatePort: changed.authorityRef } }, context));
  }
  assert.throws(() => admitPlanEffect(execute, { ...context, features: [] }), /feature admission/);
  assert.equal(validateBinding('loopback-http-origin', 'http://127.0.0.1:3001', 3000), false);
  assert.equal(validateBinding('dns-name', 'host;command.example', 3000), false);
});

test('typed exact placeholders retain numbers while private interpolations remain opaque', () => {
  const bindings = { port: { type: 'port', value: 9445 }, privateFile: { type: 'session-private-path', handleRef: 'private:one' } };
  assert.deepEqual(expandPlan({ port: '{port}', args: ['port={port}', 'file={privateFile}', '{privateFile}'] }, bindings),
    { port: 9445, args: ['port=9445', 'file={privateFile}', 'private:one'] });
});
