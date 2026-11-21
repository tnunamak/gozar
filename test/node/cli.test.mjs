// The command line after the earlier session controller was removed: `status` and `stop --port` read and close sessions through the
// session runtime, the port-form session commands are refused with a pointer to the route-contract commands, and the stop command
// that a failure prints runs on its own from any home, including one with shell metacharacters in its path.
// Replaces the earlier suites for the human renderer, `expose --port`, `detect`, `health`, the daemon and its entrypoint (matrix in the delivery report).
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseArgs } from '../../bin/gozar.mjs';
import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import { loadCatalog } from '../../packages/gozar-node/catalog.mjs';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { Journal } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'bin/gozar.mjs');

test('the port-form session commands are removed, not redirected, and the kept options are validated', () => {
  for (const command of ['expose', 'detect', 'health', 'update-origin']) assert.throws(() => parseArgs([command, '--port', '3000']), /was removed.*route-contract|was removed.*ensure/s, command);
  assert.equal(parseArgs(['stop', '--port', '3000']).port, 3000);
  assert.equal(parseArgs(['status', '--route', 'abc']).route, 'abc');
  for (const argv of [['stop', '--port', '0'], ['stop', '--port', '2;echo'], ['stop', '--port', '70000'], ['status', '--route', 'Not A Route'], ['stop', '--port', '5', '--route', 'abc'], ['status', '--client-reach', 'internet'], ['status', '--yes', '--bind-address', '10.0.0.1']]) assert.throws(() => parseArgs(argv), undefined, argv.join(' '));
});

test('the removed commands exit non-zero with the removal message and start nothing', async t => {
  const { directory } = await fixture(t, {});
  const env = { ...process.env, GOZAR_HOME: directory, PATH: '/missing-fixture-binaries' };
  for (const command of ['expose', 'detect', 'health']) {
    const plain = spawnSync(process.execPath, [cli, command, '--port', '3000'], { encoding: 'utf8', env });
    assert.notEqual(plain.status, 0, command);
    assert.match(plain.stderr, /was removed/);
    // With --json an error is the one JSON object on stdout, as for every other command.
    const json = spawnSync(process.execPath, [cli, command, '--port', '3000', '--json'], { encoding: 'utf8', env });
    assert.notEqual(json.status, 0, command);
    assert.match(JSON.parse(json.stdout).error, /was removed/);
  }
});

test('catalog excludes wrapped gated definitions; help remains generic and lists no removed command', () => {
  const child = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.doesNotMatch(child.stdout, /Claude|ChatGPT|Anthropic|OpenAI/);
  assert.doesNotMatch(child.stdout, /expose --port|gozar detect|gozar health|update-origin/);
  assert.match(child.stdout, /gozar stop \[--port N \| --route ID\]/);
});
test('the shipped catalog has no wrapped gated definitions', async () => {
  const records = await loadCatalog(root);
  assert.ok(records.length > 0);
  assert.equal(records.every(record => !record.admission && !record.recipes.create), true);
});

test('an installed symlink runs the entrypoint', async t => {
  const { directory } = await fixture(t, {});
  const executable = join(directory, 'gozar');
  await symlink(cli, executable);
  const result = spawnSync(process.execPath, [executable, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Gozar/);
});

test('the stop command a failure prints runs alone from a home with shell metacharacters and closes the recorded session from its journal', async t => {
  // A control socket path must fit in about 104 bytes, so the homes stay short.
  const base = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? tmpdir(), 'g-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = await mkdtemp(join(base, "c ' h "));
  const directory = join(home, 'port-18765'); await mkdir(directory, { mode: 0o700 });
  const journal = new Journal(directory); await journal.load();
  const step = await loadCore();
  const initial = step({ command: { type: 'status', sessionId: 'earlier-session' } });
  await journal.save({ state: { ...initial.state, stopRequested: true, phase: 'cleanup-pending' }, snapshot: { ...initial.snapshot, phase: 'cleanup-pending' } });
  const { atomicWrite } = await import('../../packages/gozar-node/journal.mjs');
  await atomicWrite(join(directory, 'bootstrap.json'), { targetPort: 18765, adapterId: 'tunnl-gg', sessionId: 'earlier-session' });
  const bin = join(home, 'bin'); await mkdir(bin);
  const result = await run('/bin/sh', ['-c', cliCommand('stop', 18765, home)], { env: { PATH: bin, HOME: home, LANG: 'C.UTF-8' }, timeout: 20_000 }).then(reply => ({ ...reply, code: 0 }), error => error);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  await journal.load();
  assert.deepEqual(journal.value.owned, {});
  assert.equal(journal.value.snapshot.phase, 'stopped');
});
