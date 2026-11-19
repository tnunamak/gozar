// Short-TTL cached provider detection (0.5.2).
//
// Polling reads (the provider inventory and offered configuration actions) NEVER run a live provider
// probe, cold or expired. Each adapter's detection is retained per full scope: registry identity, home,
// owner, provider, platform, draft, and the configuration revision it observed.
//
//   - A fresh hit serves the retained observation (`fresh: true`).
//   - An expired hit serves the retained observation with its ACTUAL checked-at and `fresh: false`.
//   - A cold read answers a declared unknown observation (`checkedAt: null`): declared configuration
//     inputs are still offered, facts that need a probe are not.
//   - Only an explicit refresh request runs the probes. Concurrent refreshes of one scope share one
//     probe (single-flight) and each awaits it.
//   - A refresh stores only the sanitized detection ({state, facts, failure}); decorated actions,
//     consents, plans and secret material are never cached. A mutation (setup, configuration, clear,
//     commit, discard, install, backend change) deletes the scope's entries and bumps their generation, so
//     a refresh still in flight for the old state can never store into the new one. A failed refresh keeps
//     the previous retained observation, never a fabricated one.
//
// The cache never feeds authority: the route catalog, consent redemption, approved effects and route
// allocation observe live state through their own paths (candidate_stale / consent_mismatch as before).
import { detectAdapter, inspectionOf } from './route-catalog.mjs';

const bareKeyOf = scope => JSON.stringify([scope.registryId ?? null, scope.home ?? null, scope.owner ?? null,
  scope.providerId ?? null, scope.platform ?? null]);
const keyOf = scope => `${bareKeyOf(scope)}\u0000${scope.draftId ?? null}\u0000${scope.revision ?? null}`;
// Mutations name registry, home, owner and provider; every platform and draft of that scope is dropped.
const mutationScopeOf = scope => [scope.registryId ?? null, scope.home ?? null, scope.owner ?? null, scope.providerId ?? null];

// The closed retained projection of one observation: only the scalar facts the adapter's definition names
// (`local-observation:` pointers) are kept, rebuilt from scratch; everything else the probe returned is dropped.
function closedFacts(adapter, facts) {
  const out = {};
  for (const fact of adapter.definition.facts ?? []) {
    if (!fact.source?.startsWith('local-observation:')) continue;
    const pointer = fact.source.slice('local-observation:'.length);
    if (pointer === '' || !pointer.startsWith('/')) continue;
    const keys = pointer.slice(1).split('/').map(k => k.replaceAll('~1', '/').replaceAll('~0', '~'));
    let source = facts, target = out;
    for (let n = 0; n < keys.length; n++) {
      if (!source || typeof source !== 'object' || !Object.hasOwn(source, keys[n])) break;
      source = source[keys[n]];
      if (n < keys.length - 1) { if (!Object.hasOwn(target, keys[n])) target[keys[n]] = {}; target = target[keys[n]]; }
      else if (source === null || ['boolean', 'string', 'number'].includes(typeof source)) target[keys[n]] = source;
    }
  }
  return out;
}

export function createDetectionCache({ now = Date.now, ttlMs = 15_000 } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000)
    throw Object.assign(new Error('detectionTtlMs must be a number in 1000..300000'), { code: 'invalid_input' });
  const entries = new Map();   // full key -> retained entry

  // Nothing observed: the adapter's DECLARED configuration actions are static (no provider I/O), so the
  // draft can still collect its inputs; actions that depend on observed facts appear after a refresh.
  const declaredUnknown = adapter => {
    let actions = [];
    try { actions = adapter.configurationActions ? adapter.configurationActions() : adapter.setupActions({ setupNeeded: true }); } catch { /* none declared */ }
    return { adapter, state: 'unknown', facts: null, properties: adapter?.definition?.capabilities ?? null,
      actions, missingActions: [], probed: false, failure: null, live: false };
  };

  // The projection kept per entry: derived with the raw facts once, transiently, then stored without them.
  const project = (adapter, observation, platform) => {
    const full = inspectionOf(adapter, observation, platform);
    const { facts, ...rest } = full;
    return { ...rest, facts: facts === null ? null : closedFacts(adapter, facts) };
  };

  const startRefresh = (entry, key, runDetect) => {
    if (entry.refresh !== null) return entry.refresh;
    const generation = entry.generation;
    const run = (async () => {
      let observation;
      try { observation = await runDetect(); }
      catch { return null; } // a failed refresh keeps the retained observation
      finally { if (entry.refresh === run) entry.refresh = null; }
      if (entries.get(key) !== entry || entry.generation !== generation) return null; // displaced: never stored, never served
      if (observation.probed !== false) {
        entry.projection = project(entry.adapter, observation, entry.platform);
        entry.checkedAt = now();
        entry.expiresAt = now() + ttlMs;
        return { generation, observation };
      }
      return null;
    })();
    entry.refresh = run;
    return run;
  };

  /**
   * One provider's retained detection for one read. `readConfiguration` is ALWAYS live (it is Gozar's own
   * scoped state, not a provider probe) and its revision keys the detection; `detect` is the live
   * provider observation and runs only when `explicit` is set. The returned inspection of a retained
   * entry is marked `live: false` and carries only the closed projection: setup consent decoration must
   * treat its facts as unknown. The inspection an explicit refresh just observed is `live: true`.
   */
  async function provider({ scope, readConfiguration, detect, explicit = false }) {
    const saved = await readConfiguration();
    const key = keyOf({ ...scope, revision: saved.revision ?? null });
    let entry = entries.get(key);
    if (!entry) {
      entry = { adapter: scope.adapter, platform: scope.platform, projection: null, checkedAt: 0, expiresAt: 0, generation: 0, refresh: null,
        mutationScope: mutationScopeOf(scope) };
      entries.set(key, entry);
    }
    entry.adapter = scope.adapter;
    entry.platform = scope.platform;
    let live = null;
    if (explicit) {
      const started = entry.generation;
      const done = await startRefresh(entry, key, detect);
      // A displaced read (a mutation dropped the entry while it awaited) is never served.
      if (entries.get(key) !== entry || entry.generation !== started)
        return { saved, detection: { checkedAt: null, fresh: false, refreshing: false }, inspection: declaredUnknown(scope.adapter) };
      if (done) live = inspectionOf(entry.adapter, done.observation, entry.platform);
    }
    if (entry.projection === null)
      return { saved, detection: { checkedAt: null, fresh: false, refreshing: entry.refresh !== null }, inspection: declaredUnknown(scope.adapter) };
    return { saved, detection: { checkedAt: new Date(entry.checkedAt).toISOString(), fresh: now() < entry.expiresAt,
      refreshing: entry.refresh !== null },
      inspection: live ? { ...live, live: true } : { ...entry.projection, adapter: entry.adapter, live: false } };
  }

  /** A mutation: the scope's retained entries are gone; the next read answers declared unknown until an explicit refresh. */
  function invalidate(scope) {
    const target = mutationScopeOf(scope);
    // A mutation that names no provider (discarding a secret handle) drops every provider of the scope: the safe direction.
    for (const [key, entry] of entries) {
      if (!entry.mutationScope.every((part, index) => index === 3 && target[3] === null ? true : part === target[index])) continue;
      entry.generation += 1; // a refresh still in flight for the old state can never store into it, nor be served
      entries.delete(key);
    }
  }

  return { provider, invalidate, entries };
}
