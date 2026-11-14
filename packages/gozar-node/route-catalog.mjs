// The consumer catalog: one candidate per adapter, with the properties an app shows, the closed list of
// unmet requirements, and a one-time consent token only for a candidate that can be used right now.
// Inspection is read-only: it calls detect, properties, setupActions, plan and observe, nothing else.
import { createHash } from 'node:crypto';
import { canonicalHome } from './service-state.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { supportedPlatform } from './platform.mjs';
import { availabilityFor, prerequisitesFor, configurationFor, features } from './embedding-state.mjs';
import { readConfiguration } from './adapter-configuration.mjs';
import { bindConfiguration } from './adapter-configuration.mjs';
import { loopbackTarget } from './durable-route.mjs';
import { checksFor, completeProperties, needsFor } from './route-view.mjs';
import { adoptDisclosureRevision, consentDisclosureRevision } from './adopt-disclosure.mjs';
import { routeConsentReview, setupConsentReview,consentSnapshot } from './consent-facts.mjs';

export { adoptDisclosureRevision } from './adopt-disclosure.mjs';
export { consentDisclosureRevision } from './adopt-disclosure.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
/** Stable opaque handles for an adapter; apps store the preferenceRef and show the label. */
export const preferenceRefFor = adapterId => `pref_${sha(`gozar-preference:${adapterId}`).slice(0, 24)}`;
export const candidateNameFor = adapterId => `cand_${sha(`gozar-candidate:${adapterId}`).slice(0, 24)}`;

const REACH = ['internet', 'tailnet', 'lan', 'this-device'];
const USAGE = ['durable', 'session', 'attached'];
const PROTOCOL_KEY = { sse: 'sse', 'streamable-http': 'streamableHttp', 'oauth-dcr': 'oauthDcr' };
const text = value => typeof value === 'string' && value.length > 0;

/** Structural check of a Query; the schema in runtime/route-catalog.schema.json is the full contract. */
export function validateQuery(query) {
  const bad = why => { throw gozarError('invalid_input', `Invalid route query: ${why}`); };
  if (query?.schemaVersion !== 1) bad('schemaVersion must be 1');
  for (const key of ['owner', 'target', 'home']) if (!text(query[key])) bad(`${key} must be a non-empty string`);
  const usage = query.usage;
  if (!USAGE.includes(usage?.kind)) bad('usage.kind must be durable, session or attached');
  if (usage.kind === 'durable') loopbackTarget(query.target);
  if (usage.kind === 'durable' && !text(usage.routeId)) bad('a durable usage needs routeId');
  if (usage.kind === 'session' && !(Number.isInteger(usage.lifetimeMs) && usage.lifetimeMs > 0)) bad('a session usage needs lifetimeMs');
  const r = query.requirements;
  if (!REACH.includes(r?.reach) || !['https', 'tcp', 'tls', 'any'].includes(r.transport) || !['endpoint-only', 'allow-provider'].includes(r.payloadAccess) ||
      !['stable', 'any'].includes(r.address) || !['none', 'allow'].includes(r.setup) || !Array.isArray(r.protocols) ||
      r.protocols.some(item => !(item in PROTOCOL_KEY))) bad('requirements are incomplete or not in the closed vocabulary');
  if (r.transport === 'any' && !['lan', 'this-device'].includes(r.reach)) bad("transport 'any' is valid only with reach 'lan' or 'this-device'");
  if (query.intent !== undefined && !['create', 'adopt'].includes(query.intent)) bad('intent must be create or adopt');
  for (const key of ['route', 'origin', 'migrationRef', 'providerId']) if (query[key] !== undefined && !text(query[key])) bad(`${key} must be a non-empty string`);
  if (query.providerId !== undefined && query.route !== undefined) bad('providerId and route are two ways to select; send one');
  return query;
}

// --- Runtime pieces that other modules own, loaded lazily so this module stands alone ------------

export async function loadRuntime() {
  try { return await import(new URL('./adapter-runtime.mjs', import.meta.url).href); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return null; throw error; }
}

/**
 * The read-only context an adapter reads through. A runtime that exports createReadContext supplies the real
 * probe and challenge verifier; without one only the clock and the no-named-route configuration exist, and
 * every probe is a typed `unsupported` (the adapter then reports its state as unknown).
 */
export async function defaultReadContext() {
  const runtime = await loadRuntime();
  if (typeof runtime?.createReadContext === 'function') return runtime.createReadContext();
  const unavailable = what => async () => { throw gozarError('unsupported', `${what} is not wired in this build`); };
  return { now: () => Date.now(), probe: unavailable('The read-only provider probe'), verifyChallenge: unavailable('The challenge verifier'),
    async configuration(ref) { if (ref === null || ref === undefined) return null; throw gozarError('route_not_found', 'Unknown route name'); } };
}

/**
 * The read context for one call: an injected or default base, with the caller's canonical state home and the
 * injected host platform stamped on it (amendment 1). Adapters never read process.platform themselves.
 */
export async function readContextFor(deps, home, platform, owner = deps.owner) {
  return { ...(deps.readContext ?? await defaultReadContext()), home, platform,
    ...(deps.embeddingServices ? {providerConfiguration: providerId => deps.embeddingServices.resolveConfiguration({home,owner,providerId})} : {}),
    ...(deps.dispatchEffect ? {dispatchEffect: deps.dispatchEffect,probe:async recipe=>(await loadRuntime()).probeWithEffects(recipe,deps.dispatchEffect)} : {}) };
}

/** `providerId` picks exactly one adapter by the id its definition declares; an unknown id lists every id on offer, in registry order. */
export function selectAdapters(adapters, providerId) {
  if (providerId === undefined) return adapters;
  const chosen = adapters.filter(adapter => adapter.id === providerId);
  if (!chosen.length) throw gozarError('route_not_found', `Unknown route id "${providerId}". Offered: ${adapters.map(adapter => adapter.id).join(', ')}`);
  return chosen;
}

// --- One adapter, observed ----------------------------------------------------------------------

/**
 * Read-only observation of one adapter. A failing probe is an `unknown` state, never a thrown catalog error;
 * on a platform other than Linux nothing is probed and the adapter is `unsupported`.
 */
export async function inspectAdapter(adapter, context, platform) {
  const base = { adapter, properties: adapter.definition.capabilities, actions: [] };
  if (!supportedPlatform(platform)) return { ...base, state: 'unsupported', facts: null, probed: false };
  let detected;
  try { detected = await adapter.detect(bindConfiguration(context, adapter.id)); }
  catch { return { ...base, state: 'unknown', facts: null, probed: true }; }
  const state = ['ready', 'action-required', 'unsupported', 'unknown'].includes(detected?.state) ? detected.state : 'unknown';
  let properties = base.properties, actions = [];
  try { properties = adapter.properties(detected.facts); } catch { /* keep the declared capabilities */ }
  if (state !== 'unsupported') { try { actions = adapter.configurationActions ? adapter.configurationActions() : adapter.setupActions({ ...detected.facts, setupNeeded: true }); } catch { /* no usable actions */ } }
  let missingActions = [];
  try { missingActions = adapter.setupActions(detected.facts); } catch {}
  actions=[...new Map([...actions,...missingActions].map(action=>[action.id,action])).values()];
  return { ...base, state, facts: detected.facts, properties, actions, missingActions, probed: true };
}

/** One revision for the provider-side state: it changes when a setup state, an action or a property changes. */
export function catalogRevisionOf(inspections, platform) {
  const view = inspections.map(item => ({ id: item.adapter.id, state: item.state, properties: item.properties,
    facts: item.adapter.definition.facts ?? [], availability: availabilityFor(item.adapter.definition),
    actions: item.actions.map(action => [action.id, action.digest, action.disclosure.revision]), disclosure: item.adapter.definition.disclosure.revision }));
  return `catrev_${sha(JSON.stringify([platform, view])).slice(0, 32)}`;
}

// --- Eligibility --------------------------------------------------------------------------------

function unmetRequirements({ requirements: r, usage, definition, properties: p, setupState }) {
  const unmet = [];
  const add = (requirement, actual, reasonCode = 'not_met') => unmet.push({ requirement, actual, reasonCode });
  if (!definition.supportedKinds.includes(usage.kind)) add('usage', usage.kind);
  if (p.reach === 'unknown') add('reach', 'unknown', 'unknown'); else if (p.reach !== r.reach) add('reach', p.reach);
  if (r.transport !== 'any' && p.transport !== r.transport) add('transport', p.transport);
  if (r.payloadAccess === 'endpoint-only') {
    const t = p.traffic;
    if (t.providerCanReadPayload === null || t.tlsTermination === 'unknown') add('payloadAccess', t.providerCanReadPayload, 'unknown');
    else if (t.providerCanReadPayload || t.tlsTermination !== 'endpoint') add('payloadAccess', t.providerCanReadPayload);
  }
  if (r.address === 'stable') {
    if (p.address.stability === 'unknown') add('address', 'unknown', 'unknown'); else if (p.address.stability !== 'stable') add('address', p.address.stability);
  }
  const missing = r.protocols.filter(name => p.protocols[PROTOCOL_KEY[name]] !== true);
  if (missing.length) add('protocols', p.protocols);
  if (setupState === 'unsupported') add('setup', 'unsupported');
  else if (setupState === 'unknown') add('setup', 'unknown', 'unknown');
  else if (setupState === 'action-required' && r.setup === 'none') add('setup', 'action-required');
  return unmet;
}

// The cost summary is a sentence and usually ends with its own full stop; the description adds exactly one.
const describe = (definition, p) => `${definition.label}: ${p.reach === 'unknown' ? 'reach not established' : `reaches ${p.reach} clients`}, ${p.address.stability} address, ${p.cost.summary.replace(/[.\s]+$/, '')}.`;

export const adapterRequest = (query, origin = query.origin ?? null) => ({ target: query.target, origin, usage: query.usage, requirements: query.requirements, configurationRef: query.route ?? null });

// --- The catalog --------------------------------------------------------------------------------

async function collect(query, deps) {
  validateQuery(query);
  const { adapters, issue, durablePlanFacts, platform } = deps;
  const consentBinding = deps.consentBinding ?? (await import('./consent-token.mjs')).consentBinding;
  const home = await canonicalHome(query.home, true);
  // The origin the app named is part of what an adapter reads: an owner-run address is judged by it.
  const context = { ...await readContextFor(deps, home, platform, query.owner), origin: query.origin ?? null };
  // An unknown named route is an error before any provider is asked.
  if (query.route !== undefined && supportedPlatform(platform)) await context.configuration(query.route);
  const inspections = await Promise.all(selectAdapters(adapters, query.providerId).map(adapter => inspectAdapter(adapter, context, platform)));
  const pinned = deps.pinnedAdapterId ? await deps.pinnedAdapterId(query) : null;

  const candidates = await Promise.all(inspections.map(async inspection => {
    const { adapter, state, actions } = inspection, definition = adapter.definition;
    // The ports and needs are those of the usage kind asked for. The proof lists the checks Gozar makes for this request,
    // so the stream check appears only when the request needs SSE.
    const declared = completeProperties(inspection.properties, definition, query.usage.kind);
    const properties = { ...declared, proof: { ...declared.proof, checks: checksFor(declared.proof.checks, { sse: query.requirements.protocols.includes('sse') }) } };
    let setupState = state, grant = null;
    const unmet = [];
    if (supportedPlatform(platform)) {
      unmet.push(...unmetRequirements({ requirements: query.requirements, usage: query.usage, definition, properties, setupState }));
      if (inspection.facts?.invalidOrigin !== undefined) {
        const setup = unmet.find(item => item.requirement === 'setup');
        if (setup) setup.actual = { origin: inspection.facts.invalidOrigin, reason: 'invalid_origin' };
      }
      // A plan exists only for a candidate that could be used now; its digest and resource go into the token.
      if (!unmet.length && setupState === 'ready' && definition.supportedKinds.includes(query.usage.kind)) {
        try {
          // A durable plan comes from the durable engine, except for a route its owner keeps: that adapter plans for itself.
          if (query.usage.kind === 'durable' && definition.ownership !== 'external-owned') {
            const plan = await durablePlanFacts({ home, adapterId: adapter.id, target: query.target, origin: query.origin ?? null, adapters });
            if (query.intent !== 'adopt' && plan.creatableOrigin === false)
              unmet.push({ requirement: 'address', actual: { origin: query.origin }, reasonCode: 'not_met' });
            else grant = { adapterId: adapter.id, planDigest: plan.planDigest, observedResource: plan.observedResource };
          } else {
            const request = adapterRequest(query);
            const own = bindConfiguration(context, adapter.id);
            const plan = await adapter.plan(own, request);
            const observed = await adapter.observe(own, request);
            grant = { adapterId: adapter.id, planDigest: plan.digest, observedResource: observed.resourceKey };
          }
        } catch (error) {
          // No durable recipe or no plan: not usable for this usage. A failing provider read leaves the state unknown.
          if (normalizeError(error).code === 'unsupported') unmet.push({ requirement: 'usage', actual: query.usage.kind, reasonCode: 'not_met' });
          else { setupState = 'unknown'; unmet.push({ requirement: 'setup', actual: 'unknown', reasonCode: 'unknown' }); }
        }
      }
    } else unmet.push({ requirement: 'platform', actual: platform, reasonCode: 'unsupported_platform' });

    const availability = availabilityFor(definition);
    if (supportedPlatform(platform) && availability[query.usage.kind].state === 'detect-only') setupState = 'detect-only';
    const eligible = unmet.length === 0 && availability[query.usage.kind].state === 'available';
    const observedAt = new Date(context.now()).toISOString();
    const saved = deps.embeddingServices ? await deps.embeddingServices.readConfiguration({home,owner:query.owner,providerId:adapter.id,draftId:query.draftId}) : await readConfiguration({ home, adapterId: adapter.id });
    const offered = [...new Map([...actions, ...(inspection.missingActions ?? [])].map(action => [action.id, action])).values()];
    const decorate = action => {
      if (!deps.registryId || !saved.revision) return action;
      const review = setupConsentReview({registryId:deps.registryId,providerId:adapter.id,configuration:saved,draftId:query.draftId??null,action,facts:definition.facts??[]});
      return {...action,consent:consentSnapshot(review),review:{canonicalInput:review.canonicalInput}};
    };
    const decorated = offered.map(decorate);
    const configuration = configurationFor(decorated, saved);
    const candidate = { providerId: adapter.id, name: candidateNameFor(adapter.id), preferenceRef: preferenceRefFor(adapter.id), rank: 0, eligible, unmet,
      display: { label: definition.label, description: describe(definition, properties), needs: needsFor(definition, query.usage.kind) }, properties,
      availability, prerequisites: prerequisitesFor(inspection, observedAt), configuration, facts: structuredClone(definition.facts ?? []),
      setup: { state: setupState, actions: setupState === 'action-required' ? (inspection.missingActions ?? actions).map(decorate) : [] }, disclosure: { ...definition.disclosure, revision: consentDisclosureRevision(definition) },
      candidateToken: null, expiresAt: null };
    if (query.usage.kind === 'durable' && query.intent === 'adopt') {
      const takeover = 'Gozar takes over the existing rule and removes it when the route is released or stopped.';
      candidate.display.description += ` ${takeover}`;
      candidate.disclosure = { ...definition.disclosure, revision: consentDisclosureRevision(definition, 'adopt'),
        text: `${definition.disclosure.text} ${takeover}` };
    }
    if (deps.registryId && saved.revision) {
      const review=routeConsentReview({registryId:deps.registryId,providerId:adapter.id,usage:query.usage,configuration:saved,target:query.target,origin:query.origin,properties,disclosure:candidate.disclosure,facts:candidate.facts});
      candidate.consentFactsDigest=review.consentFactsDigest;
      candidate.consent=consentSnapshot(review);
      candidate.review={canonicalInput:review.canonicalInput};
      if(grant)grant={...grant,consentFactsDigest:review.consentFactsDigest,configurationRevision:saved.revision,scopeId:saved.scopeId};
    }
    if (eligible && setupState === 'ready' && grant) {
      const issued = await issue({ home, binding: consentBinding(query, home, candidate.disclosure.revision,candidate.consentFactsDigest), grant });
      candidate.candidateToken = issued.token; candidate.expiresAt = issued.expiresAt;
    }
    return candidate;
  }));

  // Hard filters are in `eligible`; ranking only orders. A durable pin outranks the preference list.
  // A preference list holds preferenceRef values or providerIds; the earlier of the two positions counts.
  const order = candidate => {
    const at = [candidate.preferenceRef, candidate.providerId].map(ref => deps.preferences.indexOf(ref)).filter(index => index >= 0);
    return at.length ? Math.min(...at) : -1;
  };
  const keyed = candidates.map((candidate, index) => ({ candidate, index, pinned: pinned !== null && candidate.preferenceRef === preferenceRefFor(pinned),
    preferred: order(candidate) }));
  keyed.sort((a, b) => (b.pinned - a.pinned) || ((a.preferred < 0 ? Infinity : a.preferred) - (b.preferred < 0 ? Infinity : b.preferred)) || a.index - b.index);
  const ranked = keyed.map(({ candidate }, index) => ({ ...candidate, rank: index + 1 }));
  return { candidates: ranked, inspections };
}

/** One candidate per loaded adapter, ranked by the user's preference list and then registry order. */
export async function buildCatalog(query, deps) {
  try { return { candidates: (await collect(query, deps)).candidates }; }
  catch (error) { throw normalizeError(error); }
}

/** The full Catalog. Every dependency can be replaced; by default the real registry, tokens and preferences are used. */
export async function catalogRoutes(query, deps = {}) {
  try {
    validateQuery(query);
    const runtime = deps.adapters ? null : await loadRuntime();
    if (!deps.adapters && !runtime) throw gozarError('internal_error', 'The adapter registry is not available in this build');
    const platform = deps.platform ?? process.platform;
    const preferenceRecord = deps.preferenceRecord ?? await (await import('./route-preferences.mjs')).getRoutePreferences({ profileHome: deps.profileHome });
    const issue = deps.issue ?? (await import('./consent-token.mjs')).issueConsentToken;
    const durablePlanFacts = deps.durablePlanFacts ?? (await import('./durable-route.mjs')).durablePlanFacts;
    if (typeof durablePlanFacts !== 'function' && query.usage.kind === 'durable') throw gozarError('internal_error', 'The durable engine does not provide plan facts in this build');
    const adapters = deps.adapters ?? await runtime.loadAdapters();
    const { candidates, inspections } = await collect(query, { ...deps, adapters, platform, issue, durablePlanFacts, preferences: preferenceRecord.adapterPreference });
    const unmetNames = [...new Set(candidates.flatMap(candidate => candidate.unmet.map(item => item.requirement)))].sort();
    return { schemaVersion: 2, features: [...features], catalogRevision: catalogRevisionOf(inspections, platform), observedAt: new Date((deps.now ?? Date.now)()).toISOString(),
      preferenceRevision: preferenceRecord.revision, candidates,
      noMatch: candidates.some(candidate => candidate.eligible) ? null : { code: 'requirements_unsatisfied', requirements: unmetNames } };
  } catch (error) { throw normalizeError(error); }
}
