import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeAdapter, definitionErrors } from '../../packages/gozar-node/adapter-runtime.mjs';
import { createNgrokTcpAdapter } from '../../adapters/providers/ngrok-tcp-passthrough/index.mjs';

const ids = ['tailscale-private', 'own-address', 'ngrok-tcp-passthrough'];
const load = id => recipeAdapter({ definition: new URL(`../../adapters/providers/${id}/definition.json`, import.meta.url) });
const fact = (definition, id) => definition.facts.find(row => row.id === id);

test('generic catalog facts disclose readers before any approval or provider observation', () => {
  for (const id of ids) {
    // Definition loading alone: no detect, plan, approval or effect context.
    const definition = load(id).definition;
    assert.deepEqual(definitionErrors(definition), []);
    assert.equal(definition.facts.filter(row => row.id === 'payload-readers').length, 1);
    const row = fact(definition, 'payload-readers');
    assert.equal(row.label, 'Payload readers');
    assert.equal(row.known, true, 'documented classification is not a runtime observation');
    assert.equal(row.affectsConsent, true);
    assert.equal(row.group, 'privacy');
    assert.match(row.value, /Architecture classification:/);
    assert.match(row.value, /not a live deployment observation/);
    assert.doesNotMatch(row.value, /unknown\./i, 'retain reviewed plain wording');
    assert.equal(row.source, `adapter architecture: adapters/providers/${id}/definition.json#adapter.capabilities.traffic`);
    assert.equal(row.asOf, null);
    const unknown = fact(definition, 'payload-readers-deployment');
    assert.equal(definition.facts.filter(row => row.id === unknown.id).length, 1);
    assert.equal(unknown.known, false);
    assert.equal(unknown.value, null);
    assert.equal(unknown.reason, 'not-observed');
    assert.equal(unknown.source, 'gozar:catalog:no-deployment-observation');
    assert.equal(unknown.affectsConsent, true);
    assert.equal(unknown.group, 'privacy');
    assert.equal(unknown.asOf, null);
    const copy = JSON.parse(JSON.stringify(definition));
    assert.deepEqual(fact(copy, unknown.id), unknown);
    delete fact(copy, unknown.id).reason;
    assert.ok(definitionErrors(copy).some(error => /unknown needs a reason/.test(error)));
  }
});

test('Serve discloses local TLS readers and public certificate names without promising upstream TLS', () => {
  const definition = load('tailscale-private').definition;
  assert.equal(definition.capabilities.reach, 'tailnet');
  assert.equal(definition.capabilities.traffic.tlsTermination, 'endpoint');
  assert.deepEqual(definition.capabilities.traffic.readers, ['this device (local tailscaled)']);
  assert.equal(definition.capabilities.traffic.providerCanReadPayload, null);
  for (const id of ['public-names', 'certificate-logs']) {
    assert.equal(fact(definition, id).known, true);
    assert.equal(fact(definition, id).value, true);
  }
  const text = fact(definition, 'payload-readers').value;
  assert.match(text, /local tailscaled.*can read the payload/);
  assert.match(text, /publicly logged certificate names/);
  assert.match(text, /upstream.*TLS.*not established/);
});

test('own-address does not infer reader access or grant authority over the owner proxy', () => {
  const definition = load('own-address').definition;
  assert.equal(definition.capabilities.traffic.tlsTermination, 'unknown');
  assert.equal(definition.capabilities.traffic.providerCanReadPayload, null);
  assert.deepEqual(definition.capabilities.traffic.readers, ['the owner-managed proxy']);
  const text = fact(definition, 'payload-readers').value;
  assert.match(text, /owner-managed proxy may read payloads/);
  assert.match(text, /TLS termination and reader access have not been observed/);
  assert.match(text, /does not grant Gozar authority over the proxy or its owner/);
});

test('opaque TCP reader disclosure preserves detect-only admission and performs no execution', async () => {
  let effects = 0;
  const unexpected = async () => { effects++; throw new Error('unexpected provider effect'); };
  const adapter = createNgrokTcpAdapter({ loadSdk: unexpected, certificateTool: unexpected });
  const definition = adapter.definition;
  assert.equal(definition.capabilities.transport, 'tcp');
  assert.equal(definition.capabilities.traffic.tlsTermination, 'unknown');
  assert.equal(definition.capabilities.traffic.providerCanReadPayload, null);
  assert.deepEqual(definition.capabilities.traffic.readers, ['the application endpoint (opaque TCP)']);
  assert.equal(definition.availability.attached.state, 'detect-only');
  assert.equal(definition.availability.session.state, 'unsupported');
  assert.equal(definition.availability.durable.state, 'unsupported');
  const text = fact(definition, 'payload-readers').value;
  assert.match(text, /application endpoint/);
  assert.match(text, /TLS termination and intermediary reader access have not been observed/);
  assert.match(text, /detect-only/);
  await assert.rejects(adapter.create({
    configuration: unexpected, dispatchEffect: unexpected, assertGeneration: unexpected,
  }, { effects: [], readback: { kind: 'attached' } }), { code: 'unsupported' });
  assert.equal(effects, 0);
});
