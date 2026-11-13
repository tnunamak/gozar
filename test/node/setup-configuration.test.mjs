// What a user provides during setup reaches that adapter, and only that adapter, in every later context.
// The ngrok journey runs through the public API with a stub SDK and no network. The controller of an attached
// route is a separate process; it can open the listener only if its own contexts see the stored values.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { storeSecret, withSecret } from '../../packages/gozar-node/secret-store.mjs';
import { runSetupAction } from '../../packages/gozar-node/route-setup.mjs';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';
import { action, codeOf, query, scratch, stubAdapter } from './route-schema-check.mjs';

const TOKEN = 'ngrok-stub-token-b7e41d90c3a2';
const DOMAIN = 'reserved.example.ngrok.app';
const ORIGIN = `https://${DOMAIN}`;
const url = path => pathToFileURL(new URL(path, import.meta.url).pathname).href;
const approvalOf = a => ({ digest: a.digest, disclosureRevision: a.disclosure.revision });
const attachedQuery = home => query({ home, usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] } });
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
  const home = await scratch(t), side = await scratch(t), marks = join(side, 'marks.log'), module = join(side, 'controller.mjs');
  const sdk = { forward: async () => { throw new Error('the owner process never opens a listener'); } };
  await writeFile(module, `import { appendFileSync } from 'node:fs';
import { createNgrokAdapter } from ${JSON.stringify(url('../../adapters/providers/ngrok-https-edge/index.mjs'))};
const sdk = { forward: async options => { appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ forward: options }) + '\\n');
  return { url: () => ${JSON.stringify(ORIGIN)}, close: async () => appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ closed: true }) + '\\n') }; } };
// The base context knows no configuration at all: only the stored setup values can configure the adapter.
export default async function () {
  return { adapters: [createNgrokAdapter({ loadSdk: async () => sdk })], validation: 'none',
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified', checkedAt: new Date().toISOString() }) } };
}
`);
  const api = createRouteApi({ adapters: [createNgrokAdapter({ loadSdk: async () => sdk })], platform: 'linux',
    expose: { controllerModule: module, leaseExpiryMs: 60_000, heartbeatMs: 1_000, startTimeoutMs: 30_000 } });
  t.after(async () => {
    for (const id of (await readdir(join(home, 'attached')).catch(() => [])).filter(name => name.startsWith('att_'))) {
      const identity = JSON.parse(await readFile(join(home, 'attached', id, 'control.json'), 'utf8').catch(() => 'null') ?? 'null');
      if (identity?.pid && alive(identity.pid)) { try { process.kill(identity.pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  });
  const forwards = async () => (await readFile(marks, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const candidateOf = async (seen = []) => {
    const catalog = await api.catalogRoutes(attachedQuery(home));
    seen.push(JSON.stringify(catalog));
    assert.equal(catalog.candidates.length, 1);
    return catalog.candidates[0];
  };
  const provide = async (candidate, actionId, value, seen = []) => {
    const step = candidate.setup.actions.find(item => item.id === actionId);
    assert.ok(step, `the catalog offers ${actionId}`);
    const { handle } = await storeSecret({ home, value });
    const result = await api.runSetupAction({ home, actionId, approval: approvalOf(step), secretHandle: handle });
    seen.push(JSON.stringify(result));
    return { result, handle };
  };
  // A provide-value action takes a plain value, never a secret handle; it is kept as configuration.
  const provideValue = async (candidate, actionId, value) => {
    const step = candidate.setup.actions.find(item => item.id === actionId);
    assert.equal(step.kind, 'provide-value');
    return api.runSetupAction({ home, actionId, approval: approvalOf(step), value });
  };
  return { home, side, api, forwards, candidateOf, provide, provideValue };
}

test('ngrok setup journey: auth, then reserved domain, then ready; expose opens the listener with the stored values', async t => {
  const { home, api, forwards, candidateOf, provide, provideValue } = await ngrokWorld(t);
  let candidate = await candidateOf();
  assert.equal(candidate.setup.state, 'action-required');
  assert.deepEqual(candidate.setup.actions.map(item => item.id), ['auth', 'reserved-domain']);
  assert.equal(candidate.candidateToken, null);

  assert.equal((await provide(candidate, 'auth', TOKEN)).result.state, 'complete');
  candidate = await candidateOf();
  assert.deepEqual(candidate.setup.actions.map(item => item.id), ['reserved-domain'], 'only the missing value is asked for');
  assert.equal(candidate.setup.state, 'action-required');

  assert.equal((await provideValue(candidate, 'reserved-domain', DOMAIN)).state, 'complete');
  candidate = await candidateOf();
  assert.equal(candidate.setup.state, 'ready');
  assert.equal(typeof candidate.candidateToken, 'string');

  const view = await api.expose({ ...attachedQuery(home), approval: { candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision }, wait: 'verified' });
  assert.equal(view.state, 'usable');
  assert.equal(view.published, ORIGIN);
  const [opened] = await forwards();
  assert.deepEqual(opened.forward, { addr: '127.0.0.1:8799', authtoken: TOKEN, domain: DOMAIN });

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
  const setup = await cli(['setup', 'auth', '--approval-file', approvalFile, '--secret-file', secretFile, '--home', home, '--json']);
  assert.equal(setup.code, 0, setup.stderr);
  await cli(['catalog', '--query-file', queryFile, '--home', home, '--json']);

  // Errors: a stale approval, a missing approval and an invalid reserved domain.
  candidate = await candidateOf(surfaces);
  const domainAction = candidate.setup.actions[0];
  // The token offered as the domain: Gozar checks the format and refuses, and the value goes nowhere.
  await api.runSetupAction({ home, actionId: 'reserved-domain', approval: approvalOf(domainAction), value: TOKEN }).then(() => assert.fail('expected a rejection'), error => { assert.equal(error.code, 'invalid_input'); surfaces.push(error.message, JSON.stringify(error), String(error.stack)); });
  for (const request of [{ approval: { digest: 'sha256:stale', disclosureRevision: 'disc-stale' } }, {}]) {
    const handle = (await storeSecret({ home, value: TOKEN })).handle;
    await api.runSetupAction({ home, actionId: 'reserved-domain', secretHandle: handle, ...request }).then(() => assert.fail('expected a rejection'), error => { surfaces.push(error.message, JSON.stringify(error), String(error.stack)); });
  }
  const unset = await api.expose({ ...attachedQuery(home), approval: { candidateToken: 'tok_unknown', disclosureRevision: 'disc' }, wait: 'verified' }).catch(error => error);
  surfaces.push(String(unset.message), JSON.stringify(unset));

  // Receipts and route views come from a route that is really open.
  surfaces.push(JSON.stringify(await provideValue(candidate, 'reserved-domain', DOMAIN)));
  candidate = await candidateOf(surfaces);
  const view = await api.expose({ ...attachedQuery(home), approval: { candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision }, wait: 'verified' });
  surfaces.push(JSON.stringify(view), JSON.stringify(await api.routeStatus({ home, handle: view.handle })));
  const state = await readFile(join(home, 'attached', view.handle.id, 'state.json'), 'utf8');
  assert.ok(JSON.parse(state).receipt, 'a receipt was written');
  surfaces.push(JSON.stringify(await api.closeRoute({ home, handle: view.handle, mode: 'remove' })));

  for (const surface of surfaces) assert.ok(!surface.includes(TOKEN), `the token appeared in an output: ${surface.slice(0, 120)}`);
  const outside = await walk(home, ['secrets']);
  assert.ok(outside.some(path => path.endsWith('state.json')) && outside.some(path => path.includes('/setup/')), 'the walk covers receipts and setup records');
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
    const { handle } = await storeSecret({ home, value });
    assert.equal((await api.runSetupAction({ home, actionId: step.id, approval: approvalOf(step), secretHandle: handle })).state, 'complete');
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
