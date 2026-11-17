import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReleaseClosure } from '../../scripts/check-package.mjs';

const pkg = {
  exports: { '.': { types: './types.d.ts', import: { default: './api.mjs' } } },
  bin: { gozar: 'bin/gozar.mjs' },
  files: ['docs/operator.md', 'docs/migration.md', 'docs/embedding.md'],
};
const manifest = { providers: [{ id: 'fixture', module: 'providers/fixture.mjs', definition: 'fixture.json' }] };
const notices = { packages: [{ files: [{ path: 'third-party/fixture/LICENSE' }] }] };
const artifacts = ['adapters/recipes/wrapped.json', 'packages/gozar-core/generated/package.json',
  'packages/gozar-core/generated/gozar_core_bg.wasm'];
const members = ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'third-party/manifest.json',
  'types.d.ts', 'api.mjs', 'bin/gozar.mjs', ...pkg.files, 'adapters/manifest.json',
  'adapters/providers/fixture.mjs', 'adapters/fixture.json', 'adapters/fixture.definition.json',
  'third-party/fixture/LICENSE', ...artifacts];

test('release closure accepts a complete fixture member list without an optional SDK', () => {
  assert.doesNotThrow(() => assertReleaseClosure(new Set(members), pkg, manifest, notices, artifacts));
});
for (const missing of members) {
  test('release closure rejects an archive missing ' + missing, () => {
    const archiveMembers = new Set(members.filter(member => member !== missing));
    assert.throws(() => assertReleaseClosure(archiveMembers, pkg, manifest, notices, artifacts),
      error => error.message.includes(missing));
  });
}
