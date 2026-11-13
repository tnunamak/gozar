// ngrok HTTPS edge, attached kind: a listener opened through the ngrok SDK while the host process runs.
//
// The SDK is an optional dependency, injected as a module (`loadSdk`). The auth token and the reserved
// domain are per-user setup values. The token is stored through a `provide-secret` action in Gozar's private
// store; the reserved domain is not a secret, so it is a `provide-value` action kept as plain configuration. Gozar answers `ctx.configuration(null)` with the values this adapter's completed actions supplied,
// keyed by action id: `{auth, 'reserved-domain'}`. The token never enters facts, plans, receipts, errors or
// output: every failure below uses a fixed message and never the SDK's own text.
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { createHash } from 'node:crypto';
import {createListenerLifecycle} from '../_shared/sdk-lifecycle.mjs';
import {listenerSdk} from '../_shared/listener-effects.mjs';

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
  const lifecycle=createListenerLifecycle({adapterId:'ngrok-https-edge'});
  const keyFor = domain => `ngrok-https-edge:${domain}`;

  return recipeAdapter({
    definition: new URL('./definition.json', import.meta.url),
    extend: ({ base, definition, platformOf, unsupported }) => {
      const action = (id, label, secretLabel) => {
        const body = { id, kind: 'provide-secret', label, secretLabel, obtainUrl: 'https://dashboard.ngrok.com/get-started/your-authtoken', disclosure: definition.disclosure };
        return { ...body, digest: sha(body) };
      };
      const authAction = action('auth', 'Provide your ngrok auth token', 'ngrok auth token');
      const domainAction = (() => {
        const body = { id: 'reserved-domain', kind: 'provide-value', label: 'Provide your assigned development or reserved domain', valueLabel: 'Assigned development or reserved domain',
          obtainUrl: 'https://dashboard.ngrok.com/domains', valuePlaceholder: 'example.ngrok.app', valueFormat: 'domain', required: true, disclosure: definition.disclosure };
        return { ...body, digest: sha(body) };
      })();
      const installAction = (() => {
        const body = { id: 'install-sdk', kind: 'instructions', label: 'Install the ngrok SDK', disclosure: definition.disclosure,
          instructions: 'Reinstall Gozar with optional dependencies enabled so the ngrok SDK is present.' };
        return { ...body, digest: sha(body) };
      })();

      return {
        async detect(ctx) {
          const os = platformOf(ctx);
          if (!supportedPlatform(os)) return { state: 'unsupported', facts: { platform: os, sdk: false, authSet: false, domainSet: false, configured: false, setupNeeded: false } };
          const sdk = await listenerSdk(ctx,loadSdk).then(module => typeof (module?.forward ?? module?.default?.forward) === 'function', () => false);
          const values = read(await ctx.configuration(null).catch(() => null));
          const configured = values.authToken !== null && values.reservedDomain !== null, ready = sdk && configured;
          return { state: ready ? 'ready' : 'action-required',
            facts: { platform: os, sdk, authSet: values.authToken !== null, domainSet: values.reservedDomain !== null, configured, setupNeeded: !ready } };
        },

        configurationActions: () => [authAction, domainAction],
        setupActions: facts => (!facts?.setupNeeded ? [] : [...(facts.sdk ? [] : [installAction]), ...(facts.authSet ? [] : [authAction]), ...(facts.domainSet ? [] : [domainAction])]),

        async setup(ctx, actionId, secretHandle) {
          // The reserved domain is a provide-value action: Gozar checks and keeps it, and asks the adapter nothing.
          if (actionId !== 'auth') throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
          const next = authAction;
          if (typeof secretHandle !== 'string' || !secretHandle) return { state: 'pending', nextAction: next };
          let valid;
          try {
            valid = await ctx.withSecret(secretHandle, async bytes => bytes.length <= 512 && decode(bytes).length > 0);
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
          const config = settings(await ctx.configuration(effect.configurationRef).catch(() => null));
          if (!config || `https://${config.reservedDomain}` !== effect.origin) throw effectError('setup_required', 'Set up the ngrok auth token and reserved domain first');
          const sdk=await listenerSdk(ctx,loadSdk);
          return lifecycle.open(ctx,plan,{sdk,options:{addr:effect.target,authtoken:config.authToken,domain:config.reservedDomain}});
        },

        async observe(ctx, request) {
          const domain = settings(await ctx.configuration(request.configurationRef ?? null).catch(() => null))?.reservedDomain ?? null;
          const resourceKey = domain ? keyFor(domain) : definition.id;
          return lifecycle.observed(resourceKey);
        },

        async remove(ctx, receipt) {
          return lifecycle.remove(ctx,receipt);
        },
      };
    },
  });
}

export default createNgrokAdapter();
