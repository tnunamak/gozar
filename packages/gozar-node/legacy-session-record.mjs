// Sessions recorded by Gozar versions before the generic session runtime (`port-N/session.json` plus a `bootstrap.json`
// without `execution`). This version no longer runs the controller that wrote them. What it keeps is the honest record:
//   - status reads the recorded journal and reports it as history, never as a live route;
//   - close recovers only what the journal names as owned (journal-only, remove-only recovery in session-recipe.mjs);
//   - a controller that is still alive is never asked, killed or inferred away: its owner must stop it, and the handle
//     stays recoverable (`cleanup_debt`).
// A missing or unreadable record never means the provider resource is gone.
import { join } from 'node:path';
import { readRecord } from './service-state.mjs';
import { processIdentity } from './journal.mjs';
import { gozarError, instructionAction } from './error-normalizer.mjs';

const optional = async path => { try { return await readRecord(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

/** The recorded session's journal and bootstrap, bound to the exact incarnation named by the handle. */
export async function readLegacySession(directory, sessionId) {
  const bootstrap = await optional(join(directory, 'bootstrap.json'));
  const journal = await optional(join(directory, 'session.json'));
  const recorded = bootstrap?.sessionId ?? journal?.snapshot?.sessionId ?? null;
  if (sessionId && recorded !== sessionId) throw gozarError('route_conflict', 'The session was replaced; this handle is stale');
  return { bootstrap, journal };
}

/** The controller identity recorded at start, and whether that exact process still runs. */
export async function legacyControllerAlive(directory) {
  const identity = await optional(join(directory, 'control.json'));
  if (!identity?.pid || !identity.startIdentity) return { alive: false, pid: identity?.pid ?? null };
  return { alive: await processIdentity(identity.pid) === identity.startIdentity, pid: identity.pid };
}

/** Journal-only close of a recorded legacy session. Never sends a command to the old controller. */
export async function closeLegacySession(directory, sessionId) {
  const { journal } = await readLegacySession(directory, sessionId);
  if (!journal) throw gozarError('cleanup_debt', 'The recorded session journal is unavailable; the provider resource may remain. Inspect this home and retry.');
  const { alive, pid } = await legacyControllerAlive(directory);
  if (alive) throw gozarError('cleanup_debt', `An earlier Gozar version's controller (process ${pid}) still holds this session. This version does not run or stop it.`,
    instructionAction('stop-earlier-controller', 'Stop the earlier controller', `Stop process ${pid} yourself, then close this handle again.`));
  const { recoverStop } = await import('./session-recipe.mjs');
  return recoverStop(directory);
}
