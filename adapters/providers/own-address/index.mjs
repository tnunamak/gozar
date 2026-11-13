// own-address: an HTTPS address the owner already runs. Gozar creates and deletes nothing; it validates the address
// against this instance and keeps a record of it. The adapter is wrapped over its existing recipe definition (see
// ../../../packages/gozar-node/adapter-runtime.mjs) and adds what the owner's address needs:
//   - the address comes from the query (`ctx.origin`) or from a value the owner gave a `provide-value` action;
//   - without one the adapter is `action-required` and asks for it with one `provide-value` action;
//   - with one, its reach follows the address's host, and its proof is a check from this device until verified;
//   - a durable plan: the owner-run route kept as a service record.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A credential-free https origin, or null. */
function parseOrigin(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) return null;
  return url.pathname === '' || url.pathname === '/' ? url.origin : null;
}

const IPV4_PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];
// 100.64.0.0/10 is shared carrier-grade NAT space: not public, and not a network this device can name. Its reach is unknown.
const sharedNat = host => { const [a, b] = host.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
/** Where the address can be reached from: loopback is this device, a private address or a local name is the local network. */
export function reachOf(origin) {
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const family = isIP(host);
  // 0.0.0.0/8 means "this network", and 224.0.0.0/3 is multicast, reserved and broadcast: none is one remote host.
  if (family === 4) {
    const first = Number(host.split('.')[0]);
    return first === 0 || first >= 224 ? 'unknown' : first === 127 ? 'this-device' : IPV4_PRIVATE.some(pattern => pattern.test(host)) ? 'lan' : sharedNat(host) ? 'unknown' : 'internet';
  }
  if (family === 6) {
    if (host === '::1') return 'this-device';
    // A prefix test needs the whole first hextet: the parser drops leading zeros, so 00fd::1 prints as fd::1.
    if (host === '::' || /^ff[0-9a-f]{2}:/.test(host)) return 'unknown'; // unspecified, multicast
    // An IPv4-mapped address (::ffff:a.b.c.d) is classified as that IPv4 address. The deprecated IPv4-compatible
    // form (::a.b.c.d) is not routed as IPv4, so only its loopback reading is kept and anything else is unknown.
    // The URL parser prints both in hex, for example [::ffff:7f00:1] for 127.0.0.1, and drops a zero high hextet,
    // so ::0.0.0.2 prints as [::2].
    const embedded = host.match(/^::(ffff:)?(?:([0-9a-f]{1,4}):)?([0-9a-f]{1,4})$/);
    if (embedded) {
      const high = parseInt(embedded[2] ?? '0', 16), low = parseInt(embedded[3], 16);
      const ipv4 = reachOf(`https://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      return embedded[1] || ipv4 === 'this-device' ? ipv4 : 'unknown';
    }
    return /^(f[cd][0-9a-f]{2}|fe[89a-f][0-9a-f]):/.test(host) ? 'lan' : 'internet'; // unique-local, link-local, old site-local
  }
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) return 'this-device';
  return !host.includes('.') || /(^|\.)home\.arpa$/.test(host) || /\.(local|lan|internal)$/.test(host) ? 'lan' : 'internet';
}

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
  externalOwned: true, // the owner keeps the route; nothing is created or deleted
  extend: ({ base, definition, platformOf, unsupported }) => {
    const originAction = (() => {
      const body = { id: 'origin', kind: 'provide-value', label: 'Provide the HTTPS address you run', valueLabel: 'HTTPS address',
        valuePlaceholder: 'https://app.example.com', valueFormat: 'https-origin', required: true, disclosure: definition.disclosure };
      return { ...body, digest: sha(body) };
    })();
    const given = async ctx => ctx.origin == null ? parseOrigin((await ctx.configuration(null).catch(() => null))?.origin) : parseOrigin(ctx.origin);

    return {
      async detect(ctx) {
        const result = await base.detect(ctx);
        if (result.state !== 'ready') return result;
        // An origin the app named that is not a credential-free https origin cannot be fixed by the owner's action.
        if (ctx.origin != null && parseOrigin(ctx.origin) === null) return { state: 'unsupported', facts: { ...result.facts, setupNeeded: false, origin: null, reach: 'unknown', invalidOrigin: ctx.origin } };
        const origin = await given(ctx);
        return origin
          ? { state: 'ready', facts: { ...result.facts, setupNeeded: false, origin, reach: reachOf(origin) } }
          : { state: 'action-required', facts: { ...result.facts, setupNeeded: true, origin: null, reach: 'unknown' } };
      },

      // The proof is a check from this device until the route is verified; Gozar claims no wider vantage.
      properties: facts => ({ ...base.properties(), reach: facts?.reach ?? 'unknown', proof: { vantage: 'this-device', checks: ['tls', 'nonce'] } }),

      setupActions: facts => (facts?.setupNeeded ? [structuredClone(originAction)] : []),

      async setup(ctx, actionId) {
        if (actionId !== originAction.id) throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
        return { state: 'pending', nextAction: structuredClone(originAction) };
      },

      async plan(ctx, request) {
        if (request?.usage?.kind !== 'durable') return base.plan(ctx, request);
        platformOf(ctx);
        const origin = request.origin == null ? await given(ctx) : parseOrigin(request.origin);
        if (request.origin != null && !origin) throw effectError('invalid_input', 'The requested origin is invalid');
        if (!origin) throw effectError('setup_required', 'Provide the HTTPS address you run first');
        const resourceKey = `${definition.id}:${sha({ target: request.target, origin }).slice(0, 16)}`;
        return { digest: sha({ adapterId: definition.id, kind: 'durable', target: request.target, origin, resourceKey }), origin, resourceKey, effects: [],
          readback: { kind: 'durable', origin, target: request.target }, cleanup: { kind: 'external-owned' }, precondition: null };
      },
    };
  },
});
