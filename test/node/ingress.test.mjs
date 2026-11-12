import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { buildIngress, resolveClientAddress } from '../../packages/gozar-node/ingress.mjs';
import { createGate, NORMALISED_HEADER, STRIPPED_FORWARDING_HEADERS } from '../../packages/gozar-node/gate.mjs';
import { assertShape, fixtures } from './route-schema-check.mjs';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const unixPeer = { kind: 'unix-socket', path: '/private/gozar-state/ingress.sock', ownerUid: 1000 };
const header = (over = {}) => ({ name: 'x-forwarded-for', format: 'ip-list', trustedHops: 1, trustedProxyCidrs: ['192.0.2.0/24'], ...over });
const ingress = (boundary = { kind: 'trusted-header', evidenceRef: 'evidence-synthetic-2', peer: unixPeer, header: header() }, over = {}) =>
  buildIngress({ generation: 2, now: NOW, publicAuthority: 'example.invalid', boundary, ...over });
const proof = (over = {}) => ({ socketPeer: { address: '/private/gozar-state/ingress.sock', port: 0 }, peerIdentity: unixPeer, headers: { 'x-forwarded-for': '203.0.113.9, 192.0.2.5' },
  now: NOW + 1000, routeGeneration: 2, ...over });
const resolve = (p, i = ingress()) => resolveClientAddress(p, i);
const check = result => { assertShape('ResolveClientAddressResult', result); return result; };

test('every ingress snapshot shape validates against the frozen schema', () => {
  assertShape('Ingress', ingress());
  assertShape('Ingress', ingress({ kind: 'socket' }));
  assertShape('Ingress', ingress({ kind: 'unavailable', reason: 'provider does not expose it' }));
  assertShape('Ingress', ingress({ kind: 'trusted-header', evidenceRef: 'evidence-synthetic-3', peer: { kind: 'mtls', spkiSha256: 'ab'.repeat(32) }, header: header({ format: 'rfc7239', name: 'forwarded' }) }));
  assertShape('Ingress', ingress({ kind: 'trusted-header', evidenceRef: 'evidence-synthetic-4', peer: { kind: 'network-boundary', cidrs: ['192.0.2.0/24'], boundaryRef: 'boundary-synthetic' }, header: header() }));
});

test('a proven boundary with a matching peer yields the rightmost untrusted address', () => {
  const result = check(resolve(proof()));
  assert.deepEqual([result.address, result.source], ['203.0.113.9', 'trusted-header']);
});

test('RFC 7239 Forwarded parses quoted for= nodes, including IPv6 and ports', () => {
  const i = ingress({ kind: 'trusted-header', evidenceRef: 'evidence-synthetic-3', peer: unixPeer, header: header({ format: 'rfc7239', name: 'forwarded' }) });
  const result = check(resolve(proof({ headers: { forwarded: 'for="[2001:db8::7]:4711";proto=https, for=192.0.2.5' } }), i));
  assert.deepEqual([result.address, result.source], ['2001:db8::7', 'trusted-header']);
});

test('red: a forged forwarding chain is not trusted (too long, duplicated, oversized, malformed, all-trusted)', () => {
  const unavailable = headers => check(resolve(proof({ headers })));
  // The boundary writes one hop; a client-supplied prefix makes the chain longer than the declared trusted hops.
  const forged = unavailable({ 'x-forwarded-for': '10.0.0.1, 203.0.113.9, 192.0.2.5' });
  assert.deepEqual([forged.address, forged.source], [null, 'unavailable']);
  assert.equal(unavailable({ 'x-forwarded-for': ['203.0.113.9', '10.0.0.1'] }).source, 'unavailable');
  assert.equal(unavailable({ 'x-forwarded-for': '203.0.113.9', 'X-Forwarded-For': '10.0.0.1' }).source, 'unavailable');
  assert.equal(unavailable({ 'x-forwarded-for': 'a'.repeat(2000) }).source, 'unavailable');
  assert.equal(unavailable({ 'x-forwarded-for': 'not-an-ip, 192.0.2.5' }).source, 'unavailable');
  assert.equal(unavailable({ 'x-forwarded-for': '192.0.2.8, 192.0.2.5' }).source, 'unavailable');
  assert.equal(unavailable({}).source, 'unavailable');
});

test('red: a request that did not come from the proven peer ignores its headers and reports the socket', () => {
  const direct = check(resolve(proof({ socketPeer: { address: '198.51.100.20', port: 5555 }, peerIdentity: { kind: 'unix-socket', path: '/tmp/other.sock', ownerUid: 1000 },
    headers: { 'x-forwarded-for': '203.0.113.9' } })));
  assert.deepEqual([direct.address, direct.source], ['198.51.100.20', 'socket']);
  assert.equal(check(resolve(proof({ peerIdentity: { ...unixPeer, ownerUid: 0 } }))).source, 'socket');
  assert.equal(check(resolve(proof({ peerIdentity: null }))).source, 'socket');
  assert.equal(check(resolve(proof({ peerIdentity: { kind: 'mtls', spkiSha256: 'ab'.repeat(32) } }))).source, 'socket');
});

test('red: a stale proof (another route generation, or outside the validity window) is not trusted', () => {
  assert.deepEqual(check(resolve(proof({ routeGeneration: 1 }))).source, 'unavailable');
  assert.deepEqual(check(resolve(proof({ routeGeneration: 3 }))).address, null);
  assert.equal(check(resolve(proof({ now: NOW + 301_000 }))).source, 'unavailable');
  assert.equal(check(resolve(proof({ now: NOW - 1 }))).source, 'unavailable');
  assert.equal(check(resolve(proof({ now: Number.NaN }))).source, 'unavailable');
  // The same proof is trusted while it is current: the stale cases fail because of generation or time, nothing else.
  assert.equal(check(resolve(proof())).source, 'trusted-header');
});

test('mtls and network-boundary peers are matched on their own identity', () => {
  const spki = 'cd'.repeat(32);
  const mtls = ingress({ kind: 'trusted-header', evidenceRef: 'evidence-synthetic-3', peer: { kind: 'mtls', spkiSha256: spki }, header: header() });
  assert.equal(check(resolve(proof({ peerIdentity: { kind: 'mtls', spkiSha256: spki } }), mtls)).source, 'trusted-header');
  assert.equal(check(resolve(proof({ peerIdentity: { kind: 'mtls', spkiSha256: 'ef'.repeat(32) } }), mtls)).source, 'socket');
  const net = ingress({ kind: 'trusted-header', evidenceRef: 'evidence-synthetic-4', peer: { kind: 'network-boundary', cidrs: ['192.0.2.0/24'], boundaryRef: 'boundary-synthetic' }, header: header() });
  const inside = { socketPeer: { address: '::ffff:192.0.2.5', port: 1 }, peerIdentity: { kind: 'network-boundary', address: '192.0.2.5' } };
  assert.equal(check(resolve(proof(inside), net)).source, 'trusted-header');
  const outside = { socketPeer: { address: '203.0.113.50', port: 1 }, peerIdentity: { kind: 'network-boundary', address: '203.0.113.50' } };
  assert.equal(check(resolve(proof(outside), net)).source, 'socket');
});

test('no ingress, an unavailable ingress and a plain socket ingress never invent a header answer', () => {
  assert.equal(check(resolveClientAddress(proof(), null)).source, 'unavailable');
  assert.equal(check(resolve(proof(), ingress({ kind: 'unavailable', reason: 'none' }))).source, 'unavailable');
  const viaSocket = check(resolve(proof({ socketPeer: { address: '198.51.100.20', port: 9 } }), ingress({ kind: 'socket' })));
  assert.deepEqual([viaSocket.address, viaSocket.source], ['198.51.100.20', 'socket']);
});

test('buildIngress rejects an incomplete trusted-header claim', () => {
  for (const boundary of [{ kind: 'trusted-header', peer: unixPeer, header: header() }, { kind: 'trusted-header', evidenceRef: 'e', header: header() },
    { kind: 'trusted-header', evidenceRef: 'e', peer: unixPeer, header: header({ trustedProxyCidrs: ['not-a-cidr'] }) }])
    assert.throws(() => ingress(boundary), error => error.code === 'invalid_input');
});

test('the fixture ingress values resolve consistently with the contract', () => {
  for (const item of fixtures.valid.filter(entry => entry.shape === 'ResolveClientAddressResult')) assertShape('ResolveClientAddressResult', item.value);
});

test('red: the gate strips every inbound forwarding header and writes one normalised header the snapshot names', async t => {
  let seen;
  const app = http.createServer((request, response) => { seen = request.headers; response.end('ok'); });
  await new Promise(done => app.listen(0, '127.0.0.1', done));
  t.after(() => { app.closeAllConnections(); app.close(); });
  const gate = await createGate(app.address().port); t.after(() => gate.close());
  await new Promise((done, fail) => {
    const req = http.request(`${gate.target}/mcp`, { headers: { 'X-Forwarded-For': '10.9.9.9', Forwarded: 'for=10.9.9.9', 'X-Real-IP': '10.9.9.9' } }, response => { response.resume(); response.on('end', done); });
    req.on('error', fail); req.end();
  });
  assert.equal(seen[NORMALISED_HEADER], '127.0.0.1', 'the app learns the gate\'s own peer and nothing a client wrote');
  assert.equal(seen.forwarded, undefined);
  assert.equal(seen['x-real-ip'], undefined);
  assert.equal(gate.forwarding.header.name, NORMALISED_HEADER);
  assert.deepEqual([...gate.forwarding.stripped], [...STRIPPED_FORWARDING_HEADERS]);
  // The snapshot is usable as the header plan of an Ingress, and claims no boundary on its own.
  assertShape('Ingress', buildIngress({ generation: 1, now: NOW, publicAuthority: 'example.invalid', boundary: { kind: 'socket' } }));
  assert.equal(gate.forwarding.header.sanitization, 'strip-inbound-and-write');
});
