// ngrok HTTPS edge, attached kind: a listener opened through the ngrok SDK while the host process runs.
//
// The SDK is an optional dependency, injected as a module (`loadSdk`). The auth token and the reserved
// domain are per-user setup values. Each is stored through a `provide-secret` action in Gozar's private
// store. Gozar answers `ctx.configuration(null)` with the values this adapter's completed actions supplied,
// keyed by action id: `{auth, 'reserved-domain'}`. The token never enters facts, plans, receipts, errors or
// output: every failure below uses a fixed message and never the SDK's own text.
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { createHash } from 'node:crypto';

const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const decode = bytes => new TextDecoder().decode(bytes).trim();
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The setup values, trimmed as the setup action validated them; each is null until it is set.
const read = config => {
  const auth = typeof config?.auth === 'string' ? config.auth.trim() : '';
  const domain = typeof config?.['reserved-domain'] === 'string' ? config['reserved-domain'].trim() : '';
  return { authToken: auth.length > 0 ? auth : null, reservedDomain: domainPattern.test(domain) ? domain : null };
};
const settings = config => { const values = read(config); return values.authToken && values.reservedDomain ? values : null; };

export function createNgrokAdapter({ loadSdk = () => import('@ngrok/ngrok') } = {}) {
  const listeners = new Map(); // resourceKey -> open SDK listener; it lives and dies with this process
  const keyFor = domain => `ngrok-https-edge:${domain}`;

  return recipeAdapter({
    definition: new URL('./definition.json', import.meta.url),
    extend: ({ base, definition, platformOf, unsupported }) => {
      const action = (id, label, secretLabel) => {
        const body = { id, kind: 'provide-secret', label, secretLabel, disclosure: definition.disclosure };
        return { ...body, digest: sha(body) };
      };
      const authAction = action('auth', 'Provide your ngrok auth token', 'ngrok auth token');
      const domainAction = action('reserved-domain', 'Provide your reserved ngrok domain', 'Reserved ngrok domain');
      const installAction = (() => {
        const body = { id: 'install-sdk', kind: 'instructions', label: 'Install the ngrok SDK', disclosure: definition.disclosure,
          instructions: 'Reinstall Gozar with optional dependencies enabled so the ngrok SDK is present.' };
        return { ...body, digest: sha(body) };
      })();

      return {
        async detect(ctx) {
          const os = platformOf(ctx);
          if (!supportedPlatform(os)) return { state: 'unsupported', facts: { platform: os, sdk: false, authSet: false, domainSet: false, configured: false, setupNeeded: false } };
          const sdk = await loadSdk().then(module => typeof (module?.forward ?? module?.default?.forward) === 'function', () => false);
          const values = read(await ctx.configuration(null).catch(() => null));
          const configured = values.authToken !== null && values.reservedDomain !== null, ready = sdk && configured;
          return { state: ready ? 'ready' : 'action-required',
            facts: { platform: os, sdk, authSet: values.authToken !== null, domainSet: values.reservedDomain !== null, configured, setupNeeded: !ready } };
        },

        setupActions: facts => (!facts?.setupNeeded ? [] : [...(facts.sdk ? [] : [installAction]), ...(facts.authSet ? [] : [authAction]), ...(facts.domainSet ? [] : [domainAction])]),

        async setup(ctx, actionId, secretHandle) {
          const next = { auth: authAction, 'reserved-domain': domainAction }[actionId];
          if (!next) throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
          if (typeof secretHandle !== 'string' || !secretHandle) return { state: 'pending', nextAction: next };
          let valid;
          try {
            valid = await ctx.withSecret(secretHandle, async bytes => actionId === 'auth' ? bytes.length > 0 && bytes.length <= 512 : domainPattern.test(decode(bytes)));
          } catch { throw effectError('setup_required', 'The private store did not release the value; run the setup action again'); }
          return valid ? { state: 'complete', nextAction: null } : { state: 'blocked', nextAction: next };
        },

        async plan(ctx, request) {
          if (!supportedPlatform(platformOf(ctx))) throw unsupported('this platform');
          if (request?.usage?.kind !== 'attached') throw unsupported(`the ${request?.usage?.kind} kind`);
          const config = settings(await ctx.configuration(request.configurationRef ?? null).catch(() => null));
          if (!config) throw effectError('setup_required', 'Set up the ngrok auth token and reserved domain first');
          const origin = `https://${config.reservedDomain}`;
          if (request.origin && request.origin !== origin) throw effectError('setup_required', 'The requested origin is not your reserved ngrok domain');
          const resourceKey = keyFor(config.reservedDomain);
          const effects = [{ adapterId: definition.id, operation: 'create', kind: 'sdk-listener', target: request.target, origin, configurationRef: request.configurationRef ?? null }];
          return { digest: sha({ resourceKey, effects }), origin, resourceKey, effects,
            readback: { kind: 'attached', origin, target: request.target }, cleanup: { operation: 'close-listener' }, precondition: null };
        },

        async create(ctx, plan) {
          const [effect] = plan?.effects ?? [];
          if (plan?.readback?.kind !== 'attached' || effect?.kind !== 'sdk-listener') throw unsupported('this kind');
          await ctx.assertGeneration();
          if (!Number.isSafeInteger(ctx.generation)) throw effectError('provider_unavailable', 'The context carries no generation');
          if (listeners.has(plan.resourceKey)) throw effectError('provider_unavailable', 'A listener for this domain is already open');
          const config = settings(await ctx.configuration(effect.configurationRef).catch(() => null));
          if (!config || `https://${config.reservedDomain}` !== effect.origin) throw effectError('setup_required', 'Set up the ngrok auth token and reserved domain first');
          let listener;
          try {
            const sdk = await loadSdk();
            listener = await (sdk.forward ?? sdk.default.forward)({ addr: effect.target, authtoken: config.authToken, domain: config.reservedDomain });
          } catch { throw effectError('provider_unavailable', 'ngrok could not start the listener'); }
          let actual = null;
          try { actual = new URL(listener.url()).origin; } catch { /* treated as a mismatch below */ }
          if (actual !== effect.origin) {
            await Promise.resolve(listener.close()).catch(() => {}); // fail closed: nothing stays open
            throw effectError('provider_unavailable', 'ngrok returned an origin other than the reserved one; the listener was closed');
          }
          listeners.set(plan.resourceKey, listener);
          return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation,
            identity: { origin: actual }, readback: { ...plan.readback }, origin: actual };
        },

        async observe(ctx, request) {
          const domain = settings(await ctx.configuration(request.configurationRef ?? null).catch(() => null))?.reservedDomain ?? null;
          const resourceKey = domain ? keyFor(domain) : definition.id;
          return { present: domain ? listeners.has(resourceKey) : false, resourceKey, identity: domain ? { origin: `https://${domain}` } : null, revision: null };
        },

        async remove(ctx, receipt) {
          await ctx.assertGeneration();
          const listener = listeners.get(receipt?.resourceKey);
          if (!listener) return { removed: true, debt: null }; // an SDK listener cannot outlive its process
          try { await listener.close(); } catch { return { removed: false, debt: { code: 'close_failed', message: 'The ngrok listener did not confirm closing' } }; }
          listeners.delete(receipt.resourceKey);
          return { removed: true, debt: null };
        },
      };
    },
  });
}

export default createNgrokAdapter();
