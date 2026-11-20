import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';

// 0.5.1 pinned this through the schema-less `expose({ port, adapterId })` call, which ran the old CLI in a subprocess. That call no longer exists
// (a call without a route request is refused, see cli.test.mjs and api.test.mjs); the same two promises are kept through the route request:
// choosing a provider explicitly still needs the candidate approval, and a provider this version does not admit is refused before anything starts.
test('an explicitly chosen provider still needs approval, and one this version does not admit is refused', async t => {
  const { directory } = await fixture(t, {});
  const { createGozar } = await import('@tnunamak/gozar');
  const { query } = await import('./route-schema-check.mjs');
  const home = join(directory, 'home');
  const gozar = createGozar({ identity: { instanceId: 'explicit-opt-in', bootId: 'boot-1' } });
  const request = providerId => query({ home, owner: 'explicit-opt-in', target: '127.0.0.1:18765', providerId, usage: { kind: 'session', lifetimeMs: 60_000 },
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const unapproved = await gozar.expose({ ...request('tunnl-gg'), operationId: 'explicit-opt-in-1', wait: 'verified' }).then(() => null, error => error);
  assert.equal(unapproved?.code, 'consent_required', unapproved?.message);
  const unadmitted = await gozar.expose({ ...request('ngrok-https-edge'), operationId: 'explicit-opt-in-2', wait: 'verified', approval: { kind: 'route', candidateToken: 'none', disclosureRevision: 'none', consentFactsDigest: 'none' } })
    .then(() => null, error => error);
  assert.ok(unadmitted, 'a provider this version does not admit is refused');
  assert.notEqual(unadmitted.code, 'internal_error', unadmitted.message);
});
