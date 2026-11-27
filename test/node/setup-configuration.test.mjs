// What a user provides during setup reaches that adapter, and only that adapter, in every later context.
// The ngrok journey runs through the public API with a stub SDK and no network. The controller of an attached
// route is a separate process; it can open the listener only if its own contexts see the stored values.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import http from 'node:http';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import { pathToFileURL } from 'node:url';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { storeSecret, withSecret } from '../../packages/gozar-node/secret-store.mjs';
import { runSetupAction } from '../../packages/gozar-node/route-setup.mjs';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';
import { domainPattern } from '../../adapters/providers/ngrok-https-edge/setup.mjs';
import { action, codeOf, query, scratch, stubAdapter } from './route-schema-check.mjs';

const TOKEN = 'ngrok-stub-token-b7e41d90c3a2';
const DOMAIN = 'reserved.example.ngrok.app';
const ORIGIN = `https://${DOMAIN}`;
const url = path => pathToFileURL(new URL(path, import.meta.url).pathname).href;
const approvalOf = a => ({ digest: a.digest, disclosureRevision: a.disclosure.revision,...(a.consent?{kind:'setup',consentFactsDigest:a.consent.consentFactsDigest}:{}) });
const attachedQuery = home => query({ home,providerId:'ngrok-https-edge', usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Every regular file under `root`, skipping the named top-level directories. Sockets and lock anchors are read like any file. */
async function walk(root, skip = []) {
  const found = [];
  const visit = async directory => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      if (skip.includes(relative(root, path))) continue;
      const info = await lstat(path);
      if (info.isDirectory()) await visit(path); else if (info.isFile()) found.push(path);
    }
  };
  await visit(root);
  return found;
}
const filesOf = async directory => (await readdir(directory).catch(() => [])).filter(name => !name.startsWith('.'));

// --- The ngrok journey --------------------------------------------------------------------------------

/** A public API over the real ngrok adapter and a stub SDK. The controller process gets the same stub through a module. */
async function ngrokWorld(t) {
  let harness;t.after(()=>harness?.close());
  const home = await scratch(t), side = await scratch(t),ledger=new Map(),marks=[];
  harness=await createTestingGozar({effects:[
    {kind:'sdk-listener',operation:'detect',handle:async()=>({available:true})},
    {kind:'sdk-listener',operation:'open',handle:async({options})=>{const handle='fixture-listener';ledger.set(handle,{target:options.addr,url:ORIGIN});marks.push({forward:options});return {handle,url:ORIGIN};}},
    {kind:'sdk-listener',operation:'read',handle:async({handle})=>ledger.has(handle)?{present:true,url:ORIGIN}:{present:false}},
    {kind:'sdk-listener',operation:'close',handle:async({handle})=>{ledger.delete(handle);marks.push({closed:true});return {closed:true};}},
    {kind:'network',operation:'fetch',handle:async request=>{
      const url=new URL(request.url),resource=[...ledger.values()].find(item=>item.url===url.origin);assert.ok(resource);
      return new Promise((resolve,reject)=>{const pending=http.get(`http://${resource.target}${url.pathname}`,{headers:request.headers},response=>{const chunks=[];let previous=Date.now();response.on('data',chunk=>{const at=Date.now();chunks.push({data:chunk.toString('base64'),delayMs:at-previous});previous=at;});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks}));});pending.on('error',reject);});
    }},
  ]});const api=harness.gozar;
  const forwards = async () => structuredClone(marks);
  const candidateOf = async (seen = []) => {
    const catalog = await api.catalogRoutes(attachedQuery(home));
    seen.push(JSON.stringify(catalog));
    assert.equal(catalog.candidates.length, 1);
    return catalog.candidates[0];
  };
  const provide = async (candidate, actionId, value, seen = []) => {
    const step = candidate.setup.actions.find(item => item.id === actionId);
    assert.ok(step, `the catalog offers ${actionId}`);
    const {handle}=await api.storeSecret({home,owner:attachedQuery(home).owner,providerId:candidate.providerId,inputId:actionId,scopeId:candidate.configuration.scopeId,expectedConfigurationRevision:candidate.configuration.revision,bytes:new TextEncoder().encode(value)});
    const result = await api.runSetupAction({ home,owner:attachedQuery(home).owner,providerId:candidate.providerId,expectedConfigurationRevision:candidate.configuration.revision, actionId, approval: approvalOf(step), secretHandle: handle });
    seen.push(JSON.stringify(result));
    return { result, handle };
  };
  // A provide-value action takes a plain value, never a secret handle; it is kept as configuration.
  const provideValue = async (candidate, actionId, value) => {
    const step = candidate.setup.actions.find(item => item.id === actionId);
    assert.equal(step.kind, 'provide-value');
    return api.runSetupAction({ home,owner:attachedQuery(home).owner,providerId:candidate.providerId,expectedConfigurationRevision:candidate.configuration.revision, actionId, approval: approvalOf(step), value });
  };
  return { home, side, api, forwards, candidateOf, provide, provideValue };
}

const readProviderDisplay = provider => JSON.parse(readFileSync(
  new URL(`../../adapters/providers/${provider}/definition.json`, import.meta.url), 'utf8',
)).adapter;

test('packaged provider setup shows distinct service names', () => {
  assert.equal(readProviderDisplay('tailscale-funnel').label, 'Tailscale Funnel');
  assert.equal(readProviderDisplay('cloudflare-named').label, 'Cloudflare named tunnel');
});

test('packaged provider setup names terms and privacy links separately', () => {
  for (const provider of ['tailscale-funnel', 'cloudflare-named']) {
    const links = readProviderDisplay(provider).disclosure.links;
    assert.deepEqual(links.map(({ rel, label }) => ({ rel, label })), [
      { rel: 'terms', label: 'Terms' },
      { rel: 'privacy', label: 'Privacy' },
    ]);
  }
});


test('ngrok manual hostname accepts the exact DNS label limit', () => {
  assert.equal(domainPattern.test(`${'a'.repeat(63)}.example`), true);
  assert.equal(domainPattern.test(`${'a'.repeat(64)}.example`), false);
});

test('ngrok manual hostname distinguishes an internal dash from a label-edge dash', () => {
  assert.equal(domainPattern.test('synthetic-demo.example'), true);
  assert.equal(domainPattern.test('-synthetic.example'), false);
  assert.equal(domainPattern.test('synthetic-.example'), false);
});

test('ngrok hostname validation distinguishes the total name limit from each label limit', () => {
  const base = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63)].join('.');
  const valid = base + '.' + 'd'.repeat(61);
  const oversized = base + '.' + 'd'.repeat(62);
  assert.equal(valid.length, 253);
  assert.equal(oversized.length, 254);
  assert.equal(domainPattern.test(valid), true);
  assert.equal(domainPattern.test(oversized), false);
});

test('ngrok hostname validation does not treat missing labels as a complete hostname', () => {
  assert.equal(domainPattern.test('fixture.example'), true);
  assert.equal(domainPattern.test('fixture'), false);
  assert.equal(domainPattern.test('fixture..example'), false);
});

test('ngrok manual hostname rejects a final DNS label longer than 63 characters', () => {
  assert.equal(domainPattern.test(`fixture.${'a'.repeat(63)}`), true);
  assert.equal(domainPattern.test(`fixture.${'a'.repeat(64)}`), false);
});

test('ngrok manual hostname distinguishes a bare name from a pasted URL', () => {
  assert.equal(domainPattern.test('fixture.example'), true);
  for (const pasted of ['https://fixture.example', 'fixture.example/setup', 'fixture.example:443'])
    assert.equal(domainPattern.test(pasted), false, pasted);
});

test('ngrok manual hostname allows subdomain digits but not a numeric final label', () => {
  assert.equal(domainPattern.test('node9.region2.example'), true);
  assert.equal(domainPattern.test('node9.region2.123'), false);
});

test('ngrok setup journey: auth, then reserved domain, then ready; expose opens the listener with the stored values', async t => {
  const { home, api, forwards, candidateOf, provide, provideValue } = await ngrokWorld(t);
  let candidate = await candidateOf();
  assert.equal(candidate.setup.state, 'action-required');
  const setupEntry = candidate.setup.actions.find(item => item.id === 'ngrok-setup');
  assert.equal(setupEntry?.kind, 'gozar-runs');
  assert.equal(setupEntry.step.purpose, 'authorize');
  assert.deepEqual(candidate.setup.actions.filter(item => !item.step).map(item => item.id), ['auth', 'reserved-domain']);
  assert.equal(candidate.candidateToken, null);

  assert.equal((await provide(candidate, 'auth', TOKEN)).result.state, 'complete');
  candidate = await candidateOf();
  assert.deepEqual(candidate.setup.actions.filter(item => !item.step).map(item => item.id), ['reserved-domain'], 'only the missing legacy value is asked for');
  assert.equal(candidate.setup.state, 'action-required');

  assert.equal((await provideValue(candidate, 'reserved-domain', DOMAIN)).state, 'complete');
  candidate = await candidateOf();
  assert.equal(candidate.setup.state, 'ready');
  assert.equal(typeof candidate.candidateToken, 'string');

  const view = await api.expose({ ...attachedQuery(home), approval: {kind:'route',consentFactsDigest:candidate.consentFactsDigest, candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision }, wait: 'verified' });
  assert.equal(view.state, 'usable');
  assert.equal(view.published, ORIGIN);
  const [opened] = await forwards();
  assert.equal(opened.forward.authtoken,TOKEN);assert.equal(opened.forward.domain,DOMAIN);assert.match(opened.forward.addr,/^127\.0\.0\.1:\d+$/);assert.notEqual(opened.forward.addr,'127.0.0.1:8799','the provider forwards through the actual proof gate');

  const closed = await api.closeRoute({ home, handle: view.handle, mode: 'remove' });
  assert.equal(closed.state, 'released');
  assert.deepEqual((await forwards()).at(-1), { closed: true });
});

test('the token bytes never appear outside the secret store: files, catalog, errors, receipts, route views, CLI output', async t => {
  const { home, side, api, candidateOf, provideValue } = await ngrokWorld(t);
  const surfaces = [];
  const secretFile = join(side, 'token'), approvalFile = join(side, 'approval.json'), queryFile = join(side, 'query.json');
  await writeFile(secretFile, `${TOKEN}\n`, { mode: 0o600 }); await chmod(secretFile, 0o600);
  await writeFile(queryFile, JSON.stringify(attachedQuery(home)), { mode: 0o600 }); await chmod(queryFile, 0o600);
  const cli = async argv => {
    let stdout = '', stderr = '';
    const code = await routeMain(argv, { api, stdout: { write: chunk => { stdout += chunk; } }, stderr: { write: chunk => { stderr += chunk; } } });
    surfaces.push(stdout, stderr);
    return { code, stdout, stderr };
  };

  // The auth value arrives through the CLI, the way a user supplies it.
  let candidate = await candidateOf(surfaces);
  await writeFile(approvalFile, JSON.stringify(approvalOf(candidate.setup.actions[0])), { mode: 0o600 }); await chmod(approvalFile, 0o600);
  const setup = await cli(['setup', 'auth', '--approval-file', approvalFile, '--secret-file', secretFile, '--query-file',queryFile,'--provider-id','ngrok-https-edge','--home', home, '--json']);
  assert.equal(setup.code, 0, setup.stderr);
  await cli(['catalog', '--query-file', queryFile, '--home', home, '--json']);

  // Errors: a stale approval, a missing approval and an invalid reserved domain.
  candidate = await candidateOf(surfaces);
  const domainAction = candidate.setup.actions[0];
  // The token offered as the domain: Gozar checks the format and refuses, and the value goes nowhere.
  await api.runSetupAction({ home,owner:attachedQuery(home).owner,providerId:candidate.providerId,expectedConfigurationRevision:candidate.configuration.revision, actionId: 'reserved-domain', approval: approvalOf(domainAction), value: TOKEN }).then(() => assert.fail('expected a rejection'), error => { assert.equal(error.code, 'invalid_input'); surfaces.push(error.message, JSON.stringify(error), String(error.stack)); });
  for (const request of [{ approval: { digest: 'sha256:stale', disclosureRevision: 'disc-stale' } }, {}]) {
    const handle = (await storeSecret({ home, value: TOKEN })).handle;
    await api.runSetupAction({ home, actionId: 'reserved-domain', secretHandle: handle, ...request }).then(() => assert.fail('expected a rejection'), error => { surfaces.push(error.message, JSON.stringify(error), String(error.stack)); });
  }
  const unset = await api.expose({ ...attachedQuery(home), approval: { candidateToken: 'tok_unknown', disclosureRevision: 'disc' }, wait: 'verified' }).catch(error => error);
  surfaces.push(String(unset.message), JSON.stringify(unset));

  // Receipts and route views come from a route that is really open.
  surfaces.push(JSON.stringify(await provideValue(candidate, 'reserved-domain', DOMAIN)));
  candidate = await candidateOf(surfaces);
  const view = await api.expose({ ...attachedQuery(home), approval: {kind:'route',consentFactsDigest:candidate.consentFactsDigest, candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision }, wait: 'verified' });
  surfaces.push(JSON.stringify(view), JSON.stringify(await api.routeStatus({ home, handle: view.handle })));
  const state = await readFile(join(home, 'attached', view.handle.id, 'state.json'), 'utf8');
  assert.ok(JSON.parse(state).receipt, 'a receipt was written');
  surfaces.push(JSON.stringify(await api.closeRoute({ home, handle: view.handle, mode: 'remove' })));

  for (const surface of surfaces) assert.ok(!surface.includes(TOKEN), `the token appeared in an output: ${surface.slice(0, 120)}`);
  const outside = await walk(home, ['secrets']);
  assert.ok(outside.some(path => path.endsWith('state.json')) && outside.some(path => path.endsWith('embedding-state.json')), 'the walk covers receipts and scoped configuration records');
  for (const path of outside) assert.ok(!(await readFile(path)).includes(TOKEN), `the token is in ${relative(home, path)}`);
  const stored = await Promise.all((await filesOf(join(home, 'secrets'))).map(name => withSecret(home, name, async bytes => Buffer.from(bytes).toString())));
  assert.ok(stored.includes(TOKEN), 'the token is in the secret store');
});

// --- The record and the secret store ------------------------------------------------------------------

/** One adapter with one provide-secret action that completes, blocks, stays pending or throws on demand. */
function secretAdapter(id = 'needs-key', outcome = { state: 'complete' }) {
  const step = action('key', 'provide-secret', { secretLabel: 'a key' });
  const adapter = stubAdapter(id, { actions: [step], state: 'action-required', setup: async () => {
    if (outcome.throws) throw new Error('adapter failed');
    return { state: outcome.state, nextAction: outcome.state === 'complete' ? null : step };
  } });
  adapter.setupActions = () => [step];
  return { adapter, step, outcome };
}
const readContext = { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
const setupWith = (adapters, home, step, handle, extra = {}) => runSetupAction({ home, actionId: 'key', approval: approvalOf(step), secretHandle: handle, ...extra }, { adapters, platform: 'linux', readContext });

test('a blocked, pending, failed, stale or unapproved setup leaves no secret file behind; a complete one keeps it', async t => {
  const home = await scratch(t);
  const cases = [
    ['blocked', secretAdapter('needs-key', { state: 'blocked' }), {}, null],
    ['pending', secretAdapter('needs-key', { state: 'pending' }), {}, null],
    ['adapter throws', secretAdapter('needs-key', { throws: true }), {}, 'internal_error'],
    ['stale digest', secretAdapter(), { approval: { digest: 'sha256:other', disclosureRevision: 'disc-key' } }, 'candidate_stale'],
    ['no approval', secretAdapter(), { approval: undefined }, 'consent_required'],
    ['unknown action', secretAdapter(), { actionId: 'nope' }, 'candidate_stale'],
  ];
  for (const [name, { adapter, step }, extra, code] of cases) {
    const { handle } = await storeSecret({ home, value: `value-for-${name}` });
    assert.deepEqual(await filesOf(join(home, 'secrets')), [handle]);
    const run = setupWith([adapter], home, step, handle, extra);
    if (code) await codeOf(run); else assert.notEqual((await run).state, 'complete');
    assert.deepEqual(await filesOf(join(home, 'secrets')), [], `${name}: the provided secret was deleted`);
  }
  assert.deepEqual(await filesOf(join(home, 'setup')), [], 'nothing was recorded');

  const { adapter, step } = secretAdapter();
  const { handle } = await storeSecret({ home, value: 'kept' });
  assert.equal((await setupWith([adapter], home, step, handle)).state, 'complete');
  assert.deepEqual(await filesOf(join(home, 'secrets')), [handle]);
  // Offering a handle the record already binds is not a reason to delete it.
  assert.equal((await setupWith([adapter], home, step, handle)).state, 'complete');
  await codeOf(setupWith([adapter], home, step, handle, { approval: undefined }));
  assert.deepEqual(await filesOf(join(home, 'secrets')), [handle], 'a bound handle survives a later refused call');
});

test('replacing a value deletes the old handle file and the adapter reads the new value', async t => {
  const home = await scratch(t), { adapter, step } = secretAdapter();
  let seen;
  adapter.detect = async ctx => { seen = await ctx.configuration(null); return { state: 'action-required', facts: {} }; };
  const first = (await storeSecret({ home, value: 'first' })).handle;
  await setupWith([adapter], home, step, first);
  assert.deepEqual(await filesOf(join(home, 'secrets')), [first]);
  const second = (await storeSecret({ home, value: 'second' })).handle;
  await setupWith([adapter], home, step, second);
  assert.deepEqual(await filesOf(join(home, 'secrets')), [second], 'the replaced handle file is gone');
  await setupWith([adapter], home, step, second);
  assert.deepEqual(seen, { key: 'second' });
  assert.deepEqual(await filesOf(join(home, 'secrets')), [second]);
});

test('the record is a private 0600 file that holds handles, never values', async t => {
  const home = await scratch(t), { adapter, step } = secretAdapter();
  const { handle } = await storeSecret({ home, value: 'plain-value-in-store' });
  await setupWith([adapter], home, step, handle);
  const file = join(home, 'setup', 'needs-key.json');
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(home, 'setup'))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, values: { key: handle } });
});

// --- Scoping ------------------------------------------------------------------------------------------

/** Two providers that exist only as test manifest entries. Each logs what configuration(null) answered in every method. */
async function twoProviders(t) {
  const root = await scratch(t), log = join(root, 'seen.log');
  const ngrok = JSON.parse(readFileSync(new URL('../../adapters/providers/ngrok-https-edge/definition.json', import.meta.url), 'utf8')).adapter;
  const providers = [];
  for (const id of ['edge-a', 'edge-b']) {
    const dir = join(root, 'providers', id);
    await mkdir(dir, { recursive: true });
    const text = `Serve this app through the synthetic ${id} edge.`;
    const definition = { ...ngrok, id, label: `Synthetic ${id}`, disclosure: { revision: `disc-${id}`, text, links: [] } };
    writeFileSync(join(dir, 'definition.json'), JSON.stringify({ adapter: definition }));
    writeFileSync(join(dir, 'index.mjs'), `import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const seen = async (ctx, method) => { const config = await ctx.configuration(null); appendFileSync(${JSON.stringify(log)}, JSON.stringify({ id: definition.id, method, config }) + '\\n'); return config; };
const body = { id: 'key', kind: 'provide-secret', label: 'Provide a key', secretLabel: 'a key', disclosure: definition.disclosure };
const step = { ...body, digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
export default {
  id: definition.id, definition,
  async detect(ctx) { const config = await seen(ctx, 'detect'); return { state: config ? 'ready' : 'action-required', facts: { setupNeeded: !config } }; },
  properties: () => definition.capabilities,
  setupActions: facts => (facts?.setupNeeded ? [step] : []),
  async setup(ctx, actionId, handle) { await seen(ctx, 'setup'); await ctx.withSecret(handle, async () => {}); return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) { await seen(ctx, 'plan'); return { digest: 'plan-' + request.target, origin: null, resourceKey: 'res-' + definition.id, effects: [], readback: null, cleanup: null, precondition: null }; },
  async observe(ctx) { await seen(ctx, 'observe'); return { present: false, resourceKey: 'res-' + definition.id, identity: null, revision: null }; },
  async create() { throw new Error('unused'); }, async verify() { throw new Error('unused'); }, async remove() { throw new Error('unused'); },
  async runtimeFacts() { return { properties: definition.capabilities, ingress: null, limits: { recommendedPollIntervalMs: 1000, idleTimeoutMs: null } }; },
};
`);
    providers.push({ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` });
  }
  const api = createRouteApi({ manifest: { providers }, root, platform: 'linux' });
  const seen = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { api, seen, log };
}

test('adapter A cannot read adapter B\'s configuration, in any method, even under the same action id', async t => {
  const home = await scratch(t), { api, seen } = await twoProviders(t);
  const ask = () => api.catalogRoutes(query({ home, usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } }));
  const provide = async (catalog, id, value) => {
    const candidate = catalog.candidates.find(item => item.display.label === `Synthetic ${id}`);
    const step = candidate.setup.actions[0];
    const {handle}=await api.storeSecret({home,owner:query().owner,providerId:candidate.providerId,inputId:step.id,scopeId:candidate.configuration.scopeId,expectedConfigurationRevision:candidate.configuration.revision,bytes:new TextEncoder().encode(value)});
    assert.equal((await api.runSetupAction({ home,owner:query().owner,providerId:candidate.providerId,expectedConfigurationRevision:candidate.configuration.revision, actionId: step.id, approval: approvalOf(step), secretHandle: handle })).state, 'complete');
  };
  await provide(await ask(), 'edge-a', 'secret-for-a');
  const mark = (await seen()).length;
  const catalog = await ask();
  const states = Object.fromEntries(catalog.candidates.map(item => [item.display.label, item.setup.state]));
  assert.deepEqual(states, { 'Synthetic edge-a': 'ready', 'Synthetic edge-b': 'action-required' });
  const after = (await seen()).slice(mark);
  for (const method of ['detect', 'plan', 'observe']) {
    assert.deepEqual(after.find(item => item.id === 'edge-a' && item.method === method)?.config, { key: 'secret-for-a' }, `edge-a ${method}`);
  }
  assert.ok((await seen()).filter(item => item.id === 'edge-b').every(item => item.config === null), 'edge-b never sees edge-a\'s value');

  await provide(catalog, 'edge-b', 'secret-for-b');
  const second = (await seen()).length;
  await ask();
  const latest = (await seen()).slice(second);
  assert.deepEqual(latest.filter(item => item.id === 'edge-a').map(item => item.config), latest.filter(item => item.id === 'edge-a').map(() => ({ key: 'secret-for-a' })));
  assert.deepEqual(latest.filter(item => item.id === 'edge-b' && item.method !== 'setup').map(item => item.config), latest.filter(item => item.id === 'edge-b' && item.method !== 'setup').map(() => ({ key: 'secret-for-b' })));
});

test('the admitted and attached effect contexts carry the adapter\'s own configuration', async t => {
  const { createAdmittedContext, createAttachedEffectContext } = await import('../../packages/gozar-node/adapter-runtime.mjs');
  const { bindSetupValue } = await import('../../packages/gozar-node/adapter-configuration.mjs');
  const home = await scratch(t), read = { ...readContext, home, platform: 'linux' };
  await bindSetupValue({ home, adapterId: 'edge-a', actionId: 'key', handle: (await storeSecret({ home, value: 'for-a' })).handle });
  const admitted = createAdmittedContext({ read, adapterId: 'edge-a', generation: 1 });
  const other = createAdmittedContext({ read, adapterId: 'edge-b', generation: 1 });
  const attached = createAttachedEffectContext({ adapter: { id: 'edge-a' }, readContext: read });
  assert.deepEqual(await admitted.configuration(null), { key: 'for-a' });
  assert.deepEqual(await attached.configuration(null), { key: 'for-a' });
  assert.equal(await other.configuration(null), null);
  const named = createAdmittedContext({ read: { ...read, configuration: async ref => ({ ref }) }, adapterId: 'edge-a', generation: 1 });
  assert.deepEqual(await named.configuration('route-1'), { ref: 'route-1' }, 'a named ref keeps the base lookup');
});

test('LAN setup handles absent or empty interface observations', async () => {
  const { observedInterfaces } = await import('../../adapters/providers/lan/index.mjs');
  assert.deepEqual(observedInterfaces(undefined), []);
  assert.deepEqual(observedInterfaces({ interfaces: {
    missing: null,
    dormant: [],
    internal: [{ internal: true, address: '127.0.0.1' }],
  } }), []);
});

test('LAN setup ignores malformed address entries and entries missing an internal flag', async () => {
  const { observedInterfaces } = await import('../../adapters/providers/lan/index.mjs');
  assert.deepEqual(observedInterfaces({ interfaces: {
    unusable: [null, { internal: false, address: 'not-an-address' }],
    unknown: [{ address: '192.0.2.10' }],
  } }), []);
});

test('unavailable fixture listener runtime fails setup without trying the live SDK', async () => {
  const { listenerSdk } = await import('../../adapters/providers/_shared/listener-effects.mjs');
  const operations = [];
  await assert.rejects(
    listenerSdk({ dispatchEffect: async ({ operation }) => {
      operations.push(operation);
      return { available: false };
    } }, () => assert.fail('must not load the live SDK')),
    { code: 'setup_required', message: 'The listener runtime is unavailable in this fixture' },
  );
  assert.deepEqual(operations, ['detect']);
});

test('fixture listener refuses an invalid open result instead of returning a listener', async () => {
  const { listenerSdk } = await import('../../adapters/providers/_shared/listener-effects.mjs');
  const operations = [];
  const sdk = await listenerSdk({ dispatchEffect: async ({ operation, input }) => {
    operations.push({ operation, input });
    return operation === 'detect' ? { available: true } : { handle: '', url: 'https://fixture.invalid' };
  } }, () => assert.fail('must not load the live SDK'));
  const options = { addr: '127.0.0.1:43210' };
  await assert.rejects(sdk.forward(options), {
    code: 'provider_unavailable',
    message: 'The fixture listener effect returned an invalid resource',
  });
  assert.deepEqual(operations, [
    { operation: 'detect', input: {} },
    { operation: 'open', input: { options } },
  ]);
});

test('fixture listener read treats missing evidence as unknown, not confirmed absent', async () => {
  const { listenerSdk } = await import('../../adapters/providers/_shared/listener-effects.mjs');
  const reads = [];
  const sdk = await listenerSdk({ dispatchEffect: async ({ operation, input }) => {
    if (operation === 'detect') return { available: true };
    assert.equal(operation, 'read');
    reads.push(input.handle);
    return input.handle === 'gone' ? { present: false } : {};
  } }, () => assert.fail('must not load the live SDK'));
  assert.equal(await sdk.getListener('gone'), null);
  await assert.rejects(sdk.getListener('unknown'), {
    code: 'provider_unavailable',
    message: 'The fixture listener presence is unknown',
  });
  assert.deepEqual(reads, ['gone', 'unknown']);
});

test('Tailscale setup presents the HTTPS default port implicitly and other ports explicitly', async () => {
  const { originOf } = await import('../../adapters/providers/_shared/tailscale-serve.mjs');
  assert.equal(originOf('demo.invalid', 443), 'https://demo.invalid');
  assert.equal(originOf('demo.invalid', 8443), 'https://demo.invalid:8443');
});

test('an allowance diagnostic has a fixed message and an account-help action', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({ code: 'ERR_NGROK_108', message: 'fixture debug detail' });
  assert.match(error.message, /agent\/session allowance was reached/);
  assert.equal(error.nextAction.kind, 'open-url');
  assert.equal(error.nextAction.label, 'Check account setup');
  assert.doesNotMatch(error.message, /fixture debug detail/);
});

test('an unknown listener diagnostic gives stable review instructions', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({ message: 'fictional provider detail' });
  assert.match(error.message, /review setup and retry/);
  assert.equal(error.nextAction.kind, 'instructions');
  assert.equal(error.nextAction.label, 'Review connection and setup');
  assert.doesNotMatch(error.message, /fictional provider detail/);
});

test('Tailscale check still reports working LocalAPI when the macOS app discovery fails', async () => {
  const { checkTailscaleApp } = await import('../../adapters/providers/_shared/check-tailscale-app.mjs');
  const calls = [];
  const discovered = new Error('synthetic app discovery unavailable');
  const result = await checkTailscaleApp({
    platform: 'darwin',
    env: { PATH: '' },
    resolve: () => null,
    discover: async () => { calls.push('discover'); throw discovered; },
    node: async () => { calls.push('status'); },
    serveConfig: async () => { calls.push('serve-config'); },
  });
  assert.deepEqual(calls, ['discover', 'status', 'serve-config']);
  assert.equal(result.ok, true);
  assert.ok(result.lines.includes('Tailscale app LocalAPI: discovery failed; checking LocalAPI directly'));
  assert.ok(result.lines.includes('LocalAPI status: ok'));
  assert.ok(result.lines.includes('LocalAPI serve-config: ok'));
  assert.equal(result.lines.at(-1), 'result: reachable');
  assert.doesNotMatch(result.lines.join('\n'), /synthetic app discovery unavailable/);
});

test('Tailscale diagnostic skips macOS app discovery on Linux', async () => {
  const { checkTailscaleApp } = await import('../../adapters/providers/_shared/check-tailscale-app.mjs');
  const calls = [];
  const result = await checkTailscaleApp({
    platform: 'linux',
    env: { PATH: '' },
    resolve: () => null,
    discover: async () => { calls.push('discover'); },
    node: async () => { calls.push('status'); },
    serveConfig: async () => { calls.push('serve-config'); },
  });
  assert.deepEqual(calls, ['status', 'serve-config']);
  assert.equal(result.lines.some(line => line.startsWith('Tailscale app LocalAPI:')), false);
  assert.equal(result.ok, true);
});

test('Tailscale diagnostic checks serve config even if the status request fails', async () => {
  const { checkTailscaleApp } = await import('../../adapters/providers/_shared/check-tailscale-app.mjs');
  const calls = [];
  const result = await checkTailscaleApp({
    platform: 'darwin',
    env: { PATH: '' },
    resolve: () => null,
    discover: async () => ({ variant: 'standalone', port: 12345 }),
    node: async () => {
      calls.push('status');
      throw new Error('synthetic status detail');
    },
    serveConfig: async () => { calls.push('serve-config'); },
  });
  assert.deepEqual(calls, ['status', 'serve-config']);
  assert.ok(result.lines.some(line => line.includes('standalone app on loopback port 12345')));
  assert.ok(result.lines.includes('LocalAPI status: failed'));
  assert.ok(result.lines.includes('LocalAPI serve-config: ok'));
  assert.doesNotMatch(result.lines.join('\n'), /synthetic status detail/);
  assert.equal(result.ok, false);
  assert.equal(result.lines.at(-1), 'result: not reachable');
});

test('Tailscale diagnostic does not infer a usable config from working status', async () => {
  const { checkTailscaleApp } = await import('../../adapters/providers/_shared/check-tailscale-app.mjs');
  const result = await checkTailscaleApp({
    platform: 'linux', env: { PATH: '' }, resolve: () => null,
    node: async () => {},
    serveConfig: async () => {
      throw Object.assign(new Error('synthetic config detail'), { code: 'not_supported', nextAction: 'upgrade tailscaled' });
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.lines.includes('LocalAPI status: ok'));
  assert.ok(result.lines.includes('LocalAPI serve-config: not_supported (upgrade tailscaled)'));
  assert.doesNotMatch(result.lines.join('\n'), /synthetic config detail/);
  assert.equal(result.lines.at(-1), 'result: not reachable');
});

test('missing macOS app discovery still reports both direct LocalAPI failures', async () => {
  const { checkTailscaleApp } = await import('../../adapters/providers/_shared/check-tailscale-app.mjs');
  const result = await checkTailscaleApp({
    platform: 'darwin', env: { PATH: '' }, resolve: () => null,
    discover: async () => null,
    node: async () => { throw new Error('synthetic status detail'); },
    serveConfig: async () => { throw new Error('synthetic config detail'); },
  });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some(line => line.startsWith('Tailscale app LocalAPI: not found')));
  assert.deepEqual(result.lines.slice(-3), [
    'LocalAPI status: failed', 'LocalAPI serve-config: failed', 'result: not reachable',
  ]);
});

test('own-address reach treats loopback as this device', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  assert.equal(reachOf('https://127.0.0.1:8443/'), 'this-device');
  assert.equal(reachOf('https://127.0.0.2/'), 'this-device');
  assert.equal(reachOf('https://[::1]/'), 'this-device');
  assert.equal(reachOf('https://localhost/'), 'this-device');
  assert.equal(reachOf('https://app.localhost/'), 'this-device');
  assert.equal(reachOf('https://LOCALHOST/'), 'this-device');
});

test('own-address reach treats private addresses and local names as the LAN', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  assert.equal(reachOf('https://192.168.1.10/'), 'lan');
  assert.equal(reachOf('https://10.0.0.5/'), 'lan');
  assert.equal(reachOf('https://172.16.5.4/'), 'lan');
  assert.equal(reachOf('https://172.31.255.255/'), 'lan');
  assert.equal(reachOf('https://printer.local/'), 'lan');
  assert.equal(reachOf('https://nas.lan/'), 'lan');
  assert.equal(reachOf('https://host.internal/'), 'lan');
  assert.equal(reachOf('https://device.home.arpa/'), 'lan');
  assert.equal(reachOf('https://myhost/'), 'lan');
  assert.equal(reachOf('https://[fd00::1]/'), 'lan');
  assert.equal(reachOf('https://[fe80::1]/'), 'lan');
});

test('own-address reach leaves carrier-grade NAT, unspecified and multicast addresses unknown', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  assert.equal(reachOf('https://100.64.0.1/'), 'unknown');
  assert.equal(reachOf('https://100.127.255.255/'), 'unknown');
  assert.equal(reachOf('https://0.1.2.3/'), 'unknown');
  assert.equal(reachOf('https://224.0.0.1/'), 'unknown');
  assert.equal(reachOf('https://[::]/'), 'unknown');
  assert.equal(reachOf('https://[ff02::1]/'), 'unknown');
  assert.equal(reachOf('https://[::2]/'), 'unknown');
});

test('own-address reach treats public addresses as the internet and reads IPv4-mapped IPv6 as IPv4', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  assert.equal(reachOf('https://8.8.8.8/'), 'internet');
  assert.equal(reachOf('https://100.128.0.1/'), 'internet');
  assert.equal(reachOf('https://172.32.0.1/'), 'internet');
  assert.equal(reachOf('https://example.com/'), 'internet');
  assert.equal(reachOf('https://example.com./'), 'internet');
  assert.equal(reachOf('https://[::ffff:127.0.0.1]/'), 'this-device');
  assert.equal(reachOf('https://[::ffff:192.168.1.5]/'), 'lan');
  assert.equal(reachOf('https://[::ffff:8.8.8.8]/'), 'internet');
});

test('short IPv6 hextets do not look like private or multicast prefixes', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  for (const address of ['[00fd::1]', '[00fe::1]', '[00ff::1]']) {
    assert.equal(reachOf('https://' + address), 'internet', address);
  }
  assert.equal(reachOf('https://[fd00::1]'), 'lan');
  assert.equal(reachOf('https://[ff00::1]'), 'unknown');
});

test('IPv4-mapped shared address space keeps its two precise boundaries', async () => {
  const { reachOf } = await import('../../adapters/providers/own-address/index.mjs');
  const reach = address => reachOf('https://[::ffff:' + address + ']');
  assert.equal(reach('100.63.255.255'), 'internet');
  assert.equal(reach('100.64.0.0'), 'unknown');
  assert.equal(reach('100.127.255.255'), 'unknown');
  assert.equal(reach('100.128.0.0'), 'internet');
});

test('listener error for ngrok payment-card verification names the dashboard page', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({ code: 'ERR_NGROK_8013', message: 'fixture debug detail' });
  assert.equal(error.code, 'setup_required');
  assert.match(error.message, /payment-card verification/);
  assert.equal(error.nextAction.kind, 'open-url');
  assert.equal(error.nextAction.href, 'https://dashboard.ngrok.com/settings#id-verification');
  assert.equal(error.nextAction.digest, 'listener-account-8013');
  assert.doesNotMatch(error.message, /fixture debug detail/);
});

test('listener error for an invalid ngrok authtoken hands back the credential action', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const credentialAction = { id: 'auth', kind: 'provide-secret', label: 'Provide your ngrok auth token' };
  const error = safeListenerError({ code: 'ERR_NGROK_105' }, credentialAction);
  assert.equal(error.code, 'setup_required');
  assert.match(error.message, /valid ngrok agent authtoken/);
  assert.deepEqual(error.nextAction, credentialAction);
  assert.notEqual(error.nextAction, credentialAction);
});

test('listener error for an invalid ngrok authtoken falls back to the dashboard link', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({ code: 'ERR_NGROK_105' });
  assert.equal(error.code, 'setup_required');
  assert.equal(error.nextAction.kind, 'open-url');
  assert.equal(error.nextAction.href, 'https://dashboard.ngrok.com/get-started/your-authtoken');
});

test('listener error finds the ngrok fault code in error_code or message text', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const fromField = safeListenerError({ error_code: 'ERR_NGROK_108' });
  assert.match(fromField.message, /agent\/session allowance was reached/);
  assert.equal(fromField.nextAction.href, 'https://dashboard.ngrok.com/agents');
  const fromText = safeListenerError({ message: 'failed: ERR_NGROK_8013 while starting' });
  assert.match(fromText.message, /payment-card verification/);
});

test('listener error for an unsupported effect keeps the unsupported code', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({ code: 'unsupported' });
  assert.equal(error.code, 'unsupported');
  assert.match(error.message, /no testing handler/);
});

test('an unknown SDK error gives recovery instructions without copying its diagnostics', async () => {
  const { safeListenerError } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const error = safeListenerError({code:'UNKNOWN_FIXTURE', message:'synthetic provider detail'});
  assert.equal(error.code, 'provider_unavailable');
  assert.equal(error.nextAction.kind, 'instructions');
  assert.doesNotMatch(JSON.stringify([error.message,error.nextAction]), /UNKNOWN_FIXTURE|synthetic provider detail/);
});

test('a close acknowledgement with the fixture listener still present retains cleanup debt', async () => {
  const { createListenerLifecycle } = await import('../../adapters/providers/_shared/sdk-lifecycle.mjs');
  const lifecycle = createListenerLifecycle({adapterId:'fixture'});
  const ctx = {generation:1,assertGeneration:async()=>{}};
  let closed=0, present=true;
  const listener = {id:()=> 'fixture-id', url:()=> 'https://fixture.invalid', close:async()=>{closed++;}};
  const sdk={forward:async()=>listener,getListener:async id=>{
    assert.equal(id,'fixture-id');
    return present?listener:null;
  }};
  const receipt = await lifecycle.open(ctx,{resourceKey:'fixture',origin:'https://fixture.invalid'},{sdk});
  const pending = await lifecycle.remove(ctx,receipt);
  assert.equal(pending.removed,false);
  assert.equal(pending.debt.reason,'listener-absence-unconfirmed');
  assert.equal(lifecycle.owns(receipt),true);
  present=false;
  assert.deepEqual(await lifecycle.remove(ctx,receipt),{removed:true,debt:null});
  assert.equal(lifecycle.owns(receipt),false);
  assert.equal(closed,2);
});

test('LAN setup lists the usable addresses it observed, with their interfaces', async () => {
  const { observedInterfaces } = await import('../../adapters/providers/lan/index.mjs');
  assert.deepEqual(observedInterfaces({ interfaces: {
    eth0: [
      { internal: false, address: '192.168.1.5' },
      { internal: false, address: '10.0.0.7' },
      { internal: false, address: 'fd00::1' },
      { internal: true, address: '127.0.0.1' },
    ],
    wlan0: [{ internal: false, address: '192.168.2.9' }],
    down: 'not-a-list',
  } }), [
    { name: 'eth0', address: '192.168.1.5' },
    { name: 'eth0', address: '10.0.0.7' },
    { name: 'eth0', address: 'fd00::1' },
    { name: 'wlan0', address: '192.168.2.9' },
  ]);
});

// --- Tailscale LocalAPI client failures ------------------------------------------------------------------

// The LocalAPI client reads its replies through ctx.dispatchEffect, so a canned
// reply exercises the typed errors without a socket, a daemon or the network.
const localApi = replies => {
  const seen = [];
  const ctx = { dispatchEffect: async ({ input }) => {
    seen.push({ ...input });
    return replies(input);
  } };
  return { ctx, seen };
};

test('Tailscale not running: a node status without a Running backend names `tailscale up`', async () => {
  const { getNode } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  for (const backendState of ['Stopped', 'NeedsLogin']) {
    const { ctx, seen } = localApi(({ path }) => {
      assert.equal(path, '/localapi/v0/status?peers=false');
      return { status: 200, headers: {}, body: JSON.stringify({ BackendState: backendState, Self: { DNSName: 'node.tailnet.test.', CapMap: {} } }) };
    });
    await assert.rejects(getNode(ctx), error => {
      assert.equal(error.code, 'provider_not_running');
      assert.equal(error.provider, 'tailscale');
      assert.equal(error.message, 'Tailscale is not running: run `tailscale up`, then retry');
      assert.equal(error.nextAction, 'tailscale up');
      return true;
    });
    assert.equal(seen.length, 1, `${backendState}: one status read and nothing else`);
  }
});

test('a node status reply with no DNS name is an unsupported tailscaled, not a route', async () => {
  const { getNode } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  const { ctx, seen } = localApi(({ path }) => {
    assert.equal(path, '/localapi/v0/status?peers=false');
    return { status: 200, headers: {}, body: JSON.stringify({ BackendState: 'Running', Self: { CapMap: {} } }) };
  });
  await assert.rejects(getNode(ctx), error => {
    assert.equal(error.code, 'provider_unsupported');
    assert.equal(error.provider, 'tailscale');
    assert.equal(error.message, 'Tailscale LocalAPI does not offer serve config with an ETag: upgrade tailscaled');
    assert.equal(error.nextAction, 'upgrade tailscaled');
    return true;
  });
  assert.equal(seen.length, 1, 'one status read and nothing else');
});

test('a serve-config write without the ETag of a read is refused before any request', async () => {
  const { setServeConfig } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  for (const etag of ['', undefined]) {
    const { ctx, seen } = localApi(() => assert.fail('no request may be sent'));
    await assert.rejects(setServeConfig({ TCP: {} }, etag, ctx), error => {
      assert.equal(error.code, 'invalid_input');
      assert.equal(error.provider, 'tailscale');
      assert.equal(error.message, 'Serve config write requires the ETag of a read');
      assert.equal(error.nextAction, 'read the serve config first');
      return true;
    });
    assert.deepEqual(seen, [], 'the refused write sent nothing');
  }
});

test('an unreadable serve-config response does not become an empty usable configuration', async () => {
  const { getServeConfig } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  for (const response of [
    { status: 200, headers: {}, body: '{}' },
    { status: 200, headers: { etag: '"snapshot"' }, body: '{"TCP":' },
    { status: 200, headers: { etag: '"snapshot"' }, body: '{"TCP":[]}' },
  ]) {
    const { ctx, seen } = localApi(() => response);
    await assert.rejects(getServeConfig(ctx), {
      code: 'provider_unsupported', provider: 'tailscale', nextAction: 'upgrade tailscaled',
    });
    assert.deepEqual(seen.map(({ path, method }) => [path, method]), [['/localapi/v0/serve-config', 'GET']]);
  }
});

test('the server rejecting a stale serve-config snapshot does not trigger another write', async () => {
  const { setServeConfig } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  const { ctx, seen } = localApi(() => ({ status: 412, headers: {}, body: '' }));
  assert.equal(await setServeConfig({ TCP: {} }, '"stale-snapshot"', ctx), false);
  assert.deepEqual(seen.map(({ method, headers }) => [method, headers['If-Match']]), [['POST', '"stale-snapshot"']]);
});

test('a serve-config write tailscaled rejects fails closed: one conditional write, nothing changed', async () => {
  const { setServeConfig } = await import('../../adapters/providers/_shared/tailscale-localapi.mjs');
  const etag = '"fake-7"';
  const { ctx, seen } = localApi(({ path, method, headers }) => {
    assert.equal(path, '/localapi/v0/serve-config');
    assert.equal(method, 'POST');
    assert.equal(headers['If-Match'], etag);
    return { status: 500, headers: {}, body: '' };
  });
  await assert.rejects(setServeConfig({ TCP: { 8443: { HTTPS: true } } }, etag, ctx), error => {
    assert.equal(error.code, 'provider_failed');
    assert.equal(error.provider, 'tailscale');
    assert.equal(error.message, 'Tailscale rejected the serve config change; nothing else was changed');
    assert.equal(error.nextAction, 'retry; check the tailscaled logs if it persists');
    return true;
  });
  assert.equal(seen.length, 1, 'the rejected write was attempted once, never retried');
});
