// Test helpers for an app that uses Gozar: a route API with no network, a fake provider, and a fake read context.
// Import them from '@tnunamak/gozar/testing'. Nothing here starts a tunnel, calls a provider or reads real credentials.
//
//   const registry = await fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
//   const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
//   ...catalogRoutes, then expose with the candidate's token...
//   await registry.cleanup();
//
// A fake with kind 'durable' also keeps a rule store, a JSON file in the registry's own directory, so that separate
// processes see the same state. Pass `fakeReadContext({ verified })` to the route API and the durable route check answers as told.
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteApi as createCoreRouteApi } from './route-api.mjs';
import { createReadContext } from './adapter-runtime.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gozarError } from './error-normalizer.mjs';
import { projectSession, projectDurable, projectAttached } from './route-view.mjs';
import { enrichRoute } from './embedding-state.mjs';

export { createReadContext };

/** Explicit fixture effects for the shipped trusted adapters. No ambient switch enables this. */
export async function createTestingGozar({effects,...options}={}){
  if(!Array.isArray(effects))throw gozarError('invalid_input','Testing effects must be an explicit mapping array');
  const handlers=new Map(),events=[],active=new Map(),abort=new AbortController();let closing;
  for(const effect of effects){
    if(typeof effect?.kind!=='string'||!effect.kind||typeof effect.operation!=='string'||!effect.operation||typeof effect.handle!=='function')throw gozarError('invalid_input','A testing effect needs kind, operation and handler');
    const key=JSON.stringify([effect.kind,effect.operation]);if(handlers.has(key))throw gozarError('invalid_input','Duplicate testing effect mapping');handlers.set(key,effect.handle);
  }
  const dispatchEffect=async request=>{
    const key=JSON.stringify([request?.kind,request?.operation]),handler=handlers.get(key);
    if(abort.signal.aborted||!handler)throw gozarError('unsupported','No matching testing effect is declared');
    const event={sequence:events.length,kind:request.kind,operation:request.operation,state:'requested',fixture:true};events.push(event);
    try{const result=await handler(structuredClone(request.input),{signal:abort.signal,fixture:true});event.state='completed';return structuredClone(result);}
    catch{event.state='failed';throw gozarError('provider_unavailable','The testing effect failed');}
  };
  const api=createCoreRouteApi({...options,dispatchEffect});
  const gozar={...api};
  for(const method of ['expose','ensureRoute','adoptRoute'])gozar[method]=async request=>{try{const route=await api[method](request);if(route.cleanup.state!=='confirmed')active.set(JSON.stringify(route.handle),{home:request.home,handle:route.handle,mode:'remove'});return route;}catch(error){if(error.route&&error.route.cleanup.state!=='confirmed')active.set(JSON.stringify(error.route.handle),{home:request.home,handle:error.route.handle,mode:'remove'});throw error;}};
  gozar.closeRoute=async request=>{const route=await api.closeRoute(request);if(route.cleanup.state==='confirmed')active.delete(JSON.stringify(route.handle));return route;};
  return {gozar,events,close:()=>closing??=(async()=>{for(const request of active.values())await gozar.closeRoute(request);abort.abort();})()};
}

/** Deterministic lifecycle projections for every admitted usage kind; no provider or process is started. */
export function fakeRouteScenarios({ target = '127.0.0.1:18765', now = Date.parse('2026-11-13T12:00:00Z') } = {}) {
  const properties = { reach: 'internet', transport: 'https', traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
    address: { stability: 'stable', scope: 'fixture', conditions: [], ports: null }, cost: { kind: 'free', summary: 'Fixture', currency: null, amount: null, period: null },
    needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller', protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'this-device', checks: ['nonce', 'tls'] } };
  const origin = 'https://screen.example.invalid', checkedAt = new Date(now).toISOString(), future = new Date(now + 60_000).toISOString();
  return ['session', 'attached', 'durable'].flatMap(kind => ['detected', 'verified', 'expired', 'cleanup-unconfirmed'].map(state => {
    const handle = { kind, id: `fixture-${kind}`, generation: 1 }, verified = state !== 'detected';
    const expiry = state === 'expired' ? new Date(now - 1).toISOString() : future;
    const options = { handle, properties, now };
    const route = kind === 'durable' ? projectDurable({ state: verified ? 'usable' : 'unverified', origin, target, verification: { status: verified ? 'verified' : 'unverified', checkedAt, validUntil: expiry }, expiresAt: expiry }, options)
      : kind === 'attached' ? projectAttached({ state: verified ? 'usable' : 'unverified', origin, target, properties, checkedAtMs: now, expiresAt: expiry }, options)
      : projectSession({ snapshot: { phase: verified ? 'published-ready' : 'candidate-ready', candidate: origin, published: verified ? origin : null, target, expiresAt: expiry, checkedAtMs: now } }, options);
    return enrichRoute({ ...route, cleanup: { state: state === 'cleanup-unconfirmed' ? 'unconfirmed' : 'none' } }, { target, expiresAt: expiry, validUntil: expiry, now });
  }));
}

/**
 * A read context whose probe and verification answer as told. `probeOk` is the detect verdict (default true);
 * `verified` is the outcome of a route check (default true). The testing `createRouteApi` also uses `verified` for the
 * challenge check of a durable route, so a durable fake answers as told too.
 */
export function fakeReadContext({ home, probeOk = true, verified = true, now = Date.now } = {}) {
  return createReadContext({
    home, platform: 'linux', now,
    configuration: async () => null,
    probe: async () => ({ ok: probeOk }),
    verifyChallenge: async () => ({ status: verified ? 'verified' : 'unverified', checkedAt: verified ? new Date(now()).toISOString() : null }),
  });
}

// An expose of kind session starts a controller process. A fake provider has none, so the testing API starts no process
// and answers as a controller that has a candidate address ready. A test may replace it with `expose: { startSession }`.
const fakeStartSession = options => ({ snapshot: { sessionId: `fake-${options.port}`, phase: 'candidate-ready', candidate: options.origin ?? 'https://fake.example.invalid', expiresAtMs: Date.now() + (options.lifetimeMs ?? 60_000) } });

/** The route API with no process or network: sessions are answered in memory. Same options as the package's own factory. */
export function createRouteApi(deps = {}) {
  // A durable route is checked by the challenge verifier. With a read context given, that verifier is the context's.
  const verify = deps.verify ?? (deps.readContext && (async ({ origin, target }) => {
    const checked = await deps.readContext.verifyChallenge(origin, target);
    return { method: 'challenge', error: checked.status === 'verified' ? null : 'fake', scope: 'controller-origin', ...checked };
  }));
  return createCoreRouteApi({ platform: 'linux', ...deps, ...(verify ? { verify } : {}), expose: { startSession: fakeStartSession, ...deps.expose } });
}

const KINDS = ['session', 'attached', 'durable'];
const REACHES = ['internet', 'tailnet', 'lan', 'this-device'];

const moduleSource = (actions = [], proofProtocol = 'http') => `// A fake provider written by @tnunamak/gozar/testing. It does nothing outside memory.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const servers = new Map();
const proofProtocol = ${JSON.stringify(proofProtocol)};
const mark = event => appendFileSync(new URL('./events.jsonl', import.meta.url), JSON.stringify({event}) + '\\n');
export default {
  id: definition.id,
  definition,
  async detect(ctx) { const seen = definition.supportedKinds.includes('attached') ? {ok:true} : await ctx.probe({ fake: true }); const values=await ctx.configuration(null);const missing=${JSON.stringify(actions)}.filter(action=>action.required!==false&&!values?.[action.id]);return {state:seen?.ok!==true?'unknown':missing.length?'action-required':'ready',facts:{fake:true,detected:seen?.ok===true,setupNeeded:missing.length>0,missing}}; },
  properties: () => structuredClone(definition.capabilities),
  configurationActions: () => ${JSON.stringify(actions)},
  setupActions: facts => facts?.missing ?? ${JSON.stringify(actions)},
  async setup() { mark('setup'); return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) {
    const resourceKey = definition.id + ':' + sha({ target: request.target }).slice(0, 16);
    return { digest: sha({ id: definition.id, target: request.target, usage: request.usage?.kind }), origin: request.origin ?? null, resourceKey, effects: [{target: request.target}],
      readback: { kind: request.usage?.kind, origin: request.origin ?? null, target: request.target }, cleanup: { kind: 'fake' }, precondition: null };
  },
  ...(proofProtocol === 'echo' ? {
    async prepareProof(ctx, request, attempt) {
      let proving=true,witness=false,used=false;
      const [host,port]=request.target.split(':');
      const proof = net.createServer({allowHalfOpen:true}, socket => {
        if(!proving){const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);return;}
        let input=Buffer.alloc(0);socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();return;}if(input.length===65){witness=input.equals(Buffer.from(attempt.nonce+'\\n'));socket.end(witness?input:Buffer.from('wrong\\n'));}});
      });
      await new Promise((resolve,reject)=>{proof.once('error',reject);proof.listen(0,'127.0.0.1',resolve);});
      return {target:'127.0.0.1:'+proof.address().port,
        async verify({origin,attempt:current}) {
          if(used)throw new Error('initial proof only');used=true;
          mark('proof'); const endpoint=new URL(origin);
          try {
            const matched=await new Promise(resolve=>{let input=Buffer.alloc(0);const socket=net.connect(Number(endpoint.port),endpoint.hostname);const timer=setTimeout(()=>{socket.destroy();resolve(false);},1000);
              socket.once('connect',()=>socket.write(current.nonce+'\\n'));socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();clearTimeout(timer);resolve(false);}});socket.once('error',()=>{clearTimeout(timer);resolve(false);});socket.once('end',()=>{clearTimeout(timer);resolve(input.equals(Buffer.from(current.nonce+'\\n')));}); });
            return {status:matched&&witness?'verified':'unverified',attemptId:current.id,endpoint:origin,checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+5000).toISOString(),vantage:'this-device',checks:['nonce'],facts:[]};
          } finally {proving=false;}
        },async close(){await new Promise(resolve=>proof.close(resolve));}};
    }
  }:{}),
  async create(ctx, plan) {
    if (plan.readback.kind === 'attached' && proofProtocol === 'echo') {
      const [host,port]=plan.effects[0].target.split(':');
      const server=net.createServer({allowHalfOpen:true}, socket=>{const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});servers.set(plan.resourceKey,server);plan={...plan,origin:'tcp://127.0.0.1:'+server.address().port};mark('start');
    } else if (plan.readback.kind === 'attached') {
      const target = new URL('http://' + plan.effects[0].target);
      const server = http.createServer((req,res) => {
        const upstream = http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers}, reply => { res.writeHead(reply.statusCode,reply.headers); reply.pipe(res); });
        upstream.on('error',()=>{res.writeHead(502);res.end();}); req.pipe(upstream);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      servers.set(plan.resourceKey,server); plan={...plan,origin:'http://127.0.0.1:'+server.address().port};mark('start');
    }
    return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation ?? 1, identity: null, readback: plan.readback, origin: plan.origin ?? 'https://' + definition.id + '.example.invalid' };
  },
  async observe(ctx, request) { return { present: false, resourceKey: definition.id + ':' + sha({ target: request.target }).slice(0, 16), identity: null, revision: null }; },
  async verify(ctx, receipt) { mark('proof'); return ctx.verifyChallenge(receipt?.readback?.origin ?? receipt?.origin ?? '', receipt?.readback?.target ?? ''); },
  async remove(ctx,receipt) { mark('stop'); const server=servers.get(receipt.resourceKey); if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));servers.delete(receipt.resourceKey);} mark('cleanup');return { removed: true, debt: null }; },
  async runtimeFacts() { return { properties: structuredClone(definition.capabilities), ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
};
`;

// The module of a fake that also has the durable kind. It keeps the session methods above, and answers the durable
// ones through the engine's own adapter, with a facet whose rule store is `store.json` next to the module: a version
// counter is the compare-and-set token, and a write is a rename, so another process sees whole states only.
const durableModuleSource = runtime => `// A fake durable provider written by @tnunamak/gozar/testing. Its rule store is the file store.json beside this module.
import { recipeAdapter } from ${JSON.stringify(runtime)};
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
// The session methods live in plain.mjs, written beside this file; it is loaded by URL so the text of this template is
// never mistaken for an import of the testing module itself.
const { default: plain } = await import(new URL('./plain.mjs', import.meta.url));

const storePath = new URL('./store.json', import.meta.url);
const read = () => JSON.parse(readFileSync(storePath, 'utf8'));
const write = state => { const temporary = new URL('./store.json.tmp', import.meta.url); writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, storePath); };
const slotIds = ['a', 'b', 'c'];

function durableFacet(definition) {
  return {
    family: 'fake',
    definition,
    async observe() { const state = read(); return { identity: state.identity, snapshot: state.entries, version: String(state.version) }; },
    slots: () => slotIds.map(slot => ({ slot, origin: 'https://' + slot + '.' + plain.id + '.invalid', permitted: true })),
    read: (snapshot, slot) => snapshot[slot]?.rule ?? null,
    foreign: (snapshot, slot) => snapshot[slot]?.foreign === true,
    occupied: (snapshot, slot) => snapshot[slot] !== undefined,
    expand: target => ({ forward: target }),
    expiresAt: () => null,
    async put(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version)) return 'conflict';
      state.entries[slot] = { rule }; state.version += 1; write(state);
      return 'written';
    },
    async delete(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version) || !isDeepStrictEqual(state.entries[slot]?.rule, rule)) return 'conflict';
      delete state.entries[slot]; state.version += 1; write(state);
      return 'written';
    },
  };
}

const base = recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ wrapped }) => ({ durable: durableFacet(wrapped) }) });
const isDurable = value => value === 'durable';
export default {
  ...plain,
  durable: base.durable,
  plan: (ctx, request) => (isDurable(request.usage?.kind) ? base.plan(ctx, request) : plain.plan(ctx, request)),
  observe: (ctx, request) => (isDurable(request.usage?.kind) ? base.observe(ctx, request) : plain.observe(ctx, request)),
  verify: (ctx, receipt) => (isDurable(receipt?.readback?.kind) ? base.verify(ctx, receipt) : plain.verify(ctx, receipt)),
  remove: (ctx, receipt, ...rest) => (isDurable(receipt?.readback?.kind) ? base.remove(ctx, receipt, ...rest) : plain.remove(ctx, receipt, ...rest)),
};
`;
// The Query's protocol words; a fake inspects no traffic, so it can carry each of them.
const PROTOCOLS = ['sse', 'streamable-http', 'oauth-dcr'];
const runtimeUrl = pathToFileURL(fileURLToPath(new URL('./adapter-runtime.mjs', import.meta.url))).href;

/**
 * Writes a one-provider registry to a scratch directory and returns `{ manifest, root, cleanup }`, which is what
 * `createRouteApi({ manifest, root })` loads. `kinds` is any of 'session' and 'durable'. A durable fake keeps its
 * rules in `<root>/providers/<id>/store.json` (read it to see what the provider holds; a rule is `entries.<slot>.rule`), so
 * another process sees the same state. The fake never touches the network. `id` is the id the catalog shows as `providerId`.
 * `protocols` uses the Query's words ('sse', 'streamable-http', 'oauth-dcr'); a fake carries all three unless a test narrows it,
 * so an app's protocol requirements do not make its own fake ineligible.
 */
export async function fakeRegistry({ id, label, kinds, reach, transport = 'https', protocols = PROTOCOLS, dir, facts = [], setupActions = [], proofProtocol = 'http' } = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw gozarError('invalid_input', 'fakeRegistry needs an id of lowercase letters, digits and hyphens');
  // An attached fake would make expose start a real controller process, so only session and durable fakes exist.
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !KINDS.includes(kind))) throw gozarError('invalid_input', `fakeRegistry kinds must be a non-empty list of ${KINDS.join(' and ')}: only session and durable fakes are supported`);
  if (!REACHES.includes(reach)) throw gozarError('invalid_input', `fakeRegistry reach must be one of ${REACHES.join(', ')}`);
  if (!['https', 'http', 'tcp', 'tls'].includes(transport)) throw gozarError('invalid_input', "fakeRegistry transport must be 'https' or 'http'");
  if (!Array.isArray(protocols) || protocols.some(item => !PROTOCOLS.includes(item))) throw gozarError('invalid_input', `fakeRegistry protocols must be a list of ${PROTOCOLS.join(', ')}`);
  const own = dir === undefined;
  const root = dir ?? await mkdtemp(join(tmpdir(), 'gozar-fake-'));
  const folder = join(root, 'providers', id);
  await mkdir(folder, { recursive: true });
  const definition = {
    schemaVersion: 1, id, label: label ?? `Fake ${id}`, needs: 'Needs nothing: this is a test fake.',
    capabilities: {
      reach, transport,
      traffic: { tlsTermination: transport === 'https' ? 'provider' : 'unknown', providerCanReadPayload: ['tcp','tls'].includes(transport) ? null : false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
      address: { stability: 'unknown', scope: 'a fake address that exists only in memory', conditions: [], ports: null },
      cost: { kind: 'free', summary: 'A fake costs nothing.', currency: null, amount: null, period: null },
      needsAccount: false, lifetimes: [...kinds], supervision: 'controller',
      protocols: { sse: protocols.includes('sse'), streamableHttp: protocols.includes('streamable-http'), oauthDcr: protocols.includes('oauth-dcr') },
      proof: { vantage: 'this-device', checks: ['nonce'] },
    },
    supportedKinds: [...kinds], facts, ...(proofProtocol === 'echo' ? {originSchemes:['tcp:']} : {}),
    disclosure: { revision: `disc-${id}`, text: 'A fake provider used in tests. Nothing leaves this process.', links: [] },
    ownership: 'gozar-owned',
  };
  await writeFile(join(folder, 'definition.json'), JSON.stringify({ adapter: definition }, null, 2));
  if (kinds.includes('durable')) {
    // The durable engine reads the provider's durable recipe from the wrapped definition of the recipe adapter.
    definition.capabilities.address.stability = 'stable';
    await writeFile(join(folder, 'definition.json'), JSON.stringify({ wraps: './wrapped.definition.json', adapter: definition }, null, 2));
    await writeFile(join(folder, 'wrapped.definition.json'), JSON.stringify({ schemaVersion: 1, definition: {
      id, planVersion: 1, idleTimeoutMs: null, providerResource: `${id}-slot`, addressStability: 'stable', durableLifetime: 'provider-persistent',
      actions: [], recipes: {}, durableRecipe: { mode: 'fake', slots: ['a', 'b', 'c'], listener: { forward: '{target}' } } } }, null, 2));
    await writeFile(join(folder, 'store.json'), JSON.stringify({ identity: `store-${id}`, version: 1, entries: {} }));
    await writeFile(join(folder, 'plain.mjs'), moduleSource(setupActions, proofProtocol));
    await writeFile(join(folder, 'index.mjs'), durableModuleSource(runtimeUrl));
  } else {
    await writeFile(join(folder, 'index.mjs'), moduleSource(setupActions, proofProtocol));
  }
  return {
    manifest: { providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] },
    root,
    cleanup: async () => { await rm(own ? root : join(root, 'providers', id), { recursive: true, force: true }); if (!own) await rmdir(join(root, 'providers')).catch(error => { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(error.code)) throw error; }); },
  };
}
