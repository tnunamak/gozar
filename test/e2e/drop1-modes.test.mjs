import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { command } from '../../harness/process.mjs';

for (const route of ['tailscale-private', 'lan']) test(`${route} refuses a public relay substitute before live baseline or allocation`, async () => {
  const result = await command(process.execPath, [fileURLToPath(new URL('../../harness/drop1a.mjs', import.meta.url)), '--route', route, '--proof-class', 'public-relay']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, 'failed'); assert.match(report.error, /genuine appropriate peer/);
  assert.deepEqual(report.commands, []); assert.equal(report.before, undefined); assert.equal(report.realRoute, false);
});

test('own-address refuses an unowned ingress substitute before any live work', async () => {
  const result = await command(process.execPath, [fileURLToPath(new URL('../../harness/drop1a.mjs', import.meta.url)), '--route', 'own-address']);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.match(report.error, /disposable independently owned ingress/);
  assert.deepEqual(report.commands, []); assert.equal(report.before, undefined);
});
