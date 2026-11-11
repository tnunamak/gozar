#!/usr/bin/env node
// Drives the actual CLI. Provider prerequisites, allocation and removal remain Gozar responsibilities.
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises';
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

const { values } = parseArgs({ options: { route: { type: 'string' }, 'cli-options': { type: 'string' }, report: { type: 'string' }, 'work-directory': { type: 'string' }, 'executor-id': { type: 'string' }, 'proof-class': { type: 'string', default: 'public-relay' } } });
const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(['public-relay', 'remote-executor'].includes(values['proof-class']));
const relayMode = values['proof-class'] === 'public-relay';
const report = { proofClass: values['proof-class'], remoteExecution: false, route: values.route, result: 'failed', realRoute: false, outsideProof: false, commands: [] };
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
let directory, dummy, sentinel, sentinelIdentity, attempted = false, clean = false, lock, requestWatcher, requestTask;
const baseline = async () => {
  const output = await command('tailscale', ['serve', 'status', '--json'], { timeoutMs: 5000 });
  assert.equal(output.code, 0, output.stderr); return JSON.parse(output.stdout);
};
let before;
const cli = async (args, timeoutMs = 660_000) => {
  const argv = [join(root, 'bin/gozar.mjs'), ...args, '--port', String(dummy.port), '--json'];
  const result = await command(process.execPath, argv, { timeoutMs, env: { ...process.env, GOZAR_HOME: join(directory, 'state') } });
  report.commands.push({ argv, ...result }); assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
};
try {
  assert.ok(['localhost-run', 'tailscale-funnel'].includes(values.route), 'Drop1a supports only the two authorized routes');
  if (!relayMode) { assert.ok(values['executor-id'], 'pin the trusted external executor identity'); assert.ok(values['cli-options'], 'remote mode requires the explicit trusted bridge arguments'); }
  if (relayMode) await import('./public-relay-service.mjs');
  const extra = values['cli-options'] ? JSON.parse(await readFile(resolve(values['cli-options']), 'utf8')) : [];
  assert.ok(Array.isArray(extra) && extra.every(value => typeof value === 'string'));
  assert.ok(!extra.some(value => ['--port', '--adapter', '--origin', '--client-reach', '--transport', '--yes', '--bind-address', '--firewall-ack'].includes(value)), 'bridge options cannot override route, target or consent scope');
  await mkdir((process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')), { recursive: true });
  directory = values['work-directory'] ? resolve(values['work-directory']) : await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests'), 'gz-drop1a-'));
  await mkdir(directory, { recursive: true }); report.directory = directory;
  // One shared owner lock covers both trials, so the two routes cannot overlap within this harness.
  lock = await open(join(process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests'), 'gozar-drop1a-live.lock'), 'wx', 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid, route: values.route }));
  before = await baseline(); report.before = before;
  if (values.route === 'tailscale-funnel') {
    const occupied = config => Boolean(config.TCP?.['8443'] || Object.keys(config.Web ?? {}).some(key => key.endsWith(':8443')) || Object.keys(config.AllowFunnel ?? {}).some(key => key.endsWith(':8443')) || Object.values(config.Foreground ?? {}).some(occupied));
    assert.equal(occupied(before), false, ':8443 must be absent from the entire fresh baseline');
  }
  dummy = await startDummy();
  sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); await once(sentinel, 'spawn'); sentinelIdentity = await processIdentity(sentinel.pid);
  report.local = await probe({ origin: dummy.origin, nonce: dummy.nonce });
  const context = { serviceNonce: dummy.nonce, toolEcho: randomUUID(), serviceOrigin: dummy.origin };
  await writeFile(join(directory, 'service-context.json'), JSON.stringify(context), { mode: 0o600 });
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
  report.expose = await cli(['expose', '--adapter', values.route, '--operational', '--client-reach', 'internet', '--transport', 'https', '--sse', ...(!relayMode ? ['--streamable-http'] : []), '--yes', ...extra]);
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
  assert.ok(snapshot.published?.startsWith('https://'));
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
    assert.equal(external.probeReceipt?.remote, true); assert.equal(external.probeReceipt?.tls, true);
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
    if (before) { report.after = await baseline(); assert.equal(canonical(report.after), canonical(before), 'foreign routes or owned route residue changed baseline'); }
    report.zeroOwnedResidue = true; clean = true;
  } catch (error) { report.result = 'failed'; report.cleanupError = error.stack; }
  finally {
    requestWatcher?.close(); if (requestTask) await requestTask;
    if (sentinel && sentinel.exitCode === null && sentinel.signalCode === null) { const exited = once(sentinel, 'exit'); sentinel.kill('SIGTERM'); await exited; }
    if (dummy) await dummy.close();
    if (lock) { await lock.close(); await rm(join(process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests'), 'gozar-drop1a-live.lock')); }
    if (values.report) await writeFile(resolve(values.report), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (clean && directory && !values['work-directory']) await rm(directory, { recursive: true, force: true });
  }
}
process.exitCode = report.result === 'passed' ? 0 : 1;
