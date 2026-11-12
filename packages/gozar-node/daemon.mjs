import net from 'node:net';
import { cliCommand } from './cli-command.mjs';
import { chmod, readFile, unlink, open, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { atomicWrite, Journal, processIdentity } from './journal.mjs';
import { Controller } from './controller.mjs';
import { PublicRelayVerifier } from './public-relay.mjs';
import { ProbeDirectoryExecutor } from './probe-directory.mjs';
import { routeAnnouncement } from './announcement.mjs';
import { prepareHost, LOCAL_PLAN_FEATURES } from './host.mjs';
import { loadCatalog } from './catalog.mjs';
import { createGate, validateLifetimeMs } from './gate.mjs';
import { loadCore } from './core.mjs';

export const socketPath = directory => join(directory, 'control.sock');
export async function control(directory, command, timeoutMs = 15_000) {
  const identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  if (!identity.startIdentity || await processIdentity(identity.pid) !== identity.startIdentity) throw new Error('Controller is not running; readiness withdrawn');
  return new Promise((resolve, reject) => {
    let output = '', settled = false;
    const socket = net.createConnection(socketPath(directory));
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(deadline); socket.destroy(); error ? reject(error) : resolve(result); };
    const deadline = setTimeout(() => finish(new Error('Controller timed out; readiness unknown')), timeoutMs);
    socket.once('connect', () => socket.write(`${JSON.stringify({ nonce: identity.nonce, command })}\n`));
    socket.on('data', chunk => {
      output += chunk;
      if (output.length > 1_048_576) return finish(new Error('Controller response exceeds limit'));
      if (output.includes('\n')) {
        try { const reply = JSON.parse(output.split('\n')[0]); reply.error ? finish(new Error(reply.error)) : finish(null, reply); }
        catch (error) { finish(error); }
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => { if (!settled) finish(new Error('Controller closed without a result')); });
  });
}

// A controller keeps the implementation it loaded at startup. Retire a stopped,
// authenticated controller before reconciling its journal with the current code.
export async function stopSession(directory) {
  let identity;
  try { identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let reply;
  try { reply = await control(directory, { type: 'stop' }, 120_000); }
  catch { return recoverStop(directory); }
  if (reply.snapshot?.phase !== 'cleanup-pending') return reply;
  const journal = new Journal(directory); await journal.load();
  const current = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  if (!identity?.startIdentity || current.pid !== identity.pid || current.startIdentity !== identity.startIdentity || current.nonce !== identity.nonce ||
      !journal.value.state?.stopRequested || journal.value.state.sessionId !== reply.snapshot.sessionId) throw new Error('Controller changed during stop; inspect the recorded session and retry stop');
  if (await processIdentity(identity.pid) === identity.startIdentity) {
    try { process.kill(identity.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + 10_000;
    while (await processIdentity(identity.pid) === identity.startIdentity) {
      if (Date.now() >= deadline) throw new Error('Stopped controller has not exited; inspect the recorded controller identity and retry stop');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return { ...await recoverStop(directory), controllerHandover: true };
}

export async function launch(directory, configuration, executable) {
  if (configuration.lifetimeMs !== undefined) validateLifetimeMs(configuration.lifetimeMs);
  try { return await control(directory, { type: 'status' }, 1_000); }
  catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) && !error.message.includes('not running')) throw error; }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Launch lock belongs to the caller until the child acknowledges. No competing launch overwrites configuration.
  const lockPath = join(directory, 'launch.json');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    if (await processIdentity(previous.pid) === previous.startIdentity) throw new Error('Session is starting; retry status shortly');
    await unlink(lockPath); lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startIdentity: await processIdentity(process.pid) }));
  await lock.close();
  try {
    await atomicWrite(join(directory, 'bootstrap.json'), configuration);
    const child = spawn(process.execPath, [executable, '--daemon', directory], { detached: true, stdio: 'ignore', env: {
      PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
    child.unref();
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const startupDeadline = Date.now() + (configuration.probeWaitMs ?? 5000) + 120000;
    while (Date.now() < startupDeadline) {
      try { return await control(directory, { type: 'status', initial: true }, Math.min(10000, startupDeadline - Date.now())); }
      catch (error) {
        if (await processIdentity(child.pid) === null) {
          let failure;
          try { failure = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')); } catch {}
          throw new Error(failure?.message ?? 'Controller exited before startup completed');
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    throw new Error(`Controller startup still pending; run ${cliCommand('status', configuration.targetPort)} before retrying expose`);
  } finally { await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function serve(directory, { step: suppliedStep, probeExecutor, hostAuthorities, processOutputObserver } = {}) {
  const config = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
  if (config.lifetimeMs !== undefined) validateLifetimeMs(config.lifetimeMs);
  const journal = new Journal(directory);
  await journal.load();
  // A crashed prior controller never restores readiness from disk. Only remove attributable local children.
  const step = suppliedStep ?? await loadCore();
  // Establish exclusive ownership before inspecting or cleaning a previous session.
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (await processIdentity(prior.pid) === prior.startIdentity) throw new Error('Existing controller is still running');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (journal.value.state && journal.value.snapshot?.phase !== 'stopped') {
    const recovered = await recoverStop(directory);
    if (recovered.snapshot.phase !== 'stopped' || recovered.localCleanupFailures?.length) {
      throw new Error('Previous session has unresolved cleanup. Run stop; inspect the journal path.');
    }
    await journal.load();
  }
  if (Object.keys(journal.value.owned).length) throw new Error('Cleanup remains pending; stop the recorded session before restarting');
  let controller;
  if (!probeExecutor && config.probeDirectory) probeExecutor = new ProbeDirectoryExecutor(config.probeDirectory, { vantages: ['public', 'tailnet', 'lan'], executorRef: config.probeExecutorId, requestPath: config.probeRequest, receiptPath: config.probeReceipt });
  if (!probeExecutor) probeExecutor = new PublicRelayVerifier();
  const selectedAdapter = config.adapters.find(adapter => adapter.id === config.adapterId);
  let routeQueue = Promise.resolve();
  const queuedRouteOrigins = new Set();
  const operational = config.operational === true || selectedAdapter?.planVersion === 1;
  const gate = operational ? await createGate(config.targetPort, { lifetimeMs: config.lifetimeMs, onExpire: () => { controller?.command({ type: 'stop' }).catch(() => {}); } }) : null;
  controller = new Controller({ ...config, targetPort: gate?.port ?? config.targetPort, servicePort: config.targetPort, step, journal });
  controller.driver.lifetimeMs = config.lifetimeMs;
  controller.driver.probeWaitMs = config.probeWaitMs;
  controller.driver.observeProcessOutput = config.observeProcessOutput === true;
  controller.driver.onProcessOutput = event => {
    try { processOutputObserver?.(event); } catch {}
    if (!event.completeLine || event.sessionId !== controller.sessionId || event.adapterId !== selectedAdapter?.id ||
        controller.driver.stopped || controller.state?.stopRequested) return;
    const resource = controller.driver.journal.value.owned[event.resourceId];
    if (!resource || resource.kind !== 'process' || resource.retired || resource.sessionId !== event.sessionId ||
        resource.adapterId !== event.adapterId || resource.generation !== event.generation || resource.continuityRef !== event.continuityRef) return;
    const adapter = controller.driver.adapters.find(item => item.id === event.adapterId);
    if (adapter?.ownership !== 'owned' || adapter.planVersion !== 1) return;
    const origin = routeAnnouncement(adapter.recipes?.create?.parser, event.completeLine);
    if (!origin) return;
    if (origin === controller.state?.published || origin === controller.state?.candidate || queuedRouteOrigins.has(origin)) return;
    queuedRouteOrigins.add(origin);
    routeQueue = routeQueue.then(async () => {
      if (origin === controller.state?.published || origin === controller.state?.candidate || controller.driver.stopped || controller.state?.stopRequested) return;
      const activeUntil = Date.now() + 2000;
      while (Date.now() < activeUntil && !controller.state?.resources?.some(item => item.id === event.resourceId && item.cleanup === 'active')) {
        if (controller.driver.stopped || controller.state?.stopRequested) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!controller.state?.resources?.some(item => item.id === event.resourceId && item.cleanup === 'active')) return;
      if (origin === controller.state?.published || origin === controller.state?.candidate) return;
      const identity = await processIdentity(resource.pid);
      if (identity !== resource.startIdentity || controller.driver.stopped || controller.state?.stopRequested) return;
      const current = controller.driver.journal.value.owned[event.resourceId];
      if (current !== resource || current.retired || current.continuityRef !== event.continuityRef) return;
      const receipt = await controller.driver.continuity(event.resourceId);
      if (!receipt?.continuous || receipt.handleRef !== event.resourceId || receipt.continuityRef !== event.continuityRef ||
          receipt.sessionId !== event.sessionId || receipt.expiresAtMs <= controller.driver.nowMs() ||
          controller.driver.stopped || controller.state?.stopRequested || controller.driver.journal.value.owned[event.resourceId] !== resource || resource.retired) return;
      if (origin === controller.state?.published || origin === controller.state?.candidate) return;
      const result = await controller.command({ type: 'owned-process-origin', sessionId: event.sessionId, adapterId: event.adapterId,
        resourceId: event.resourceId, allocationGeneration: event.generation, continuityRef: event.continuityRef, origin, line: event.completeLine });
      if (config.approveOrigin === true && result.snapshot?.phase === 'candidate-ready' && result.snapshot.candidate === origin &&
          !controller.driver.stopped && !controller.state?.stopRequested) {
        await controller.command({ type: 'approve-origin', origin, generation: result.snapshot.generation });
      }
    }).catch(() => {}).finally(() => queuedRouteOrigins.delete(origin));
  };
  if (operational) await prepareHost(controller.driver, selectedAdapter, { origin: config.origin, gate, probeExecutor, authorities: hostAuthorities });
  let setupPending = Boolean(gate && selectedAdapter?.setup?.requiresProxyTarget);
  const present = output => ({ ...output, ...(gate ? { lifetimeMs: gate.lifetimeMs, expiresAtMs: gate.expiresAtMs } : {}), ...(selectedAdapter?.clientProfile ? { connectionProfile: selectedAdapter.clientProfile } : {}),
    ...(setupPending && !controller.state?.stopRequested ? { action: { kind: 'external', instruction: `Point the existing origin ${config.origin} at ${gate.target}, then run ${cliCommand('health', config.targetPort)}.`, target: gate.target, recheckCommand: 'health' } } : {}) });
  const nonce = randomUUID();
  const identity = { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce };
  // Only remove a stale socket after proving the prior daemon identity is gone.
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (await processIdentity(prior.pid) === prior.startIdentity) throw new Error('Existing controller is still running');
    await unlink(socketPath(directory)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let closing = false;
  let initializedDone = false;
  let initializedResolve;
  let armMonitor = () => {};
  const initialized = new Promise(resolve => { initializedResolve = resolve; });
  const server = net.createServer(socket => {
    let input = '', dispatched = false;
    socket.setTimeout((config.probeWaitMs ?? 5000) + 120000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      input += chunk;
      if (input.length > 65_536) return socket.destroy();
      if (dispatched || !input.includes('\n')) return;
      dispatched = true;
      try {
        const message = JSON.parse(input.split('\n')[0]);
        if (message.nonce !== nonce) throw new Error('Controller identity mismatch');
        const command = message.command;
        if (command?.type === 'process-output') {
          if (!Number.isSafeInteger(command.after ?? 0) || (command.after ?? 0) < 0) throw new Error('Invalid output cursor');
          socket.end(`${JSON.stringify({ events:controller.driver.readProcessOutput(command.after ?? 0) })}\n`); return;
        }
        if (!['status', 'health', 'update-origin', 'stop', 'reconcile', 'approve-origin'].includes(command?.type)) throw new Error('Unsupported controller command');
        if (command.initial === true) await initialized;
        let output;
        if (command.type === 'stop') {
          output = await controller.shutdown();
          if (output.snapshot.phase === 'stopped' && !output.localCleanupFailures.length) closing = true;
        } else {
          if (setupPending && command.type === 'health') {
            setupPending = false;
            output = await controller.command({ type: 'start', adapterId: config.adapterId, consent: config.consent === true });
            if (config.approveOrigin && output.snapshot.phase === 'candidate-ready') output = await controller.approve();
            armMonitor();
            socket.end(`${JSON.stringify(publicReply(present(output), directory))}\n`); return;
          }
          if (command.type === 'update-origin') {
            if (selectedAdapter?.ownership !== 'external-owned') throw new Error('Origin updates require an external-owned route');
            const origin = (await import('./catalog.mjs')).safeOrigin(command.origin);
            if (!origin.startsWith('https:')) throw new Error('External origin requires HTTPS');
            const nowMs = controller.driver.nowMs();
            controller.driver.host.bindings.externalOrigin = { type: 'credential-free-https-origin', value: origin, authorityRef: randomUUID(),
              sessionId: controller.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 900000 };
            config.origin = origin;
            if (setupPending) { socket.end(`${JSON.stringify(publicReply(present(controller.present()), directory))}\n`); return; }
          }
          const fresh = controller.driver.acceptedProbeReceipt?.expiresAtMs > controller.driver.nowMs() && controller.driver.proofGeneration === controller.state?.generation;
          const health = initializedDone && operational && ['status', 'health'].includes(command.type) && !command.initial && (command.type === 'health' || !fresh) && controller.state?.selected && !controller.state?.stopRequested;
          output = await controller.command(health ? { type: 'health' } : command);
          if (config.approveOrigin && output.snapshot.phase === 'candidate-ready') output = await controller.approve();
        }
        socket.end(`${JSON.stringify(publicReply(present(output), directory))}\n`);
        if (closing) server.close();
      } catch (error) { socket.end(`${JSON.stringify({ error: error.message })}\n`); }
    });
  });
  // First listen, then publish identity. A status response always names this running controller.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath(directory), resolve); });
  await chmod(socketPath(directory), 0o600);
  await atomicWrite(join(directory, 'control.json'), identity);
  let monitor;
  server.on('close', async () => {
    clearInterval(monitor);
    await gate?.close();
    controller.driver.outputEvents = []; controller.driver.outputBytes = 0;
    // Keep the last controller identity for crash/status auditing. The socket closes here;
    // every status call still proves the process birth identity and authenticates its live socket.
  });
  const terminate = async () => {
    if (closing) return;
    closing = true;
    await controller.shutdown().catch(() => {});
    server.close();
  };
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  try {
    // An owner-managed proxy cannot point at the new gate until its target is visible.
    if (!setupPending) await controller.command({ type: 'detect' });
    const planned = await controller.command({ type: 'recommend' });
    const selected = config.adapterId ?? planned.snapshot.recommendations[0];
    if (selected && config.consent && !setupPending) {
      await controller.command({ type: 'start', adapterId: selected, consent: true });
      // CLI approval is explicit and exact; never turn an unvalidated candidate into a published URL.
      if (config.approveOrigin === true) await controller.approve();
    }
  } catch (error) {
    await atomicWrite(join(directory, 'failure.json'), { message: error.message });
    await terminate();
    throw error;
  } finally { initializedDone = true; initializedResolve(); }
  if (operational) {
    armMonitor = () => {
      if (closing || controller.state?.stopRequested || !controller.state?.selected) return;
      const expires = controller.driver.proofExpiries.get(controller.state.generation);
      const delay = expires ? Math.max(250, Math.min(30000, expires - controller.driver.nowMs() - 1000)) : 10000;
      monitor = setTimeout(async () => {
        if (closing || controller.state?.stopRequested) return;
        try {
          if (!controller.inFlight.size) {
            const result = await controller.command({ type: 'health' });
            if (config.approveOrigin && result.snapshot.phase === 'candidate-ready') await controller.approve();
          }
        } catch (error) { controller.hostLimitations.add(error.message); }
        armMonitor();
      }, delay);
      monitor.unref();
    };
    armMonitor();
  }
  return { server, controller, gate, terminate };
}

export function publicReply(output, directory) {
  return { ...(output.lifetimeMs !== undefined ? { lifetimeMs: output.lifetimeMs, expiresAtMs: output.expiresAtMs } : {}), snapshot: { ...output.snapshot, adapterId: output.state?.selected ?? output.snapshot?.adapterId }, ...(output.action ? { action: output.action } : {}), ...(output.gateTarget ? { gateTarget: output.gateTarget } : {}), ...(output.validation ? { validation: output.validation } : {}), journalPath: join(directory, 'session.json'),
    ...(output.connectionProfile ? { connectionProfile: output.connectionProfile } : {}),
    ...(output.localCleanupFailures ? { localCleanupFailures: output.localCleanupFailures } : {}) };
}

export function recoveryAdapters(saved, installed) {
  return saved.map(record => {
    const { endpointLifetime: ignored, ...adapter } = record;
    const current = installed.find(item => item.id === adapter.id);
    if (adapter.planVersion === 1 && adapter.ownership === 'owned' && current?.ownership === 'owned' && current.admission?.state === 'admitted' &&
        current.endpointLifetime === 'owned-process' && isDeepStrictEqual(adapter.recipes, current.recipes) &&
        isDeepStrictEqual(adapter.bindings, current.bindings) && isDeepStrictEqual(adapter.admission, current.admission)) return { ...adapter, endpointLifetime: current.endpointLifetime };
    return adapter;
  });
}

// Recover only local handles recorded by a dead controller. Never replay a create or remote deletion.
export async function recoverStop(directory) {
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (prior.startIdentity && await processIdentity(prior.pid) === prior.startIdentity) throw new Error('Controller is alive; use its private stop channel');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const journal = new Journal(directory); await journal.load();
  if (!journal.value.state) throw new Error('No recorded session to stop');
  const step = await loadCore();
  const state = journal.value.state;
  const installed = await loadCatalog(fileURLToPath(new URL('../../', import.meta.url)), { operational: true });
  const adapters = recoveryAdapters(state.adapters, installed);
  const controller = new Controller({ step, journal, adapters, requirements: state.requirements,
    targetPort: journal.value.targetPort, sessionId: state.sessionId });
  controller.state = state;
  controller.driver.recoveryOnly = true;
  controller.driver.host.features = [...new Set([...LOCAL_PLAN_FEATURES, ...(state.host?.features ?? []).filter(feature => ['probe-assertions', 'client-vantage-probe'].includes(feature))])];
  controller.driver.authorize(state.selected);
  const result = await controller.shutdown();
  return publicReply(result, directory);
}
