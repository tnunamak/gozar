import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';

test('operator walk installs the package version and dispatches documented setup-operation commands', async t => {
  const guide = await readFile(new URL('../../docs/live-provider-walk.md', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const version = guide.match(/^npm install @tnunamak\/gozar@(\S+)$/m)?.[1];
  assert.equal(version, pkg.version);
  assert.equal(guide.match(/Public raw TCP\/TLS profiles are detect-only in (\S+);/)?.[1], version);
  assert.equal(guide.match(/installed package version \((\S+) for this walk\)/)?.[1], version);

  const inGuide = [...guide.matchAll(/^\.\/node_modules\/\.bin\/gozar (setup-operation .+)$/gm)]
    .map(([, line]) => line.trim().split(/\s+/));
  assert.deepEqual(inGuide.map(argv => argv[1]), ['reserve', 'read', 'run', 'run', 'cancel', 'read']);

  const scratch = await mkdtemp(join(tmpdir(), 'gozar-walk-doc-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const ref = { home: scratch, owner: 'walk-fixture', providerId: 'unregistered-fixture', operationId: 'doc-fixture' };
  const scoped = { ...ref, expectedConfigurationRevision: 0 };
  const reserve = { ...scoped, expectedSetupRevision: 0, actionId: 'fixture-reserve' };
  const run = { ...scoped, expectedSetupRevision: 1, actionId: 'fixture-run' };
  for (const [file, body] of [['setup-ref.json', ref], ['setup-reserve.json', reserve], ['setup-run.json', run]]) {
    await writeFile(join(scratch, file), JSON.stringify(body), { mode: 0o600 });
  }
  const calls = [];
  const api = {
    readSetupOperation: async args => {
      calls.push(['read', args]);
      return { nextAction: null, state: 'fixture' };
    },
    cancelSetupOperation: async args => {
      calls.push(['cancel', args]);
      return { state: 'fixture' };
    },
    runSetupAction: async args => {
      calls.push(['run', args]);
      return { state: 'fixture' };
    },
  };
  const results = [];
  for (const documented of inGuide) {
    const argv = [...documented];
    for (const flag of ['--request-file', '--secret-file']) {
      const i = argv.indexOf(flag);
      if (i !== -1) argv[i + 1] = join(scratch, argv[i + 1]);
    }
    let output = '';
    const exit = await routeMain(argv, {
      api,
      storeSecret: async () => assert.fail('No secret intake is authorized in this fixture'),
      stdout: { write(chunk) { output += chunk; } },
      stderr: { write() {} },
    });
    results.push([exit, JSON.parse(output).error?.code ?? null]);
  }
  assert.deepEqual(results, [[0, null], [0, null], [3, 'consent_mismatch'], [0, null], [0, null], [0, null]]);
  assert.deepEqual(calls, [
    ['run', reserve],
    ['read', { ...ref, includeBrowserHandoff: false }],
    ['read', ref], // The secret-input preflight is not an explicit interactive read.
    ['run', run],
    ['cancel', ref],
    ['read', { ...ref, includeBrowserHandoff: false }],
  ]);
});
