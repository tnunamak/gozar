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
  const text = value.trim();
  if (!/^https:\/\/[^/@?#\\\s]+\/?$/i.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.username || url.password || !url.hostname) return null;
  return url.pathname === '' || url.pathname === '/' ? url.origin : null;
}

// Invalid input can contain credentials or a token in the path. Only the
// credential-free scheme and authority belong in an error's public data.
function rejectedOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
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
    const action = (id, kind, label, actor, verification, purpose, fields) => {
      const body = { id, kind, label, disclosure: definition.disclosure, ...fields,
        ...(purpose && { step: { actor, verification, purpose, permission: { id, label } } }) };
      return { ...body, digest: sha(body) };
    };
    const originFields = { valueLabel: 'HTTPS address', valuePlaceholder: 'https://app.example.com', valueFormat: 'https-origin', required: true };
    const originAction = action('origin', 'provide-value', 'Provide the HTTPS address you run', 'owner', 'host', 'configure', originFields);
    const localOrigin = action('origin', 'provide-value', originAction.label, null, null, null, originFields);
    const entry = action('own-address-setup', 'gozar-runs', 'Set up an existing HTTPS address', 'machine', 'host', 'configure');
    const retained = 'The owner retains DNS records, the certificate, proxy settings, router rules and existing credentials. Stop in Gozar to withdraw its route and close any Gozar-owned gate. Remove in Gozar to forget its tracking record. The infrastructure administrator must retire any mapping that was added solely for this route.';
    const mapping = (origin, bindTarget) => {
      const exact = /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(bindTarget ?? '') && Number(bindTarget.split(':')[1]) <= 65535;
      return action('map-adopted-origin', 'instructions', 'Map the existing HTTPS origin to Gozar', 'administrator', 'host', 'configure',
        { instructions:
          `Configure DNS for ${origin} to reach your existing reverse proxy. Configure the proxy’s HTTPS listener for this exact hostname and port with a certificate the intended client trusts. If inbound routing is needed, forward only the proxy’s HTTPS port to that proxy, with access limited to the intended audience. ` +
          (exact
            ? `Set the upstream for this hostname on the same computer to the exact Gozar gate at http://${bindTarget}. `
            : 'Start the Gozar route and wait for its exact loopback gate target before setting the upstream. If the route uses a host-owned verifier, use only the upstream named by its owner. ') +
          'The proxy must preserve the request method, path and query and forward the Gozar challenge to the application. Allow streaming without buffering if the app requires it. From the intended client network, open the exact HTTPS origin and check the actual application. Gozar checks the application challenge and TLS from its observed vantage. ' + retained });
    };
    const unknown = reason => ({ known: false, reason });
    const given = async ctx => ctx.origin == null ? parseOrigin((await ctx.configuration().catch(() => null))?.origin) : parseOrigin(ctx.origin);

    return {
      async detect(ctx) {
        const result = await base.detect(ctx);
        if (result.state !== 'ready') return result;
        // An origin the app named that is not a credential-free https origin cannot be fixed by the owner's action.
        if (ctx.origin != null && parseOrigin(ctx.origin) === null) return { state: 'unsupported', facts: { ...result.facts, setupNeeded: false, origin: null, reach: 'unknown', invalidOrigin: rejectedOrigin(ctx.origin) } };
        const origin = await given(ctx);
        return origin
          ? { state: 'ready', facts: { ...result.facts, setupNeeded: false, origin, reach: reachOf(origin) } }
          : { state: 'action-required', facts: { ...result.facts, setupNeeded: true, origin: null, reach: 'unknown' } };
      },

      // The proof is a check from this device until the route is verified; Gozar claims no wider vantage.
      properties: facts => ({ ...base.properties(), reach: facts?.reach ?? 'unknown', proof: { vantage: 'this-device', checks: ['tls', 'nonce'] } }),

      configurationActions: () => [structuredClone(localOrigin), entry],

      setupActions: facts => (!facts?.setupNeeded ? [] : facts.origin ? [mapping(facts.origin)] : [structuredClone(localOrigin)]),

      async observeSetup(ctx, operation) {
        const route = ctx.route;
        if (operation.cancelled) return { state: 'cancelled', evidence: unknown('external-resources-retained'),
          nextAction: action('retain-infrastructure', 'instructions', 'Keep your existing infrastructure',
            'owner', 'host', 'reconcile', { instructions: retained }) };
        const fixedOrigin = ctx.origin != null;
        if (fixedOrigin && parseOrigin(ctx.origin) === null) return {
          state: 'blocked', nextAction: null, evidence: unknown('app-fixed-https-origin-invalid'),
        };
        if (operation.lastActionId === null) return { state: 'authorization-required', nextAction: entry };
        const origin = await given(ctx);
        if (!origin) return {
          state: 'authorization-required',
          nextAction: structuredClone(originAction), evidence: unknown('owner-https-origin-required'),
        };
        if (!route) return {
          state: 'complete', nextAction: mapping(origin),
          evidence: { operationId: operation.id, stepId: originAction.id, source: 'host',
            observedAt: new Date(ctx.now()).toISOString(),
            summary: 'The HTTPS address is configured. The route still needs its own approval, mapping and client proof.' },
        };
        if (route.origin && route.origin !== origin) return {
          state: 'blocked', evidence: unknown('owner-route-origin-changed'),
          nextAction: action('review-adopted-origin', 'instructions', 'Review the changed HTTPS origin', 'owner', 'host', 'reconcile',
            { instructions: 'The live route uses another hostname or port. Stop its Gozar tracking and approve the exact current origin before checking it again. ' + retained }),
        };
        const proof = route?.verification;
        const reach = reachOf(origin);
        const vantage = reach === 'internet' ? 'public' : reach;
        const target = route?.hostConfiguration?.target;
        const matches = route?.published === origin && proof?.status === 'verified' && target?.known === true &&
          proof.subject?.origin === origin && proof.subject.target === target.value &&
          proof.subject.handleGeneration === route.handle?.generation && proof.checks?.includes('nonce') &&
          proof.checks.includes('tls') && Number.isFinite(Date.parse(proof.observedAt));
        if (matches && proof.vantage === vantage && vantage !== 'unknown') {
          return { state: 'complete', nextAction: null, evidence: { operationId: operation.id,
            stepId: 'map-adopted-origin', source: vantage === 'this-device' ? 'host' : 'trusted-client', observedAt: proof.observedAt,
            summary: 'TLS and the exact application challenge passed from the required route vantage. Existing infrastructure remains owner-managed.',
          } };
        }
        if (matches && proof.vantage === 'this-device') {
          return { state: 'pending', evidence: unknown('independent-client-challenge-pending'),
            nextAction: action('verify-adopted-origin', 'instructions', 'Verify the adoption from the intended client network',
              'trusted-client', 'trusted-client', 'reconcile', { instructions:
                `From the intended client network, open ${origin} and check that your client trusts the certificate and reaches the actual app. Use Gozar’s trusted client verifier to return the challenge for this same address. A local TLS and application check leaves independent reachability pending. ${retained}` }) };
        }
        const bind = route?.hostConfiguration?.bindTarget;
        return { state: 'pending', nextAction: mapping(origin, bind?.known === true ? bind.value : undefined),
          evidence: unknown('adopted-mapping-or-client-proof-pending') };
      },

      async routeGuidance(ctx) {
        return (await this.observeSetup(ctx, { id: ctx.route.operationId,
          cancelled: ctx.route.state === 'released', resources: [] })).nextAction;
      },

      async executeSetup(ctx, { action: { id }, value }) {
        if (id === entry.id) return { state: 'complete' };
        if (id !== originAction.id || !parseOrigin(value)) throw effectError('invalid_input', 'Provide a credential-free HTTPS origin');
        return { state: 'complete', nextAction: null };
      },

      async setup(ctx, actionId) {
        if (actionId !== originAction.id) throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
        return { state: 'pending', nextAction: structuredClone(localOrigin) };
      },

      async plan(ctx, request) {
        platformOf(ctx);
        // A kind this adapter does not declare is refused as unsupported before any address is required.
        if (!definition.supportedKinds.includes(request?.usage?.kind)) return base.plan(ctx, request);
        const origin = request?.origin == null ? await given(ctx) : parseOrigin(request.origin);
        if (request?.origin != null && !origin) throw effectError('invalid_input', 'The requested origin is invalid');
        if (!origin) throw effectError('setup_required', 'Provide the HTTPS address you run first');
        // Detect and plan consume the same scoped mapping, including session plans.
        if (request?.usage?.kind !== 'durable') return base.plan(ctx, { ...request, origin });
        const resourceKey = `${definition.id}:${sha({ target: request.target, origin }).slice(0, 16)}`;
        return { digest: sha({ adapterId: definition.id, kind: 'durable', target: request.target, origin, resourceKey }), origin, resourceKey, effects: [],
          readback: { kind: 'durable', origin, target: request.target }, cleanup: { kind: 'external-owned' }, precondition: null };
      },
    };
  },
});
