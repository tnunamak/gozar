// Legacy route inspection: can Gozar adopt a route another program created before it used Gozar?
//
// Gozar recognises a provider-owned legacy route through the provider itself: a rule that
// forwards to `target` (and to `origin`, when one is given), read through each durable adapter's facet.
// It reads no file format. Every path in `source.stateFiles` is opaque input: no provider-owned
// file format matters to a 0.2 consumer, so Gozar never opens those files and a route that only a
// file could describe becomes a "sign in again" setup action. Nothing here mutates anything: the
// only provider request is the read-only observation, and no token value is read or returned.
//
// The result names no app and no provider format. `migrationRef` is an opaque digest of
// {origin, target, observedResource}; adoptRoute checks it when the caller passes it back.
import { canonicalDigest } from './consent-token.mjs';
import { durableCapability } from './plan.mjs';
import { defaultHome } from './default-home.mjs';
import { durableAdapters, observeDurableStores, selectAdoptableRule, planFactsFromObservation, migrationRefOf } from './durable-route.mjs';

const refuse = (code, message) => Object.assign(new Error(message), { code });

// Sign in again: the one setup action for a route only a saved file could describe. Instructions
// only; Gozar runs nothing and shows no provider name, because it recognised no provider format.
function signInAgain() {
  const instructions = 'Gozar cannot use the saved sign-in this route came from. Sign in to the route provider again, then ask Gozar for a new route.';
  const disclosure = { revision: 'legacy-sign-in-again-1', text: 'Gozar does not read saved provider files. You will sign in again with the provider; Gozar stores no credential it cannot read.', links: [] };
  return { id: 'legacy-sign-in-again', kind: 'instructions', label: 'Sign in again', instructions, disclosure,
    digest: 'sha256:' + canonicalDigest({ id: 'legacy-sign-in-again', instructions, disclosure }) };
}

export async function inspectLegacyRoute(request, deps) {
  const { owner, source, target } = request ?? {};
  const origin = request?.origin ?? null;
  if (typeof owner !== 'string' || !owner) throw refuse('invalid_input', 'owner must be a non-empty string');
  if (!Array.isArray(source?.stateFiles) || !source.stateFiles.every(path => typeof path === 'string' && path)) throw refuse('invalid_input', 'source.stateFiles must be a list of paths');
  if (typeof target !== 'string' || !/^127\.0\.0\.1:[0-9]{1,5}$/.test(target)) throw refuse('invalid_input', 'target must be 127.0.0.1:PORT');
  if (origin !== null && typeof origin !== 'string') throw refuse('invalid_input', 'origin must be a string');
  const hasFiles = source.stateFiles.length > 0;

  const adapters = await durableAdapters(deps);
  let entries = null;
  {
    const observation = await observeDurableStores(adapters, request?.home ?? defaultHome(), { tolerant: true });
    if (observation.errors.length && !observation.entries.length) {
      const [error] = observation.errors;
      // Files cannot be read, and the provider is not answering: the only thing left is to sign in again.
      if (!(hasFiles && typeof error.provider === 'string')) throw error;
    } else entries = observation.entries;
  }
  const result = (state, reasonCode, extra = {}) => ({ schemaVersion: 1,
    migrationRef: migrationRefOf({ origin: extra.origin ?? origin, target, observedResource: extra.observedResource ?? null }),
    origin: extra.origin ?? origin, target, bridgeHome: null, state, reasonCode, nextAction: extra.nextAction ?? null });
  if (!entries) return result('blocked', 'unrecognized_format', { nextAction: signInAgain() });

  // Every candidate listener, on every durable adapter, that forwards to this target.
  const hits = new Map();
  const atOrigin = [];
  for (const { durable, snapshot } of entries) {
    for (const item of durable.slots(snapshot, { target })) {
      if (durable.read(snapshot, item.slot) === null) continue;
      if (item.origin === origin) atOrigin.push(item.slot);
      if (item.forwards) hits.set(item.origin, item.slot);
    }
  }
  const notFound = () => hasFiles ? result('blocked', 'unrecognized_format', { nextAction: signInAgain() }) : result('blocked', 'not_found');
  if (origin !== null) {
    if (!hits.size) return atOrigin.length ? result('blocked', 'target_mismatch') : notFound();
    if (!hits.has(origin)) return result('blocked', 'origin_mismatch');
  } else {
    if (!hits.size) return notFound();
    // Several routes forward to this target: the caller must say which origin it means.
    if (hits.size > 1) return result('blocked', 'not_adoptable');
  }
  const [found] = origin !== null ? [origin] : [...hits.keys()];
  let match;
  try { match = selectAdoptableRule(entries, { origin: found, target }); }
  catch (error) {
    if (error.code === 'claim_mismatch') return result('external', 'not_adoptable', { origin: found });
    if (error.code === 'ambiguous_route') return result('blocked', 'not_adoptable', { origin: found });
    throw error;
  }
  const entry = entries.find(item => item.adapterId === match.adapterId);
  const facts = planFactsFromObservation(entry, { adapterId: match.adapterId, facet: entry.durable, capability: durableCapability(entry.durable.definition), target, origin: found });
  return result('adoptable', null, { origin: found, observedResource: facts.observedResource });
}
