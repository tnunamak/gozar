// Shared by consumer-session-acknowledgment.test.mjs and consumer-watch-acknowledgment.test.mjs. Not a test file.
//
// An embedding host that declared `acknowledgeOrigin` and gates its own challenge listener on exactly what it was told.
// Provenance: the host model ports the exact-attempt allowance of the DataConnect adoption branch
// ra-gozar/adopt-052-1119 (head 94f88e2e52456d265891a0aead8109018a5a14c2), reference-implementation/server/
// reachability/service.ts (acknowledgeOrigin, approvesChallengeAuthority, check, closeShared) and service-challenge.ts.
// Nothing here imports that checkout. The route side is the real public factory with fixture provider effects.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServiceVerifier } from '@tnunamak/gozar';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { scratch, query } from './route-schema-check.mjs';

export const CHALLENGE_PATH = '/.well-known/gozar/service';
export const handleKey = handle => `${handle.kind}:${handle.id}:${handle.generation}`;
const sameHandle = (a, b) => a.kind === b.kind && a.id === b.id && a.generation === b.generation;

/**
 * The host's allowance, as the adoption branch implements it. A provider-chosen origin is allowed only inside a
 * proof call the host itself opened (`start`, `check`). The first acknowledgment binds that call to one exact
 * handle, origin and attempt; any other tuple is refused, and nothing outside a call is acknowledged.
 */
export class ExactAttemptHost {
  applying = null;
  proofCalls = new Map();
  accepted = [];
  refused = [];
  constructor({ home, owner }) { this.home = home; this.owner = owner; }

  acknowledgeOrigin = async request => {
    const refuse = reason => { this.refused.push({ reason, attemptId: request.attemptId, handle: request.handle }); throw new Error('origin_acknowledgment_scope_mismatch'); };
    const applying = this.applying;
    const proof = this.proofCalls.get(handleKey(request.handle));
    const scope = applying && applying.origin === null && request.operationId === applying.operationId &&
      request.providerId === applying.providerId && request.target === applying.target ? applying : proof;
    if (!scope) refuse('outside-any-host-call');
    if (request.home !== this.home || request.owner !== this.owner || !request.attemptId || !URL.canParse(request.origin)) refuse('malformed');
    const prior = scope.acknowledgment;
    if (prior && (!sameHandle(prior.handle, request.handle) || prior.attemptId !== request.attemptId || prior.origin !== request.origin)) refuse('another-attempt-in-this-call');
    scope.acknowledgment = request;
    this.accepted.push({ attemptId: request.attemptId, handle: request.handle });
    return { acknowledged: true, origin: request.origin, handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId };
  };

  approvesChallengeAuthority(authority) {
    const origins = [this.applying?.acknowledgment?.origin, ...[...this.proofCalls.values()].map(call => call.acknowledgment?.origin)];
    return origins.some(origin => { try { return !!origin && new URL(origin).host === authority; } catch { return false; } });
  }

  /** The host's start: the whole `ensureRoute` call is one proof call for a provider-chosen origin. */
  async start(api, request) {
    this.applying = { origin: null, operationId: request.operationId, providerId: request.providerId, target: request.target };
    try { return await api.ensureRoute(request); } finally { this.applying = null; }
  }

  /** The host's explicit check: one proof call on one handle, with the library's own status call. */
  async check(api, handle) {
    const call = { handle };
    this.proofCalls.set(handleKey(handle), call);
    try { return await api.routeStatus({ home: this.home, handle }); }
    finally { if (this.proofCalls.get(handleKey(handle)) === call) this.proofCalls.delete(handleKey(handle)); }
  }

  /** The host's close drops the handle's permission first, then closes (closeShared). */
  async close(api, handle) {
    this.proofCalls.delete(handleKey(handle));
    if (this.applying?.acknowledgment && sameHandle(this.applying.acknowledgment.handle, handle)) this.applying = null;
    return api.closeRoute({ home: this.home, handle, mode: 'remove' });
  }
}

/** A real HTTP listener that answers the library's service challenge only for a Host the allowance approves. */
export async function challengeListener(host, t) {
  const verify = createServiceVerifier();
  const server = http.createServer((req, res) => {
    const answer = { status: 200, headers: {}, body: '' };
    const collector = { writeHead(status, headers) { answer.status = status; answer.headers = headers; }, end(body) { answer.body = body ?? ''; } };
    let approved = false;
    if (verify(req, collector)) { try { approved = host.approvesChallengeAuthority(JSON.parse(answer.body).authority); } catch { approved = false; } }
    if (!approved) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":{"code":"not_found"}}'); return; }
    res.writeHead(answer.status, answer.headers); res.end(answer.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  return { server, port: server.address().port, ask: hostHeader => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: `${CHALLENGE_PATH}?nonce=${'ab'.repeat(32)}`, headers: { host: hostHeader } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  }) };
}

/**
 * Fixture provider effects for the tailscale adapters: a stored serve configuration the local API reads and writes,
 * and a public fetch that traverses the stored forwarding rule to the real local listener. `hooks.beforeProofFetch`
 * lets a test hold the library's proof request after the acknowledgment.
 */
export function funnelEffects({ hooks = {} } = {}) {
  const node = { BackendState: 'Running', Self: { DNSName: 'fixture.node.invalid.', ID: 'fixture-node', CapMap: { https: [], funnel: [], 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': [] } },
    CurrentTailnet: { MagicDNSEnabled: true, MagicDNSSuffix: 'node.invalid' }, CertDomains: ['fixture.node.invalid'] };
  const state = { config: { TCP: { 9000: { TCPForward: '127.0.0.1:9001' } } }, version: 1, writes: 0, proofFetches: [] };
  const effects = [
    { kind: 'recipe', operation: 'probe', handle: async ({ recipe }) => ({ stdout: JSON.stringify(recipe.args[0] === 'serve' ? state.config : node), stderr: '', exitCode: 0 }) },
    { kind: 'local-api', operation: 'request', handle: async request => {
      if (request.path.includes('status?')) return { status: 200, headers: {}, body: JSON.stringify(node) };
      assert.equal(request.path, '/localapi/v0/serve-config');
      if (request.method === 'GET') return { status: 200, headers: { etag: `"${state.version}"` }, body: JSON.stringify(state.config) };
      assert.equal(request.method, 'POST');
      if (request.headers['If-Match'] !== `"${state.version}"`) return { status: 412, headers: {}, body: '' };
      state.config = structuredClone(request.body); state.version++; state.writes++;
      return { status: 200, headers: {}, body: '' };
    } },
    { kind: 'network', operation: 'fetch', handle: async request => {
      const url = new URL(request.url), port = url.port || '443';
      const proxy = url.protocol === 'http:' ? `http://${url.host}` : state.config.Web?.[`${url.hostname}:${port}`]?.Handlers?.['/']?.Proxy;
      assert.ok(proxy, 'public proof must traverse the independently stored forwarding rule');
      if (url.pathname === CHALLENGE_PATH) { state.proofFetches.push({ host: url.host }); await hooks.beforeProofFetch?.(url); }
      return new Promise((resolve, reject) => {
        const pending = http.get(proxy + url.pathname + url.search, { headers: request.headers }, response => {
          const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, chunks: [{ data: Buffer.concat(chunks).toString('base64'), delayMs: 0 }] }));
        });
        pending.on('error', reject);
      });
    } },
  ];
  return { effects, state, node };
}

/**
 * The whole fixture: a real challenge listener on the target, the exact-attempt host, and the public factory
 * declaring that host's `acknowledgeOrigin`. `pick` chooses the provider by id.
 */
export async function hostedFunnelWorld(t, { providerId = 'tailscale-funnel', hooks, acknowledgeOrigin } = {}) {
  // Registered before the scratch home, so the harness closes its routes while the home still exists.
  const closing = {}; t.after(() => closing.harness?.close());
  const home = await scratch(t), owner = 'consumer-owner';
  const host = new ExactAttemptHost({ home, owner });
  const listener = await challengeListener(host, t);
  const fixture = funnelEffects({ hooks });
  const harness = await createTestingGozar({ effects: fixture.effects, acknowledgeOrigin: acknowledgeOrigin?.(host) ?? host.acknowledgeOrigin });
  closing.harness = harness;
  const api = harness.gozar;
  const target = `127.0.0.1:${listener.port}`;
  const durableRequest = {
    ...query({ home, owner, providerId, operationId: 'consumer-op', target, usage: { kind: 'durable', routeId: 'consumer-route' },
      requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } }),
  };
  return { api, home, owner, host, listener, fixture, target, harness, durableRequest, providerId };
}

/** The approval a person gives after seeing the exact catalog candidate. */
export async function approved(api, request) {
  await api.listProviders({ home: request.home, owner: request.owner, refresh: true }); // the host's explicit detection before consent
  const candidate = (await api.catalogRoutes(request)).candidates[0];
  assert.ok(candidate, 'the catalog offers a candidate');
  assert.equal(candidate.eligible, true, 'the candidate is eligible: ' + JSON.stringify(candidate.unmet));
  return { ...request, approval: { kind: 'route', candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest } };
}
