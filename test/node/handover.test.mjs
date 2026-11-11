import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';
import { loadCore } from '../../packages/gozar-node/core.mjs';
import { stopSession, recoveryAdapters } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite, processIdentity } from '../../packages/gozar-node/journal.mjs';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';

async function oldController(t, stopRequested = true) {
  const { directory, journal } = await fixture(t, {});
  const step = await loadCore();
  const initial = step({ command: { type: 'status', sessionId: 'old-session' } });
  await journal.save({ state: { ...initial.state, stopRequested, phase: 'cleanup-pending' }, snapshot: { ...initial.snapshot, phase: 'cleanup-pending' } });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/old-controller.mjs', import.meta.url)), directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  t.after(async () => { if (await processIdentity(child.pid)) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } });
  return { directory, journal, child };
}

test('stop hands an authenticated older controller to the current reconciler', async t => {
  const { directory, journal, child } = await oldController(t);
  const self = await processIdentity(process.pid);
  const result = await stopSession(directory);
  assert.equal(result.controllerHandover, true);
  assert.equal(result.snapshot.phase, 'stopped');
  assert.equal(await processIdentity(child.pid), null);
  assert.equal(await processIdentity(process.pid), self);
  assert.equal(await readFile(join(directory, 'handed-over'), 'utf8'), 'yes');
  await journal.load(); assert.deepEqual(journal.value.owned, {});
});

test('a controller that has not durably fenced stop is preserved', async t => {
  const { directory, child } = await oldController(t, false);
  await assert.rejects(stopSession(directory), /Controller changed during stop/);
  assert.ok(await processIdentity(child.pid));
  await assert.rejects(readFile(join(directory, 'handed-over')), { code: 'ENOENT' });
});

test('a replaced controller birth identity is never signalled', async t => {
  const { directory, child } = await oldController(t);
  await atomicWrite(join(directory, 'control.json'), { pid: child.pid, startIdentity: 'replaced', nonce: 'old-controller-nonce' });
  const result = await stopSession(directory);
  assert.equal(result.snapshot.phase, 'stopped');
  assert.ok(await processIdentity(child.pid));
  await assert.rejects(readFile(join(directory, 'handed-over')), { code: 'ENOENT' });
});

test('legacy cleanup metadata requires an exact installed recipe and binding match', () => {
  const saved = { id: 'fixture', planVersion: 1, ownership: 'owned', admission: { state: 'admitted', requiredFeatures: [] }, bindings: {}, recipes: { create: { kind: 'spawn' }, remove: { kind: 'owned-process' } } };
  const installed = { ...structuredClone(saved), endpointLifetime: 'owned-process' };
  assert.equal(recoveryAdapters([saved], [installed])[0].endpointLifetime, 'owned-process');
  for (const edit of [value => { value.recipes.create.program = 'changed'; }, value => { value.bindings.changed = {}; }, value => { value.admission.state = 'blocked'; }]) {
    const changed = structuredClone(installed); edit(changed);
    assert.equal(recoveryAdapters([saved], [changed])[0].endpointLifetime, undefined);
  }
});

test('a declared process-lifetime endpoint needs genuine birth absence and exact ledger agreement', async t => {
  const { journal } = await fixture(t, {});
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const startIdentity = await processIdentity(child.pid);
  const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
  const resource = { id: 'owned-child', kind: 'process', sessionId: 'test', adapterId: 'fixture', pid: child.pid, startIdentity,
    nonce: 'fixture-nonce', continuityRef: 'fixture-continuity', bindings: {}, details: {} };
  const adapter = { id: 'fixture', ownership: 'owned', planVersion: 1, endpointLifetime: 'owned-process', admission: { state: 'admitted', requiredFeatures: [] },
    recipes: { create: { kind: 'spawn', process: { mode: 'owned-long-running' } }, remove: { kind: 'owned-process', before: [], after: [], requires: [] } } };
  await journal.save({ state: { resources: [{ id: resource.id, ledger: { handleRef: resource.id, continuityRef: resource.continuityRef, bindings: {}, details: {} } }] } });
  const driver = new EffectDriver({ journal, adapters: [adapter], sessionId: 'test' });
  const receipt = await driver.proveProcessAbsent(resource);
  assert.equal(receipt.processGone, true); assert.equal(receipt.providerAbsent, true);
  assert.equal(receipt.continuous, undefined);
  await assert.rejects(driver.proveProcessAbsent({ ...resource, details: { changed: true } }), /durable ownership ledger/);
  await assert.rejects(driver.proveProcessAbsent({ ...resource, pid: process.pid, startIdentity: await processIdentity(process.pid) }), /still running/);
  delete driver.adapters[0].endpointLifetime;
  await assert.rejects(driver.proveProcessAbsent(resource), /No admitted identity and absence readbacks/);
});
