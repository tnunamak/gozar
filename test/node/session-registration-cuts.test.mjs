// The shared session runtime claims custody of the host's configuration reference (a registered use) before the controller exists, so the cuts
// between that registration and the controller's first act must never leave a reference nobody can release. The attached path publishes a
// complete recovery pair before it registers (route-allocation-recovery); a session keeps its own directory and registers inside the broker
// setup, so its cuts get their own proof here, on every provider family: a failure after the registration releases the exact registered handle
// once and starts no provider effect, and a refused release stays exact, retryable debt that a later close settles.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';
import { registryIdentity } from '../../packages/gozar-node/registry-identity.mjs';
import { providerWorld } from './session-provider-fixtures.mjs';

async function cutWorld(t, providerId, { stage, failRelease = false, failAfterRegister = false }) {
  const real = createEmbeddingServices({ registryId: await registryIdentity({}) });
  const uses = { registered: [], released: [], failRelease };
  const embeddingServices = { ...real,
    registerConfigurationUse: async request => {
      uses.registered.push(structuredClone(request.handle)); await real.registerConfigurationUse(request);
      if (failAfterRegister) throw new Error('registration failed after it committed');
    },
    releaseConfigurationUse: async request => { uses.released.push(structuredClone(request.handle)); if (uses.failRelease) throw new Error('release refused'); return real.releaseConfigurationUse(request); } };
  const w = await providerWorld(t, providerId, { routeDeps: { embeddingServices, expose: { publicationCut: async at => { if (stage && at === stage) throw Object.assign(new Error(`injected failure at ${at}`), { code: 'provider_unavailable' }); } } } });
  return { w, uses };
}

for (const providerId of ['localhost-run', 'lan', 'tailscale-funnel']) {
  test(`${providerId}: a failure after the host registered its reference releases that exact handle once and starts no provider effect`, async t => {
    const { w, uses } = await cutWorld(t, providerId, { stage: 'spawn' });
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.ok(failure, 'expose must fail');
    assert.equal(uses.registered.length, 1, 'the registration happened before the cut');
    assert.deepEqual(uses.released, uses.registered, 'the exact registered handle is released once');
    assert.equal(w.events.filter(event => event.at === 'allocate').length, 0, 'no provider effect');
    assert.equal(failure.route?.cleanup?.state, 'confirmed');
    assert.equal(failure.route?.published, null);
  });

  test(`${providerId}: a refused release after that failure stays exact debt, and a later close settles it`, async t => {
    const { w, uses } = await cutWorld(t, providerId, { stage: 'spawn', failRelease: true });
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.ok(failure, 'expose must fail');
    assert.equal(uses.released.length, 1);
    assert.equal(failure.route?.cleanup?.state, 'unconfirmed', 'a refused release is never reported as confirmed');
    assert.deepEqual(failure.route?.handle, uses.registered[0], 'the retained handle is the registered one');
    uses.failRelease = false;
    const closed = await w.api.closeRoute({ home: w.home, handle: failure.route.handle, mode: 'remove' });
    assert.equal(closed.cleanup.state, 'confirmed');
    assert.equal(uses.released.length, 2, 'the retry releases the same handle once more');
    assert.deepEqual(uses.released[1], uses.registered[0]);
    assert.equal(w.events.filter(event => event.at === 'allocate').length, 0);
  });
}

test('a registration that commits and then fails releases the exact use once, whichever provider', async t => {
  const { w, uses } = await cutWorld(t, 'localhost-run', { failAfterRegister: true });
  const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
  assert.ok(failure, 'expose must fail after the committed registration');
  assert.equal(uses.registered.length, 1);
  assert.deepEqual(uses.released, uses.registered, 'the exact registered handle is released');
  assert.equal(failure.route?.cleanup?.state, 'confirmed');
  assert.equal(w.events.filter(event => event.at === 'allocate').length, 0);
});
