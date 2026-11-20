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
  // Two present records must name the same incarnation. A partial update that left them disagreeing proves neither, so nothing is projected from
  // either and nothing is removed: the record stays debt for an owner to inspect.
  const named = [bootstrap?.sessionId, journal?.snapshot?.sessionId].filter(id => id !== undefined && id !== null);
  if (new Set(named).size > 1) throw gozarError('cleanup_debt', 'The recorded session files name different sessions; nothing was changed. Inspect this home and retry.');
  const recorded = named[0] ?? null;
  if (sessionId && recorded !== sessionId) throw gozarError('route_conflict', 'The session was replaced; this handle is stale');
  return { bootstrap, journal };
}

/**
 * The controller identity recorded at start, and whether that exact process still runs. `known` is false when no complete identity was recorded:
 * then `alive: false` only means nothing could be checked, never that the controller is gone.
 */
export async function legacyControllerAlive(directory) {
  const identity = await optional(join(directory, 'control.json'));
  if (!identity?.pid || !identity.startIdentity) return { alive: false, known: false, pid: identity?.pid ?? null };
  return { alive: await processIdentity(identity.pid) === identity.startIdentity, known: true, pid: identity.pid };
}

/** Journal-only close of a recorded legacy session. Never sends a command to the old controller. */
export async function closeLegacySession(directory, sessionId) {
  const { journal } = await readLegacySession(directory, sessionId);
  if (!journal) throw gozarError('cleanup_debt', 'The recorded session journal is unavailable; the provider resource may remain. Inspect this home and retry.');
  const { alive, known, pid } = await legacyControllerAlive(directory);
  const unresolved = Object.keys(journal.owned ?? {}).length > 0 || Object.keys(journal.intents ?? {}).length > 0 || (journal.snapshot?.phase ?? 'stopped') !== 'stopped';
  if (!known && unresolved) throw gozarError('cleanup_debt', 'No complete controller identity was recorded for this session, so it cannot be shown that the earlier controller stopped. Inspect this home and retry.');
  if (alive) throw gozarError('cleanup_debt', `An earlier Gozar version's controller (process ${pid}) still holds this session. This version does not run or stop it.`,
    instructionAction('stop-earlier-controller', 'Stop the earlier controller', `Stop process ${pid} yourself, then close this handle again.`));
  const { recoverStop } = await import('./session-recipe.mjs');
  return recoverStop(directory);
}
