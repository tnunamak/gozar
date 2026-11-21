// The command line's view of the sessions in one Gozar home (`port-N` directories). It reads and closes; it never starts.
//   generic sessions      the generic session runtime's own record and controller (attached-route.mjs)
//   earlier-version ones  history only, journal-only recovery (legacy-session-record.mjs)
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalHome, readRecord } from './service-state.mjs';
import { sessionTargetCheck } from './target-check.mjs';
import { gozarError } from './error-normalizer.mjs';

const optional = async path => { try { return await readRecord(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

/** One entry per recorded session. Every entry is a read: a running controller is observed, a dead one is history. */
export async function sessionInventory(home) {
  const { observeAttachedRoute } = await import('./attached-route.mjs');
  const entries = [];
  let names = [];
  try { names = await readdir(home); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names.sort()) {
    const match = /^port-([0-9]+)$/.exec(name);
    if (!match) continue;
    const port = Number(match[1]), directory = join(home, name);
    const bootstrap = await optional(join(directory, 'bootstrap.json'));
    if (bootstrap?.execution === 'generic-session-v1') {
      try {
        const view = await observeAttachedRoute({ home, handle: bootstrap.handle }, { asStatus: true });
        entries.push({ port, handle: bootstrap.handle, state: view.state, origin: view.published ?? null, cleanup: view.cleanup.state, targetCheck: await sessionTargetCheck(port) });
      } catch (error) { entries.push({ port, handle: bootstrap.handle, state: 'unknown', origin: null, cleanup: 'unknown', error: error.message }); }
      continue;
    }
    // An earlier version's record: never presented as current, and a missing journal is not an absence.
    const journal = await optional(join(directory, 'session.json')).catch(() => null);
    const owned = Object.keys(journal?.owned ?? {}).length;
    entries.push({ port, earlierVersion: true, state: owned ? 'cleanup-pending' : 'not-running', origin: null, cleanup: owned ? 'unconfirmed' : 'none' });
  }
  return entries;
}

/** Closes the one session recorded for a port, through the runtime that owns its record. */
export async function stopSessionByPort(home, port) {
  const directory = join(await canonicalHome(home, false), `port-${port}`);
  const bootstrap = await optional(join(directory, 'bootstrap.json'));
  if (!bootstrap) throw gozarError('route_not_found', `No recorded session on port ${port}`);
  if (bootstrap.execution === 'generic-session-v1') {
    const { closeAttachedRoute } = await import('./attached-route.mjs');
    return { ...await closeAttachedRoute({ home, handle: bootstrap.handle }), port };
  }
  const { closeLegacySession } = await import('./legacy-session-record.mjs');
  const result = await closeLegacySession(directory, null);
  const stopped = result.snapshot?.phase === 'stopped' && !result.localCleanupFailures?.length;
  return { port, earlierVersion: true, state: stopped ? 'released' : 'uncertain', cleanup: { state: stopped ? 'confirmed' : 'unconfirmed' } };
}
