// A session allocation that fails after it created an owned provider effect, and before any success receipt reached the controller, must still hand
// the controller the exact removal capability: the receipt names this session and the journal's owned resources, and removal reads the saved journal.
// The cut is the real `start` followed by a thrown fault (throw-after-start-controller.mjs), so the owned child exists when the failure surfaces.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Journal } from '../../packages/gozar-node/journal.mjs';
import { sessionRecipeEffects } from '../../packages/gozar-node/session-recipe.mjs';
import { providerWorld } from './session-provider-fixtures.mjs';
import { scratch } from './route-schema-check.mjs';

const controllerModule = fileURLToPath(new URL('./throw-after-start-controller.mjs', import.meta.url));
const count = (w, at) => w.events.filter(event => event.at === at).length;

async function cutWorld(t, providerId) {
  const refusal = { on: false };
  const w = await providerWorld(t, providerId, { routeDeps: { expose: { controllerModule } },
    before: async (effect) => { if (refusal.on && effect.operation === 'close') throw new Error('removal refused'); } });
  return { w, refusal };
}
const cutPort = (w, port) => writeFile(join(w.home, 'throw-after-start'), String(port));

for (const providerId of ['localhost-run', 'tailscale-funnel']) {
  test(`${providerId}: a fault after the owned effect removes it once through the carried receipt and leaves a sibling session alone`, async t => {
    const { w } = await cutWorld(t, providerId);
    const second = await w.another();
    const sibling = await w.expose(await w.approvedRequest(second));
    assert.ok(sibling, 'the sibling session started');
    assert.equal(w.ownedNow(), 1, 'the sibling owns one provider resource');
    await cutPort(w, w.target.split(':')[1]);
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.ok(failure, 'the cut session must fail');
    assert.equal(count(w, 'allocate'), 2, 'the cut session did create its owned effect');
    assert.equal(count(w, 'remove'), 1, 'that effect was removed exactly once');
    assert.equal(w.ownedNow(), 1, 'only the sibling remains');
    assert.equal(failure.route?.cleanup?.state, 'confirmed', 'removal came from the carried receipt, so cleanup is confirmed');
    assert.equal((await w.host.close(w.api, sibling.handle)).cleanup.state, 'confirmed', 'the untouched sibling still closes on its own handle');
    assert.equal(count(w, 'remove'), 2);
  });
}

// An owned process is removed by the driver itself, by pid; the fixture forwarder's removal is a declared effect a test can refuse.
test('lan: a refused removal after that fault stays exact debt, and a later close removes it once', async t => {
  const { w, refusal } = await cutWorld(t, 'lan');
  await cutPort(w, w.target.split(':')[1]);
  refusal.on = true;
  const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
  assert.ok(failure, 'the cut session must fail');
  assert.equal(count(w, 'allocate'), 1);
  assert.equal(count(w, 'remove'), 0, 'the refused removal removed nothing');
  assert.equal(w.ownedNow(), 1, 'the owned effect is still there');
  assert.equal(failure.route?.cleanup?.state, 'unconfirmed', 'a refused removal is never reported as confirmed');
  assert.ok(failure.route?.handle, 'the retained handle is returned');
  refusal.on = false;
  const closed = await w.api.closeRoute({ home: w.home, handle: failure.route.handle, mode: 'remove' });
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(count(w, 'remove'), 1, 'the later close removes it exactly once');
  assert.equal(w.ownedNow(), 0);
});

// `compareAndRemove` is given a receipt and a directory; both must be this session's own before anything is read or removed.
test('a removal receipt that is not this session\'s changes nothing, and leaves a sister session\'s journal byte for byte', async t => {
  const home = await scratch(t);
  const sister = join(home, 'sessions', 'sister');
  await mkdir(sister, { recursive: true });
  const journal = new Journal(sister);
  await journal.save({ state: { sessionId: 'sister-session', adapters: [], requirements: {} }, owned: { r1: { id: 'r1', kind: 'process', sessionId: 'sister-session', pid: 1 } } });
  const before = await readFile(join(sister, 'session.json'), 'utf8');
  const definition = { id: 'localhost-run', planVersion: 1, ownership: 'owned', recipes: { create: {} } };
  const adapter = { id: 'localhost-run', operationalDefinition: definition, definition: { effectOperations: [] } };
  const effects = sessionRecipeEffects({ adapter, readContext: {}, request: { target: '127.0.0.1:1' }, handle: { id: 'route:own-session' }, directory: sister, gate: () => ({}) });
  const receipt = (over = {}) => ({ schemaVersion: 1, adapterId: 'localhost-run', identity: { kind: 'session-recipe', sessionId: 'own-session', resourceIds: [] }, ...over });
  for (const wrong of [
    receipt({ adapterId: 'tunnl-gg' }),
    receipt({ identity: { kind: 'session-recipe', sessionId: 'sister-session', resourceIds: ['r1'] } }),
    receipt({ identity: { kind: 'other', sessionId: 'own-session' } }),
    undefined,
  ]) {
    const result = await effects.compareAndRemove(wrong);
    assert.equal(result.removed, false);
    assert.ok(result.debt?.message);
  }
  // This session's own receipt, over a directory whose saved journal belongs to another session: refused, not recovered.
  const crossed = await effects.compareAndRemove(receipt());
  assert.equal(crossed.removed, false, 'a directory holding another session\'s journal is not recovered from');
  assert.equal(await readFile(join(sister, 'session.json'), 'utf8'), before, 'the sister journal is unchanged');
});
