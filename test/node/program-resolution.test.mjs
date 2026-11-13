// A recipe names the bare program `tailscale`. On macOS the Tailscale app keeps its CLI inside the app bundle, which is
// on PATH only after the user installs the CLI integration. The effect driver resolves the program at spawn, in one place.
// Source: https://tailscale.com/kb/1080/cli (macOS section): the App Store app bundles the CLI and it runs as
// /Applications/Tailscale.app/Contents/MacOS/Tailscale <command>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgramResolver, tailscaleAppBundleCli } from '../../packages/gozar-node/program-resolution.mjs';
import { fixture, effect } from './helpers.mjs';

const bundle = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const files = (...present) => path => present.includes(path);

test('the bundle path is the one the Tailscale CLI documentation gives', () => assert.equal(tailscaleAppBundleCli, bundle));

test('darwin falls back to the app bundle CLI only when PATH has no tailscale', () => {
  const env = { PATH: '/usr/bin:/opt/homebrew/bin' };
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle) })('tailscale', env), bundle);
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle, '/opt/homebrew/bin/tailscale') })('tailscale', env), 'tailscale', 'a PATH tailscale wins');
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files() })('tailscale', env), 'tailscale', 'no bundle: unchanged, so detect says the CLI is absent');
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle) })('tailscale', { PATH: 'relative/bin:' }), bundle, 'relative PATH entries do not count');
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle) })('tailscale', {}), bundle, 'no PATH at all');
});

test('every other platform and program is unchanged', () => {
  const env = { PATH: '/usr/bin' };
  assert.equal(createProgramResolver({ platform: 'linux', isExecutable: files(bundle) })('tailscale', env), 'tailscale', 'Linux never uses the bundle');
  assert.equal(createProgramResolver({ platform: 'win32', isExecutable: files(bundle) })('tailscale', env), 'tailscale');
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle) })('ngrok', env), 'ngrok', 'only tailscale has a bundle CLI');
  assert.equal(createProgramResolver({ platform: 'darwin', isExecutable: files(bundle) })('/usr/local/bin/tailscale', env), '/usr/local/bin/tailscale', 'an explicit path is not touched');
});

// The driver resolves at spawn: the recipe, its digest and the consent bound to it keep the program `tailscale`.
async function directory(t, name, script) {
  const base = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? tmpdir(), 'gozar-program-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  if (script) { await mkdir(join(base, 'bin')); await writeFile(join(base, 'bin', name), `#!/bin/sh\necho ${script}\n`); await chmod(join(base, 'bin', name), 0o755); }
  return base;
}
async function runTailscale(t, { platform, pathDirectory, bundleCli }) {
  const saved = process.env.PATH;
  process.env.PATH = pathDirectory;
  t.after(() => { process.env.PATH = saved; });
  const recipe = { kind: 'spawn', program: 'tailscale', args: ['status'], timeoutMs: 2000, maxOutputBytes: 100 };
  const { driver } = await fixture(t, { detect: recipe }, { resolveProgram: createProgramResolver({ platform, bundleCli }) });
  return driver.execute(effect(recipe));
}

test('the driver runs the bundle CLI on darwin when PATH has no tailscale, and the PATH one when it has', async t => {
  const app = await directory(t, 'Tailscale', 'from-bundle');
  const empty = await directory(t);
  const cli = await directory(t, 'tailscale', 'from-path');
  const bundleCli = join(app, 'bin', 'Tailscale');
  assert.equal((await runTailscale(t, { platform: 'darwin', pathDirectory: empty, bundleCli })).result.stdout, 'from-bundle\n');
  assert.equal((await runTailscale(t, { platform: 'darwin', pathDirectory: join(cli, 'bin'), bundleCli })).result.stdout, 'from-path\n');
  const linux = await runTailscale(t, { platform: 'linux', pathDirectory: empty, bundleCli });
  assert.equal(linux.ok, false, 'on Linux a missing tailscale is not replaced by the bundle');
  assert.equal(linux.result?.stdout, undefined);
});
