import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('registry --check refuses an existing but malformed provider definition', t => {
  const root = mkdtempSync(join(tmpdir(), 'gozar-registry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const definition = 'fixture.definition.json';
  writeFileSync(join(root, 'fixture.mjs'), 'export {};');
  writeFileSync(join(root, definition), '{');
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    providers: [{ id: 'fixture', module: 'fixture.mjs', definition }],
    definitions: [definition],
    normalizedDefinitions: [definition],
  }));
  const script = fileURLToPath(new URL('../../scripts/sync-adapter-registry.mjs', import.meta.url));
  const verify = () => spawnSync(process.execPath, [script, '--root', root, '--check'], { encoding: 'utf8' });
  const bad = verify();
  assert.equal(bad.error, undefined);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /fixture: provider definition is invalid JSON/);
  writeFileSync(join(root, definition), '{}');
  const good = verify();
  assert.equal(good.status, 0, good.stderr);
});
