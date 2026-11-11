#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { startDummy } from './dummy-server.mjs';
import { probe } from './probe.mjs';
import { createProbeChallenge, executeTrustedProbe } from './probe-receipt.mjs';
import { runFakeEffects } from './core-fixtures.mjs';
import { command } from './process.mjs';
import { loadCatalog } from '../packages/gozar-node/catalog.mjs';
import { processIdentity } from '../packages/gozar-node/journal.mjs';

const { values } = parseArgs({ options: {
  'fake-effects': { type: 'boolean' }, inspect: { type: 'boolean' }, live: { type: 'boolean' },
  'firstdrop-funnel': { type: 'boolean' }, tailnet: { type: 'boolean' }, 'localhost-run': { type: 'boolean' }, lan: { type: 'boolean' }, 'own-address': { type: 'boolean' }, ngrok: { type: 'boolean' }, 'named-cloudflare': { type: 'boolean' },
  transport: { type: 'string' }, 'client-profile': { type: 'string' },
  'adapter-id': { type: 'string' }, origin: { type: 'string' }, 'bind-address': { type: 'string' },
  'route-port': { type: 'string' }, port: { type: 'string' }, 'outside-executor': { type: 'string' }, 'outside-receipt': { type: 'string' }, 'outside-executor-id': { type: 'string' }, 'outside-request': { type: 'string' },
} });
const root = fileURLToPath(new URL('../', import.meta.url));
const report = { evidence: 'read-only-prerequisites', realRoute: false, outsideProof: false };
const canonical = value => JSON.stringify(value, function (key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item; });
async function baseline() {
  const results = await Promise.all(['serve', 'funnel'].map(kind => command('tailscale', [kind, 'status', '--json'], { timeoutMs: 5000 }).catch(error => ({ code: -1, stderr: error.message }))));
  return Object.fromEntries(results.map((result, i) => [[ 'serve', 'funnel' ][i], result.code === 0 ? JSON.parse(result.stdout) : { unavailable: result.stderr }]));
}
function configuredPorts(config) {
  const ports = new Set();
  for (const map of ['TCP', 'Web', 'AllowFunnel']) for (const key of Object.keys(config[map] ?? {})) {
    const match = /(?:^|:)([0-9]+)$/.exec(key); if (match) ports.add(Number(match[1]));
  }
  for (const child of Object.values(config.Foreground ?? {})) for (const port of configuredPorts(child)) ports.add(port);
  return ports;
}
async function requireFree(port, before) {
  assert.ok(![443, 10000].includes(port), 'protected route port');
  for (const config of Object.values(before)) {
    assert.ok(!config.unavailable, 'Tailscale baseline unavailable');
    assert.ok(!configuredPorts(config).has(port), 'route port already configured');
  }
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '0.0.0.0', resolve); });
  await new Promise(resolve => socket.close(resolve));
}
async function inspect() {
  const [routes, versions] = await Promise.all([baseline(), Promise.all([['tailscale', ['version']], ['ssh', ['-V']], ['cloudflared', ['--version']], ['ngrok', ['version']]].map(async ([program, args]) => {
    try { const output = await command(program, args, { timeoutMs: 5000 }); return { program, available: output.code === 0, output: (output.stdout + output.stderr).trim() }; }
    catch (error) { return { program, available: false, detail: error.message }; }
  }))]);
  return { routes, versions, interfaces: networkInterfaces(), limitations: ['Binary presence does not prove an authorized named Cloudflare tunnel or ngrok route.', 'No route mutation performed by inspect.', 'An explicit trusted remote executor or fresh external receipt is required for peer/public proof.'] };
}
async function live() {
  const modes = ['firstdrop-funnel', 'tailnet', 'localhost-run', 'lan', 'own-address', 'ngrok', 'named-cloudflare'].filter(key => values[key]);
  assert.equal(modes.length, 1, 'select exactly one explicit live mode');
  assert.ok(values['adapter-id'], '--adapter-id must name the admitted catalog record');
  const mode = modes[0];
  const modeAdapters = { 'firstdrop-funnel': ['tailscale-funnel'], tailnet: ['tailscale-private'], 'localhost-run': ['localhost-run'], lan: ['lan'], 'own-address': ['own-address'], ngrok: ['ngrok-https-edge', 'ngrok-tls-passthrough', 'ngrok-tcp-passthrough'], 'named-cloudflare': ['cloudflare-named'] };
  assert.ok(modeAdapters[mode].includes(values['adapter-id']), 'adapter ID must match explicit mode safety policy');
  const reach = mode === 'tailnet' ? 'tailnet' : mode === 'lan' ? 'lan' : 'internet';
  const vantage = reach === 'internet' ? 'public' : reach;
  const catalog = await loadCatalog(root);
  const adapter = catalog.find(record => record.id === values['adapter-id']);
  if (!adapter) { report.result = 'needs-validation'; report.missingPrecondition = `Adapter ${values['adapter-id']} has no admitted runtime catalog record.`; return; }
  assert.equal(adapter.audience, reach === 'internet' ? 'public' : reach, 'adapter reach does not match selected mode');
  assert.equal(adapter.ownership, mode === 'own-address' ? 'external-owned' : 'owned', 'own-address must be validate-only');
  if (mode !== 'own-address' && !adapter.recipes?.create) { report.result = 'needs-validation'; report.missingPrecondition = `Adapter ${adapter.id} has detection only; an admitted create/remove recipe is required.`; return; }
  const before = await baseline(); report.baseline = before;
  const routePort = Number(values['route-port'] ?? (mode === 'firstdrop-funnel' ? 8443 : 9444));
  if (['firstdrop-funnel', 'tailnet'].includes(mode)) {
    if (mode === 'firstdrop-funnel') assert.equal(routePort, 8443, 'new public Funnel restricted to :8443');
    else assert.ok([9444, 9445].includes(routePort), 'private candidates are only 9444/9445 after fresh baseline');
    assert.ok(Number.isSafeInteger(routePort) && routePort > 0 && routePort <= 65535, 'valid dedicated route port required');
    for (const operation of ['create', 'remove']) {
      const recipe = adapter.recipes[operation];
      assert.equal(recipe?.program?.split('/').at(-1), 'tailscale');
      assert.ok(recipe.args?.includes(mode === 'firstdrop-funnel' ? 'funnel' : 'serve'), 'exact Tailscale subcommand required');
      const literal = recipe.args.includes(`--https=${routePort}`);
      const bound = Object.entries(adapter.bindings ?? {}).some(([name, spec]) => spec.type === 'unused-port' && spec.candidates?.includes(routePort) && recipe.args.includes(`--https={${name}}`));
      assert.ok(literal || bound, 'admitted recipe must use the dedicated port or a guarded explicit unused-port binding');
      if (operation === 'remove') assert.ok(recipe.args.includes('off'), 'scoped off recipe required');
    }
    await requireFree(routePort, before);
  }
  if (mode === 'own-address') { assert.ok(values.origin, 'own-address is validate-only and requires --origin'); assert.equal(new URL(values.origin).origin, values.origin); }
  if (mode === 'lan') {
    const addresses = Object.values(networkInterfaces()).flat().filter(Boolean).filter(item => !item.internal).map(item => item.address);
    assert.ok(addresses.includes(values['bind-address']), 'LAN mode requires an exact host interface --bind-address');
    const help = await command(process.execPath, [join(root, 'bin/gozar.mjs'), '--help']);
    if (!help.stdout.includes('--bind-address') || !help.stdout.includes('--firewall-ack')) {
      report.result = 'needs-validation'; report.missingPrecondition = 'Integrated CLI must support exact --bind-address and --firewall-ack for a real LAN forwarder.'; return;
    }
    report.lanLimitations = ['HTTP forwarder only; TLS requires a separately validated termination layer.', 'Host firewall and client DNS/name reachability need peer validation.'];
  }
  await mkdir((process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')), { recursive: true });
  const directory = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests'), 'gz-e2e-'));
  report.sessionDirectory = directory;
  const dummy = await startDummy({ port: Number(values.port ?? 0) });
  const actualSessionDirectory = join(directory, `port-${dummy.port}`);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(unrelated, 'spawn');
  const unrelatedIdentity = await processIdentity(unrelated.pid);
  const cli = async args => {
    const output = await command(process.execPath, [join(root, 'bin/gozar.mjs'), ...args, '--port', String(dummy.port), '--json'], { timeoutMs: 45_000, env: { ...process.env, GOZAR_HOME: directory } });
    report.commands ??= []; report.commands.push({ args, ...output });
    assert.equal(output.code, 0, output.stderr || output.stdout);
    const replies = output.stdout.split('\n').filter(line => line.trim().startsWith('{')).map(line => JSON.parse(line));
    assert.ok(replies.length, 'CLI must emit a JSON result'); return replies.at(-1);
  };
  let started = false; let clean = false; let ownedBeforeStop = []; let controllerBeforeStop;
  try {
    report.local = await probe({ origin: dummy.origin, nonce: dummy.nonce });
    const args = ['expose', '--adapter', values['adapter-id'], '--client-reach', reach, '--yes'];
    args.push('--transport', values.transport ?? (mode === 'lan' ? 'http' : 'https'));
    if (values['client-profile']) args.push('--client-profile', values['client-profile']);
    if (mode === 'own-address') args.push('--origin', values.origin);
    if (mode === 'lan') args.push('--bind-address', values['bind-address'], '--firewall-ack', values['bind-address']);
    // Set before invocation: failed expose can still leave attributable cleanup debt.
    started = true;
    const exposed = await cli(args); const status = await cli(['status']);
    report.exposed = exposed; report.status = status;
    const snapshot = status.snapshot ?? status;
    const origin = snapshot.candidate ?? snapshot.published;
    assert.ok(origin, 'CLI must expose an exact candidate origin');
    assert.equal(snapshot.published, null, 'this harness has supplied no trusted verifier receipt to the CLI; publication must remain withheld');
    assert.equal((exposed.snapshot ?? exposed).sessionId, snapshot.sessionId);
    const issuedAt = Date.now();
    report.localRoute = await probe({ origin, nonce: dummy.nonce, issuedAt });
    report.realRoute = true; report.evidence = 'real-cli-local-route-only';
    if (mode === 'lan') assert.equal(new URL(origin).hostname.replace(/^\[|\]$/g, ''), values['bind-address'], 'LAN route must bind the requested host interface');
    const request = createProbeChallenge({ origin, nonce: dummy.nonce, nowMs: issuedAt, vantage, executorId: values['outside-executor-id'] });
    report.outsideRequest = request;
    if (values['outside-request']) {
      await writeFile(resolve(values['outside-request']), JSON.stringify(request), { flag: 'wx', mode: 0o600 });
      report.outsideRequestPath = resolve(values['outside-request']);
    }
    let receipt;
    if (values['outside-executor'] || values['outside-receipt']) assert.ok(values['outside-executor-id'] && values['outside-executor-id'] !== 'local-node', 'pin --outside-executor-id to the known trusted remote identity');
    if (values['outside-executor']) {
      // Explicitly trusted executable; stdin/stdout JSON, no shell interpolation.
      const result = await command(resolve(values['outside-executor']), [], { input: JSON.stringify(request), timeoutMs: 30_000 });
      assert.equal(result.code, 0, result.stderr); receipt = JSON.parse(result.stdout);
    } else if (values['outside-receipt']) {
      // An external verifier can consume the challenge and deposit a trusted receipt while the route is alive.
      for (let attempt = 0; attempt < 60; attempt++) {
        try { receipt = JSON.parse(await readFile(resolve(values['outside-receipt']), 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      if (!receipt) { report.result = 'needs-validation'; report.missingPrecondition = `Fresh trusted receipt was not deposited at ${resolve(values['outside-receipt'])} within 15 seconds.`; }
    }
    if (receipt) {
      const verified = await executeTrustedProbe(request, { identity: values['outside-executor-id'], vantage, remote: true, execute: async () => receipt }, { requireTls: mode !== 'lan' });
      report.coreProbeReceipt = verified.probeReceipt;
      report.remote = receipt; report.outsideProof = true; report.evidence = 'real-cli-and-trusted-remote-receipt';
    } else if (!report.missingPrecondition) {
      report.result = 'needs-validation'; report.missingPrecondition = `Trusted ${vantage} executor that can reach ${origin}, validate ${mode === 'lan' ? 'HTTP' : 'HTTPS/TLS'}, and return ordered nonce-bound MCP/SSE evidence while this route is alive.`;
    }
  } finally {
    try {
      if (started) {
        const beforeStop = await readFile(join(actualSessionDirectory, 'session.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {}; });
        ownedBeforeStop = Object.values(beforeStop.owned ?? {});
        controllerBeforeStop = await readFile(join(actualSessionDirectory, 'control.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        report.stop = await cli(['stop']);
        const snapshot = report.stop.snapshot ?? report.stop;
        assert.equal(snapshot.phase, 'stopped');
        assert.ok((snapshot.resources ?? []).every(resource => resource.ownership !== 'owned' || resource.cleanup === 'removed'));
        const journal = JSON.parse(await readFile(join(actualSessionDirectory, 'session.json'), 'utf8'));
        assert.equal(Object.keys(journal.owned ?? {}).length, 0, 'owned journal residue');
        for (const resource of ownedBeforeStop.filter(item => item.kind === 'process')) assert.notEqual(await processIdentity(resource.pid), resource.startIdentity, 'owned child residue');
        // Daemon close is asynchronous after stop reply; bound this check to our controller only.
        const control = controllerBeforeStop;
        if (control) {
          for (let i = 0; i < 40 && await processIdentity(control.pid) === control.startIdentity; i++) await new Promise(resolve => setTimeout(resolve, 50));
          assert.notEqual(await processIdentity(control.pid), control.startIdentity, 'owned controller residue');
        }
      }
      assert.equal(await processIdentity(unrelated.pid), unrelatedIdentity, 'stop disturbed unrelated child');
      report.after = await baseline(); assert.equal(canonical(report.after), canonical(before), 'preexisting route baseline changed');
      report.zeroOwnedResidue = true; clean = true;
    } finally {
      if (unrelated.exitCode === null && unrelated.signalCode === null) { const exited = once(unrelated, 'exit'); unrelated.kill('SIGTERM'); await exited; }
      await dummy.close();
      if (clean) { await rm(directory, { recursive: true, force: true }); delete report.sessionDirectory; }
    }
  }
  if (!report.result) report.result = 'passed';
}
try {
  if (values['fake-effects']) { Object.assign(report, await runFakeEffects(), { result: 'passed' }); }
  else if (values.live) await live();
  else { report.prerequisites = await inspect(); report.result = 'needs-validation'; report.missingPrecondition = 'Select --live with an explicit mode and admitted --adapter-id to check a live route.'; }
} catch (error) { report.result = 'failed'; report.error = error.stack; }
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.result === 'passed' ? 0 : report.result === 'needs-validation' ? 2 : 1;
