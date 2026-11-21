// Owner loss: when the lease expires, the controller must stop forwarding, try the one owned removal, record what
// is still owed and exit. Reference-release debt may never keep a live forwarder (or the controller) alive.
// Deterministic: fake adapter, fake clock, no provider, no child process.
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { controlAttached, runAttachedController } from '../../packages/gozar-node/attached-route.mjs';
import { properties, stubAdapter } from './route-schema-check.mjs';

const EXPIRY_MS = 100, TEARDOWN_MS = 300, EXIT_BOUND_MS = 5_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const accepts = port => new Promise(resolve => {
  const socket = net.createConnection({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
async function until(read, accept, ms = EXIT_BOUND_MS) {
  const end = Date.now() + ms;
  for (;;) { const value = await read(); if (accept(value)) return value; assert.ok(Date.now() < end, 'expected observation did not arrive: ' + JSON.stringify(value)); await sleep(10); }
}
async function listener(t) {
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.end('app'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

// One owner-loss scenario. `forwarding` is how the controller fronts the app: its own gate, or the adapter's proof session.
async function scenario(t, { forwarding, removal, hangCreate = false, closeFailure = null, journalFailure = false, managedReference = true, lateProof = false }) {
  await mkdir(join(homedir(), '.tmp'), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(homedir(), '.tmp', 'gz-ownerloss-'));
  const home = join(root, 'h'), directory = join(home, 'attached', 'att_0123456789abcdef');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const appPort = await listener(t), foreignPort = await listener(t);
  const clock = { t: Date.parse('2026-11-18T12:00:00Z') };
  const iso = () => new Date(clock.t).toISOString();
  const seen = { removes: [], gatePort: null, closes: 0, forwardingOpenAtRemove: null, release: null };
  let release;
  const hang = new Promise(resolve => { release = resolve; });
  const adapter = stubAdapter('fake-owner-loss', { caps: properties() });
  adapter.mode = removal;
  adapter.create = async (ctx, plan) => {
    seen.gatePort ??= forwarding === 'gate' ? Number(plan.effects[0].target.split(':').pop()) : null;
    seen.creates = (seen.creates ?? 0) + 1;
    if (hangCreate) await hang;
    return { schemaVersion: 1, adapterId: adapter.id, resourceKey: plan.resourceKey, generation: ctx.generation, identity: {}, readback: null, origin: 'https://example.invalid' };
  };
  adapter.verify = async () => ({ status: 'verified', checkedAt: iso() });
  if (forwarding === 'proof-session') {
    const proofServer = net.createServer(socket => { socket.on('error', () => {}); socket.end('proof'); });
    await new Promise(resolve => proofServer.listen(0, '127.0.0.1', resolve));
    seen.gatePort = proofServer.address().port;
    t.after(() => new Promise(resolve => { if (!proofServer.listening) return resolve(); proofServer.close(resolve); }));
    adapter.prepareProof = async () => { seen.prepares = (seen.prepares ?? 0) + 1; if(lateProof)await hang; return ({
      target: `127.0.0.1:${seen.gatePort}`,
      verify: async ({ origin, attempt }) => ({ attemptId: attempt.id, endpoint: origin, status: 'verified', checkedAt: iso(), vantage: 'this-device', checks: ['nonce'], validUntil: new Date(clock.t + 15_000).toISOString(), facts: [] }),
      close: () => {
        seen.closes++;
        if (closeFailure === 'throw') throw new Error('synchronous close refusal');
        if (closeFailure === 'reject') return Promise.reject(new Error('asynchronous close refusal'));
        if (closeFailure === 'hang') return new Promise(() => {});
        return new Promise(resolve => proofServer.close(resolve));
      },
    }); };
  }
  adapter.remove = async (_ctx, receipt) => {
    seen.removes.push(receipt);
    seen.forwardingOpenAtRemove = seen.gatePort === null ? null : await accepts(seen.gatePort);
    if (adapter.mode === 'hang') await hang;
    if (adapter.mode === 'throw') throw new Error('provider refused');
    if (adapter.mode === 'debt') return { removed: false, debt: { message: 'provider still holds the resource' } };
    if (journalFailure) await chmod(directory, 0o500);
    return { removed: true, debt: null };
  };
  const target = `127.0.0.1:${appPort}`;
  const bootstrap = { schemaVersion: 1, id: 'att_0123456789abcdef', home, platform: 'linux', adapterId: adapter.id,
    request: { target }, plan: { digest: 'plan', origin: null, resourceKey: `res-${adapter.id}`, effects: [{ target }], readback: null, cleanup: null, precondition: null },
    operationId: null, ...(managedReference ? { owner: 'fixture-owner' } : {}), // managed fixtures retain reference debt
    leaseExpiryMs: EXPIRY_MS };
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify(bootstrap));
  const handle = { kind: 'attached', id: bootstrap.id, generation: 1 };
  const runtime = { adapters: [adapter], effectContext: () => ({}), readContext: { now: () => clock.t, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) },
    now: () => clock.t, ownerLossTeardownMs: TEARDOWN_MS, ownerLossLocalCloseMs: 30 };
  let settled = false;
  const run = runAttachedController(directory, runtime).finally(() => { settled = true; });
  run.catch(() => {});
  const cleanup = async () => { // only a failing run gets here with a live controller: make it finishable
    if (settled) return;
    adapter.mode = 'ok'; closeFailure = null; release();
    await controlAttached(directory, { type: 'close', handleId: handle.id, generation: 1 }, 2_000).catch(() => {});
    await controlAttached(directory, { type: 'finalize-removal', handleKind: 'attached', handleId: handle.id, generation: 1 }, 2_000).catch(() => {});
    await Promise.race([run.catch(() => {}), sleep(2_000)]);
  };
  // Remove the home only after the fixture listeners and controller have retired.
  // A failed removal must not skip their teardown and leave the test process alive.
  t.after(async () => {
    await cleanup();
    await chmod(directory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  if (lateProof) await until(async () => seen.prepares, count => count === 1);
  else if (hangCreate) await until(async () => seen.creates, count => count === 1);
  else await until(async () => (await json(join(directory, 'state.json')).catch(() => null))?.phase, phase => phase === 'usable');
  assert.equal(await accepts(seen.gatePort), true, 'forwarding is open while the owner holds the lease');
  const foreignBefore = await accepts(foreignPort);
  return { adapter, clock, seen, run, directory, handle, bootstrap, foreignPort, foreignBefore, release, isSettled: () => settled,
    expire: () => { clock.t += 60_000; } };
}
const exitBounded = run => Promise.race([run, sleep(EXIT_BOUND_MS).then(() => { throw new Error('controller outlived its owner past the teardown bound'); })]);

for (const forwarding of ['gate', 'proof-session']) {
  test(`owner loss (${forwarding}): reference debt after removal still stops forwarding and exits, journal keeps the debt`, async t => {
    const s = await scenario(t, { forwarding, removal: 'ok' });
    s.expire();
    await exitBounded(s.run);
    assert.equal(s.seen.removes.length, 1, 'exactly one owned removal');
    assert.equal(s.seen.removes[0].resourceKey, s.bootstrap.plan.resourceKey);
    assert.equal(s.seen.forwardingOpenAtRemove, false, 'forwarding was already closed when removal ran');
    assert.equal(await accepts(s.seen.gatePort), false);
    if (forwarding === 'proof-session') assert.equal(s.seen.closes, 1);
    const state = await json(join(s.directory, 'state.json'));
    assert.equal(state.lastView.cleanup.state, 'unconfirmed', 'never confirmed while the reference remains');
    assert.notEqual(state.phase, 'released');
    assert.deepEqual(state.resourceRemoval.handle, s.handle);
    assert.equal(state.resourceRemoval.providerId, s.adapter.id);
    assert.equal(state.resourceRemoval.owner, 'fixture-owner');
    assert.deepEqual(state.handle, s.handle);
    assert.ok(state.receipt, 'receipt retained');
    assert.ok((await stat(join(s.directory, 'bootstrap.json'))).isFile(), 'bootstrap identity retained');
    await sleep(150);
    assert.equal(await accepts(s.seen.gatePort), false, 'no later forwarding revival');
    assert.equal(s.seen.removes.length, 1);
    assert.equal(s.foreignBefore && await accepts(s.foreignPort), true, 'an unrelated listener is untouched');
  });
}

for (const removal of ['debt', 'throw']) {
  test(`owner loss: removal ${removal} stops forwarding, is attempted once and stays recorded as unresolved`, async t => {
    const s = await scenario(t, { forwarding: 'gate', removal });
    s.expire();
    await exitBounded(s.run);
    assert.equal(s.seen.removes.length, 1);
    assert.equal(s.seen.forwardingOpenAtRemove, false);
    assert.equal(await accepts(s.seen.gatePort), false);
    const state = await json(join(s.directory, 'state.json'));
    assert.equal(state.lastView.cleanup.state, 'unconfirmed');
    assert.equal(state.resourceRemoval, null, 'no removal milestone is claimed for a resource that was not removed');
    assert.ok(state.receipt, 'the exact owned receipt stays journaled for a later owner');
    assert.deepEqual(state.handle, s.handle);
  });
}

test('owner loss: a removal that never returns is bounded; a racing close does not remove twice', async t => {
  const s = await scenario(t, { forwarding: 'gate', removal: 'hang' });
  const expiredAt = Date.now();
  s.expire();
  await until(async () => s.seen.removes.length, count => count === 1);
  const racing = controlAttached(s.directory, { type: 'close', handleId: s.handle.id, generation: 1 }, 2_000).catch(() => null);
  await exitBounded(s.run);
  await racing;
  assert.ok(Date.now() - expiredAt < EXIT_BOUND_MS);
  assert.equal(s.seen.removes.length, 1, 'racing release paths share one removal attempt');
  assert.equal(s.seen.forwardingOpenAtRemove, false);
  assert.equal(await accepts(s.seen.gatePort), false);
  const state = await json(join(s.directory, 'state.json'));
  assert.equal(state.lastView.cleanup.state, 'unconfirmed');
  assert.notEqual(state.phase, 'released');
  assert.ok(state.receipt);
  assert.deepEqual(state.handle, s.handle);
  s.release();
});

test('owner loss while the provider create never returns: forwarding closes, nothing is removed by guess, the handle stays journaled', async t => {
  const s = await scenario(t, { forwarding: 'gate', removal: 'ok', hangCreate: true });
  s.expire();
  await exitBounded(s.run);
  assert.equal(await accepts(s.seen.gatePort), false);
  assert.equal(s.seen.removes.length, 0, 'no receipt, so no removal is invented');
  const state = await json(join(s.directory, 'state.json'));
  assert.equal(state.lastView.cleanup.state, 'unconfirmed');
  assert.match(state.lastView.cleanup.message, /Startup outcome remains unknown/);
  assert.equal(state.receipt, null);
  assert.deepEqual(state.handle, s.handle);
  // This fixture models a create that never returns. Resolving it after controller
  // exit would start a late journal write concurrently with temporary-home removal.
});

for (const closeFailure of ['throw', 'reject', 'hang']) {
  test(`owner loss: proof-session close ${closeFailure} cannot skip removal or controller exit`, async t => {
    const s = await scenario(t, { forwarding: 'proof-session', removal: 'ok', closeFailure });
    s.expire();
    const view = await exitBounded(s.run);
    assert.equal(s.seen.closes, 1, 'local close attempted exactly once');
    assert.equal(s.seen.removes.length, 1, 'failed local close cannot skip owned removal');
    assert.equal(view.cleanup.state, 'unconfirmed');
    assert.match(view.cleanup.message, /local forwarding/i);
    const state = await json(join(s.directory, 'state.json'));
    assert.equal(state.lastView.cleanup.state, 'unconfirmed');
    assert.match(state.lastView.cleanup.message, /local forwarding/i);
    assert.deepEqual(state.resourceRemoval.handle, s.handle);
    assert.ok(state.receipt);
    assert.equal(await accepts(s.foreignPort), true);
  });
}

test('owner loss: a failed journal write cannot prevent exit or erase the previous recovery record', async t => {
  const s = await scenario(t, { forwarding: 'gate', removal: 'ok', journalFailure: true });
  s.expire();
  const view = await exitBounded(s.run);
  assert.equal(view.cleanup.state, 'unconfirmed');
  assert.match(view.cleanup.message, /could not be journaled/);
  assert.equal(s.seen.removes.length, 1);
  assert.equal(await accepts(s.seen.gatePort), false);
  const state = await json(join(s.directory, 'state.json'));
  assert.ok(state.receipt, 'previous owned receipt remains readable');
  assert.deepEqual(state.handle, s.handle);
  assert.equal(state.resourceRemoval, null, 'a failed write did not persist a removal milestone');
});

test('detached controller exits normally after a synchronous proof close failure', async t => {
  const root = await mkdtemp(join(homedir(), '.tmp', 'gz-exit-'));
  const directory = join(root, 'h', 'attached', 'att_0123456789abcdef');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const module = join(root, 'runtime.mjs');
  await writeFile(module, `
    import net from 'node:net';
    import { properties, stubAdapter } from ${JSON.stringify(new URL('./route-schema-check.mjs', import.meta.url).href)};
    export default async () => {
      const adapter = stubAdapter('fake-owner-loss', { caps: properties() });
      adapter.prepareProof = async () => {
        const server = net.createServer(s => s.end('proof'));
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        console.log(JSON.stringify({ port: server.address().port }));
        return { target: '127.0.0.1:' + server.address().port,
          verify: async ({origin,attempt}) => ({attemptId:attempt.id,endpoint:origin,status:'verified',checkedAt:new Date().toISOString(),vantage:'this-device',checks:['nonce'],validUntil:new Date(Date.now()+15000).toISOString(),facts:[]}),
          close() { throw new Error('close refused'); } };
      };
      adapter.create = async (ctx,plan) => ({schemaVersion:1,adapterId:adapter.id,resourceKey:plan.resourceKey,generation:ctx.generation,identity:{},readback:null,origin:'https://example.invalid'});
      adapter.verify = async () => ({status:'verified',checkedAt:new Date().toISOString()});
      adapter.remove = async () => ({removed:true,debt:null});
      return { adapters:[adapter], effectContext:()=>({}), ownerLossTeardownMs:300,ownerLossLocalCloseMs:30,
        readContext:{now:Date.now,configuration:async()=>null,probe:async()=>({ok:true}),verifyChallenge:async()=>({status:'verified'})} };
    };
  `);
  const target = '127.0.0.1:18789';
  await writeFile(join(directory, 'bootstrap.json'), JSON.stringify({schemaVersion:1,id:'att_0123456789abcdef',home:join(root,'h'),platform:'linux',adapterId:'fake-owner-loss',request:{target},
    plan:{digest:'plan',origin:null,resourceKey:'res-fake-owner-loss',effects:[{target}],readback:null,cleanup:null,precondition:null},owner:'fixture-owner',leaseExpiryMs:100,controllerModule:module}));
  const child = spawn(process.execPath, [new URL('../../packages/gozar-node/attached-route.mjs', import.meta.url).pathname, '--controller', directory], {stdio:['ignore','pipe','pipe']});
  const exited = new Promise((resolve,reject) => { child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal})); });
  t.after(async () => { if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited; });
  let output='',errors='';
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const result = await exitBounded(exited);
  assert.deepEqual(result, {code:0,signal:null}, errors);
  const port = JSON.parse(output.trim()).port;
  assert.equal(await accepts(port), false, 'process-owned forwarding is gone after actual child exit');
  const state = await json(join(directory, 'state.json'));
  assert.equal(state.lastView.cleanup.state, 'unconfirmed');
  assert.match(state.lastView.cleanup.message, /local forwarding/i);
  assert.ok(state.receipt);
});

test('owner loss: late removal success cannot erase unconfirmed local forwarding', async t => {
  const s = await scenario(t, { forwarding: 'proof-session', removal: 'hang', closeFailure: 'throw', managedReference: false });
  s.expire();
  await until(async () => (await json(join(s.directory, 'state.json'))).lastView.cleanup.message,
    message => /local forwarding/i.test(message ?? ''));
  // On the old source this snapshot appeared only after the removal wait timed out.
  // Settle the same pending removal after local uncertainty has already been journaled.
  s.release();
  const view = await exitBounded(s.run);
  assert.equal(s.seen.removes.length, 1);
  assert.equal(view.cleanup.state, 'unconfirmed');
  assert.match(view.cleanup.message, /local forwarding/i);
  const state = await json(join(s.directory, 'state.json'));
  assert.equal(state.lastView.cleanup.state, 'unconfirmed');
  assert.equal(state.phase, 'uncertain');
  assert.match(state.lastView.cleanup.message, /local forwarding/i);
  assert.deepEqual(state.resourceRemoval.handle, s.handle, 'remote removal milestone remains separate');
});

test('owner loss: a late proof session records its failed close without inventing a removal', async t => {
  const s = await scenario(t, { forwarding: 'proof-session', removal: 'ok', closeFailure: 'throw', lateProof: true });
  s.expire();
  const initial = await exitBounded(s.run);
  assert.equal(initial.cleanup.state, 'unconfirmed');
  s.release();
  const state = await until(async () => json(join(s.directory, 'state.json')),
    state => /local forwarding/i.test(state.lastView.cleanup.message ?? ''));
  assert.equal(state.lastView.cleanup.state, 'unconfirmed');
  assert.equal(state.phase, 'uncertain');
  assert.equal(s.seen.closes, 1);
  assert.equal(s.seen.creates ?? 0, 0, 'owner-loss latch prevents the late session from allocating');
  assert.equal(s.seen.removes.length, 0, 'no receipt, so no resource removal is invented');
  assert.equal(state.receipt, null);
  assert.deepEqual(state.handle, s.handle);
});
