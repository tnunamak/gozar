import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { materializePrivateBinding, privateMaterializationScope } from '../../packages/gozar-node/materialization.mjs';
import { assertTransportMapping, transportEndpoint } from '../../packages/gozar-node/transport.mjs';
import { PrivateFiles } from '../../packages/gozar-node/private-files.mjs';
import { fixture } from './helpers.mjs';

const nowMs = 1000, sessionId = 'test', generation = 1;
function authority(value) { return { value, sessionId, generation, authorityRef: 'fixture-authority', observedAtMs: 900, expiresAtMs: 2000 }; }
function materializationCase() {
  const credential = { ...authority(undefined), type: 'credential-reference', handleRef: 'credential:fixture' }; delete credential.value;
  const bindings = { credential, hostname: { ...authority('selected.example'), type: 'dns-name' }, tunnel: { ...authority('selected-tunnel'), type: 'opaque-private-reference' } };
  const value = { credentialRef: credential.handleRef, hostname: 'selected.example', tunnel: 'selected-tunnel' };
  const facts = { 'credential-scope': authority(value) };
  const spec = { type: 'session-private-path', materialize: { format: 'json', template: { credential: { kind: 'credential-ref', binding: 'credential' }, hostname: '{hostname}' },
    credentialRefs: ['credential'], requires: [{ op: 'verified', fact: 'credential-scope', value: { credentialRef: '{credential}', hostname: '{hostname}', tunnel: '{tunnel}' } }] } };
  return { spec, bindings, facts, sessionId, generation, nowMs };
}

test('materializer resolves only an exact scoped opaque reference into private filesystem modes', async t => {
  const { journal } = await fixture(t, {}); const input = materializationCase();
  const secret = ['synthetic', 'credential', 'fixture'].join('-');
  let resolves = 0;
  const files = new PrivateFiles({ journal, sessionId, resolveCredential: async ref => { resolves++; assert.equal(ref, input.bindings.credential.handleRef); return secret; } });
  const receipt = await materializePrivateBinding({ ...input, files });
  assert.equal(resolves, 1); assert.equal(receipt.generation, generation);
  assert.deepEqual(receipt.materialization, { credentialRefs: { credential: 'credential:fixture' } });
  const path = await files.path(receipt.handleRef);
  assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { credential: secret, hostname: 'selected.example' });
  assert.equal((await readFile(journal.path, 'utf8')).includes(secret), false); assert.equal(JSON.stringify(receipt).includes(secret), false);
  await files.remove(receipt.handleRef);
});

test('materializer rejects stale, missing, wrong-generation, mismatched facts before resolving or creating files', async t => {
  const { journal } = await fixture(t, {}); let resolves = 0;
  const files = new PrivateFiles({ journal, sessionId, resolveCredential: async () => { resolves++; return 'fixture'; } });
  for (const edit of [
    value => { delete value.bindings.credential; }, value => { value.bindings.credential.generation = 2; },
    value => { value.bindings.credential.expiresAtMs = nowMs; }, value => { value.bindings.credential.sessionId = 'other'; },
    value => { value.bindings.credential.value = 'not-a-reference'; }, value => { value.bindings.credential.path = '/private/forbidden'; },
    value => { value.bindings.hostname.generation = 2; }, value => { value.bindings.hostname.expiresAtMs = nowMs; },
    value => { value.bindings.tunnel.sessionId = 'other'; }, value => { value.facts['credential-scope'].value.hostname = 'other.example'; },
    value => { value.facts['credential-scope'].generation = 2; }, value => { value.facts['credential-scope'].expiresAtMs = nowMs; },
    value => { value.spec.materialize.template.credential.binding = 'other'; }, value => { value.spec.materialize.requires = []; },
  ]) {
    const value = materializationCase(); edit(value);
    await assert.rejects(materializePrivateBinding({ ...value, files }));
  }
  assert.equal(resolves, 0); assert.deepEqual(journal.value.owned, {});
});

test('resolver failures expose a fixed error and never return credential bytes', async t => {
  const { journal } = await fixture(t, {});
  const files = new PrivateFiles({ journal, sessionId, resolveCredential: async () => { throw new Error('private-diagnostic'); } });
  await assert.rejects(materializePrivateBinding({ ...materializationCase(), files }), error => error.message === 'Credential handle unavailable');
  assert.deepEqual(journal.value.owned, {});
});

test('typed endpoint mapping preserves HTTPS, TLS and TCP and exact upstream and policy identity', () => {
  for (const scheme of ['https', 'tls', 'tcp']) {
    const endpoint = { scheme, hostname: 'selected.example', port: 443, endpointName: 'selected-endpoint' };
    assert.equal(transportEndpoint(endpoint), true);
    const rule = { op: 'transport-mapping', fact: 'mapping', endpoint, upstream: { scheme: 'tcp', hostname: '127.0.0.1', port: 8123 }, policyRef: 'policy:selected' };
    if (scheme === 'https') rule.origin = 'https://selected.example';
    const expected = Object.fromEntries(Object.entries(rule).filter(([key]) => !['op', 'fact'].includes(key)));
    const host = { facts: { mapping: authority(expected) } };
    assert.deepEqual(assertTransportMapping(rule, host, {}, { sessionId, generation, nowMs }), expected);
    for (const edit of [value => { value.generation = 2; }, value => { value.expiresAtMs = nowMs; }, value => { value.sessionId = 'other'; }, value => { value.value.upstream.port = 8124; }]) {
      const changed = structuredClone(host); edit(changed.facts.mapping);
      assert.throws(() => assertTransportMapping(rule, changed, {}, { sessionId, generation, nowMs }));
    }
    if (scheme !== 'https') assert.throws(() => assertTransportMapping({ ...rule, origin: 'https://selected.example' }, host, {}, { sessionId, generation, nowMs }), /cannot coerce/);
  }
  assert.equal(transportEndpoint({ scheme: 'https', hostname: 'user@selected.example', port: 443, endpointName: 'selected' }), false);
});

async function operationalMaterialization(t) {
  const { journal } = await fixture(t, {});
  const { EffectDriver } = await import('../../packages/gozar-node/driver.mjs');
  const { loadCore } = await import('../../packages/gozar-node/core.mjs');
  const { Controller } = await import('../../packages/gozar-node/controller.mjs');
  const input = materializationCase(); const current = Date.now();
  for (const receipt of [...Object.values(input.bindings), ...Object.values(input.facts)]) { receipt.observedAtMs = current - 10; receipt.expiresAtMs = current + 60000; }
  const endpoint = { scheme: 'https', hostname: 'selected.example', port: 443, endpointName: 'selected-endpoint' };
  input.bindings.endpoint = { ...authority(endpoint), type: 'transport-endpoint', observedAtMs: current - 10, expiresAtMs: current + 60000 };
  const mapping = { op: 'transport-mapping', fact: 'mapping', endpoint: '{endpoint}', upstream: { scheme: 'http', hostname: '127.0.0.1', port: 8123 }, policyRef: 'policy:selected', origin: 'https://selected.example' };
  input.facts.mapping = { ...authority({ endpoint, upstream: mapping.upstream, policyRef: mapping.policyRef, origin: mapping.origin }), observedAtMs: current - 10, expiresAtMs: current + 60000 };
  const features = ['recipe-sequence', 'typed-bindings', 'predicate-parser', 'owned-resource-ledger', 'owned-process', 'private-file-reference', 'private-file-materialization', 'transport-origin-mapping', 'probe-assertions', 'client-vantage-probe'];
  const actor = journal.directory + '/private-child.mjs';
  await writeFile(actor, 'import {readFileSync} from "node:fs";const c=JSON.parse(readFileSync(process.argv[2],"utf8"));console.log(c.credential);console.error(c.credential);setInterval(()=>{},1000);');
  const adapter = { id: 'private-plan', planVersion: 1, audience: 'public', ownership: 'owned', capabilities: { https: true }, admission: { state: 'admitted', requiredFeatures: features },
    bindings: { configFile: input.spec, credential: { type: 'credential-reference' }, hostname: { type: 'dns-name' }, tunnel: { type: 'opaque-private-reference' }, endpoint: { type: 'transport-endpoint' } },
    endpointTemplate: 'https://{hostname}', recipes: {
      create: { kind: 'spawn', program: process.execPath, args: [actor, '{configFile}'],
        timeoutMs: 1000, maxOutputBytes: 4096, parser: { kind: 'exit-code' }, process: { mode: 'owned-long-running', stdin: 'closed', lifetimeMs: 10000, collectMs: 20 },
        requires: [{ op: 'private-file', binding: 'configFile', mode: '0600', parentMode: '0700' }, mapping], ledger: { endpoint: '{endpoint}' } },
      remove: { kind: 'owned-process', signal: 'SIGTERM', thenSignal: 'SIGKILL', graceMs: 100, confirmExit: true, parser: { kind: 'exit-code' } } } };
  const secret = ['synthetic', 'private', 'dispatch'].join('-'); const observed = [];
  const driver = new EffectDriver({ adapters: [adapter], journal, sessionId, targetPort: 8123, resolveCredential: async () => secret, observeProcessOutput: true, onProcessOutput: event => observed.push(event) });
  driver.host = { features, bindings: input.bindings, facts: input.facts, probe: { nonceRef: 'private-test-nonce', verifierRef: 'private-test-verifier', expiresAtMs: current + 60000, allowPublicRelay: true } };
  driver.authorize(adapter.id);
  const fileReceipt = await driver.materializePrivateFile(adapter.id, 'configFile', { generation: 1 });
  const path = await driver.privateFiles.path(fileReceipt.handleRef);
  const step = await loadCore();
  const output = step({ command: { type: 'start', sessionId, adapterId: adapter.id, consent: true }, adapters: [adapter], requirements: { clientReach: 'internet', httpsRequired: true }, host: { ...driver.host, nowMs: driver.nowMs() } });
  const controller = new Controller({ step, journal, adapters: [adapter], requirements: { clientReach: 'internet', httpsRequired: true }, targetPort: 8123, sessionId, driver });
  controller.state = output.state; controller.last = output;
  return { adapter, driver, controller, journal, output, step, secret, observed, fileReceipt, path };
}

test('actual WASM persists then spawns a secret-file child; output stays private and stop removes only its exact artifact', async t => {
  const data = await operationalMaterialization(t);
  t.after(() => data.driver.closeLocal());
  assert.equal(data.output.effects[0]?.kind, 'persist', JSON.stringify(data.output));
  const persisted = await data.driver.execute(data.output.effects[0]); assert.equal(persisted.ok, true, JSON.stringify(persisted));
  const next = await data.controller.apply(persisted);
  const create = next.effects.find(effect => effect.operation === 'create'); assert.ok(create, JSON.stringify(next));
  const created = await data.driver.execute(create); assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.result.stdout, ''); assert.equal(created.result.stderr, '');
  await data.controller.apply(created);
  const resource = data.journal.value.owned[created.result.resourceId];
  const argv = await readFile(`/proc/${resource.pid}/cmdline`, 'utf8');
  assert.equal(argv.includes(data.path), true); assert.equal(argv.includes(data.secret), false);
  assert.equal(data.observed.length, 0); assert.equal(data.driver.readProcessOutput().length, 0);
  assert.equal((await readFile(data.journal.path, 'utf8')).includes(data.secret), false);
  assert.equal(JSON.stringify([persisted, created, data.controller.state]).includes(data.secret), false);
  await assert.rejects(data.driver.privateFiles.remove(data.fileReceipt.handleRef), /owner is still running/);
  for (const receipt of [...Object.values(data.driver.host.bindings), ...Object.values(data.driver.host.facts)]) receipt.expiresAtMs = 1;
  const foreignPath = data.path + '.unrelated'; await writeFile(foreignPath, 'unrelated');
  const stopped = await data.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped));
  await assert.rejects(stat(data.path), { code: 'ENOENT' });
  assert.equal(await readFile(foreignPath, 'utf8'), 'unrelated');
});

test('core denies wrong-scope private materialization and transport receipts before persistence', async t => {
  const data = await operationalMaterialization(t); t.after(() => data.driver.closeLocal());
  const original = structuredClone(data.driver.host);
  for (const edit of [
    host => { delete host.bindings.configFile.materialization; },
    host => { host.bindings.configFile.generation = 2; },
    host => { host.bindings.configFile.expiresAtMs = 1; },
    host => { host.bindings.configFile.materialization.credentialRefs.credential = 'credential:other'; },
    host => { host.bindings.credential.generation = 2; },
    host => { host.facts['credential-scope'].value.hostname = 'other.example'; },
    host => { host.facts['credential-scope'].sessionId = 'other'; },
    host => { host.facts.mapping.value.upstream.port = 8124; },
    host => { host.facts.mapping.generation = 2; },
  ]) {
    const host = structuredClone(original); edit(host);
    const output = data.step({ command: { type: 'start', sessionId, adapterId: data.adapter.id, consent: true }, adapters: [data.adapter], requirements: { clientReach: 'internet', httpsRequired: true }, host: { ...host, nowMs: data.driver.nowMs() } });
    assert.deepEqual(output.effects, []); assert.equal(output.snapshot.published, null);
  }
});

test('dispatch rechecks exact private and mapping authority after the core issued the durable intent', async t => {
  const data = await operationalMaterialization(t); t.after(() => data.driver.closeLocal());
  const original = structuredClone(data.driver.host);
  for (const edit of [
    host => { host.bindings.configFile.generation = 2; },
    host => { host.bindings.credential.generation = 2; },
    host => { host.facts['credential-scope'].value.tunnel = 'other-tunnel'; },
    host => { host.facts.mapping.value.endpoint.scheme = 'tls'; },
  ]) {
    data.driver.host = structuredClone(original); edit(data.driver.host);
    const result = await data.driver.execute(data.output.effects[0]);
    assert.equal(result.ok, false); assert.equal(result.result.notApplied, true);
  }
  assert.deepEqual(data.journal.value.intents, {}); assert.equal(data.driver.children.size, 0);
});


test('artifact provenance rejects changed templates with identical credential refs and mismatched approved upstreams', async t => {
  const data = await operationalMaterialization(t); t.after(() => data.driver.closeLocal());
  data.driver.adapters[0].bindings.configFile.materialize.template.hostname = 'different.example';
  let result = await data.driver.execute(data.output.effects[0]);
  assert.equal(result.ok, false); assert.match(result.result.detail, /exact materialization declaration/);
  data.driver.adapters = structuredClone([data.adapter]);
  data.driver.adapters[0].recipes.create.requires[1].upstream.port = 8124;
  data.driver.host.facts.mapping.value.upstream.port = 8124;
  result = await data.driver.execute(data.output.effects[0]);
  assert.equal(result.ok, false); assert.match(result.result.detail, /approved loopback target/);
  assert.deepEqual(data.journal.value.intents, {});
});

test('private inode ownership is durable before secret writing and failed intent leaves no secret artifact', async t => {
  const { journal } = await fixture(t, {});
  const files = new PrivateFiles({ journal, sessionId, resolveCredential: async () => ['synthetic', 'durability'].join('-') });
  const own = journal.own.bind(journal); let inspected = false;
  journal.own = async resource => { assert.equal((await readFile(join(files.root, resource.basename))).length, 0); await own(resource); inspected = true; };
  const receipt = await materializePrivateBinding({ ...materializationCase(), files });
  assert.equal(inspected, true); await files.remove(receipt.handleRef);
  journal.own = async () => { throw new Error('durability unavailable'); };
  await assert.rejects(materializePrivateBinding({ ...materializationCase(), files }), /durability unavailable/);
  assert.deepEqual(await readdir(files.root), []); assert.deepEqual(journal.value.owned, {});
});

test('reopened private file records are recoverable, while uncertain process ownership retains artifacts', async t => {
  const { journal } = await fixture(t, {});
  const files = new PrivateFiles({ journal, sessionId, resolveCredential: async () => 'synthetic-recovery-material' });
  const receipt = await materializePrivateBinding({ ...materializationCase(), files });
  const path = await files.path(receipt.handleRef);
  const { Journal } = await import('../../packages/gozar-node/journal.mjs');
  const reopened = new Journal(journal.directory); await reopened.load();
  const recovery = new PrivateFiles({ journal: reopened, sessionId });
  assert.equal(await recovery.path(receipt.handleRef), path);
  reopened.value.owned[receipt.handleRef].pendingDispatch = { effectId: 'pending-fixture', sessionId, generation };
  await assert.rejects(recovery.remove(receipt.handleRef), /dispatch outcome is unknown/);
  assert.equal((await stat(path)).isFile(), true);
  delete reopened.value.owned[receipt.handleRef].pendingDispatch;
  reopened.value.owned['uncertain-process'] = { id: 'uncertain-process', kind: 'process', artifacts: [receipt.handleRef] };
  await assert.rejects(recovery.remove(receipt.handleRef), /exit is unproven/);
  assert.equal((await stat(path)).isFile(), true);
  delete reopened.value.owned['uncertain-process'];
  await recovery.remove(receipt.handleRef);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});

test('host preparation materializes only explicit declarations and preserves empty private storage for legacy plans', async t => {
  const { journal } = await fixture(t, {});
  const { EffectDriver } = await import('../../packages/gozar-node/driver.mjs');
  const { prepareHost } = await import('../../packages/gozar-node/host.mjs');
  const input = materializationCase(), current = Date.now();
  for (const receipt of [...Object.values(input.bindings), ...Object.values(input.facts)]) { receipt.observedAtMs = current - 10; receipt.expiresAtMs = current + 60000; }
  const adapter = { id: 'private-host', planVersion: 1, admission: { state: 'admitted', requiredFeatures: ['private-file-reference', 'private-file-materialization'] }, recipes: {},
    bindings: { configFile: input.spec, credential: { type: 'credential-reference' }, hostname: { type: 'dns-name' }, tunnel: { type: 'opaque-private-reference' }, legacyFile: { type: 'session-private-path' } } };
  const driver = new EffectDriver({ journal, adapters: [adapter], sessionId, targetPort: 8123 });
  const host = await prepareHost(driver, adapter, { authorities: { bindings: input.bindings, facts: input.facts }, generation, resolveCredential: async () => 'synthetic-host-material' });
  assert.equal(host.bindings.configFile.generation, 1); assert.ok(host.bindings.configFile.materialization);
  assert.equal(JSON.parse(await readFile(await driver.privateFiles.path(host.bindings.configFile.handleRef), 'utf8')).hostname, 'selected.example');
  assert.equal(await readFile(await driver.privateFiles.path(host.bindings.legacyFile.handleRef), 'utf8'), '');
  assert.equal(journal.value.owned[host.bindings.legacyFile.handleRef].materialized, undefined);
  await driver.closeLocal(); assert.deepEqual(journal.value.owned, {});
});
