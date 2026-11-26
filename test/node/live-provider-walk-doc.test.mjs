import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';

// This fixture checks CLI dispatch and refused secret intake, not successful managed setup or cleanup.
test('operator walk checks package version, setup command dispatch and refused secret intake', async t => {
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

// The provider reference is generated; this guards its account of proof, not the table itself.
test('provider reference separates the declared proof profile from observed verification checks', async () => {
  const reference = await readFile(new URL('../../docs/providers.md', import.meta.url), 'utf8');
  assert.match(reference, /The Proof column is the provider's declared profile, not live verification/);
  assert.match(reference, /observation actually ran are recorded per\s+route in `RouteView\.verification\.checks`/);
  assert.doesNotMatch(reference, /Proof is what Gozar checks before it publishes/);
  assert.doesNotMatch(reference, /sse check only when the app asks for SSE/);
  assert.doesNotMatch(reference, /first publication check/);
});

test('managed cancellation and reconciliation precede general dashboard cleanup and state deletion', async () => {
  const guide = await readFile(new URL('../../docs/live-provider-walk.md', import.meta.url), 'utf8');
  const choose = guide.indexOf('Choose the cleanup path');
  const cancel = guide.indexOf('gozar setup-operation cancel');
  const offers = guide.indexOf('Follow the returned cleanup offers.');
  const sequence = guide.indexOf('After the applicable setup cleanup is settled');
  const deletion = guide.indexOf("delete this walk's local state");
  assert.ok(choose >= 0 && choose < cancel && cancel < offers && offers < sequence && sequence < deletion,
    'operators must retain managed custody through cancellation and reconciliation before general cleanup');
});
