import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, posix } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));

test('npm archive contains generated core, catalog and every relative runtime import', async () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(packed.status, 0, packed.stderr);
  const output = JSON.parse(packed.stdout);
  const metadata = Array.isArray(output) ? output[0] : output['@tnunamak/gozar'];
  const files = new Set(metadata.files.map(file => file.path));
  for (const path of ['packages/gozar-core/generated/gozar_core.js', 'packages/gozar-core/generated/gozar_core_bg.wasm',
    'packages/gozar-core/generated/package.json', 'adapters/manifest.json', 'packages/gozar-node/api.mjs']) assert.ok(files.has(path), path);
  for (const path of files) {
    if (!path.endsWith('.mjs')) continue;
    const source = await readFile(new URL(path, new URL('../../', import.meta.url)), 'utf8');
    for (const [, relative] of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      assert.ok(files.has(posix.normalize(posix.join(dirname(path), relative))), `${path} imports missing ${relative}`);
    }
  }
  assert.ok(![...files].some(path => path.startsWith('target/') || path.startsWith('test/') || path.startsWith('crates/')));
});

test('ordinary CLI commands never resolve the demo harness', () => {
  const hook = `import { registerHooks } from 'node:module'; registerHooks({ resolve(specifier, context, next) { if (specifier.includes('harness/')) throw new Error('Unexpected demo import'); return next(specifier, context); } });`;
  const preload = `data:text/javascript,${encodeURIComponent(hook)}`;
  for (const args of [['help'], ['status', '--port', '1', '--json'], ['service', 'status', '--origin', 'https://unused.example', '--json']]) {
    const result = spawnSync(process.execPath, ['--import', preload, cli, ...args], { encoding: 'utf8' });
    assert.doesNotMatch(result.stderr + result.stdout, /Unexpected demo import/);
    assert.ok([0, 1].includes(result.status), result.stderr);
  }
});
