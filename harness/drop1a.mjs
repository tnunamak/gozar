#!/usr/bin/env node
// Drives the actual CLI. Provider prerequisites, allocation and removal remain Gozar responsibilities.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { command } from './process.mjs';
import { startDummy } from './dummy-server.mjs';
import { probe } from './probe.mjs';
import { diagnosePublicRelayCandidate } from './public-relay-diagnostic.mjs';
import { validateDrop1aReceipt } from './drop1a-receipt.mjs';
import { processIdentity } from '../packages/gozar-node/journal.mjs';
import { acquireLiveLock, assertUnusedPort, canonical, routeBaseline } from './live-safety.mjs';
import { startIndependentIngress } from './independent-ingress.mjs';

const { values } = parseArgs({ options: { route: { type: 'string' }, 'cli-options': { type: 'string' }, report: { type: 'string' }, 'work-directory': { type: 'string' }, 'executor-id': { type: 'string' }, 'proof-class': { type: 'string', default: 'public-relay' }, 'bind-address': { type: 'string' }, 'firewall-ack': { type: 'string' }, 'independent-ingress': { type: 'boolean' } } });
const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(['public-relay', 'remote-executor'].includes(values['proof-class']));
const relayMode = values['proof-class'] === 'public-relay';
const report = { proofClass: values['proof-class'], remoteExecution: false, route: values.route, result: 'failed', realRoute: false, outsideProof: false, commands: [], setupActions: [], actionCountScope: 'Harness-issued setup operations only; excludes client UI, authentication, administrator prerequisites and cognitive checks.', startedAtMs: Date.now() };
const reach = values.route === 'tailscale-private' ? 'tailnet' : values.route === 'lan' ? 'lan' : 'internet';
let directory, dummy, sentinel, sentinelIdentity, attempted = false, clean = false, releaseLock, requestWatcher, requestTask, ingress;
let before;
const cli = async (args, timeoutMs = 660_000) => {
  const argv = [join(root, 'bin/gozar.mjs'), ...args, '--port', String(dummy.port), '--json'];
  const result = await command(process.execPath, argv, { timeoutMs, env: { ...process.env, GOZAR_HOME: join(directory, 'state') } });
  report.commands.push({ argv, ...result }); assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
};
try {
  assert.ok(['localhost-run', 'tailscale-funnel', 'tailscale-private', 'lan', 'own-address'].includes(values.route), 'choose one of the five drop-1 modes');
  assert.ok(reach === 'internet' || !relayMode, 'tailnet/LAN require a genuine appropriate peer; public relay cannot substitute');
  if (values.route === 'lan') assert.ok(values['bind-address'] && values['firewall-ack'] === values['bind-address'], 'LAN requires the exact interface and matching scoped firewall approval');
  if (values.route === 'own-address') assert.equal(values['independent-ingress'], true, 'own-address harness requires a disposable independently owned ingress');
  if (!relayMode) { assert.ok(values['executor-id'], 'pin the trusted external executor identity'); assert.ok(values['cli-options'], 'remote mode requires the explicit trusted bridge arguments'); }
  if (relayMode) await import('./public-relay-service.mjs');
  const extra = values['cli-options'] ? JSON.parse(await readFile(resolve(values['cli-options']), 'utf8')) : [];
  assert.ok(Array.isArray(extra) && extra.every(value => typeof value === 'string'));
  assert.ok(!extra.some(value => ['--port', '--adapter', '--origin', '--client-reach', '--transport', '--yes', '--bind-address', '--firewall-ack'].includes(value)), 'bridge options cannot override route, target or consent scope');
  await mkdir((process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')), { recursive: true });
  directory = values['work-directory'] ? resolve(values['work-directory']) : await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests'), 'gz-drop1a-'));
  await mkdir(directory, { recursive: true }); report.directory = directory;
  // One shared owner lock covers every live route and the terminal walk.
  releaseLock = await acquireLiveLock(values.route);
  before = await routeBaseline(); report.before = before;
  if (values.route === 'tailscale-funnel') {
    assertUnusedPort(before, 8443);
  }
  if (values.route === 'tailscale-private') {
    report.selectedPrivatePort = [9444, 9445].find(port => { try { assertUnusedPort(before, port); return true; } catch { return false; } });
    assert.ok(report.selectedPrivatePort, 'both authorized private ports are occupied');
  }
  dummy = await startDummy();
  sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); await once(sentinel, 'spawn'); sentinelIdentity = await processIdentity(sentinel.pid);
  report.local = await probe({ origin: dummy.origin, nonce: dummy.nonce });
  const context = { serviceNonce: dummy.nonce, toolEcho: randomUUID(), serviceOrigin: dummy.origin };
  await writeFile(join(directory, 'service-context.json'), JSON.stringify(context), { mode: 0o600 });
  if (values.route === 'own-address') {
    ingress = await startIndependentIngress({ directory, target: dummy.origin });
    report.independentIngress = { beforeExpose: await ingress.snapshot() };
    report.setupActions.push({ kind: 'fixture-ingress', origin: ingress.origin });
  }
  if (!relayMode) {
    const probeDirectoryIndex = extra.indexOf('--probe-directory');
    assert.ok(probeDirectoryIndex >= 0, 'Drop1a requires the private UUID/MAC probe-directory channel');
    const probeDirectory = resolve(extra[probeDirectoryIndex + 1]);
    assert.equal(probeDirectory, join(directory, 'private-probes'), 'watch only this run’s owned private probe channel');
    await mkdir(probeDirectory, { recursive: true, mode: 0o700 });
    let bundled = false;
    requestWatcher = watch(probeDirectory, (_event, filename) => {
      if (bundled || !filename?.endsWith('.request.json')) return;
      bundled = true;
      const privateRequestPath = join(probeDirectory, filename);
      requestTask = (async () => {
        const bundledResult = await command(process.execPath, [join(root, 'harness/make-outside-probe.mjs'), directory, privateRequestPath]);
        assert.equal(bundledResult.code, 0, bundledResult.stderr);
        const details = JSON.parse(bundledResult.stdout);
        report.outsideTask = details; report.privateRequestPath = privateRequestPath;
        console.log(JSON.stringify({ event: 'outside-challenge-ready', privateRequestPath, sanitizedRequestPath: join(directory, 'probe-request.json'), ...details }));
      })().catch(error => { report.outsidePreparationError = error.message; console.log(JSON.stringify({ event: 'outside-preparation-failed', error: error.message })); });
    });
  }
  console.log(JSON.stringify({ event: 'before-live-creation', route: values.route, directory, serviceContext: join(directory, 'service-context.json'), baseline: before }));
  attempted = true;
  report.setupActions.push({ kind: 'cli-consent', route: values.route, target: dummy.origin, clientReach: reach });
  report.expose = await cli(['expose', '--adapter', values.route, '--client-reach', reach, '--transport', reach === 'lan' ? 'http' : 'https', '--sse', ...(!relayMode ? ['--streamable-http'] : []), ...(reach === 'lan' ? ['--bind-address', values['bind-address'], '--firewall-ack', values['firewall-ack']] : []), ...(ingress ? ['--origin', ingress.origin] : []), '--yes', ...extra]);
  if (ingress) {
    assert.equal(report.expose.action?.kind, 'external', 'owner must receive an explicit route-to-gate action');
    assert.equal(canonical(await ingress.snapshot()), canonical(report.independentIngress.beforeExpose), 'expose changed independent ingress');
    const target = report.expose.action.target;
    const parsed = new URL(target); assert.equal(parsed.hostname, '127.0.0.1'); assert.equal(parsed.protocol, 'http:');
    ingress.retarget(target);
    report.setupActions.push({ kind: 'manual-route-to-gate', target, instruction: report.expose.action.instruction });
    report.independentIngress.beforeValidation = await ingress.snapshot();
    report.expose = await cli(['health']);
    assert.equal(canonical(await ingress.snapshot()), canonical(report.independentIngress.beforeValidation), 'validation changed independent ingress');
  }
  report.routeAllocated = Boolean(report.expose.snapshot?.candidate && report.expose.snapshot?.resources?.some(resource => resource.ownership === 'owned'));
  if (relayMode && report.expose.snapshot?.phase !== 'published-ready' && report.expose.snapshot?.candidate) {
    report.failureCandidate = report.expose.snapshot.candidate;
    report.publicRelayFailure = await diagnosePublicRelayCandidate({ origin: report.failureCandidate, serviceNonce: dummy.nonce, gateChallenge: report.expose.probeChallenge ?? report.expose.diagnostics?.probeChallenge });
    await writeFile(join(directory, 'public-relay-negative.json'), JSON.stringify(report.publicRelayFailure, null, 2), { mode: 0o600 });
  }
  assert.equal(report.expose.snapshot?.phase, 'published-ready', 'Gozar did not validate the selected network proof; stop this owned attempt before retry');
  report.status = await cli(['status']);
  const snapshot = report.status.snapshot;
  assert.equal(snapshot.phase, 'published-ready', 'actual CLI must validate the selected network proof before publication');
  assert.ok(snapshot.published?.startsWith(reach === 'lan' ? 'http://' : 'https://'));
  if (report.selectedPrivatePort) assert.equal(Number(new URL(snapshot.published).port), report.selectedPrivatePort);
  assert.equal(snapshot.adapterId, values.route);
  const journal = JSON.parse(await readFile(join(directory, 'state', `port-${dummy.port}`, 'session.json'), 'utf8'));
  const receipt = report.status.validation?.probeReceipt ?? report.status.probeReceipt ?? journal.probeReceipt ?? journal.validation?.probeReceipt;
  // Core persisted validation includes the actual accepted receipt, not a second harness-generated challenge.
  report.acceptedReceipt = receipt ?? journal.state?.proof;
  if (relayMode) {
    report.hostAllowPublicRelay = journal.state?.host?.probe?.allowPublicRelay;
    assert.equal(report.hostAllowPublicRelay, true, 'host must have explicitly authorized the public-relay proof path');
  }
  if (relayMode) {
    // Import the host's actual public-DNS/pinned-TLS transport, never relabel ordinary fetch.
    const { verifyPublicRelayService } = await import('./public-relay-service.mjs');
    report.publicRelay = await verifyPublicRelayService({ origin: snapshot.published, serviceNonce: dummy.nonce, toolEcho: context.toolEcho, validation: report.status.validation, authorization: journal.state.host.probe });
    report.realRoute = true; report.outsideProof = true; report.remoteExecution = false;
    report.limitations = ['Proof uses host execution over a public-DNS pinned relay path; it does not establish reachability from another client network.'];
  } else {
    report.localRoute = await probe({ origin: snapshot.published, nonce: dummy.nonce, toolEcho: context.toolEcho });
    report.realRoute = true;
    // The host's trusted proof receipt is mandatory; published state alone cannot substitute for provenance.
    const externalPath = join(directory, 'trusted-outside-receipt.json');
    const external = JSON.parse(await readFile(externalPath, 'utf8'));
    const request = JSON.parse(await readFile(join(directory, 'probe-request.json'), 'utf8'));
    validateDrop1aReceipt(external, request, { ...context, executorId: values['executor-id'] });
    assert.ok(external.executorId && external.executorId !== 'local-node', 'known external job identity required');
    assert.equal(external.probeReceipt?.origin, snapshot.published);
    assert.equal(external.probeReceipt?.remote, true); assert.equal(external.probeReceipt?.tls, reach !== 'lan');
    assert.equal(external.probeReceipt?.instanceMatched, true); assert.equal(external.probeReceipt?.sse, true);
    assert.equal(external.probeReceipt?.streamableHttp, true);
    assert.equal(external.observations?.service?.toolCall, true);
    assert.equal(external.observations.service.toolResult.nonce, dummy.nonce); assert.equal(external.observations.service.toolResult.echo, context.toolEcho);
    report.remote = external; report.outsideProof = true; report.remoteExecution = true;
  }
  report.result = 'passed';
} catch (error) { report.error = error.stack; if (error.publicRelayEvidence) report.publicRelayFailure = error.publicRelayEvidence; }
finally {
  try {
    if (attempted) {
      const stateDirectory = join(directory, 'state', `port-${dummy.port}`);
      const previous = await readFile(join(stateDirectory, 'session.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (values.route === 'localhost-run' && Object.values(previous?.owned ?? {}).some(resource => resource.kind === 'process')) {
        report.transportDiagnostic = await command(process.execPath, [join(root, 'harness/diagnose-transport.mjs'), directory], { timeoutMs: 5000 });
      }
      const controllerBefore = await readFile(join(stateDirectory, 'control.json'), 'utf8').then(JSON.parse).catch(() => null);
      report.stop = await cli(['stop']); assert.equal(report.stop.snapshot.phase, 'stopped');
      const journal = JSON.parse(await readFile(join(stateDirectory, 'session.json'), 'utf8'));
      assert.equal(Object.keys(journal.owned).length, 0);
      if (controllerBefore) {
        for (let attempt = 0; attempt < 50 && await processIdentity(controllerBefore.pid) === controllerBefore.startIdentity; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
        assert.notEqual(await processIdentity(controllerBefore.pid), controllerBefore.startIdentity, 'owned controller residue');
      }
      for (const resource of Object.values(previous?.owned ?? {}).filter(resource => resource.kind === 'process')) assert.notEqual(await processIdentity(resource.pid), resource.startIdentity);
    }
    if (sentinel) assert.equal(await processIdentity(sentinel.pid), sentinelIdentity, 'foreign sentinel process must survive stop');
    if (ingress) {
      report.independentIngress.afterStop = await ingress.snapshot();
      assert.equal(canonical(report.independentIngress.afterStop), canonical(report.independentIngress.beforeValidation ?? report.independentIngress.beforeExpose), 'stop changed independent ingress');
      if (report.publicRelay) {
        // Only the independent fixture owner reconnects its target after Gozar removes its gate.
        ingress.retarget(dummy.origin);
        const { createPinnedPublicRequest } = await import('../packages/gozar-node/public-relay.mjs');
        report.independentIngress.serviceAfterStop = await probe({ origin: ingress.origin, nonce: dummy.nonce, request: createPinnedPublicRequest({ origin: ingress.origin, resolvedIp: report.publicRelay.resolvedIp, timeoutMs: 10000 }) });
      }
    }
    report.zeroOwnedResidue = true; clean = true;
  } catch (error) { report.result = 'failed'; report.cleanupError = error.stack; }
  finally {
    try {
      if (before) {
        report.after = await routeBaseline();
        assert.equal(canonical(report.after), canonical(before), 'foreign routes or owned route residue changed baseline');
        if (values.route === 'tailscale-funnel') assertUnusedPort(report.after, 8443);
        if (report.selectedPrivatePort) assertUnusedPort(report.after, report.selectedPrivatePort);
      }
    } catch (error) { report.result = 'failed'; report.baselineError = error.stack; report.zeroOwnedResidue = false; clean = false; }
    requestWatcher?.close(); if (requestTask) await requestTask;
    const finalizers = [
      ['sentinel', async () => { if (sentinel && sentinel.exitCode === null && sentinel.signalCode === null) { const exited = once(sentinel, 'exit'); sentinel.kill('SIGTERM'); await exited; } }],
      ['independent-ingress', async () => { if (ingress) { report.independentIngress.transcript = ingress.transcript(); report.independentIngress.fixtureCleanup = await ingress.close(); } }],
      ['demo', async () => { if (dummy) await dummy.close(); }],
      ['live-lock', async () => { if (releaseLock) await releaseLock(); }],
    ];
    for (const [name, finalize] of finalizers) {
      try { await finalize(); }
      catch (error) { report.result = 'failed'; report.zeroOwnedResidue = false; clean = false; (report.finalizerErrors ??= []).push({ name, error: error.stack }); }
    }
    report.finishedAtMs = Date.now(); report.elapsedMs = report.finishedAtMs - report.startedAtMs; report.setupActionCount = report.setupActions.length;
    if (values.report) await writeFile(resolve(values.report), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (clean && directory && !values['work-directory']) await rm(directory, { recursive: true, force: true });
  }
}
process.exitCode = report.result === 'passed' ? 0 : 1;
