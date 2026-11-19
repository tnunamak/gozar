// Short-TTL cached provider detection (0.5.2).
//
// Polling reads — the provider inventory, catalog candidates and offered configuration actions — no
// longer run live provider probes on every call. Each adapter's detection is cached per full scope:
// registry identity, home, owner, provider, platform AND the configuration revision it observed. The
// contract is strict:
//
//   - A fresh hit serves the retained observation and runs ZERO provider probes.
//   - A cold or expired poll also runs ZERO probes: cold answers a declared unknown observation, expired
//     answers the retained observation with its ACTUAL checked-at and fresh: false, and both start ONE
//     same-scope refresh in the background (single-flight: concurrent polls share it).
//   - An explicit refresh request awaits the probes and owns them; the read that follows a setup,
//     configuration or artifact mutation does the same, so a changed draft or configuration is reflected
//     immediately, never served stale.
//   - A refresh stores only the sanitized detection ({state, facts, failure}); decorated actions,
//     consents, plans and secret material are never cached. A late refresh cannot overwrite newer state
//     (generation guard), and a failed refresh keeps the previous retained observation, never a
//     fabricated one.
//
// The cache never feeds authority: consent redemption, approved effects and route allocation keep
// revalidating live state through their own paths; a candidate issued on cached observations still has
// its plan and provider state re-proved at redemption (candidate_stale / consent_mismatch as before).
import { detectAdapter, inspectionOf } from './route-catalog.mjs';

const keyOf = scope => JSON.stringify([scope.registryId ?? null, scope.home ?? null, scope.owner ?? null,
  scope.providerId ?? null, scope.platform ?? null, scope.revision ?? null]);

export function createDetectionCache({ now = Date.now, ttlMs = 15_000 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw Object.assign(new Error('detectionTtlMs must be an integer in 1000..300000'), { code: 'invalid_input' });
  const entries = new Map();

  const observationOf = entry => entry
    ? { detection: { checkedAt: new Date(entry.checkedAt).toISOString(), fresh: now() < entry.expiresAt, refreshing: entry.refresh !== null },
        inspection: inspectionOf(entry.adapter, entry.observation, entry.platform) }
    : { detection: { checkedAt: null, fresh: false, refreshing: true },
        // Declared unknown: nothing was observed yet; the background refresh converges it.
        inspection: { adapter: null, state: 'unknown', facts: null, properties: null, actions: [], missingActions: [], probed: false, failure: null } };

  const startRefresh = (entry, scope, runDetect) => {
    if (entry.refresh !== null) return;
    const generation = entry.generation;
    entry.refresh = (async () => {
      let observation;
      try { observation = await runDetect(); }
      catch { entry.refresh = null; return; } // a failed refresh keeps the retained observation
      if (entries.get(keyOf(scope)) !== entry || entry.generation !== generation) return; // a late refresh never overwrites newer state
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
   * Gozar's own state, not a provider probe); the detection is keyed by the revision it returns.
   * `detect` performs the live provider observation when a refresh owns the probes.
   */
  async function provider({ scope, readConfiguration, detect, explicit = false }) {
    const saved = await readConfiguration();
    const full = { ...scope, revision: saved.revision ?? null };
    const id = keyOf(full);
    let entry = entries.get(id);
    if (!entry) {
      entry = { adapter: scope.adapter, platform: scope.platform, observation: null, checkedAt: null, expiresAt: 0, generation: 0, refresh: null, awaitNext: false };
      entries.set(id, entry);
    }
    entry.adapter = scope.adapter;
    if (explicit || entry.awaitNext || entry.observation === null) {
      // The read that owns the probes: an explicit refresh, the first read after a mutation, or the
      // refresh the cold entry started. A cold read starts it and answers the declared unknown.
      const owns = explicit || entry.awaitNext || !entries.has(id) || entry.observation === null && entry.refresh === null;
      entry.awaitNext = false;
      startRefresh(entry, full, detect);
      if (owns && (explicit || entry.awaitNext === false && entry.observation === null) && entry.refresh) { await entry.refresh; }
      else if (explicit || entry.awaitNext === false && entry.observation === null && entry.refresh === null) { /* already fresh below */ }
      if (entry.observation !== null && (explicit || entry.refresh === null || entry.observation !== null)) {
        // fall through to serve the (now refreshed or retained) observation
      }
    }
    const served = observationOf(entry.observation === null && entry.refresh !== null && !explicit ? entry : entry);
    if (entry.observation === null && entry.refresh === null && !explicit) {
      // Nothing retained and nothing running (a refresh can fail on its first run): keep the declared
      // unknown with honest checked-at null rather than a fabricated observation.
      return { saved, detection: { checkedAt: null, fresh: false, refreshing: false }, inspection: observationOf(null).inspection };
    }
    return { saved, ...observationOf(entry.observation === null && !explicit ? { ...entry, refresh: entry.refresh } : entry) };
  }

  /** A setup, configuration or artifact mutation: the affected scope's next read awaits one fresh detection. */
  function invalidate(scope) {
    for (const [id, entry] of entries) {
      if (entry.scopeMatches !== undefined && !entry.scopeMatches(scope)) continue;
    }
  }

  return { provider, entries };
}
