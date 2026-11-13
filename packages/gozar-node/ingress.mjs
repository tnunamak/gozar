// Ingress: what an app may believe about where a request came from. A forwarded client address is trusted only
// when the route's Ingress names a proven boundary and the transport-level peer of this very request is that
// boundary, at the route generation the proof was taken for. Header presence and loopback prove nothing.
import { BlockList, isIP } from 'node:net';
import { gozarError } from './error-normalizer.mjs';

const MAX_HEADER_BYTES = 1024;
const MAX_CHAIN = 32;
const iso = ms => new Date(ms).toISOString();

function cidrList(cidrs) {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address, bits, extra] = String(cidr).split('/');
    const family = isIP(address);
    const prefix = Number(bits);
    if (!family || extra !== undefined || !/^\d{1,3}$/.test(bits ?? '') || prefix > (family === 4 ? 32 : 128)) throw gozarError('invalid_input', `Not a CIDR: ${cidr}`);
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return list;
}
const within = (list, address) => { const family = isIP(address); return family !== 0 && list.check(address, family === 4 ? 'ipv4' : 'ipv6'); };
const plain = address => String(address ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1').toLowerCase();

/**
 * Builds the Ingress snapshot for one route generation. Without a proven boundary the answer is 'unavailable'
 * (or 'socket' when the app is reached directly); a trusted-header answer needs evidence, a peer and a header plan.
 */
export function buildIngress({ generation, now = Date.now(), validForMs = 300_000, publicAuthority, boundary }) {
  if (!Number.isInteger(generation) || generation < 0 || typeof publicAuthority !== 'string' || !publicAuthority)
    throw gozarError('invalid_input', 'An ingress needs a generation and a public authority');
  const base = { generation, verifiedAt: iso(now), validUntil: iso(now + validForMs), publicAuthority, authorityHandling: 'configured-origin' };
  if (!boundary || boundary.kind === 'unavailable') return { ...base, clientAddress: { source: 'unavailable', reason: boundary?.reason ?? 'no proven ingress boundary' } };
  if (boundary.kind === 'socket') return { ...base, clientAddress: { source: 'socket' } };
  const { peer, header, evidenceRef } = boundary;
  const peerOk = peer?.kind === 'unix-socket' ? typeof peer.path === 'string' && Number.isInteger(peer.ownerUid) :
    peer?.kind === 'mtls' ? typeof peer.spkiSha256 === 'string' && peer.spkiSha256 !== '' :
    peer?.kind === 'network-boundary' ? Array.isArray(peer.cidrs) && peer.cidrs.length > 0 && typeof peer.boundaryRef === 'string' : false;
  if (boundary.kind !== 'trusted-header' || !peerOk || typeof evidenceRef !== 'string' || !evidenceRef || !header ||
      !['rfc7239', 'ip-list'].includes(header.format) || !/^[a-z0-9-]+$/.test(header.name ?? '') || !Number.isInteger(header.trustedHops) || header.trustedHops < 0)
    throw gozarError('invalid_input', 'A trusted-header ingress needs evidence, a proven peer and a header plan');
  if (peer.kind === 'network-boundary') cidrList(peer.cidrs);
  cidrList(header.trustedProxyCidrs ?? []);
  return { ...base, clientAddress: { source: 'trusted-header', evidenceRef, peer,
    header: { name: header.name, format: header.format, sanitization: 'strip-inbound-and-write', selection: 'rightmost-untrusted',
      trustedHops: header.trustedHops, trustedProxyCidrs: [...(header.trustedProxyCidrs ?? [])] } } };
}

function peerMatches(expected, proof) {
  const actual = proof.peerIdentity;
  if (!actual || actual.kind !== expected.kind) return false;
  if (expected.kind === 'unix-socket') return actual.path === expected.path && actual.ownerUid === expected.ownerUid;
  if (expected.kind === 'mtls') return typeof actual.spkiSha256 === 'string' && actual.spkiSha256 === expected.spkiSha256;
  const peerAddress = plain(proof.socketPeer?.address);
  return plain(actual.address) === peerAddress && within(cidrList(expected.cidrs), peerAddress);
}

// One header, exactly once, of bounded size. A duplicate (even in another case) is a forged or confused chain.
function headerValue(headers, name) {
  const hits = Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() === name);
  if (hits.length !== 1) return null;
  const value = hits[0][1];
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_HEADER_BYTES) return null;
  return value;
}
function splitOutsideQuotes(value, separator) {
  const parts = []; let quoted = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') quoted = !quoted;
    else if (value[i] === separator && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}
function nodeAddress(raw) {
  let node = raw.trim().replace(/^"|"$/g, '');
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(node);
  if (bracket) node = bracket[1]; else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(node)) node = node.slice(0, node.lastIndexOf(':'));
  return isIP(node) ? plain(node) : null;
}
function parseChain(value, format) {
  const items = splitOutsideQuotes(value, ',');
  if (items.length > MAX_CHAIN) return null;
  const chain = [];
  for (const item of items) {
    let address;
    if (format === 'ip-list') address = nodeAddress(item);
    else {
      const pairs = splitOutsideQuotes(item, ';').map(pair => pair.trim().split(/=(.*)/s)).filter(([key]) => key.toLowerCase() === 'for');
      address = pairs.length === 1 ? nodeAddress(pairs[0][1] ?? '') : null;
    }
    if (!address) return null;
    chain.push(address);
  }
  return chain;
}

const unavailable = reason => ({ address: null, source: 'unavailable', reason });
const viaSocket = (proof, reason) => ({ address: plain(proof.socketPeer?.address) || null, source: 'socket', reason });

/**
 * Pure and fail-closed. Returns where the client is, and how we know:
 *  - 'trusted-header': the peer is the proven boundary, the proof is current, and the written header is well formed;
 *  - 'socket': the transport peer itself (a request that did not come through the boundary, or a route with no header plan);
 *  - 'unavailable': nothing can be attributed.
 */
export function resolveClientAddress(proof, ingress) {
  const clientAddress = ingress?.clientAddress;
  if (!clientAddress || !proof) return unavailable('No ingress is known for this route');
  if (clientAddress.source === 'unavailable') return unavailable(clientAddress.reason);
  if (proof.routeGeneration !== ingress.generation) return unavailable('The proof is for another route generation');
  if (!Number.isFinite(proof.now) || proof.now >= Date.parse(ingress.validUntil) || proof.now < Date.parse(ingress.verifiedAt))
    return unavailable('The ingress proof is outside its validity window');
  if (clientAddress.source === 'socket') return viaSocket(proof, null);
  const { peer, header } = clientAddress;
  if (!peerMatches(peer, proof)) return viaSocket(proof, 'The peer is not the proven ingress boundary; its headers are ignored');
  const value = headerValue(proof.headers, header.name);
  if (value === null) return unavailable('The ingress boundary did not write exactly one well-formed forwarding header');
  const chain = parseChain(value, header.format);
  if (!chain) return unavailable('The forwarding header is malformed or too long');
  // The boundary strips what it received and writes one value, so a longer chain than the declared hops is forged.
  if (chain.length > header.trustedHops + 1) return unavailable('The forwarding chain is longer than the declared trusted hops');
  const trusted = cidrList(header.trustedProxyCidrs);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!within(trusted, chain[i])) return { address: chain[i], source: 'trusted-header', reason: null };
  }
  return unavailable('Every address in the forwarding chain is a trusted proxy');
}
