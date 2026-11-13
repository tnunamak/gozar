// The Funnel session against a fake `tailscale`: the real core, the real daemon and the real recipe.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LISTENERS_TAKEN, openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';
import { dnsName, installFakeTailscale, persistentRule } from './fake-tailscale.mjs';
import { query, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const funnel = await loadDefinition(root, 'tailscale-funnel');
const probeExecutor = { vantages: ['public'], async verify(request) {
  const now = Math.floor(performance.timeOrigin + performance.now());
  return { probeReceipt: { ...request.authorization, origin: request.origin, vantage: 'public', remote: true, observedAtMs: now, expiresAtMs: now + 30000, tls: true, instanceMatched: true, sse: true } };
} };

/** A home with the fake `tailscale` first on PATH; `bootstrap` writes one session directory the daemon can serve. */
async function world(t, tailscale = {}) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-funnel-'));
  const fake = await installFakeTailscale(home, tailscale);
  const savedPath = process.env.PATH;
  process.env.PATH = `${fake.bin}:${savedPath}`;
  const daemons = [];
  t.after(async () => { for (const daemon of daemons) await daemon.terminate().catch(() => {}); process.env.PATH = savedPath; await rm(home, { recursive: true, force: true }); });
  const bootstrap = async port => {
    const directory = join(home, `port-${port}`); await mkdir(directory, { recursive: true });
    await atomicWrite(join(directory, 'bootstrap.json'), { adapters: [structuredClone(funnel)], adapterId: funnel.id, targetPort: port,
      requirements: { clientReach: 'internet', httpsRequired: true, sse: true }, consent: true, approveOrigin: true });
    return directory;
  };
  const start = async port => { const daemon = await serve(await bootstrap(port), { probeExecutor }); daemons.push(daemon); return daemon; };
  return { home, fake, start };
}

const taken = { TCP: { 8443: { HTTPS: true }, 10000: { HTTPS: true } }, Web: {}, AllowFunnel: {} };

test('red: a session starts on 10000 when a durable route holds 8443, and never asks for 8443', async t => {
  const w = await world(t, { config: persistentRule(8443) });
  const daemon = await w.start(18901);
  assert.equal(daemon.controller.state.phase, 'published-ready');
  assert.equal(daemon.controller.state.published, 'https://device.example-tailnet.ts.net:10000');
  assert.deepEqual(await w.fake.funnelPorts(), [10000]);
  assert.equal(daemon.controller.state.plans[0]?.origin ?? daemon.controller.state.published, 'https://device.example-tailnet.ts.net:10000');
});

test('red: a second session starts on 10000 while a first session in the same home still holds 8443', async t => {
  const w = await world(t);
  const first = await w.start(18906);
  assert.equal(first.controller.state.published, 'https://device.example-tailnet.ts.net:8443');
  const second = await w.start(18907);
  assert.equal(second.controller.state.phase, 'published-ready', JSON.stringify(second.controller.state.limitations));
  assert.equal(second.controller.state.published, 'https://device.example-tailnet.ts.net:10000');
  assert.deepEqual(await w.fake.funnelPorts(), [8443, 10000], 'the first session kept 8443; nothing asked for it twice');
});

test('a session still takes 8443 when it is free', async t => {
  const w = await world(t, { config: persistentRule(10000) });
  const daemon = await w.start(18901);
  assert.equal(daemon.controller.state.published, 'https://device.example-tailnet.ts.net:8443');
  assert.deepEqual(await w.fake.funnelPorts(), [8443]);
});

test('red: when every candidate is taken the session stops before it changes anything', async t => {
  const w = await world(t, { config: taken });
  const daemon = await w.start(18902);
  assert.equal(daemon.controller.state.phase, 'failed');
  assert.ok(daemon.controller.state.limitations.includes(LISTENERS_TAKEN), JSON.stringify(daemon.controller.state.limitations));
  assert.deepEqual(await w.fake.funnelPorts(), [], 'no funnel was started, so no port was touched');
  assert.deepEqual(Object.keys((await w.fake.read()).foreground), []);
});

/**
 * Opens a session through the real API on an adapter named like the real one, handing it the failed core reply of a session on
 * another port, so that the API's cleanup has no controller of its own to stop (the daemon here lives in this process).
 */
async function openFailed(t, w, deps = {}) {
  const daemon = await w.start(18903), tokens = tokenStubs();
  const q = query({ home: w.home, target: '127.0.0.1:18902', usage: { kind: 'session', lifetimeMs: 60_000 } });
  const { token } = await tokens.issue({ home: w.home, binding: tokens.consentBinding(q, w.home, 'disc-tailscale-funnel'), grant: { adapterId: 'tailscale-funnel', planDigest: `plan-tailscale-funnel-${q.target}`, observedResource: 'res-tailscale-funnel' } });
  const request = { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-tailscale-funnel' }, wait: 'verified' };
  return openSessionRoute(request, { adapters: [stubAdapter('tailscale-funnel')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux',
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) },
    startSession: async () => ({ snapshot: daemon.controller.state }), stopSession: async () => ({ snapshot: { phase: 'stopped' } }), pollMs: 20, ...deps }).then(() => null, error => error);
}

test('red: a session whose ports another Gozar route holds fails as route_conflict and names the route and how to stop it', async t => {
  const w = await world(t, { config: taken });
  const error = await openFailed(t, w, { portHolders: async () => [{ port: 8443, routeId: 'example-app-main' }] });
  assert.equal(error?.code, 'route_conflict');
  assert.match(error.message, /8443 and 10000/);
  assert.match(error.message, /route example-app-main/);
  assert.match(JSON.stringify(error.nextAction), /example-app-main/);
});

test('red: a session whose ports only foreign listeners hold fails as requirements_unsatisfied with a next action', async t => {
  const w = await world(t, { config: taken });
  const error = await openFailed(t, w);
  assert.equal(error?.code, 'requirements_unsatisfied');
  assert.match(error.message, /8443 and 10000/);
  assert.match(JSON.stringify(error.nextAction), /8443/);
});

// A tailscaled that tears a foreground session down a moment after its watcher exits: `serve status` still shows the entry.
const lingering = { config: persistentRule(10000), lingerMs: 1500 };

test('red: an entry that lingers briefly after the watcher exits does not turn stop into cleanup debt or fail the next start', async t => {
  const w = await world(t, lingering);
  const first = await w.start(18904);
  const stopped = await first.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot.limitations));
  assert.deepEqual(stopped.localCleanupFailures ?? [], []);
  const second = await w.start(18905);
  assert.equal(second.controller.state.phase, 'published-ready', JSON.stringify(second.controller.state.limitations));
  assert.equal(second.controller.state.published, 'https://device.example-tailnet.ts.net:8443');
});

test('the wait is bounded: an entry that outlives it is still reported as cleanup debt', async t => {
  const w = await world(t, lingering);
  const first = await w.start(18904);
  first.controller.driver.absenceSettleMs = 200;
  const stopped = await first.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'cleanup-pending');
  assert.match(stopped.localCleanupFailures[0].detail, /listener 8443 may still be configured/);
});

test('a provider read that fails during stop is not re-read in a loop', async t => {
  const w = await world(t);
  const first = await w.start(18904);
  await w.fake.update(state => { state.failServeStatus = true; });
  const before = (await w.fake.read()).calls.length;
  await first.controller.shutdown();
  const calls = (await w.fake.read()).calls.slice(before).filter(call => call[0] === 'serve');
  assert.ok(calls.length >= 1 && calls.length <= 2, `serve status was read ${calls.length} times: only an entry that is still shown is re-read`);
});

test('other apps\' Funnel rules on 443 and 9443 and a tailnet-only rule on 8443 survive a session start and stop byte-identical', async t => {
  const rule = (port, funnel) => ({ TCP: { [port]: { HTTPS: true } }, Web: { [`${dnsName}:${port}`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${9000 + port % 1000}` } } } },
    AllowFunnel: funnel ? { [`${dnsName}:${port}`]: true } : {} });
  const parts = [rule(443, true), rule(9443, true), rule(8443, false)];
  const config = Object.fromEntries(['TCP', 'Web', 'AllowFunnel'].map(key => [key, Object.assign({}, ...parts.map(part => part[key]))]));
  const w = await world(t, { config });
  const before = structuredClone((await w.fake.read()).config);
  const daemon = await w.start(18908);
  assert.equal(daemon.controller.state.published, `https://${dnsName}:10000`, JSON.stringify(daemon.controller.state.limitations));
  const stopped = await daemon.controller.shutdown();
  assert.equal(stopped.snapshot.phase, 'stopped', JSON.stringify(stopped.snapshot.limitations));
  const after = await w.fake.read();
  assert.deepEqual(after.config, before);
  const writes = after.calls.filter(call => call[0] !== 'status' && !(call[0] === 'serve' && call[1] === 'status'));
  assert.deepEqual(writes.map(call => call.slice(0, 4)), [['funnel', '--yes', '--https=10000', '--set-path=/']], 'one narrow funnel call; no reset, off or other port');
});
