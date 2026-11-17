import { createHash } from 'node:crypto';
import {createListenerLifecycle} from './sdk-lifecycle.mjs';
import {listenerSdk} from './listener-effects.mjs';
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { prepareStreamProof, streamAddress, hasProofCertificateTool } from './stream-proof.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const unavailable = () => effectError('provider_unavailable', 'The ngrok stream listener could not complete the operation');

export function createNgrokStreamAdapter(definitionUrl, { loadSdk = () => import('@ngrok/ngrok'), certificate, certificateTool = hasProofCertificateTool, closeTimeoutMs = 5000 } = {}) {
  const prepared=new Map(),ownedSessions=new Map();
  let lifecycle;
  return recipeAdapter({ definition: definitionUrl, extend: ({ definition, platformOf, unsupported }) => {
    const transport = definition.capabilities.transport;
    lifecycle=createListenerLifecycle({adapterId:definition.id,timeoutMs:closeTimeoutMs});
    const read = async (ctx, ref = null) => {
      const config = await ctx.configuration(ref).catch(() => null);
      return { auth: typeof config?.auth === 'string' && config.auth.trim() ? config.auth.trim() : null,
        domain: domainPattern.test(config?.['reserved-domain']) ? config['reserved-domain'] : null };
    };
    const action = body => {
      const disclosed = { ...body, disclosure: definition.disclosure };
      return { ...disclosed, digest: sha(disclosed) };
    };
    const authAction = action({ id: 'auth', kind: 'provide-secret', label: 'Provide your ngrok auth token', secretLabel: 'ngrok auth token',
      obtainUrl: 'https://dashboard.ngrok.com/get-started/your-authtoken' });
    const domainAction = action({ id: 'reserved-domain', kind: 'provide-value', label: 'Provide your reserved ngrok domain', valueLabel: 'Reserved ngrok domain',
      valueFormat: 'domain', required: true, obtainUrl: 'https://dashboard.ngrok.com/domains' });
    const install = action({ id: 'install-sdk', kind: 'instructions', label: 'Install the ngrok SDK', instructions: 'Install the optional @ngrok/ngrok dependency.' });
    const openssl = action({ id: 'install-proof-tool', kind: 'instructions', label: 'Install OpenSSL for the synthetic TLS proof', instructions: 'Install the openssl command. Gozar uses it to generate a temporary proof certificate, never your application certificate.' });
    const actions = transport === 'tls' ? [authAction, domainAction] : [authAction];
    const originFor = (config, request) => transport === 'tls' ? `tls://${config.domain}:443` : request.origin;
    const keyFor = (config, request) => `${definition.id}:${transport === 'tls' ? config.domain : sha({ target: request.target, origin: request.origin }).slice(0, 16)}`;
    const configured = config => config.auth && (transport !== 'tls' || config.domain);
    return {
      async detect(ctx) {
        const platform = platformOf(ctx);
        if (!supportedPlatform(platform)) return { state: 'unsupported', facts: { platform, setupNeeded: false } };
        const sdk = await listenerSdk(ctx,loadSdk).then(module => typeof (module.forward ?? module.default?.forward) === 'function', () => false);
        const config = await read(ctx), proofTool = transport !== 'tls' || await certificateTool();
        const ready = Boolean(sdk && configured(config) && proofTool);
        return { state: ready ? 'ready' : 'action-required', facts: { platform, sdk, authSet: Boolean(config.auth), domainSet: Boolean(config.domain), proofTool, setupNeeded: !ready } };
      },
      configurationActions: () => actions,
      setupActions: facts => facts?.setupNeeded ? [...(facts.sdk ? [] : [install]), ...(facts.proofTool !== false ? [] : [openssl]),
        ...(facts.authSet ? [] : [authAction]), ...(transport === 'tls' && !facts.domainSet ? [domainAction] : [])] : [],
      async setup(ctx, id, handle) {
        if (id !== 'auth') throw unsupported('this setup action');
        if (!handle) return { state: 'pending', nextAction: authAction };
        try {
          const valid = await ctx.withSecret(handle, async bytes => bytes.length <= 512 && new TextDecoder().decode(bytes).trim().length > 0);
          return { state: valid ? 'complete' : 'blocked', nextAction: valid ? null : authAction };
        } catch { throw effectError('setup_required', 'Provide the ngrok auth token through Gozar setup'); }
      },
      async plan(ctx, request) {
        if (!supportedPlatform(platformOf(ctx)) || request?.usage?.kind !== 'attached') throw unsupported('this usage');
        const config = await read(ctx, request.configurationRef);
        if (!configured(config)) throw effectError('setup_required', 'Complete ngrok setup first');
        const origin = originFor(config, request);
        if (!streamAddress(request.target) || (origin && !streamAddress(origin, transport)) || (request.origin && origin !== request.origin)) throw unsupported('this endpoint');
        const resourceKey = keyFor(config, request);
        const effects = [{ adapterId: definition.id, operation: 'create', kind: 'sdk-stream-listener', target: request.target, origin, configurationRef: request.configurationRef ?? null }];
        return { digest: sha({ resourceKey, effects }), origin, resourceKey, effects, precondition: null,
          readback: { kind: 'attached', origin, target: request.target }, cleanup: { operation: 'close-listener' } };
      },
      async prepareProof(ctx, request, attempt) {
        const session = await prepareStreamProof(ctx, request, attempt, { transport, certificate });
        const entry = { session, attempt, request };
        prepared.set(session.target, entry);
        return { target: session.target, verify: input => session.verify(input), async close() { await session.close(); prepared.delete(session.target); } };
      },
      async create(ctx, plan) {
        const effect = plan?.effects?.[0], entry = prepared.get(effect?.target);
        if (!entry || effect?.kind !== 'sdk-stream-listener' || plan?.readback?.kind !== 'attached' || plan.readback.target !== entry.request.target) throw unsupported('an unprepared stream route');
        const config=await read(ctx,effect.configurationRef);
        if(!configured(config)||originFor(config,entry.request)!==effect.origin)throw effectError('setup_required','Complete ngrok setup first');
        const {attempt,session}=entry;
        const sdk=await listenerSdk(ctx,loadSdk);
        try{const receipt=await lifecycle.open({...ctx,signal:attempt.signal,deadlineMs:attempt.deadlineMs},plan,{sdk,credentialAction:authAction,
          options:{addr:effect.target,authtoken:config.auth,proto:transport,...(transport==='tls'?{domain:config.domain}:effect.origin?{remote_addr:streamAddress(effect.origin,'tcp').origin.slice(6)}:{})},
          normalizeOrigin:value=>{
            const parsed=new URL(value);
            if(parsed.username||parsed.password||!['','/'].includes(parsed.pathname)||parsed.search||parsed.hash)return null;
            if(transport==='tls'&&!parsed.port)value=`${parsed.protocol}//${parsed.hostname}:443`;
            return streamAddress(value,transport)?.origin??null;
          }});ownedSessions.set(receipt.identity.runtimeId,entry);return receipt;
        }catch(error){if(error.cleanupReceipt)ownedSessions.set(error.cleanupReceipt.identity.runtimeId,entry);await session.close();throw error;}
      },
      async observe(ctx, request) {
        const resourceKey=keyFor(await read(ctx,request.configurationRef),request);
        return lifecycle.observed(resourceKey);
      },
      // Publication is exclusively the prepared proof hook; no generic HTTP fallback.
      async verify() { return { status: 'unverified', checkedAt: null }; },
      async remove(ctx, receipt) {
        lifecycle.owns(receipt);
        const entry=ownedSessions.get(receipt?.identity?.runtimeId);if(entry)await entry.session.close();
        const result=await lifecycle.remove(ctx,receipt);
        if(result.removed&&entry){prepared.delete(entry.session.target);ownedSessions.delete(receipt.identity.runtimeId);}
        return result;
      },
    };
  } });
}
