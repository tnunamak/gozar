import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { attachedStatus, closeAttachedRoute, openAttachedRoute, openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';
import { routeStatus, closeRoute } from '../../packages/gozar-node/route-view.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { assertShape, codeOf, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

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
  await writeFile(module, `import { appendFileSync } from 'node:fs';
import { stubAdapter } from ${JSON.stringify(helperUrl)};
const mark = event => appendFileSync(${JSON.stringify(marks)}, event + '\\n');
export default async function () {
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
/** Always kill controller processes a test started, by the pid each wrote. */
function reapControllers(t, home) {
  t.after(async () => {
    const root = join(home, 'attached');
    for (const id of (await readdir(root).catch(() => [])).filter(name => name.startsWith('att_'))) {
      const identity = JSON.parse(await readFile(join(root, id, 'control.json'), 'utf8').catch(() => 'null') ?? 'null');
      if (identity?.pid && alive(identity.pid)) { try { process.kill(identity.pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  });
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
  const home = await scratch(t), controller = await controllerFixture(t);
  reapControllers(t, home);
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
  const home = await scratch(t), controller = await controllerFixture(t);
  reapControllers(t, home);
  const owner = await ownerScript(t, home, controller.module, { exitAfterOpen: true });
  assert.equal(owner.view.state, 'usable');
  assert.equal((await owner.exited).code, 0);
  assert.ok(await waitFor(async () => (await controller.read()).includes('removed'), EXPIRY + 5000));
});

test('open, status, close: the lease holds beyond the expiry, close removes at once and the handle is then released', async t => {
  const home = await scratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  reapControllers(t, home);
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
  const home = await scratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  reapControllers(t, home);
  const view = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, controller.module));
  assert.equal(await codeOf(attachedStatus({ home, handle: { ...view.handle, generation: view.handle.generation + 1 } })), 'route_conflict');
  assert.equal(await codeOf(attachedStatus({ home, handle: { kind: 'attached', id: 'att_0000000000000000', generation: 1 } })), 'route_not_found');
  assert.equal(await codeOf(closeAttachedRoute({ home, handle: { kind: 'attached', id: '../escape', generation: 1 } })), 'route_not_found');
  await closeAttachedRoute({ home, handle: view.handle });
});

test('red: a token is single use, and a provider that moved after approval is candidate_stale and starts nothing', async t => {
  const home = await scratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  reapControllers(t, home);
  const request = await approvedRequest(tokens, home);
  const moved = stubAdapter('stub-a'); moved.plan = async (ctx, ask) => ({ digest: 'plan-changed', origin: null, resourceKey: 'res-stub-a', effects: [], readback: null, cleanup: null, precondition: null });
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module, { adapters: [moved] }))), 'candidate_stale');
  assert.deepEqual(await controller.read(), [], 'nothing was created');
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module))), 'consent_unknown', 'the spent token cannot be replayed');
});

test('missing approval is consent_required, a wrong usage kind is invalid_input, and macOS is unsupported', async t => {
  const home = await scratch(t), controller = await controllerFixture(t), tokens = tokenStubs();
  const request = await approvedRequest(tokens, home);
  const { approval, ...withoutApproval } = request;
  assert.equal(await codeOf(openAttachedRoute(withoutApproval, depsFor(tokens, controller.module))), 'consent_required');
  assert.equal(await codeOf(openAttachedRoute({ ...request, usage: { kind: 'session', lifetimeMs: 1000 } }, depsFor(tokens, controller.module))), 'invalid_input');
  assert.equal(await codeOf(openAttachedRoute(request, depsFor(tokens, controller.module, { platform: 'win32' }))), 'unsupported');
  assert.deepEqual(await controller.read(), []);
});

test('a controller that cannot create reports the typed failure and leaves nothing running', async t => {
  const home = await scratch(t), tokens = tokenStubs(), dir = await scratch(t), module = join(dir, 'failing.mjs');
  reapControllers(t, home);
  await writeFile(module, `import { stubAdapter } from ${JSON.stringify(helperUrl)};
export default async function () { const adapter = stubAdapter('stub-a'); adapter.create = async () => { throw Object.assign(new Error('no auth'), { code: 'setup_required' }); };
  return { adapters: [adapter], effectContext: () => ({}), validation: 'none', readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } }; }
`);
  assert.equal(await codeOf(openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, module))), 'setup_required');
});

test('red: a controller that never starts is stopped when the open times out, so no controller outlives a failed start', async t => {
  const home = await scratch(t), tokens = tokenStubs(), dir = await scratch(t), module = join(dir, 'hanging.mjs');
  reapControllers(t, home);
  await writeFile(module, `export default () => new Promise(() => { setInterval(() => {}, 1000); });\n`);
  const failure = await openAttachedRoute(await approvedRequest(tokens, home), depsFor(tokens, module, { startTimeoutMs: 1500 })).then(() => null, error => error);
  t.after(() => { if (failure?.controllerCleanup?.pid && alive(failure.controllerCleanup.pid)) process.kill(failure.controllerCleanup.pid, 'SIGKILL'); });
  assert.equal(failure?.code, 'provider_unavailable');
  assert.ok(['stopped', 'killed'].includes(failure.controllerCleanup?.state), JSON.stringify(failure.controllerCleanup && { state: failure.controllerCleanup.state }));
  // A killed child of this test process can stay a zombie until Node reaps it, so ask the identity function, not kill(0).
  assert.equal(await processIdentity(failure.controllerCleanup.pid), null);
});

test('openSessionRoute redeems the grant, takes the adapter from it, and projects the session machinery reply', async t => {
  const home = await scratch(t), tokens = tokenStubs(), started = [];
  const q = query({ home, usage: { kind: 'session', lifetimeMs: 60_000 } });
  const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-b'), grant: grantFor('stub-b', q) });
  const request = { ...q, adapterId: 'ignored-adapter', approval: { candidateToken: token, disclosureRevision: 'disc-stub-b' }, wait: 'allocated' };
  const startSession = async options => { started.push(options); return { snapshot: { sessionId: 'sess1', phase: 'candidate-ready', candidate: 'https://example.invalid', expiresAtMs: Date.now() + 60_000 } }; };
  const view = await openSessionRoute(request, { adapters: [stubAdapter('stub-a'), stubAdapter('stub-b')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext, startSession });
  assertShape('RouteView', view);
  assert.equal(started.length, 1);
  assert.equal(started[0].adapterId, 'stub-b');
  assert.equal(started[0].port, 8799);
  assert.deepEqual([view.handle.kind, view.handle.id], ['session', 'port-8799:sess1']);
  assert.equal(await codeOf(openSessionRoute(request, { adapters: [stubAdapter('stub-b')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext, startSession })), 'consent_unknown');
});
