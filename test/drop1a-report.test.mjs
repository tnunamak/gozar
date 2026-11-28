import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const harness = fileURLToPath(new URL('../harness/drop1a.mjs', import.meta.url));

test('drop1a never overwrites an existing report and still prints the second attempt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gozar-drop1a-report-'));
  try {
    const path = join(directory, 'receipt.json');
    const run = () => spawnSync(process.execPath, [harness, '--route', 'fixture-invalid', '--report', path], {
      encoding: 'utf8',
      timeout: 10000,
    });
    const first = run();
    assert.ifError(first.error);
    assert.equal(first.status, 1, first.stderr);
    const firstBytes = await readFile(path);
    const firstReport = JSON.parse(firstBytes.toString('utf8'));
    assert.equal(firstReport.route, 'fixture-invalid');
    assert.equal(firstReport.result, 'failed');
    assert.deepEqual(firstReport.setupActions, []);
    assert.match(firstReport.error, /choose one of the five drop-1 modes/);
    assert.equal(JSON.parse(first.stdout).route, 'fixture-invalid');

    const second = run();
    assert.ifError(second.error);
    assert.equal(second.status, 1, second.stderr);
    assert.match(second.stderr, /\bEEXIST\b/);
    assert.deepEqual(await readFile(path), firstBytes);
    const secondReport = JSON.parse(second.stdout);
    assert.equal(secondReport.route, 'fixture-invalid');
    assert.equal(secondReport.result, 'failed');
    assert.deepEqual(secondReport.setupActions, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
