import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as core from '../../../packages/gozar-core/generated/gozar_core.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const native = process.env.GOZAR_NATIVE ?? path.resolve(root, process.env.CARGO_TARGET_DIR || 'target', 'debug/gozar-core-json');
const endpoint = { scheme: 'https', hostname: 'endpoint.example', port: 443, endpointName: 'fixture-endpoint' };
const upstream = { scheme: 'http', hostname: '127.0.0.1', port: 53123 };
const verified = { op: 'verified', fact: 'credential-scope', value: { credentialRef: '{credential}', endpoint: '{endpoint}' } };
const mapping = { op: 'transport-mapping', fact: 'transport-scope', endpoint: '{endpoint}', upstream, policyRef: 'fixture-policy', origin: 'https://endpoint.example' };
const features = ['recipe-sequence', 'typed-bindings', 'owned-process', 'owned-resource-ledger', 'private-file-reference', 'private-file-materialization', 'transport-origin-mapping'];
const adapter = {
  id: 'fixture', audience: 'public', ownership: 'owned', planVersion: 1,
  admission: { state: 'admitted', requiredFeatures: features }, endpointTemplate: 'https://endpoint.example',
  bindings: {
    credential: { type: 'credential-reference' }, endpoint: { type: 'transport-endpoint' },
    privateFile: { type: 'session-private-path', materialize: { format: 'json', template: { token: { kind: 'credential-ref', binding: 'credential' } }, credentialRefs: ['credential'], requires: [verified] } },
  },
  recipes: { create: { kind: 'spawn', program: 'fixture-only', args: ['--config', '{privateFile}'], parser: { kind: 'exit-code' }, process: { mode: 'owned-long-running', stdin: 'closed', lifetimeMs: 900000 }, ledger: { endpoint: '{endpoint}' }, requires: [verified, mapping] }, remove: { kind: 'owned-process', resourceId: '{resourceId}', signal: 'SIGTERM', graceMs: 100, thenSignal: 'SIGKILL', confirmExit: true, requires: [{ op: 'owned-ledger-match', source: 'ownership', pointer: '/route' }] } },
};
const scope = { sessionId: 'hooks', generation: 1, authorityRef: 'fixture-authority', observedAtMs: 1000, expiresAtMs: 10000 };
const host = {
  nowMs: 1000, features, probe: { nonceRef: 'fixture-nonce', verifierRef: 'fixture-verifier', expiresAtMs: 10000 },
  bindings: {
    credential: { ...scope, type: 'credential-reference', handleRef: 'credential-handle' },
    endpoint: { ...scope, type: 'transport-endpoint', value: endpoint },
    privateFile: { ...scope, type: 'session-private-path', handleRef: 'file-handle', mode: '0600', parentMode: '0700', materialization: { credentialRefs: { credential: 'credential-handle' } } },
  },
  facts: {
    'credential-scope': { ...scope, value: { credentialRef: 'credential-handle', endpoint } },
    'transport-scope': { ...scope, value: { endpoint, upstream, policyRef: 'fixture-policy', origin: 'https://endpoint.example' } },
  },
};
let steps = 0;
function both(input) {
  const wasm = JSON.parse(core.step(JSON.stringify(input)));
  const result = spawnSync(native, [], { input: JSON.stringify(input) + '\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), wasm);
  steps++;
  return wasm;
}
const start = (record, authority) => both({ adapters: [record], host: authority, command: { type: 'start', sessionId: 'hooks', adapterId: record.id, consent: true }, requirements: { clientReach: 'internet' } });
const ack = (output, authority, result = { durable: true }) => both({ state: output.state, host: authority, command: { type: 'effect-result', effectId: output.effects[0].id, sessionId: 'hooks', generation: output.effects[0].generation, ok: true, result } });
const intent = start(adapter, host);
assert.equal(intent.effects[0].kind, 'persist');
const spawn = ack(intent, host); assert.equal(spawn.effects[0].kind, 'spawn');
for (const mutate of [
  value => { value.bindings.credential.generation = 0; },
  value => { value.bindings.privateFile.generation = 0; },
  value => { value.bindings.privateFile.mode = '0644'; },
  value => { value.bindings.privateFile.materialization.credentialRefs.credential = 'wrong-handle'; },
  value => { value.facts['credential-scope'].value.credentialRef = 'wrong-handle'; },
  value => { value.facts['transport-scope'].value.upstream.port = 53124; },
  value => { value.facts['transport-scope'].value.endpoint.scheme = 'tls'; },
  value => { value.facts['transport-scope'].generation = 0; },
  value => { value.facts['transport-scope'].expiresAtMs = 0; },
  value => { value.features = value.features.filter(feature => feature !== 'private-file-materialization'); },
]) {
  const authority = structuredClone(host); mutate(authority);
  assert.deepEqual(start(adapter, authority).effects, []);
  assert.deepEqual(ack(intent, authority).effects, []);
}
const secretHost = structuredClone(host); secretHost.bindings.credential.value = 'SECRET_BODY_SENTINEL';
const secretOutput = start(adapter, secretHost);
assert.ok(secretOutput.error); assert.ok(!JSON.stringify(secretOutput).includes('SECRET_BODY_SENTINEL'));
for (const scheme of ['tls', 'tcp']) {
  const record = structuredClone(adapter), authority = structuredClone(host);
  authority.bindings.endpoint.value.scheme = scheme;
  authority.facts['credential-scope'].value.endpoint.scheme = scheme;
  authority.facts['transport-scope'].value.endpoint.scheme = scheme;
  assert.deepEqual(start(record, authority).effects, []);
}
const allocated = ack(spawn, host, { exitCode: 0, ownership: { handleRef: 'owned-fixture', continuityRef: 'fixture-continuity', kind: 'process', sessionId: 'hooks', generation: 1, details: { endpoint } } });
const expired = { ...structuredClone(host), nowMs: 10001, bindings: {}, facts: {} };
const stopping = both({ state: allocated.state, host: expired, command: { type: 'stop' } });
assert.equal(stopping.effects[0].recipeRef, 'remove/ownership');
const ownershipReceipt = { handleRef: 'owned-fixture', continuityRef: 'fixture-continuity', sessionId: 'hooks', observedAtMs: 10001, expiresAtMs: 20000, continuous: true };
const checked = ack(stopping, expired, { details: { endpoint }, ownershipReceipt, observation: { sessionId: 'hooks', authorityRef: 'fixture-observer', observedAtMs: 10001, expiresAtMs: 20000 } });
assert.equal(checked.effects[0].kind, 'persist');
const removing = ack(checked, expired); assert.equal(removing.effects[0].kind, 'owned-process');
const stopped = ack(removing, expired, { exitCode: 0, removed: true, ownershipReceipt });
assert.equal(stopped.snapshot.phase, 'stopped');
console.log(JSON.stringify({ nativeWasmEqual: true, sharedHooks: true, steps, providerCommandsExecuted: 0 }));
