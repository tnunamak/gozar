import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';
import { render } from '../../packages/gozar-node/render.mjs';

test('installed gozar symlink runs the CLI entrypoint', async t => {
  const { directory } = await fixture(t, {});
  const executable = join(directory, 'gozar');
  await symlink(fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url)), executable);
  const result = spawnSync(process.execPath, [executable, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Gozar/);
  assert.match(result.stdout, /expose --port/);
});

test('stopped CLI reports the result without catalog setup or recommendations', () => {
  const text = render({ snapshot: { phase: 'stopped', recommendations: ['route'], plans: [{ adapterId: 'route', eligibility: 'needs-validation' }], limitations: ['Catalog setup detail'] }, localCleanupFailures: [] }, [{ id: 'route' }]);
  assert.equal(text, 'Gozar · stopped\nExposure stopped.');
  assert.doesNotMatch(text, /Recommended|Validation|Catalog/);
});

test('cleanup failure prints the exact retry scope and expected success', () => {
  const output = render({ snapshot: { phase: 'stopped' }, localCleanupFailures: [{ detail: 'Fixture cleanup failed' }], journalPath: '/private/fixture/session.json' }, [], { port: 3000 });
  assert.ok(output.includes(`Retry: ${cliCommand('stop', 3000)}`));
  assert.match(output, /Success: Exposure stopped, with no remaining cleanup failures/);
  assert.match(output, /Local state: \/private\/fixture\/session.json/);
});

test('noninteractive no-flag expose asks one question and gives an exact next command', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url)), 'expose', '--port', '18765'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal((result.stdout.match(/Where does the app that will use this run\?/g) ?? []).length, 1);
  assert.ok(result.stdout.includes(`${cliCommand('expose', 18765)} --client-reach internet`));
  assert.doesNotMatch(result.stdout, /<choice>|\[--|Unknown option/);
});

test('published route text reports the host lifetime', () => {
  const text = render({ lifetimeMs: 1_500_000, snapshot: { phase: 'published-ready', adapterId: 'trial', published: 'https://trial.example' } }, [{ id: 'trial', planVersion: 1 }]);
  assert.match(text, /up to 25 minutes/);
  assert.doesNotMatch(text, /up to 15 minutes/);
});
