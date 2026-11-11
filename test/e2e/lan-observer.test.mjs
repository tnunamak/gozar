import test from 'node:test';
import assert from 'node:assert/strict';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';
import { prepareHost } from '../../packages/gozar-node/host.mjs';
import { createGate } from '../../packages/gozar-node/gate.mjs';
import { startDummy } from '../../harness/dummy-server.mjs';
import { sanitizeOutsideRequest } from '../../harness/outside-request.mjs';
import { observeLive } from '../../harness/live-probe.mjs';

test('actual LAN HTTP challenge survives sanitization and local observer without inventing a peer receipt', async () => {
  // Local integration only. No external job, TLS or LAN reachability is asserted.
  const service = await startDummy();
  const gate = await createGate(service.port);
  const driver = new EffectDriver({ adapters: [], journal: { value: { owned: {} } }, sessionId: 'local-observer-fixture', targetPort: gate.port });
  let request, observed;
  const executor = { vantages: ['lan'], async verify(payload) {
    request = sanitizeOutsideRequest(payload, { serviceNonce: service.nonce, toolEcho: 'local-fixture-echo' });
    observed = await observeLive(request);
    throw new Error('Local fixture has no genuine peer execution provenance');
  } };
  try {
    await prepareHost(driver, { bindings: {} }, { gate, probeExecutor: executor });
    await assert.rejects(driver.verifyProbe({ url: gate.target, vantage: 'lan', tls: false, sse: true, streamableHttp: true }), /pending or failed/);
    assert.equal(request.requirements.httpsRequired, false);
    assert.equal(request.vantage, 'lan');
    assert.equal(observed.observerVantage, 'local-to-execution-machine');
    assert.equal(observed.service.vantage, 'local'); assert.equal(observed.service.tls, false);
    assert.equal(observed.service.toolCall, true); assert.equal(observed.gate.events.length, 3);
    assert.equal(driver.acceptedProbeReceipt, undefined, 'local observations must not become accepted remote proof');
    await assert.rejects(observeLive({ ...request, vantage: 'public' }), /HTTP is admitted only/);
    await assert.rejects(observeLive({ ...request, vantage: 'tailnet' }), /HTTP is admitted only/);
    await assert.rejects(observeLive({ ...request, requirements: { ...request.requirements, httpsRequired: true } }), /HTTP is admitted only/);
  } finally { await driver.closeLocal(); await gate.close(); await service.close(); }
});
