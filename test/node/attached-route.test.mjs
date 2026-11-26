import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile, access, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { attachedStatus, closeAttachedRoute, controlAttached, openAttachedRoute, openSessionRoute, redeemApproval } from '../../packages/gozar-node/attached-route.mjs';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { fakeRegistry } from '../../packages/gozar-node/testing.mjs';
import { routeStatus, closeRoute } from '../../packages/gozar-node/route-view.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { assertShape, codeOf, query, scratch, attachedScratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

test('controlAttached does not open a socket when identity settles after the deadline', async () => {
  let prepared, entered, deadline;
  const identityReady = new Promise(resolve => { prepared = resolve; });
  const identifying = new Promise(resolve => { entered = resolve; });
  let opens = 0, cleared = 0;
  const timer = Symbol('fake deadline');
  const pending = controlAttached('fictional-control', { type: 'observe' }, 123, {
    readControl: async () => JSON.stringify({ pid: 123, startIdentity: 'fixture-start', nonce: 'fixture-nonce' }),
    identify: () => { entered(); return identityReady; },
    connect: () => { opens++; throw new Error('unexpected socket attempt'); },
    setDeadline: (callback, ms) => { assert.equal(ms, 123); deadline = callback; return timer; },
    clearDeadline: id => { assert.equal(id, timer); cleared++; },
  });
  const rejected = assert.rejects(pending, { code: 'provider_unavailable' });
  await identifying;
  deadline();
  await rejected;
  prepared('fixture-start');
  await identityReady;
  assert.equal(opens, 0);
  assert.equal(cleared, 1);
});
const helperUrl = pathToFileURL(new URL('./route-schema-check.mjs', import.meta.url).pathname).href;
const attachedUrl = pathToFileURL(new URL('../../packages/gozar-node/attached-route.mjs', import.meta.url).pathname).href;
const readContext = { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
const EXPIRY = 1500, BEAT = 200;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, ms, step = 50) { const end = Date.now() + ms; for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } }
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A controller module that holds a stub adapter whose create/remove leave marks a test can read from outside the process. */
async function controllerFixture(t) {
  const dir = await scratch(t), marks = join(dir, 'marks.log'), module = join(dir, 'controller.mjs');
  await writeFile(module, `import { appendFileSync,readFileSync,writeFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import { stubAdapter } from ${JSON.stringify(helperUrl)};
const mark = event => appendFileSync(${JSON.stringify(marks)}, event + '\\n');
export default async function () {
  const file=process.argv[3]+'/bootstrap.json',bootstrap=JSON.parse(readFileSync(file,'utf8'));
  writeFileSync(file,JSON.stringify({...bootstrap,identity:{instanceId:'fixture-instance',bootId:randomUUID()}}));
  const adapter = stubAdapter('stub-a');
  const { create, remove } = adapter;
  adapter.create = async (...args) => { mark('created'); return create(...args); };
  adapter.remove = async (...args) => { mark('removed'); return remove(...args); };
  return { adapters: [adapter], effectContext: () => ({}), validation: 'none',
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } };
}
`);
  const read = async () => { try { return (await readFile(marks, 'utf8')).split('\n').filter(Boolean); } catch { return []; } };
  return { module, read };
}
const grantFor = (adapterId, q) => ({ adapterId, planDigest: `plan-${adapterId}-${q.target}`, observedResource: `res-${adapterId}` });
const attachedQuery = home => query({ home, usage: { kind: 'attached' } });
async function approvedRequest(tokens, home, adapterId = 'stub-a') {
  const q = attachedQuery(home);
  const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, `disc-${adapterId}`), grant: grantFor(adapterId, q) });
  return { ...q, approval: { candidateToken: token, disclosureRevision: `disc-${adapterId}` }, wait: 'verified' };
}
const depsFor = (tokens, controllerModule, over = {}) => ({ adapters: [stubAdapter('stub-a')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext,
  controllerModule, leaseExpiryMs: EXPIRY, heartbeatMs: BEAT, startTimeoutMs: 30_000, ...over });

test('valid fixture approval spends before planning and observing the approved route', async t => {
  const home = await scratch(t), tokens = tokenStubs(), events = [];
  const request = await approvedRequest(tokens, home);
  const adapter = stubAdapter('stub-a');
  const plan = adapter.plan, observe = adapter.observe;
  adapter.plan = (...args) => { events.push('plan'); return plan.apply(adapter, args); };
  adapter.observe = (...args) => { events.push('observe'); return observe.apply(adapter, args); };
  const result = await redeemApproval(request, {
    ...depsFor(tokens, undefined, {adapters:[adapter]}),
    redeem(input) { events.push('spend'); return tokens.redeem(input); },
  });
  assert.deepEqual(events, ['spend','plan','observe']);
  assert.equal(result.adapter, adapter);
  assert.equal(result.plan.digest, result.grant.planDigest);
  assert.equal(result.request.target, request.target);
});

// A separate owner process, so a test can kill the owner for real.
async function ownerScript(t, home, controllerModule, { exitAfterOpen = false } = {}) {
  const dir = await scratch(t), file = join(dir, 'owner.mjs');
  await writeFile(file, `import { openAttachedRoute } from ${JSON.stringify(attachedUrl)};
import { stubAdapter, tokenStubs, query } from ${JSON.stringify(helperUrl)};
const home = ${JSON.stringify(home)}, tokens = tokenStubs(), q = query({ home, usage: { kind: 'attached' } });
const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-a'), grant: { adapterId: 'stub-a', planDigest: 'plan-stub-a-' + q.target, observedResource: 'res-stub-a' } });
const view = await openAttachedRoute({ ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-a' }, wait: 'verified' },
  { adapters: [stubAdapter('stub-a')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux',
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) },
    controllerModule: ${JSON.stringify(controllerModule)}, leaseExpiryMs: ${EXPIRY}, heartbeatMs: ${BEAT}, startTimeoutMs: 30000 });
console.log('OPEN ' + JSON.stringify(view));
${exitAfterOpen ? 'process.exit(0);' : 'setInterval(() => {}, 1000);'}
`);
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  t.after(() => { if (alive(child.pid)) child.kill('SIGKILL'); });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const opened = await waitFor(() => /OPEN (.*)\n/.exec(out), 30_000);
  assert.ok(opened, `the owner did not open the route: ${err}`);
  return { child, exited, view: JSON.parse(opened[1]) };
}

test('red: a dropped control channel (owner process killed with SIGKILL) removes the route within the lease expiry', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t);
  const owner = await ownerScript(t, home, controller.module);
  assertShape('RouteView', owner.view);
  assert.equal(owner.view.state, 'usable');
  assert.equal(owner.view.handle.kind, 'attached');
  assert.deepEqual(await controller.read(), ['created']);
  // While the owner lives and beats, the route outlives several expiry periods.
  await sleep(EXPIRY * 2);
  assert.deepEqual(await controller.read(), ['created'], 'a live owner keeps the route');
  const root = join(home, 'attached'), [id] = (await readdir(root)).filter(name => name.startsWith('att_'));
  const { pid } = JSON.parse(await readFile(join(root, id, 'control.json'), 'utf8'));
  assert.ok(alive(pid));
  owner.child.kill('SIGKILL');
  assert.equal((await owner.exited).signal, 'SIGKILL');
  const killedAt = Date.now();
  const removed = await waitFor(async () => (await controller.read()).includes('removed'), EXPIRY + 5000);
  assert.ok(removed, 'the route must be removed after the owner dies');
  assert.ok(Date.now() - killedAt < EXPIRY + 4000, `removed ${Date.now() - killedAt} ms after the kill`);
  assert.deepEqual(await controller.read(), ['created', 'removed']);
  assert.equal(await waitFor(() => !alive(pid), 5000), true, 'the controller process exits after removing the route');
  // After the fact, status reports the released route from the controller's last record.
  const view = await attachedStatus({ home, handle: owner.view.handle });
  assertShape('RouteView', view);
  assert.equal(view.state, 'released');
});

test('an owner that exits normally also loses the lease (unref\'d heartbeat: it never keeps the owner alive)', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t);
  const owner = await ownerScript(t, home, controller.module, { exitAfterOpen: true });
  assert.equal(owner.view.state, 'usable');
  assert.equal((await owner.exited).code, 0);
  const root = join(home, 'attached'), [id] = (await readdir(root)).filter(name => name.startsWith('att_'));
  const { pid } = JSON.parse(await readFile(join(root, id, 'control.json'), 'utf8'));
  assert.ok(await waitFor(async () => (await controller.read()).includes('removed'), EXPIRY + 5000));
  assert.deepEqual(await controller.read(), ['created', 'removed']);
  // Removal is recorded before the controller finishes writing its final state.
  // Wait for exit before scratch teardown can remove its working directory.
  assert.equal(await waitFor(() => !alive(pid), 5000), true, 'the controller exits after normal owner exit');
});

test('open, status, close: the lease holds beyond the expiry, close removes at once and the handle is then released', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const view = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, controller.module));
  assertShape('RouteView', view);
  assert.deepEqual([view.handle.kind, view.state], ['attached', 'usable']);
  assert.match(view.handle.id, /^att_[0-9a-f]{16}$/);
  assert.equal(view.ownership, 'gozar-owned');
  await sleep(EXPIRY * 2);                                  // this process is the owner, and it beats from an unref'd timer
  const status = await routeStatus({ home, handle: view.handle }, {});
  assertShape('RouteView', status);
  assert.equal(status.state, 'usable');
  assert.deepEqual(await controller.read(), ['created']);
  const closed = await closeRoute({ home, handle: view.handle, mode: 'remove' }, {});
  assertShape('RouteView', closed);
  assert.equal(closed.state, 'released');
  assert.deepEqual(await controller.read(), ['created', 'removed']);
  assert.equal((await routeStatus({ home, handle: view.handle }, {})).state, 'released');
});

test('a stale generation on status is route_conflict and an unknown attached id is route_not_found', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const view = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, controller.module));
  assert.equal(await codeOf(attachedStatus({ home, handle: { ...view.handle, generation: view.handle.generation + 1 } })), 'route_conflict');
  assert.equal(await codeOf(attachedStatus({ home, handle: { kind: 'attached', id: 'att_0000000000000000', generation: 1 } })), 'route_not_found');
  assert.equal(await codeOf(closeAttachedRoute({ home, handle: { kind: 'attached', id: '../escape', generation: 1 } })), 'route_not_found');
  await closeAttachedRoute({ home, handle: view.handle });
});

test('red: a token is single use, and a provider that moved after approval is candidate_stale and starts nothing', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const request = await approvedRequest(tokens, home);
  const moved = stubAdapter('stub-a'); moved.plan = async (ctx, ask) => ({ digest: 'plan-changed', origin: null, resourceKey: 'res-stub-a', effects: [], readback: null, cleanup: null, precondition: null });
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module, { adapters: [moved] }))), 'candidate_stale');
  assert.deepEqual(await controller.read(), [], 'nothing was created');
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module))), 'consent_unknown', 'the spent token cannot be replayed');
});

test('missing approval is consent_required, a wrong usage kind is invalid_input, and macOS is unsupported', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const request = await approvedRequest(tokens, home);
  const { approval, ...withoutApproval } = request;
  assert.equal(await codeOf(openAttachedRoute(withoutApproval, depsFor(tokens, controller.module))), 'consent_required');
  assert.equal(await codeOf(openAttachedRoute({ ...request, usage: { kind: 'session', lifetimeMs: 1000 } }, depsFor(tokens, controller.module))), 'invalid_input');
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module, { platform: 'win32' }))), 'unsupported');
  assert.deepEqual(await controller.read(), []);
});

test('a failed create reports setup_required and retains unconfirmed recovery authority until fixture teardown', async t => {
  const home = await attachedScratch(t), tokens = tokenStubs(), dir = await scratch(t), module = join(dir, 'failing.mjs');
  await writeFile(module, `import { stubAdapter } from ${JSON.stringify(helperUrl)};
export default async function () { const adapter = stubAdapter('stub-a'); adapter.create = async () => { throw Object.assign(new Error('no auth'), { code: 'setup_required' }); };
  return { adapters: [adapter], effectContext: () => ({}), validation: 'none', readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } }; }
`);
  const failure = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, module)).then(() => null, error => error);
  assert.equal(failure?.code, 'setup_required');
  assert.equal(failure.route.cleanup.state, 'unconfirmed');
  assert.equal(failure.route.published, null);
  const root = join(home, 'attached');
  const ids = (await readdir(root)).filter(id => /^att_[0-9a-f]{16}$/.test(id));
  assert.equal(ids.length, 1);
  const control = JSON.parse(await readFile(join(root, ids[0], 'control.json'), 'utf8'));
  assert.ok(Number.isSafeInteger(control.pid) && control.pid > 0);
  assert.equal(typeof control.startIdentity, 'string');
  assert.ok(control.startIdentity);
  assert.equal(await processIdentity(control.pid), control.startIdentity,
    'unconfirmed creation retains the authenticated controller, not confirmed provider absence');
});

test('red: a controller that never starts is stopped when the open times out, so no controller outlives a failed start', async t => {
  const home = await attachedScratch(t), tokens = tokenStubs(), dir = await scratch(t), module = join(dir, 'hanging.mjs');
  await writeFile(module, `export default () => new Promise(() => { setInterval(() => {}, 1000); });\n`);
  const failure = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, module, { startTimeoutMs: 1500 })).then(() => null, error => error);
  assert.equal(failure?.code, 'provider_unavailable');
  assert.ok(['stopped', 'killed'].includes(failure.controllerCleanup?.state), JSON.stringify(failure.controllerCleanup && { state: failure.controllerCleanup.state }));
  // A killed child of this test process can stay a zombie until Node reaps it, so ask the identity function, not kill(0).
  assert.equal(await processIdentity(failure.controllerCleanup.pid), null);
});

test('openSessionRoute redeems the grant, takes the adapter from it, and runs the generic session controller', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const q = query({ home, usage: { kind: 'session', lifetimeMs: 60_000 } });
  const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-a'), grant: grantFor('stub-a', q) });
  const request = { ...q, adapterId: 'ignored-adapter', approval: { candidateToken: token, disclosureRevision: 'disc-stub-a' }, wait: 'verified' };
  const deps = depsFor(tokens, controller.module, { adapters: [stubAdapter('stub-b'), stubAdapter('stub-a')] });
  const view = await openSessionRoute(request, deps);
  assertShape('RouteView', view);
  assert.deepEqual(await controller.read(), ['created'], 'the adapter named by the grant, not the request, created the route');
  assert.equal(view.handle.kind, 'session');
  assert.match(view.handle.id, /^port-8799:[A-Za-z0-9_-]+$/);
  assert.equal(view.state, 'usable');
  assert.equal(await codeOf(openSessionRoute(request, depsFor(tokens, controller.module))), 'consent_unknown', 'the spent token cannot be replayed');
  const closed = await closeAttachedRoute({ home, handle: view.handle, mode: 'remove' });
  assert.equal(closed.state, 'released');
  assert.deepEqual(await controller.read(), ['created', 'removed']);
});

test('URL targets ending in a port remain accepted for session and attached usage', async t => {
  const home = await attachedScratch(t), controller = await controllerFixture(t);
  for (const kind of ['session', 'attached']) {
    const tokens = tokenStubs();
    const q = query({ home, target: 'http://127.0.0.1:8799', usage: kind === 'session' ? { kind, lifetimeMs: 60_000 } : { kind } });
    const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-a'), grant: grantFor('stub-a', q) });
    const request = { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-a' }, wait: 'verified' };
    const view = await (kind === 'session' ? openSessionRoute : openAttachedRoute)(request, depsFor(tokens, controller.module));
    assert.equal(view.handle.kind, kind);
    if (kind === 'session') assert.match(view.handle.id, /^port-8799:/);
    await closeAttachedRoute({ home, handle: view.handle, mode: 'remove' });
  }
});

for (const kind of ['attached', 'session']) test(`stale executable registry refuses ${kind} before reservation`, async t => {
  const home = await attachedScratch(t), id = `recheck-${kind}`;
  const registry = await fakeRegistry({ id, kinds: [kind], reach: 'this-device', transport: 'tcp', proofProtocol: 'echo' });
  t.after(() => registry.cleanup());
  const options = { manifest: registry.manifest, root: registry.root, readContext };
  const api = createRouteApi(options);
  const q = query({ home, owner: 'registry-witness', operationId: 'registry-witness',
    usage: kind === 'session' ? { kind, lifetimeMs: 60_000 } : { kind }, target: '127.0.0.1:8799',
    requirements: { reach: 'this-device', transport: 'tcp', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const approve = async sdk => {
    const candidate = (await sdk.catalogRoutes(q)).candidates.find(item => item.candidateToken);
    assert.ok(candidate?.candidateToken, 'fixture provides an approvable candidate');
    return { ...q, wait: 'verified', approval: { kind: 'route', candidateToken: candidate.candidateToken,
      disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest } };
  };
  const original = await approve(api);
  const provider = join(registry.root, 'providers', id);
  const readEvents = () => readFile(join(provider, 'events.jsonl'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const before = await readEvents();
  await appendFile(join(provider, 'index.mjs'), '\n// Change executable registry bytes without changing behavior.\n');
  await assert.rejects(api.expose(original), { code: 'artifact_integrity_failed' });
  await assert.rejects(access(join(home, 'operations')), { code: 'ENOENT' });
  assert.equal(await readEvents(), before, 'preallocation refusal must have no provider effects');
  const fresh = createRouteApi(options);
  const view = await fresh.expose(await approve(fresh));
  try {
    assert.equal(view.handle.kind, kind);
    assert.equal(view.operationId, q.operationId);
  } finally {
    const closed = await fresh.closeRoute({ home, owner: q.owner, handle: view.handle, mode: 'remove' });
    assert.equal(closed.cleanup.state, 'confirmed');
  }
});
