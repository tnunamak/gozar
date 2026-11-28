import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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


test('non-object provider definitions are refused without skipping later providers', async t => {
  for (const value of ['null', '[]', 'true', '0', '"fixture-marker"']) await t.test(value, () => {
    const f = fixture(t, [provider('alpha'), provider('beta')], ['alpha.definition.json', 'beta.definition.json']);
    writeFileSync(f.file('alpha.mjs'), 'export {};\n');
    writeFileSync(f.file('alpha.definition.json'), value);
    writeFileSync(f.file('beta.definition.json'), json({}));
    const result = f.run('--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /alpha: invalid definition alpha\.definition\.json/);
    assert.match(result.stderr, /beta: module beta\.mjs is missing/);
    assert.doesNotMatch(result.stderr, /TypeError|fixture-marker/);
  });
});

test('non-object wrapped definitions have an invalid-definition diagnostic', async t => {
  for (const value of [null, [], {definition:null}, {definition:[]}, {definition:true}]) await t.test(JSON.stringify(value), () => {
    const f = fixture(t, [provider('alpha')], ['alpha.definition.json']);
    wrappedProvider(f);
    writeFileSync(f.file('alpha.plan.json'), json(value));
    const result = f.run('--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /alpha: declared wrapped definition has an invalid shape/);
    assert.doesNotMatch(result.stderr, /TypeError|is missing/);
  });
});

test('non-object manifest entries are refused while later providers are still checked', async t => {
  for (const value of [null, [], true, 0, 'fixture-marker']) await t.test(JSON.stringify(value), () => {
    const f = fixture(t, [value, provider('beta')], ['beta.definition.json']);
    writeFileSync(f.file('beta.definition.json'), json({}));
    const before = readFileSync(f.manifest);
    for (const args of [[], ['--check']]) {
      const result = f.run(...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /provider at index 0 is not an object/);
      assert.match(result.stderr, /beta: module beta\.mjs is missing/);
      assert.doesNotMatch(result.stderr, /TypeError|fixture-marker/);
      assert.deepEqual(readFileSync(f.manifest), before);
    }
  });
});

test('a definition directory is unreadable, not invalid JSON', t => {
  const f = fixture(t, [provider('alpha')], ['alpha.definition.json']);
  writeFileSync(f.file('alpha.mjs'), 'export {};\n');
  mkdirSync(f.file('alpha.definition.json'));
  const before = readFileSync(f.manifest);
  for (const args of [[], ['--check']]) {
    const result = f.run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /alpha: definition alpha\.definition\.json is unreadable/);
    assert.doesNotMatch(result.stderr, /invalid definition|TypeError/);
    assert.deepEqual(readFileSync(f.manifest), before);
  }
});

test('docs generator handles malformed manifest and definition without changing the docs', async t => {
  const generator = fileURLToPath(new URL('./generate-adapter-docs.mjs', import.meta.url));
  for (const [name, providers, definition, expected] of [
    ['null providers', null, {}, /adapters\/manifest\.json providers must be an array/],
    ['object providers', {}, {}, /adapters\/manifest\.json providers must be an array/],
    ['missing adapter', [provider('alpha')], {}, /alpha: invalid definition alpha\.definition\.json/],
    ['missing capabilities', [provider('alpha')], { adapter: {} }, /alpha: invalid definition alpha\.definition\.json/],
    ['unreadable definition', [provider('alpha')], null, /alpha: definition alpha\.definition\.json is unreadable/],
  ]) await t.test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'gozar-docs-'));
    try {
      for (const dir of ['scripts', 'adapters', 'docs']) mkdirSync(join(root, dir));
      const local = join(root, 'scripts', 'generate-adapter-docs.mjs');
      const output = join(root, 'docs', 'providers.md');
      const input = join(root, 'adapters', 'alpha.definition.json');
      copyFileSync(generator, local);
      writeFileSync(output, 'fixture-docs\n');
      writeFileSync(join(root, 'adapters', 'manifest.json'), json({ providers }));
      if (definition === null) mkdirSync(input); else writeFileSync(input, json(definition));
      for (const args of [[], ['--check']]) {
        const result = spawnSync(process.execPath, [local, ...args], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, expected);
        assert.doesNotMatch(result.stderr, /TypeError/);
        assert.equal(readFileSync(output, 'utf8'), 'fixture-docs\n');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
