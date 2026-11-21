// 0.5.2 scope of the host acknowledgment boundary: it covers origins a PROVIDER assigns after allocation (the
// host cannot know them in advance, so it must bind its verifier's Host allowance when told). An owner-kept
// route (ownership: 'external-owned', e.g. own-address) has no provider allocation: its origin is the exact
// credential-free https origin the owner supplied BEFORE the call, so the host can allow exactly that origin
// up front and needs no wildcard. Gozar therefore asks no acknowledgment for it, and every proof request
// names exactly the owner-supplied origin and no other.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServiceVerifier } from '@tnunamak/gozar';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch, query } from './route-schema-check.mjs';

test('owner-kept route with a declared acknowledgeOrigin: no acknowledgment is asked; every proof names exactly the owner-supplied origin', async t => {
  let harness, app; t.after(async () => { await harness?.close(); if (app) await new Promise(resolve => app.close(resolve)); });
  const home = await scratch(t), verifier = createServiceVerifier();
  app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('owner app'); });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const target = `127.0.0.1:${app.address().port}`, origin = 'https://owner.fixture.invalid';
  const asked = [], probed = new Set(); let proofAvailable = true;
  harness = await createTestingGozar({
    acknowledgeOrigin: async request => { asked.push(request); return { acknowledged: false }; },
    effects: [{ kind: 'network', operation: 'fetch', handle: async request => {
      if (!proofAvailable) return { status: 503, headers: {}, chunks: [] };
      const url = new URL(request.url); probed.add(url.origin);
      const forwarded = await new Promise((resolve, reject) => http.get(`http://${target}${url.pathname}${url.search}`, { headers: request.headers }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, chunks: [{ data: Buffer.concat(chunks).toString('base64'), delayMs: 0 }] }));
      }).once('error', reject));
      return forwarded;
    } }] });
  const api = harness.gozar;
  const q = query({ home, target, origin, providerId: 'own-address', operationId: 'owner-scope', usage: { kind: 'durable', routeId: 'owner-scope-route' },
    requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } });
  const choice = (await api.catalogRoutes(q)).candidates[0];
  const route = await api.ensureRoute({ ...q, approval: { kind: 'route', candidateToken: choice.candidateToken, disclosureRevision: choice.disclosure.revision, consentFactsDigest: choice.consentFactsDigest } });
  assert.equal(route.ownership, 'external-owned');
  assert.equal(route.verification.status, 'verified', 'the owner-kept proof runs without a host acknowledgment');
  assert.deepEqual(asked, [], 'no acknowledgment was asked: the origin is owner-supplied, not provider-assigned');
  assert.deepEqual([...probed].filter(seen => seen !== `http://${target}`), [origin], 'every public proof request named exactly the owner-supplied origin (the other is the local target itself), so the host can allow that one origin up front');
  proofAvailable = false;
  const unverified = await api.routeStatus({ home, handle: route.handle });
  assert.equal(unverified.verification.status, 'unverified');
  assert.equal(unverified.consentChange, undefined, 'proof failure does not change consent');
  const abort = new AbortController();
  const watch = api.watchRoutes({ home, handle: route.handle, signal: abort.signal })[Symbol.asyncIterator]();
  assert.equal((await watch.next()).value.type, 'snapshot');
  abort.abort();
  assert.equal((await watch.next()).done, true, 'the initial unverified snapshot has no extra consent event');
  await api.closeRoute({ home, handle: route.handle, mode: 'remove' });
});
