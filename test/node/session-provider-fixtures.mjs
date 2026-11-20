// Not a test file. One inert fixture world per recipe session provider, all through the public testing factory and its
// declared fixture effects: no account, credential, public tunnel or DNS. Each world records an ordered event log
// (`allocate`, `ack`, `proof`, `remove`), an app on a real loopback listener, and what the provider currently owns.
//
//   localhost-run, tunnl-gg   a real child process stands in for the ssh tunnel; its announce line names the origin
//   lan                       an interface inventory plus a process-runtime forwarder ledger
//   tailscale-funnel/private  the fake `tailscale` executable (fake-tailscale.mjs) run as a real child
//
// The acknowledging host is ExactAttemptHost wrapped so it records the announced origin and denies any other Host: the
// fixture "public" fetch is answered 404 unless the host has acknowledged the Host the request names.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createServiceVerifier } from '@tnunamak/gozar';
import { createTestingGozar } from '@tnunamak/gozar/testing';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { testingFetch } from '../../packages/gozar-node/testing-network.mjs';
import { verification } from '../../packages/gozar-node/service-state.mjs';
import { scratch, query } from './route-schema-check.mjs';
import { ExactAttemptHost } from './consumer-host-fixture.mjs';
import { installFakeTailscale } from './fake-tailscale.mjs';

const run = promisify(execFile);
// Gozar removes an owned process by signalling its recorded pid and treats a zombie as gone. Node learns of the exit one event later, so a fixture
// that only watched `exitCode` could still call a just-removed child present. This reads the same fact Gozar does.
const liveChild = child => {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  try { const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'; }
  catch { return false; }
};

export const PROVIDERS = ['localhost-run', 'tunnl-gg', 'lan', 'tailscale-funnel', 'tailscale-private'];
const REQUIREMENTS = {
  'localhost-run': { reach: 'internet', transport: 'https' }, 'tunnl-gg': { reach: 'internet', transport: 'https' }, lan: { reach: 'lan', transport: 'any' },
  'tailscale-funnel': { reach: 'internet', transport: 'https' }, 'tailscale-private': { reach: 'tailnet', transport: 'https' },
};
const SYNTHETIC = '192.0.2.10';
const OPENSSH = { stdout: 'OpenSSH_9.6p1', stderr: '', exitCode: 0 };

const forward = (target, url, headers) => new Promise((resolve, reject) => {
  const [host, port] = target.split(':');
  http.get({ host, port: Number(port), path: url.pathname + url.search, headers }, response => {
    // Chunk timing is part of the answer: the SSE proof needs an unbuffered, timed stream.
    const chunks = []; let before = Date.now();
    response.on('data', chunk => { const now = Date.now(); chunks.push({ data: Buffer.from(chunk).toString('base64'), delayMs: now - before }); before = now; });
    response.once('error', reject);
    response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, chunks }));
  }).once('error', reject);
});
const waitFirstOutput = child => new Promise(resolve => { const timer = setTimeout(() => resolve(''), 4000); child.stdout.once('data', chunk => { clearTimeout(timer); resolve(String(chunk)); }); });

/**
 * `options.acknowledge`  how the host answers: undefined = the exact-attempt host, false = no handler declared, or a function (request, host) -> reply.
 * `options.tailscale`    the fake tailscale's starting state ({ config, lingerMs, refuseFunnel }) for the two tailscale providers.
 * `options.originAckTimeoutMs`  how long the host may hold the acknowledgment before the start fails closed.
 * `options.routeDeps`    extra route-API dependencies (a `publicationCut`, wrapped `embeddingServices`): the world is then built on the route API directly
 *                        with the same fixture effects, not through the public testing factory, so a test can cut or observe the owner process.
 * `options.hold`         an async hook run when the library's proof request arrives (after the acknowledgment).
 */
export async function providerWorld(t, providerId, { acknowledge, hold, tailscale = {}, lifetimeMs = 60_000, originAckTimeoutMs, routeDeps, operationId = `unified-${providerId}-${randomUUID().slice(0, 8)}` } = {}) {
  const closing = {}; t.after(async () => { await closing.harness?.close(); for (const child of closing.children ?? []) child.kill(); });
  closing.children = [];
  const home = await scratch(t), owner = 'consumer-owner', events = [], owned = new Map();
  const verifier = createServiceVerifier();
  const app = http.createServer((req, res) => { if (!verifier(req, res)) res.end('app'); });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve); }));
  const target = `127.0.0.1:${app.address().port}`;
  const host = new ExactAttemptHost({ home, owner });
  const acknowledgeOrigin = acknowledge === false ? undefined : async request => {
    events.push({ at: 'ack', origin: request.origin, handle: request.handle, attemptId: request.attemptId });
    return acknowledge ? acknowledge(request, host) : host.acknowledgeOrigin(request);
  };

  // What the provider forwards to is recorded by the provider fixture itself; the "public" fetch may reach only that, and only for an acknowledged Host.
  let forwardTarget = null;
  const publicFetch = { kind: 'network', operation: 'fetch', handle: async request => {
    const url = new URL(request.url);
    events.push({ at: 'proof', host: url.host });
    await hold?.(url, { events });
    if (!host.approvesChallengeAuthority(url.host)) return { status: 404, headers: {}, chunks: [{ data: Buffer.from('{"error":{"code":"not_found"}}').toString('base64'), delayMs: 0 }] };
    const to = await forwardTarget?.(url);
    assert.ok(to, 'the public proof may reach only what a provider effect created: ' + url.origin);
    const answer = await forward(to, url, request.headers);
    events.push({ at: 'proof-answer', status: answer.status, body: Buffer.from(answer.chunks[0].data, 'base64').toString().slice(0, 200) });
    return answer;
  } };
  const ssh = announce => {
    let serial = 0;
    forwardTarget = () => [...owned.values()].find(entry => entry.present())?.target;
    return [
      { kind: 'recipe', operation: 'probe', handle: async () => OPENSSH },
      { kind: 'spawn', operation: 'run', handle: async input => {
        if (!input.longRunning) return OPENSSH;
        const gateTarget = input.args.find(arg => /^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/, ''); assert.ok(gateTarget);
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        closing.children.push(child);
        const handle = `fixture-ssh-${++serial}`; owned.set(handle, { child, target: gateTarget, present: () => liveChild(child) });
        events.push({ at: 'allocate', handle });
        child.once('exit', () => events.push({ at: 'remove', handle }));
        return { handle, pid: child.pid, stdout: announce, stderr: '', exitCode: null };
      } },
      { kind: 'spawn', operation: 'read', handle: async ({ handle }) => ({ present: owned.get(handle)?.present() === true }) },
      { kind: 'spawn', operation: 'close', handle: async ({ handle }) => { owned.get(handle)?.child.kill(); return { closed: true }; } },
      publicFetch,
    ];
  };

  let effects, announced, setup = async () => {}, harnessOptions = {}, extra = {};
  if (providerId === 'localhost-run') { announced = 'https://fixture.lhr.life'; effects = ssh(`${announced}\n`); }
  else if (providerId === 'tunnl-gg') { announced = 'https://wild-fox-10bf6aa2.tunnl.gg'; effects = ssh(JSON.stringify({ event: 'tunnel', url: announced, upgrade: 'https://tunnl.gg/pricing' }) + '\n'); }
  else if (providerId === 'lan') {
    let serial = 0;
    const inventory = { interfaces: { eth0: [{ address: SYNTHETIC, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '02:00:00:00:00:01', cidr: SYNTHETIC + '/24' }], lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] } };
    forwardTarget = url => [...owned.values()].find(entry => entry.present() && new URL(entry.origin).origin === url.origin)?.target;
    effects = [
      { kind: 'recipe', operation: 'probe', handle: async ({ recipe }) => { assert.equal(recipe.kind, 'interfaces'); return { stdout: JSON.stringify(inventory), stderr: '', exitCode: 0 }; } },
      { kind: 'process-runtime', operation: 'open', handle: async input => { const handle = `fixture-forwarder-${++serial}`; let present = true; owned.set(handle, { origin: input.origin, target: input.target, present: () => present, stop: () => { present = false; } }); events.push({ at: 'allocate', handle, origin: input.origin }); return { handle }; } },
      { kind: 'process-runtime', operation: 'read', handle: async ({ handle }) => ({ present: owned.get(handle)?.present() === true }) },
      { kind: 'process-runtime', operation: 'close', handle: async ({ handle }) => { events.push({ at: 'remove', handle }); owned.get(handle).stop(); return { closed: true }; } },
      publicFetch,
    ];
    harnessOptions = { identity: { instanceId: randomUUID(), bootId: randomUUID() }, hostCapabilities: {} };
    setup = async api => {
      for (const inputId of ['interface', 'firewall']) {
        const config = (await api.listProviders({ home, owner, refresh: true })).providers.find(p => p.providerId === 'lan').configuration;
        const action = config.actions.find(a => a.id === inputId && a.kind === 'provide-value'); assert.ok(action, `the adapter offers ${inputId}`);
        await api.runSetupAction({ home, owner, providerId: 'lan', expectedConfigurationRevision: config.revision, actionId: action.id, value: SYNTHETIC,
          approval: { kind: 'setup', digest: action.digest, disclosureRevision: action.disclosure.revision, consentFactsDigest: action.consent.consentFactsDigest } });
      }
    };
  } else {
    const fake = await installFakeTailscale(home, tailscale); extra.fake = fake;
    const exec = async args => { try { const { stdout, stderr } = await run(join(fake.bin, 'tailscale'), args, { env: { PATH: process.env.PATH } }); return { stdout, stderr, exitCode: 0 }; } catch (error) { return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.code ?? 1 }; } };
    let serial = 0;
    forwardTarget = async url => {
      const state = await fake.read();
      for (const entry of Object.values(state.foreground ?? {})) if (entry.exitedAt === undefined) {
        const proxy = entry.config.Web?.[url.host]?.Handlers?.['/']?.Proxy; if (proxy) return proxy.replace(/^http:\/\//, '');
      }
      return null;
    };
    effects = [
      { kind: 'recipe', operation: 'probe', handle: async ({ recipe }) => exec(recipe.args) },
      { kind: 'spawn', operation: 'run', handle: async input => {
        if (!input.longRunning) return exec(input.args);
        const child = spawn(join(fake.bin, 'tailscale'), input.args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        closing.children.push(child);
        const first = await waitFirstOutput(child);
        const handle = `fixture-tailscale-${++serial}`; owned.set(handle, { child, present: () => liveChild(child) });
        events.push({ at: 'allocate', handle });
        child.once('exit', () => events.push({ at: 'remove', handle }));
        return { handle, pid: child.pid, stdout: first, stderr: '', exitCode: null };
      } },
      { kind: 'spawn', operation: 'read', handle: async ({ handle }) => ({ present: owned.get(handle)?.present() === true }) },
      { kind: 'spawn', operation: 'close', handle: async ({ handle }) => { owned.get(handle)?.child.kill('SIGTERM'); return { closed: true }; } },
      publicFetch,
    ];
    announced = `https://device.example-tailnet.ts.net:${providerId === 'tailscale-funnel' ? 8443 : 8443}`;
  }

  const harness = routeDeps ? directHarness({ effects, ...(acknowledgeOrigin ? { acknowledgeOrigin } : {}), ...(originAckTimeoutMs ? { originAckTimeoutMs } : {}), ...harnessOptions, ...routeDeps })
    : await createTestingGozar({ effects, ...(acknowledgeOrigin ? { acknowledgeOrigin } : {}), ...(originAckTimeoutMs ? { originAckTimeoutMs } : {}), ...harnessOptions });
  closing.harness = harness;
  const api = harness.gozar;
  const request = (over = {}) => query({ home, owner, providerId, operationId, target, usage: { kind: 'session', lifetimeMs },
    requirements: { ...REQUIREMENTS[providerId], payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] }, ...over });
  const approvedRequest = async (over = {}) => {
    await setup(api);
    const q = request(over);
    await api.listProviders({ home, owner, refresh: true });
    const candidate = (await api.catalogRoutes(q)).candidates.find(item => item.providerId === providerId);
    assert.ok(candidate, 'the catalog offers the provider');
    assert.equal(candidate.eligible, true, `eligible: ${JSON.stringify(candidate.unmet)}`);
    return { ...q, wait: 'verified', approval: { kind: 'route', candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest } };
  };
  /** Another app on its own loopback port in the same home, for a second session. */
  const another = async () => {
    const second = http.createServer((req, res) => { if (!verifier(req, res)) res.end('app'); });
    await new Promise(resolve => second.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { second.closeAllConnections(); second.close(resolve); }));
    const extraTarget = `127.0.0.1:${second.address().port}`;
    return { target: extraTarget, operationId: `${operationId}-${extraTarget.split(':')[1]}` };
  };
  /** The host's call: the whole `expose` is one proof call for a provider-chosen origin. */
  const expose = async ready => {
    host.applying = { origin: null, operationId: ready.operationId, providerId, target: ready.target };
    try { return await api.expose(ready); } finally { host.applying = null; }
  };
  const ownedNow = () => [...owned.values()].filter(entry => entry.present()).length;
  return { api, harness, home, owner, host, events, owned, ownedNow, target, app, request, approvedRequest, another, expose, announced, providerId, operationId, ...extra };
}

// The testing factory's own wiring (declared fixture effects dispatched in this process, the public-relay proof answered by them), minus its
// event log and project-facing facts: only for tests that must reach the route API's owner-process seams.
function directHarness({ effects, ...options }) {
  const handlers = new Map(effects.map(effect => [JSON.stringify([effect.kind, effect.operation]), effect.handle])), abort = new AbortController();
  const dispatchEffect = async request => {
    const handler = handlers.get(JSON.stringify([request?.kind, request?.operation]));
    if (abort.signal.aborted || !handler) throw Object.assign(new Error('No matching testing effect is declared'), { code: 'unsupported' });
    try { return structuredClone(await handler(structuredClone(request.input), { signal: abort.signal, fixture: true })); }
    catch { throw Object.assign(new Error('The testing effect failed'), { code: 'provider_unavailable' }); }
  };
  const gozar = createRouteApi({ platform: 'linux', ...options, dispatchEffect, verify: request => verification(request, { fetch: testingFetch(dispatchEffect) }) });
  return { gozar, close: async () => { abort.abort(); } };
}
