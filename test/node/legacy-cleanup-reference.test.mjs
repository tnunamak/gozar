// Which session records may take the "no configuration reference" cleanup. Only an unmarked bootstrap written by a Gozar version
// before managed custody has none; a record that carries any managed marker (generic execution, a handle, an owner, an embedding)
// must prove its identity or the close fails with debt, never as a legacy cleanup. Ported from release-legacy-scope.test.mjs,
// whose fixtures launched the removed daemon controller; the records here are the same bootstraps without a running controller.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { attachedCleanupReference } from '../../packages/gozar-node/attached-route.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { attachedScratch } from './route-schema-check.mjs';

async function recorded(t, extra = {}) {
  const home = await attachedScratch(t), sessionId = randomUUID(), directory = join(home, 'port-8799');
  await mkdir(directory, { mode: 0o700 });
  await atomicWrite(join(directory, 'bootstrap.json'), { targetPort: 8799, adapterId: 'ngrok', sessionId, ...extra });
  return { home, request: { home, handle: { kind: 'session', id: `port-8799:${sessionId}`, generation: 1 }, mode: 'remove' } };
}

for (const [label, extra] of [
  ['generic execution without identity', { execution: 'generic-session-v1' }],
  ['null managed handle', { handle: null }],
  ['null managed embedding', { embedding: null }],
  ['malformed managed handle', { handle: {} }],
  ['managed owner without binding', { owner: 'fixture-owner' }],
]) {
  test(`red: ${label} cannot take legacy no-reference cleanup`, async t => {
    const world = await recorded(t, extra);
    await assert.rejects(attachedCleanupReference(world.request, { registryId: 'fixture-registry' }), error => ['route_conflict', 'cleanup_debt'].includes(error.code));
  });
}

for (const [label, extra] of [
  ['a genuine earlier native session', {}],
  ['an identity-only direct ngrok proof is not configuration custody', { proofSubject: { instanceId: 'fixture-instance', bootId: 'fixture-boot', handleGeneration: 1, origin: 'https://example.invalid', target: '127.0.0.1:8799' } }],
]) {
  test(`${label} has no configuration reference to release`, async t => {
    const world = await recorded(t, extra);
    assert.equal(await attachedCleanupReference(world.request, { registryId: 'fixture-registry' }), null);
  });
}

test('a record that names no readable bootstrap is cleanup debt, not a legacy cleanup', async t => {
  const home = await attachedScratch(t);
  await mkdir(join(home, 'port-8799'), { mode: 0o700 });
  await assert.rejects(attachedCleanupReference({ home, handle: { kind: 'session', id: `port-8799:${randomUUID()}`, generation: 1 }, mode: 'remove' }, { registryId: 'fixture-registry' }), { code: 'cleanup_debt' });
});
