// Which executor observes a recipe session's publication proof. The driver decides what a receipt proves (exact origin, this attempt's
// nonce, the vantage the core asked for, TLS, SSE, protocols, freshness; see driver.test.mjs and session-lifecycle); the session only
// chooses the executor, and the choice must never invent a vantage the host did not supply.
// Replaces the earlier `sessionProofFetch` tests (public pinned fetch / no independent tailnet or LAN vantage): the same properties now sit in
// the executor choice, and the receipt rules they relied on are the driver's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicRelayVerifier } from '../../packages/gozar-node/public-relay.mjs';
import { sessionProbeExecutor } from '../../packages/gozar-node/session-recipe.mjs';

const origin = 'https://device.example-tailnet.ts.net:8443';
const signal = new AbortController().signal;
const now = () => 1_000_000;
const authorization = { nonceRef: 'nonce-1', verifierRef: 'verifier-1', expiresAtMs: now() + 900_000 };

test('without a host executor or fixture effects the proof runs through the public relay verifier, which serves the public vantage only', () => {
  const executor = sessionProbeExecutor({ runtime: {}, gate: {}, now });
  assert.ok(executor instanceof PublicRelayVerifier);
  assert.deepEqual(executor.vantages, ['public']);
  assert.equal(executor.vantages.includes('tailnet'), false, 'a tailnet proof has no executor, so the driver leaves it unverified');
  assert.equal(executor.vantages.includes('lan'), false, 'a LAN proof has no executor, so the driver leaves it unverified');
});

test('a host-supplied executor is used as it is, for the vantages the host declares', () => {
  const probeExecutor = { vantages: ['tailnet'], verify: async () => assert.fail('not called here') };
  assert.equal(sessionProbeExecutor({ runtime: { probeExecutor, dispatchEffect: async () => {} }, gate: {}, now }), probeExecutor);
});

test('a fixture proof fetches the gate challenge for the exact announced origin and asks for SSE only when the core did', async () => {
  const calls = [];
  const gate = { verify: async (url, options) => { calls.push({ url, sse: options.sse, signal: options.signal }); return { tls: true, instanceMatched: true, sse: options.sse }; } };
  const executor = sessionProbeExecutor({ runtime: { dispatchEffect: async () => {}, fetch: 'fixture-fetch' }, gate, now });
  assert.deepEqual(executor.vantages, ['public', 'tailnet', 'lan']);
  for (const [sse, vantage] of [[false, 'public'], [true, 'tailnet'], [true, 'lan']]) {
    const { probeReceipt, provenance } = await executor.verify({ origin, vantage, authorization, requirements: { sse }, signal });
    assert.deepEqual(calls.at(-1), { url: origin, sse, signal });
    assert.equal(probeReceipt.origin, origin);
    assert.equal(probeReceipt.vantage, vantage, 'the receipt names the vantage the core asked for, never another');
    assert.equal(probeReceipt.nonceRef, authorization.nonceRef);
    assert.equal(probeReceipt.verifierRef, authorization.verifierRef);
    assert.equal(probeReceipt.sse, sse);
    assert.equal(probeReceipt.streamableHttp, false);
    assert.equal(probeReceipt.oauthDcr, false);
    assert.ok(probeReceipt.expiresAtMs <= authorization.expiresAtMs, 'a receipt never outlives its authorization');
    assert.deepEqual(provenance, { kind: 'explicit-fixture-effects' }, 'fixture receipts say they are fixtures, never real remote evidence');
  }
  assert.equal(calls.every(call => call.url === origin), true);
});

test('a fixture proof that the gate refuses produces no receipt', async () => {
  const gate = { verify: async () => { throw new Error('challenge did not match'); } };
  const executor = sessionProbeExecutor({ runtime: { dispatchEffect: async () => {} }, gate, now });
  await assert.rejects(executor.verify({ origin, vantage: 'public', authorization, requirements: { sse: false }, signal }), /challenge did not match/);
});
