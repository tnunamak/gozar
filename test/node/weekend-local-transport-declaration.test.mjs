import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, lstat, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';

test('unknown adapters forward only declared local authorization observations', async t => {
  const parent = join(homedir(), '.tmp');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o777, 0o700);
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  const root = await mkdtemp(join(parent, 'local-declaration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicFile = JSON.parse(await readFile(new URL('../../adapters/providers/lan/definition.json', import.meta.url), 'utf8'));
  const declarations = publicFile.adapter.effectOperations;
  const isAuthorization = row => row.kind === 'local-forwarder' && row.operation === 'authorize';
  const entries = [];
  for (const removeAuthorization of [false, true]) {
    const id = 'fixture-' + randomUUID();
    const directory = join(root, 'providers', id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const definition = structuredClone(publicFile.adapter);
    definition.id = id;
    if (removeAuthorization) definition.effectOperations = declarations.filter(row => !isAuthorization(row));
    await writeFile(join(directory, 'definition.json'), JSON.stringify({ adapter: definition }), { mode: 0o600 });
    // Required methods deliberately reject when unused, rather than pretending to
    // detect, prove, create a listener or remove any real provider resource.
    const module = [
      "import { readFileSync } from 'node:fs';",
      "const { adapter: definition } = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8'));",
      "function unsupported() { throw Object.assign(new Error('Fixture method is not implemented'), { code: 'unsupported' }); }",
      "export default { id: definition.id, definition,",
      "  detect: unsupported, properties: unsupported, setupActions: unsupported, setup: unsupported, plan: unsupported,",
      "  create(ctx, request) { return ctx.dispatchEffect(request); },",
      "  observe: unsupported, verify: unsupported, remove: unsupported, runtimeFacts: unsupported",
      "};",
    ].join('\n');
    await writeFile(join(directory, 'index.mjs'), module, { mode: 0o600 });
    entries.push({ id, module: 'providers/' + id + '/index.mjs', definition: 'providers/' + id + '/definition.json' });
  }
  const [allowed, removed] = await loadAdapters({ root, manifest: { providers: entries } });
  assert.notEqual(allowed.id, removed.id);
  assert.notEqual(allowed.id, publicFile.adapter.id);
  const observation = Object.freeze({ source: 'synthetic-fixture', observed: true, proof: false, ready: false });
  const calls = [];
  const context = {
    platform: process.platform, home: root, generation: 1,
    dispatchEffect: async request => { calls.push(request); return observation; },
  };
  const request = { kind: 'local-forwarder', operation: 'authorize' };
  // On the old definition this rejects unsupported through the real generic gate.
  const result = await allowed.create(context, request);
  assert.strictEqual(result, observation, 'fixture observation is not promoted to peer proof');
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0], request, 'the real adapter context forwards the original request');
  assert.equal(declarations.filter(isAuthorization).length, 1);
  for (const invalid of [
    { kind: 'local-forwarder', operation: 'not-declared' },
    { kind: 'not-declared', operation: 'authorize' },
  ]) {
    await assert.rejects(() => allowed.create(context, invalid), { code: 'unsupported' });
    assert.equal(calls.length, 1, 'undeclared request never reaches the handler');
  }
  await assert.rejects(() => removed.create(context, request), { code: 'unsupported' });
  assert.equal(calls.length, 1, 'removing the data row removes authority for another unknown ID');
});
