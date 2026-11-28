import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('generated provider Markdown keeps Windows and CR-only label line breaks in one table cell', t => {
  const root = mkdtempSync(join(tmpdir(), 'gozar-provider-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'adapters', 'docs']) mkdirSync(join(root, dir));
  const script = join(root, 'scripts/generate-adapter-docs.mjs');
  copyFileSync(new URL('../../scripts/generate-adapter-docs.mjs', import.meta.url), script);
  writeFileSync(join(root, 'adapters/manifest.json'), JSON.stringify({ providers: [{ definition: 'fixture.json' }] }));
  writeFileSync(join(root, 'adapters/fixture.json'), JSON.stringify({ adapter: {
    id: 'fixture', label: 'First\r\nsecond\rthird', supportedKinds: [],
    capabilities: { reach: 'this-device', address: { stability: 'stable' }, traffic: {}, protocols: {}, cost: { summary: 'Fixture' } },
  } }));
  const check = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.ifError(check.error);
  assert.equal(check.status, 0, check.stderr);
  const output = readFileSync(join(root, 'docs/providers.md'), 'utf8');
  assert.match(output, /\| First second third \|/);
  assert.ok(!output.includes('\r'));
});
