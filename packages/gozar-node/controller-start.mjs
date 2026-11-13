import { processIdentity } from './process-identity.mjs';

// A detached controller outlives the process that started it. If the start fails for any reason, the
// starter must stop that controller itself, and must prove it is gone. Two rules decide everything here:
//   - A null identity means "no such process" only when the identity function can read this process's
//     start time. It is never taken as proof that a live child has exited.
//   - A signal goes out only to a process that is proven to be the one we started: its recorded identity
//     still matches, or (when no identity could be recorded) our own ChildProcess handle has not seen it
//     exit, which means the kernel has not reaped it and its PID cannot belong to anyone else.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const handleAlive = child => Boolean(child) && child.exitCode === null && child.signalCode === null;

/** Record the identity of a controller that was just spawned. Call this right after the 'spawn' event. */
export async function recordController(child, { identity = processIdentity } = {}) {
  return { pid: child.pid, startIdentity: await identity(child.pid), child };
}

/**
 * Whose process is `record.pid` now? 'ours' (running), 'gone' (exit proven) or 'foreign' (the PID was reused).
 * Throws when it cannot tell: no identity was recorded and there is no child handle, or the identity cannot be read.
 */
export async function observeController(record, { identity = processIdentity } = {}) {
  if (record.child && !handleAlive(record.child)) return 'gone';
  if (record.startIdentity) {
    let current;
    try { current = await identity(record.pid); }
    catch (error) {
      // Our own handle still has not seen the exit, so the kernel has not reaped it: the PID is still ours.
      if (handleAlive(record.child)) return 'ours';
      throw error;
    }
    if (current === null) return 'gone';
    return current === record.startIdentity ? 'ours' : 'foreign';
  }
  if (record.child) return 'ours';
  throw new Error('Cannot tell whether the controller is running: no identity was recorded for it');
}

/** True while the recorded controller is running. False only when its exit is proven. Throws when it cannot tell. */
export async function controllerAlive(record, options) {
  return await observeController(record, options) === 'ours';
}

/**
 * Stop a detached controller and its process group: SIGTERM, then SIGKILL after graceMs.
 * Resolves with the outcome, and never throws for an ordinary failure:
 *   'gone'        the controller was already gone, proven by the identity function or the child handle
 *   'stopped'     it exited after SIGTERM
 *   'killed'      it needed SIGKILL
 *   'foreign'     the PID now belongs to another process; nothing was signalled
 *   'unconfirmed' it could not be proven gone; the caller must say so
 */
export async function stopController(record, { identity = processIdentity, kill = process.kill.bind(process), graceMs = 5000, killWaitMs = 5000, pollMs = 25 } = {}) {
  const observe = () => observeController(record, { identity });
  const send = signal => {
    // The controller is detached, so it leads its own process group: -pid reaches its descendants too.
    try { kill(-record.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const waitGone = async ms => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await observe() !== 'ours') return true;
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
  };
  try {
    const first = await observe();
    if (first !== 'ours') return { state: first, pid: record.pid }; // 'gone' or 'foreign': nothing to signal
    send('SIGTERM');
    if (await waitGone(graceMs)) return { state: 'stopped', pid: record.pid };
    // Prove identity again immediately before the stronger signal; the PID may have been reused while we waited.
    if (await observe() !== 'ours') return { state: 'stopped', pid: record.pid };
    send('SIGKILL');
    if (await waitGone(killWaitMs)) return { state: 'killed', pid: record.pid };
    return { state: 'unconfirmed', pid: record.pid };
  } catch (error) {
    return { state: 'unconfirmed', pid: record.pid, error };
  }
}

/** Reports the original error after cleanup. An unproven cleanup is stated in the message; the cause stays the original. */
export function withCleanupOutcome(error, outcome) {
  if (outcome.state === 'unconfirmed') {
    const wrapped = new Error(`${error.message} The controller (pid ${outcome.pid}) could not be confirmed stopped; inspect it and stop it by hand.`, { cause: error });
    for (const key of ['code', 'provider', 'nextAction']) if (error[key] !== undefined) wrapped[key] = error[key];
    wrapped.controllerCleanup = outcome;
    return wrapped;
  }
  try { error.controllerCleanup = outcome; } catch {}
  return error;
}
