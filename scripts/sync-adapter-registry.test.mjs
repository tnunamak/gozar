import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./sync-adapter-registry.mjs', import.meta.url));
const json = value => JSON.stringify(value, null, 2) + '\n';
const provider = id => ({ id, module: id + '.mjs', definition: id + '.definition.json' });

function fixture(t, providers, views) {
  const root = mkdtempSync(join(tmpdir(), 'gozar-registry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = join(root, 'views.json');
  writeFileSync(manifest, json({ providers, definitions: views, normalizedDefinitions: views }));
  return {
    manifest, file: name => join(root, name),
    run: (...args) => spawnSync(process.execPath, [script, '--root', root, '--manifest', manifest, ...args], { encoding: 'utf8' }),
  };
}

function wrappedProvider(f) {
  writeFileSync(f.file('alpha.mjs'), 'export {};\n');
  writeFileSync(f.file('alpha.definition.json'), json({
    wraps: 'alpha.plan.json',
    adapter: { capabilities: { transport: 'https', address: { ports: [1000] } } },
  }));
  writeFileSync(f.file('alpha.plan.json'), json({
    definition: { bindings: { port: { candidates: [4101, 4102] } }, validation: { vantage: 'lan', tls: true } },
  }));
}

test('check reports a present malformed definition without echoing its contents', t => {
  const f = fixture(t, [provider('alpha')], ['alpha.definition.json']);
  writeFileSync(f.file('alpha.mjs'), 'export {};\n');
  writeFileSync(f.file('alpha.definition.json'), '{ not valid json: fixture-marker }');
  const result = f.run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /alpha: invalid definition alpha\.definition\.json/);
  assert.doesNotMatch(result.stderr, /fixture-marker/);
});

test('fix refuses a missing module before publishing any registry bytes', t => {
  const f = fixture(t, [provider('alpha'), provider('beta')], []);
  wrappedProvider(f);
  writeFileSync(f.file('beta.definition.json'), json({ adapter: {} }));
  const before = [f.file('alpha.definition.json'), f.manifest].map(path => readFileSync(path));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /beta: module beta\.mjs is missing/);
  assert.deepEqual([f.file('alpha.definition.json'), f.manifest].map(path => readFileSync(path)), before);
});

test('fix still repairs generated fields and compatibility views for a valid registry', t => {
  const f = fixture(t, [provider('alpha')], []);
  wrappedProvider(f);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const { adapter } = JSON.parse(readFileSync(f.file('alpha.definition.json'), 'utf8'));
  assert.deepEqual(adapter.capabilities.address.ports, [4101, 4102]);
  assert.deepEqual(adapter.capabilities.proof, { vantage: 'lan', checks: ['tls'] });
  const { definitions, normalizedDefinitions } = JSON.parse(readFileSync(f.manifest, 'utf8'));
  assert.deepEqual(definitions, ['alpha.definition.json']);
  assert.deepEqual(normalizedDefinitions, definitions);
  const checked = f.run('--check');
  assert.equal(checked.status, 0, checked.stderr);
});
