// Cross-check the shared Node shim using only an observation effect.
import assert from 'node:assert/strict';
import { loadCore } from '../../../packages/gozar-node/core.mjs';
import { Controller } from '../../../packages/gozar-node/controller.mjs';
const adapter = {
  id: 'opaque-observer', audience: 'public', ownership: 'owned', capabilities: { https: true },
  recipes: { detect: { kind: 'spawn', program: 'ssh', args: ['-V'], timeoutMs: 5000,
    maxOutputBytes: 16384, parser: { kind: 'contains', value: 'OpenSSH', stream: 'combined' } } },
};
const saves = [];
const controller = new Controller({ step: await loadCore(), adapters: [adapter],
  requirements: { clientReach: 'internet' }, sessionId: 'host-smoke', targetPort: 1,
  journal: { save: async value => saves.push(structuredClone(value)) } });
const output = await controller.command({ type: 'detect' });
assert.equal(output.snapshot.observations[adapter.id], 'present');
assert.equal(saves.length, 2);
assert.equal(output.effects.length, 0);
console.log(JSON.stringify({ nodeHost: true, wasm: true, observation: 'present', statesSaved: saves.length, routeCreated: false }));
