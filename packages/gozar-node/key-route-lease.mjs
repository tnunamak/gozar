import { constants } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { atomicWrite, Journal, processIdentity } from './journal.mjs';
import { cliCommand } from './cli-command.mjs';
import { acquireProcessLock } from './process-lock.mjs';
import { gozarError, instructionAction } from './error-normalizer.mjs';

const leaseFile = (identitiesDirectory, keyFingerprint) =>
  join(identitiesDirectory, `.active-route-${keyFingerprint}.json`);
const lockFile = (identitiesDirectory, keyFingerprint) =>
  join(identitiesDirectory, `.active-route-${keyFingerprint}.lock`);

const stopAction = (port, home) => instructionAction('stop-key-holder', `Stop the route on port ${port}`, `Run: ${cliCommand('stop', port, home)}`);
const heldError = (port, home) => gozarError('route_conflict', `The installation key is held by port ${port}. Stop it with ${cliCommand('stop', port, home)}.`, stopAction(port, home));
const unconfirmedError = (port, home, cause) => gozarError('cleanup_debt',
  `The installation key is still held by port ${port}; cleanup is not confirmed. Run ${cliCommand('stop', port, home)} and inspect that session.`, stopAction(port, home), cause);
const unreadableError = home => gozarError('route_conflict', 'Installation key lease is unreadable; inspect its recorded session before retrying',
  instructionAction('inspect-key-holder', 'Find the route that holds the installation key', `Run: ${cliCommand('status', undefined, home)}`));

async function withLock(path, action) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const anchor = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await anchor.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600)
      throw Object.assign(new Error('Installation key lease lock ownership or mode mismatch'), { code: 'unsafe_state_path' });
  } finally { await anchor.close(); }
  let release;
  try { release = await acquireProcessLock(path, { waitMs: 120_000 }); }
  catch (error) {
    if (error.code === 'busy') throw gozarError('busy', 'Installation key lease lock is busy; try again in a moment', null, error);
    throw error;
  }
  try { return await action(); } finally { await release(); }
}

async function readLease(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function validLease(value) {
  return value?.version === 1 && typeof value.leaseId === 'string' &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.startIdentity === 'string' &&
    typeof value.sessionId === 'string' && typeof value.sessionDirectory === 'string' &&
    Number.isInteger(value.targetPort) && value.targetPort > 0 && value.targetPort <= 65535;
}

async function recoverOwner(owner) {
  const sessionDirectory = resolve(owner.sessionDirectory);
  if (dirname(sessionDirectory) !== resolve(owner.home) || !/^port-[1-9]\d*$/.test(basename(sessionDirectory)))
    throw new Error('Previous key owner session path is outside this Gozar home');
  const journal = new Journal(owner.sessionDirectory);
  await journal.load();
  const ownerIntents = () => {
    const intents = Object.values(journal.value.intents ?? {});
    if (intents.some(intent => typeof intent.sessionId !== 'string' || !intent.sessionId))
      throw new Error('Previous key owner has an intent without a session identity');
    // serve starts a new session only after the prior state is stopped and owned is empty.
    // Its retained audit records are not resource authority for the current lease owner.
    return intents.filter(intent => intent.sessionId === owner.sessionId);
  };
  const createIntents = intents => intents.filter(intent => intent.operation === 'create');
  const matchCreatedResources = (intents, state) => createIntents(intents).map(intent => {
    const unkeyedPeers = createIntents(intents).filter(peer => !peer.resourceId &&
      peer.adapterId === intent.adapterId && peer.generation === intent.generation);
    if (!intent.resourceId && unkeyedPeers.length !== 1) return { intent, resources:[] };
    const matches = state?.resources?.filter(resource => resource.adapterId === intent.adapterId &&
      resource.generation === intent.generation && resource.ownership === 'owned' &&
      (!intent.resourceId || resource.id === intent.resourceId)) ?? [];
    return { intent, resources:matches };
  });
  if (journal.value.state) {
    if (journal.value.state.sessionId !== owner.sessionId)
      throw new Error('Previous key owner session identity does not match its journal');
    const unresolvedBeforeRecovery = matchCreatedResources(ownerIntents(), journal.value.state)
      .filter(entry => entry.resources.length !== 1);
    if (unresolvedBeforeRecovery.length)
      throw new Error('Previous key owner has a create intent without a durable resource identity');
    const { recoverStop } = await import('./daemon.mjs');
    const result = await recoverStop(owner.sessionDirectory);
    if (result.snapshot?.phase !== 'stopped' || result.localCleanupFailures?.length)
      throw new Error('Previous key owner cleanup is unresolved');
  } else if (Object.keys(journal.value.owned ?? {}).length || Object.keys(journal.value.intents ?? {}).length) {
    throw new Error('Previous key owner has unjournaled session state');
  }
  await journal.load();
  if (journal.value.state && journal.value.state.sessionId !== owner.sessionId)
    throw new Error('Recovered session identity changed');
  if (Object.keys(journal.value.owned ?? {}).length)
    throw new Error('Previous key owner still has recorded local resources');
  const intents = ownerIntents();
  const removedResources = new Set(intents.filter(intent => intent.operation === 'remove' && intent.resourceId)
    .map(intent => intent.resourceId));
  const unresolvedCreates = matchCreatedResources(intents, journal.value.state).filter(entry =>
    entry.resources.length !== 1 || entry.resources.some(resource => resource.cleanup !== 'removed' || !removedResources.has(resource.id)));
  if (unresolvedCreates.length) throw new Error('Previous key owner has an unresolved create intent');
}

export async function acquireInstallKeyLease({ home, keyFingerprint, sessionDirectory, sessionId, targetPort }) {
  if (!/^[a-f0-9]{64}$/.test(keyFingerprint) || typeof sessionId !== 'string' || !sessionId ||
      !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)
    throw new Error('Invalid installation key lease identity');
  const identitiesDirectory = join(home, 'identities');
  const recordPath = leaseFile(identitiesDirectory, keyFingerprint);
  const mutexPath = lockFile(identitiesDirectory, keyFingerprint);
  const stop = port => cliCommand('stop', port, home);

  return withLock(mutexPath, async () => {
    const previous = await readLease(recordPath);
    if (previous) {
      if (!validLease(previous) || previous.keyFingerprint !== keyFingerprint) throw unreadableError(home);
      if (await processIdentity(previous.pid) === previous.startIdentity) throw heldError(previous.targetPort, home);
      try { await recoverOwner({ ...previous, home }); }
      catch (error) { throw unconfirmedError(previous.targetPort, home, error); }
      await unlink(recordPath);
    }

    const startIdentity = await processIdentity(process.pid);
    if (!startIdentity) throw new Error('Cannot verify this process identity for installation key ownership');
    const leaseId = randomUUID();
    await atomicWrite(recordPath, { version: 1, leaseId, keyFingerprint, pid: process.pid, startIdentity,
      sessionId, sessionDirectory, targetPort, stopCommand: stop(targetPort) });
    let released = false;
    return {
      async release() {
        if (released) return;
        await withLock(mutexPath, async () => {
          const current = await readLease(recordPath);
          if (current?.leaseId === leaseId && current.pid === process.pid && current.startIdentity === startIdentity)
            await unlink(recordPath);
        });
        released = true;
      },
    };
  });
}

// Retire a dead same-port owner before a new controller can replace its journal.
export async function retireInstallKeyLease(home, sessionDirectory) {
  let identity;
  try { identity = await readFile(join(home, 'identities', 'ed25519'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const keyFingerprint = createHash('sha256').update(identity).digest('hex');
  const identitiesDirectory = join(home, 'identities');
  const recordPath = leaseFile(identitiesDirectory, keyFingerprint);
  await withLock(lockFile(identitiesDirectory, keyFingerprint), async () => {
    const previous = await readLease(recordPath);
    if (!previous) return;
    if (!validLease(previous) || previous.keyFingerprint !== keyFingerprint) throw unreadableError(home);
    if (resolve(previous.sessionDirectory) !== resolve(sessionDirectory)) return;
    if (await processIdentity(previous.pid) === previous.startIdentity) throw heldError(previous.targetPort, home);
    try { await recoverOwner({ ...previous, home }); }
    catch (error) { throw unconfirmedError(previous.targetPort, home, error); }
    await unlink(recordPath);
  });
}
