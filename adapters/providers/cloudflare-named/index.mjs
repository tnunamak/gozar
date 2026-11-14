// Only the connector process is owned here. Registration, DNS and token revocation stay with the owner.
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { createGate } from '../../../packages/gozar-node/gate.mjs';
import { findOnPath } from '../../../packages/gozar-node/program-resolution.mjs';
import { createHash } from 'node:crypto';
import {startTokenProcess} from '../_shared/token-process.mjs';
import {createListenerLifecycle} from '../_shared/sdk-lifecycle.mjs';
import {testingFetch} from '../../../packages/gozar-node/testing-network.mjs';
import {randomUUID} from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function settings(config) {
  const port = Number(config?.['gate-port']); let origin;
  try {
    const url = new URL(config?.origin);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin;
  } catch { /* incomplete input */ }
  return typeof config?.token === 'string' && config.token.trim() && origin && Number.isInteger(port) && port > 1023 && port < 65536
    ? { token: config.token.trim(), origin, port } : null;
}

const startConnector=({token})=>startTokenProcess({program:'cloudflared',args:['tunnel','--no-autoupdate','--metrics','127.0.0.1:0','run'],token});

export function createNamedAdapter({ detectBinary = async () => findOnPath('cloudflared', process.env.PATH) !== null, startConnector: start = startConnector } = {}) {
  const runtimes=new Map(),handles=new Map();let lifecycle;
  return recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ definition, base }) => {
    lifecycle=createListenerLifecycle({adapterId:definition.id});
    const action = (id, kind, label, extra = {}) => {
      const body = { id, kind, label, disclosure: definition.disclosure, ...extra };
      return { ...body, digest: sha(body) };
    };
    const inputs = [
      action('token', 'provide-secret', 'Tunnel token', { secretLabel: 'Tunnel token', obtainUrl: 'https://one.dash.cloudflare.com/' }),
      action('origin', 'provide-value', 'Published HTTPS origin', { valueLabel: 'Published HTTPS origin', valueFormat: 'https-origin' }),
      action('gate-port', 'provide-value', 'Local connector port', { valueLabel: 'Local connector port', valueFormat: 'text',
        help: 'Set the dashboard service target to http://127.0.0.1:PORT using this port (1024–65535). Keep it distinct from your app port.' }),
    ];
    const install = action('install-connector', 'instructions', 'Install the connector', { instructions: 'Install cloudflared from its official package, then ask the catalog again.' });
    const supervisorAction=action('install-supervisor','instructions','Install the process supervisor',{instructions:'Install Bash, then ask the catalog again. The supervisor passes credentials through anonymous pipes.'});
    return {
      configurationActions: () => inputs,
      async detect(ctx) {
        if(!supportedPlatform(ctx.platform))return {state:'unsupported',facts:{platform:ctx.platform}};
        const config=await ctx.configuration(null),binary=ctx.dispatchEffect?(await ctx.dispatchEffect({kind:'process-runtime',operation:'detect',input:{program:'cloudflared'}})).available===true:await detectBinary();
        const supervisor=ctx.dispatchEffect?(await ctx.dispatchEffect({kind:'process-runtime',operation:'detect',input:{program:'bash'}})).available===true:findOnPath('bash',process.env.PATH)!==null;
        return { state: binary && supervisor && settings(config) ? 'ready' : 'action-required', facts: { detected: binary,supervisor,
          authSet: typeof config?.token === 'string' && config.token.trim().length > 0, originSet: typeof config?.origin === 'string', portSet: settings(config) !== null } };
      },
      setupActions: facts => facts?.platform && !supportedPlatform(facts.platform) ? [] : [...(facts?.detected ? [] : [install]),...(facts?.supervisor?[]:[supervisorAction]), ...(facts?.authSet ? [] : [inputs[0]]), ...(facts?.originSet ? [] : [inputs[1]]), ...(facts?.portSet ? [] : [inputs[2]])],
      async setup(ctx, id, handle) {
        if (id !== 'token') throw effectError('unsupported', 'This input is not a secret');
        const valid = await ctx.withSecret(handle, async bytes => bytes.length <= 65536 && new TextDecoder().decode(bytes).trim().length>0);
        return { state: valid ? 'complete' : 'blocked', nextAction: valid ? null : inputs[0] };
      },
      async plan(ctx, request) {
        if (request.usage?.kind !== 'attached') throw effectError('unsupported', 'The connector uses attached usage');
        const config = settings(await ctx.configuration(null));
        if (!config) throw effectError('setup_required', 'Provide the token, HTTPS origin and local connector port');
        if (Number(request.target.split(':').at(-1)) === config.port) throw effectError('setup_required', 'The connector port must differ from the app port');
        if (request.origin && request.origin !== config.origin) throw effectError('setup_required', 'The configured origin differs from the requested origin');
        const resourceKey = definition.id + ':' + sha(config.origin).slice(0, 24);
        return { digest: sha({ target: request.target, origin: config.origin, port: config.port, tokenHash: sha(config.token) }), origin: config.origin, resourceKey,
          effects: [{kind:'process-runtime',operation:'open',target:request.target}], readback: { kind: 'attached', target: request.target, origin: config.origin }, cleanup: { kind: 'connector-process' }, precondition: null };
      },
      async prepareProof(ctx, request) {
        const config = settings(await ctx.configuration(null));
        if (!config) throw effectError('setup_required', 'Complete the connector inputs');
        const gate = await createGate(Number(request.target.split(':').at(-1)), { listenPort: config.port, lifetimeMs: 2147483647 });
        const verify = async ({ origin, attempt }) => {
          let status = 'unverified';
          while (!attempt.signal.aborted && Date.now() < attempt.deadlineMs) {
            try { await gate.verify(origin, { sse: request.requirements.protocols.includes('sse'), signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(5000)]),fetch:ctx.dispatchEffect?testingFetch(ctx.dispatchEffect):undefined }); status = 'verified'; break; }
            catch { if (!attempt.signal.aborted) await delay(200, undefined, { signal: attempt.signal }).catch(() => {}); }
          }
          return { status, attemptId: attempt.id, endpoint: origin, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 15000).toISOString(), vantage: 'this-device',
            checks: status === 'verified' ? ['tls', 'nonce', ...(request.requirements.protocols.includes('sse') ? ['sse'] : [])] : [], facts: [] };
        };
        return { target: '127.0.0.1:' + gate.port, verify, refresh: verify, close: () => gate.close() };
      },
      async create(ctx, plan) {
        if(plan?.readback?.kind!=='attached')throw effectError('unsupported','The connector uses attached usage');
        await ctx.assertGeneration();
        const config = settings(await ctx.configuration(null));
        if (!config || config.origin !== plan.origin) throw effectError('setup_required', 'The configured input changed');
        const sdk={forward:async()=>{
          let runtime;
          if(ctx.dispatchEffect){
            const result=await ctx.dispatchEffect({kind:'process-runtime',operation:'open',input:{program:'cloudflared',args:['tunnel','--no-autoupdate','--metrics','127.0.0.1:0','run'],credential:config.token,origin:plan.origin,target:plan.effects[0].target,deadlineMs:ctx.deadlineMs??Date.now()+30000}});
            if(typeof result?.handle!=='string'||!result.handle)throw effectError('provider_unavailable','The process fixture returned no owned handle');
            runtime={alive:async()=>{const result=await ctx.dispatchEffect({kind:'process-runtime',operation:'read',input:{handle:resultHandle}});if(typeof result?.present!=='boolean')throw effectError('provider_unavailable','Process presence is unknown');return result.present;},close:()=>ctx.dispatchEffect({kind:'process-runtime',operation:'close',input:{handle:result.handle}})};
            const resultHandle=result.handle;
          }else runtime=await start({token:config.token});
          const id=randomUUID(),listener={id:()=>id,url:()=>plan.origin,close:()=>runtime.close(),runtime};
          handles.set(id,listener);runtimes.set(plan.resourceKey,listener);return listener;
        },getListener:async id=>{const listener=handles.get(id);return listener&&await listener.runtime.alive()?listener:null;}};
        return lifecycle.open(ctx,plan,{sdk,options:{}});
      },
      async observe(ctx) {
        const config=await ctx.configuration(null),resourceKey=settings(config)?definition.id+':'+sha(settings(config).origin).slice(0,24):definition.id;
        return lifecycle.observed(resourceKey);
      },
      async remove(ctx,receipt){return lifecycle.remove(ctx,receipt);},
      async runtimeFacts(ctx,receipt){
        let state;try{const runtime=runtimes.get(receipt.resourceKey)?.runtime;state=runtime?{known:true,value:await runtime.alive()?'running':'stopped'}:{known:false,value:null,reason:'runtime-not-observed'};}catch{state={known:false,value:null,reason:'runtime-observation-unavailable'};}
        return {...await base.runtimeFacts(ctx,receipt),facts:[{id:'connector-state',label:'Owned connector process',...state,group:'runtime',affectsConsent:false,source:'local-process',asOf:new Date().toISOString()}]};
      },
    };
  } });
}
export default createNamedAdapter();
