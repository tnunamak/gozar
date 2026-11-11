import net from 'node:net';
import { chmod, readFile, unlink, open, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { atomicWrite, Journal, processIdentity } from './journal.mjs';
import { Controller } from './controller.mjs';
import { PublicRelayVerifier } from './public-relay.mjs';
import { ProbeDirectoryExecutor } from './probe-directory.mjs';
import { prepareHost } from './host.mjs';
import { createGate } from './gate.mjs';
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

export async function launch(directory, configuration, executable) {
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
    throw new Error('Controller startup still pending; run status before retrying expose');
  } finally { await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function serve(directory, { step: suppliedStep, probeExecutor, hostAuthorities, processOutputObserver } = {}) {
  const config = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
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
  if (!probeExecutor && config.probeDirectory) probeExecutor = new ProbeDirectoryExecutor(config.probeDirectory, { executorRef: config.probeExecutorId, requestPath: config.probeRequest, receiptPath: config.probeReceipt });
  if (!probeExecutor) probeExecutor = new PublicRelayVerifier();
  const selectedAdapter = config.adapters.find(adapter => adapter.id === config.adapterId);
  const operational = config.operational === true || selectedAdapter?.planVersion === 1;
  const gate = operational ? await createGate(config.targetPort, { onExpire: () => { controller?.command({ type: 'stop' }).catch(() => {}); } }) : null;
  controller = new Controller({ ...config, targetPort: gate?.port ?? config.targetPort, servicePort: config.targetPort, step, journal });
  controller.driver.probeWaitMs = config.probeWaitMs;
  controller.driver.observeProcessOutput = config.observeProcessOutput === true;
  controller.driver.onProcessOutput = processOutputObserver;
  if (operational) await prepareHost(controller.driver, selectedAdapter, { origin: config.origin, gate, probeExecutor, authorities: hostAuthorities });
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
          if (command.type === 'update-origin') {
            if (selectedAdapter?.ownership !== 'external-owned') throw new Error('Origin updates require an external-owned route');
            const origin = (await import('./catalog.mjs')).safeOrigin(command.origin);
            if (!origin.startsWith('https:')) throw new Error('External origin requires HTTPS');
            const nowMs = controller.driver.nowMs();
            controller.driver.host.bindings.externalOrigin = { type: 'credential-free-https-origin', value: origin, authorityRef: randomUUID(),
              sessionId: controller.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 900000 };
          }
          const fresh = controller.driver.acceptedProbeReceipt?.expiresAtMs > controller.driver.nowMs() && controller.driver.proofGeneration === controller.state?.generation;
          const health = initializedDone && operational && ['status', 'health'].includes(command.type) && !command.initial && (command.type === 'health' || !fresh) && controller.state?.selected && !controller.state?.stopRequested;
          output = await controller.command(health ? { type: 'health' } : command);
          if (config.approveOrigin && output.snapshot.phase === 'candidate-ready') output = await controller.approve();
        }
        socket.end(`${JSON.stringify(publicReply(output, directory))}\n`);
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
    await controller.command({ type: 'detect' });
    const planned = await controller.command({ type: 'recommend' });
    const selected = config.adapterId ?? planned.snapshot.recommendations[0];
    if (selected && config.consent) {
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
    const armMonitor = () => {
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
  return { snapshot: { ...output.snapshot, adapterId: output.state?.selected ?? output.snapshot?.adapterId }, ...(output.action ? { action: output.action } : {}), ...(output.gateTarget ? { gateTarget: output.gateTarget } : {}), ...(output.validation ? { validation: output.validation } : {}), journalPath: join(directory, 'session.json'),
    ...(output.localCleanupFailures ? { localCleanupFailures: output.localCleanupFailures } : {}) };
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
  const controller = new Controller({ step, journal, adapters: state.adapters, requirements: state.requirements,
    targetPort: journal.value.targetPort, sessionId: state.sessionId });
  controller.state = state;
  controller.driver.recoveryOnly = true;
  controller.driver.authorize(state.selected);
  const result = await controller.shutdown();
  return publicReply(result, directory);
}
