import { createHash } from 'node:crypto';
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { prepareStreamProof, streamAddress, hasProofCertificateTool } from './stream-proof.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const unavailable = () => effectError('provider_unavailable', 'The ngrok stream listener could not complete the operation');

export function createNgrokStreamAdapter(definitionUrl, { loadSdk = () => import('@ngrok/ngrok'), certificate, certificateTool = hasProofCertificateTool } = {}) {
  const listeners = new Map(), prepared = new Map(), pending = new Set();
  return recipeAdapter({ definition: definitionUrl, extend: ({ definition, platformOf, unsupported }) => {
    const transport = definition.capabilities.transport;
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
        const sdk = await loadSdk().then(module => typeof (module.forward ?? module.default?.forward) === 'function', () => false);
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
          const valid = await ctx.withSecret(handle, async bytes => bytes.length > 0 && bytes.length <= 512);
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
        await ctx.assertGeneration();
        if (!Number.isSafeInteger(ctx.generation) || listeners.has(plan.resourceKey) || pending.has(plan.resourceKey)) throw unavailable();
        const config = await read(ctx, effect.configurationRef);
        if (!configured(config) || originFor(config, entry.request) !== effect.origin) throw effectError('setup_required', 'Complete ngrok setup first');
        const { attempt, session } = entry;
        if (attempt.signal.aborted || ctx.now() >= attempt.deadlineMs) { await session.close(); throw unavailable(); }
        pending.add(plan.resourceKey);
        let listener, timer, aborted, abandoned = false;
        try {
          const sdk = await loadSdk();
          const opening = Promise.resolve((sdk.forward ?? sdk.default.forward)({ addr: effect.target, authtoken: config.auth, proto: transport,
            ...(transport === 'tls' ? { domain: config.domain } : effect.origin ? { remote_addr: streamAddress(effect.origin, 'tcp').origin.slice(6) } : {}) }));
          // A late SDK result owns a real resource even when its caller already stopped waiting.
          opening.then(value => { if (abandoned) void Promise.resolve().then(() => value.close()).catch(() => {}); }, () => {});
          listener = await Promise.race([opening, new Promise((_, reject) => {
            aborted = () => { abandoned = true; reject(unavailable()); };
            timer = setTimeout(aborted, Math.max(1, Math.min(30000, attempt.deadlineMs - ctx.now())));
            attempt.signal.addEventListener('abort', aborted, { once: true });
            if (attempt.signal.aborted) aborted();
          })]);
          await ctx.assertGeneration();
          let actual = listener.url();
          // ngrok TLS defaults to port 443; public contract keeps an explicit port.
          const parsed = new URL(actual);
          if (parsed.username || parsed.password || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) throw unavailable();
          if (transport === 'tls' && !parsed.port) actual = `${parsed.protocol}//${parsed.hostname}:443`;
          const endpoint = streamAddress(actual, transport);
          if (!endpoint || (effect.origin && endpoint.origin !== effect.origin) || attempt.signal.aborted || ctx.now() >= attempt.deadlineMs) throw unavailable();
          const receipt = { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation,
            identity: { origin: endpoint.origin, attemptId: attempt.id }, origin: endpoint.origin, readback: { ...plan.readback, origin: endpoint.origin } };
          listeners.set(plan.resourceKey, { listener, entry, receipt });
          return receipt;
        } catch {
          abandoned = true;
          if (listener) await Promise.resolve().then(() => listener.close()).catch(() => {});
          await session.close();
          throw unavailable();
        } finally { clearTimeout(timer); attempt.signal.removeEventListener('abort', aborted); pending.delete(plan.resourceKey); }
      },
      async observe(ctx, request) {
        const resourceKey = keyFor(await read(ctx, request.configurationRef), request), record = listeners.get(resourceKey);
        return { present: Boolean(record), resourceKey, identity: record?.receipt.identity ?? null, revision: null };
      },
      // Publication is exclusively the prepared proof hook; no generic HTTP fallback.
      async verify() { return { status: 'unverified', checkedAt: null }; },
      async remove(ctx, receipt) {
        await ctx.assertGeneration();
        const record = listeners.get(receipt?.resourceKey);
        if (!record) return { removed: true, debt: null };
        if (JSON.stringify(record.receipt) !== JSON.stringify(receipt)) throw unavailable();
        await record.entry.session.close();
        prepared.delete(record.entry.session.target);
        try { await record.listener.close(); } catch { return { removed: false, debt: { code: 'close_failed', message: 'The ngrok listener did not confirm closing' } }; }
        listeners.delete(receipt.resourceKey);
        return { removed: true, debt: null };
      },
    };
  } });
}
