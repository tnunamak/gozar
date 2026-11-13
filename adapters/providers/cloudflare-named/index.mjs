// Only the connector process is owned here. Registration, DNS and token revocation stay with the owner.
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { createGate } from '../../../packages/gozar-node/gate.mjs';
import { findOnPath } from '../../../packages/gozar-node/program-resolution.mjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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

// EOF on the parent pipe stops exactly this child, including when the controller dies.
const supervisor = `
const {spawn}=require('node:child_process');
const child=spawn('cloudflared',['tunnel','--no-autoupdate','--metrics','127.0.0.1:0','run'],{env:process.env,stdio:'ignore'});
let stopping=false,timer;
const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');timer=setTimeout(()=>child.kill('SIGKILL'),3000);};
process.stdin.resume();process.stdin.on('end',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.once('spawn',()=>process.stdout.write('started\\n'));
child.once('error',()=>process.exit(1));child.once('exit',code=>{clearTimeout(timer);process.exit(stopping?0:code||1);});
`;
async function startConnector({ token }) {
  const child = spawn(process.execPath, ['-e', supervisor], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', TUNNEL_TOKEN: token }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let exited = false;
  const done = new Promise(resolve => {
    child.once('exit', () => { exited = true; resolve(); });
    child.once('error', () => { exited = true; resolve(); });
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5000);
      const finish = fn => value => { clearTimeout(timer); fn(value); };
      child.stdout.once('data', finish(resolve)); child.once('error', finish(reject)); child.once('exit', finish(() => reject(new Error('exited'))));
    });
  } catch {
    child.stdin.end(); await done;
    throw effectError('provider_unavailable', 'The connector did not start');
  }
  return { alive: () => !exited, async close() { child.stdin.end(); await done; } };
}

export function createNamedAdapter({ detectBinary = async () => findOnPath('cloudflared', process.env.PATH) !== null, startConnector: start = startConnector } = {}) {
  const runtimes = new Map(), removed = new Set();
  return recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ definition, base }) => {
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
    return {
      configurationActions: () => inputs,
      async detect(ctx) {
        if(!supportedPlatform(ctx.platform))return {state:'unsupported',facts:{platform:ctx.platform}};
        const config = await ctx.configuration(null), binary = await detectBinary();
        return { state: binary && settings(config) ? 'ready' : 'action-required', facts: { detected: binary,
          authSet: typeof config?.token === 'string' && config.token.length > 0, originSet: typeof config?.origin === 'string', portSet: settings(config) !== null } };
      },
      setupActions: facts => facts?.platform && !supportedPlatform(facts.platform) ? [] : [...(facts?.detected ? [] : [install]), ...(facts?.authSet ? [] : [inputs[0]]), ...(facts?.originSet ? [] : [inputs[1]]), ...(facts?.portSet ? [] : [inputs[2]])],
      async setup(ctx, id, handle) {
        if (id !== 'token') throw effectError('unsupported', 'This input is not a secret');
        const valid = await ctx.withSecret(handle, async bytes => bytes.length > 0 && bytes.length <= 65536);
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
          effects: [{ target: request.target }], readback: { kind: 'attached', target: request.target, origin: config.origin }, cleanup: { kind: 'connector-process' }, precondition: null };
      },
      async prepareProof(ctx, request) {
        const config = settings(await ctx.configuration(null));
        if (!config) throw effectError('setup_required', 'Complete the connector inputs');
        const gate = await createGate(Number(request.target.split(':').at(-1)), { listenPort: config.port, lifetimeMs: 2147483647 });
        const verify = async ({ origin, attempt }) => {
          let status = 'unverified';
          while (!attempt.signal.aborted && Date.now() < attempt.deadlineMs) {
            try { await gate.verify(origin, { sse: request.requirements.protocols.includes('sse'), signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(5000)]) }); status = 'verified'; break; }
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
        if (runtimes.has(plan.resourceKey)) throw effectError('precondition_failed', 'A connector already owns this route');
        const config = settings(await ctx.configuration(null));
        if (!config || config.origin !== plan.origin) throw effectError('setup_required', 'The configured input changed');
        let runtime;
        try { runtime = await start({ token: config.token }); runtimes.set(plan.resourceKey, { runtime, generation: ctx.generation }); removed.delete(plan.resourceKey); }
        catch { await runtime?.close().catch(() => {}); throw effectError('provider_unavailable', 'The connector could not start'); }
        return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation, identity: null, readback: plan.readback, origin: plan.origin };
      },
      async observe(ctx) {
        const config = settings(await ctx.configuration(null)), resourceKey = config ? definition.id + ':' + sha(config.origin).slice(0, 24) : definition.id;
        return { present: runtimes.get(resourceKey)?.runtime.alive() === true, resourceKey, identity: null, revision: null };
      },
      async remove(ctx, receipt) {
        await ctx.assertGeneration();
        if (removed.has(receipt.resourceKey)) return { removed: true, debt: null };
        const owned = runtimes.get(receipt.resourceKey);
        if (!owned || owned.generation !== receipt.generation) return { removed: false, debt: { reason: 'runtime-ownership-unconfirmed' } };
        try {
          await owned.runtime.close();
          if (owned.runtime.alive()) return { removed: false, debt: { reason: 'connector-stop-unconfirmed' } };
          runtimes.delete(receipt.resourceKey); removed.add(receipt.resourceKey); return { removed: true, debt: null };
        }
        catch { return { removed: false, debt: { reason: 'connector-stop-unconfirmed' } }; }
      },
      async runtimeFacts(ctx, receipt) {
        return { ...await base.runtimeFacts(ctx, receipt), facts: [{ id: 'connector-state', label: 'Connector process', value: runtimes.get(receipt.resourceKey)?.runtime.alive() ? 'running' : 'stopped',
          known: true, group: 'runtime', affectsConsent: false, source: 'local-process', asOf: new Date().toISOString() }] };
      },
    };
  } });
}
export default createNamedAdapter();
