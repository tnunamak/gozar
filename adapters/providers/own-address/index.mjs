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
  return value === url.origin || value === `${url.origin}/` ? url.origin : null;
}

const IPV4_PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];
// 100.64.0.0/10 is shared carrier-grade NAT space: not public, and not a network this device can name. Its reach is unknown.
const sharedNat = host => { const [a, b] = host.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
/** Where the address can be reached from: loopback is this device, a private address or a local name is the local network. */
export function reachOf(origin) {
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const family = isIP(host);
  if (family === 4) return host.startsWith('127.') ? 'this-device' : IPV4_PRIVATE.some(pattern => pattern.test(host)) ? 'lan' : sharedNat(host) ? 'unknown' : 'internet';
  if (family === 6) return host === '::1' ? 'this-device' : /^(f[cd]|fe[89ab])/.test(host) ? 'lan' : 'internet';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'this-device';
  return /\.(local|lan)$/.test(host) ? 'lan' : 'internet';
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
    const given = async ctx => parseOrigin(ctx.origin) ?? parseOrigin((await ctx.configuration(null).catch(() => null))?.origin);

    return {
      async detect(ctx) {
        const result = await base.detect(ctx);
        if (result.state !== 'ready') return result;
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
        const origin = parseOrigin(request.origin) ?? await given(ctx);
        if (!origin) throw effectError('setup_required', 'Provide the HTTPS address you run first');
        const resourceKey = `${definition.id}:${sha({ target: request.target, origin }).slice(0, 16)}`;
        return { digest: sha({ adapterId: definition.id, kind: 'durable', target: request.target, origin, resourceKey }), origin, resourceKey, effects: [],
          readback: { kind: 'durable', origin, target: request.target }, cleanup: { kind: 'external-owned' }, precondition: null };
      },
    };
  },
});
