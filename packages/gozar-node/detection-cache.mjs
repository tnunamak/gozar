// Short-TTL cached provider detection (0.5.2).
//
// Polling reads — the provider inventory, catalog candidates and offered configuration actions — no
// longer run live provider probes on every call. Each adapter's detection is cached per full scope:
// registry identity, home, owner, provider, platform AND the configuration revision it observed. The
// contract is strict:
//
//   - A fresh hit serves the retained observation and runs ZERO provider probes.
//   - A cold or expired poll also runs ZERO probes: a cold read answers a declared unknown observation,
//     an expired read answers the retained observation with its ACTUAL checked-at and fresh: false, and
//     both start ONE same-scope refresh in the background (single-flight: concurrent polls share it).
//   - An explicit refresh request awaits the probes and owns them; the read that follows a setup,
//     configuration or artifact mutation does the same, so a changed draft or configuration is reflected
//     immediately, never served stale.
//   - A refresh stores only the sanitized detection ({state, facts, failure}); decorated actions,
//     consents, plans and secret material are never cached. A late refresh cannot overwrite newer state
//     (a mutation deletes the scope's entries first, and the generation guard fences races), and a failed
//     refresh keeps the previous retained observation, never a fabricated one.
//
// The cache never feeds authority: consent redemption, approved effects and route allocation keep
// revalidating live state through their own paths; a candidate issued on cached observations still has
// its plan and provider state re-proved at redemption (candidate_stale / consent_mismatch as before).
import { detectAdapter, inspectionOf } from './route-catalog.mjs';

const bareKeyOf = scope => JSON.stringify([scope.registryId ?? null, scope.home ?? null, scope.owner ?? null,
  scope.providerId ?? null, scope.platform ?? null]);
const keyOf = scope => `${bareKeyOf(scope)}\u0000${scope.draftId ?? null}\u0000${scope.revision ?? null}`;

export function createDetectionCache({ now = Date.now, ttlMs = 15_000 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw Object.assign(new Error('detectionTtlMs must be a number in 1000..300000'), { code: 'invalid_input' });
  const entries = new Map();   // full key -> retained entry
  const pending = new Map();   // bare key -> the scope's next read awaits one fresh detection

  const declaredUnknown = adapter => ({ adapter, state: 'unknown', facts: null, properties: adapter?.definition?.capabilities ?? null,
    actions: [], missingActions: [], probed: false, failure: null });

  const startRefresh = (entry, key, runDetect) => {
    if (entry.refresh !== null) return;
    const generation = entry.generation;
    entry.refresh = (async () => {
      let observation;
      try { observation = await runDetect(); }
      catch { entry.refresh = null; return; } // a failed refresh keeps the retained observation
      if (entries.get(key) !== entry || entry.generation !== generation) return; // late refreshes never overwrite newer state
      entry.refresh = null;
      if (observation.probed !== false) {
        entry.observation = observation;
        entry.checkedAt = now();
        entry.expiresAt = now() + ttlMs;
      }
    })();
  };

  /**
   * One provider's cached detection for one polling read. `readConfiguration` is ALWAYS live (it is
   * Gozar's own scoped state, not a provider probe) and its revision keys the detection; `detect`
   * performs the live provider observation when a refresh owns the probes.
   */
  async function provider({ scope, readConfiguration, detect, explicit = false }) {
    const saved = await readConfiguration();
    const key = keyOf({ ...scope, revision: saved.revision ?? null });
    let entry = entries.get(key);
    if (!entry) {
      const bare = bareKeyOf(scope);
      entry = { adapter: scope.adapter, platform: scope.platform, observation: null, checkedAt: 0, expiresAt: 0,
        generation: 0, refresh: null, awaitNext: pending.get(bare) === true };
      pending.delete(bare);
      entries.set(key, entry);
    }
    entry.adapter = scope.adapter;
    entry.platform = scope.platform;
    const owns = explicit || entry.awaitNext;
    entry.awaitNext = false;
    if (owns) {
      startRefresh(entry, key, detect);
      await entry.refresh; // this read owns the probes
    } else if (entry.observation === null || now() >= entry.expiresAt) {
      startRefresh(entry, key, detect); // answered from retained state; one background refresh converges it
    }
    if (entry.observation === null)
      return { saved, detection: { checkedAt: null, fresh: false, refreshing: entry.refresh !== null },
        inspection: declaredUnknown(scope.adapter) };
    return { saved, detection: { checkedAt: new Date(entry.checkedAt).toISOString(), fresh: now() < entry.expiresAt,
      refreshing: entry.refresh !== null }, inspection: inspectionOf(entry.adapter, entry.observation, entry.platform) };
  }

  /** A setup, configuration or artifact mutation: the scope's retained entries are gone and its next read awaits one fresh detection. */
  function invalidate(scope) {
    const bare = bareKeyOf(scope);
    pending.set(bare, true);
    for (const [key, entry] of entries) {
      if (key.split('\u0000')[0] !== bare) continue;
      entry.generation += 1; // a refresh still in flight for the old state can never store into it
      entries.delete(key);
    }
  }

  return { provider, invalidate, entries };
}
