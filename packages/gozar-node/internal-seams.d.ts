// Internal seams between Gozar modules for the 0.2 build (frozen with the route contract).
//
// These are not consumer exports. They fix how the catalog, the consent tokens, the adapter
// registry and the durable engine call each other, so each module can be built and tested
// against stubs of the others. Apps never import these.
import type { Requirements, Usage, Query, Candidate } from './route-contract.js';
import type { Adapter } from './adapter-contract.js';

// --- consent-token.mjs ----------------------------------------------------------------------------

/**
 * What a token is bound to. Every field is compared on redemption; any mismatch spends the token
 * and fails with consent_mismatch. `home` is the canonical home path. `route` and `origin` are
 * null when the query had none.
 */
export type ConsentBinding = {
  owner: string;
  home: string;
  target: string;
  usage: Usage;
  intent: 'create' | 'adopt';
  requirements: Requirements;
  route: string | null;
  origin: string | null;
  disclosureRevision: string;
};

/**
 * What the token grants, fixed when the catalog issues it. The redeemer re-observes under the
 * reservation lock. If `planDigest` or `observedResource` no longer match, the token is already
 * spent and the call fails with candidate_stale; nothing is changed.
 */
export type ConsentGrant = { adapterId: string; planDigest: string; observedResource: string };

export function issueConsentToken(request: {
  home: string; binding: ConsentBinding; grant: ConsentGrant; ttlMs?: number;
}): Promise<{ token: string; expiresAt: string }>;

/** Single use: the token is spent whether redemption succeeds or fails. */
export function redeemConsentToken(request: {
  home: string; token: string; binding: ConsentBinding;
}): Promise<ConsentGrant>;

/** Pure: builds the binding from a request so issuer and redeemer cannot disagree. */
export function consentBinding(query: Query, canonicalHome: string, disclosureRevision: string): ConsentBinding;

// --- adapter-runtime.mjs --------------------------------------------------------------------------

/**
 * Loads every entry of adapters/manifest.json `providers` and validates it against
 * runtime/adapter.schema.json. An entry that fails validation is a load error, never a skipped
 * adapter. Only built-in module paths are loadable.
 */
export function loadAdapters(options?: {
  /** Path to, or parsed object of, a manifest; default adapters/manifest.json. Tests pass a fixture. */
  manifest?: string | { providers: { id: string; module: string; definition: string }[] };
  /** Directory that holds `providers/`; default the package's adapters directory. */
  root?: string;
}): Promise<Adapter[]>;

// --- durable-route.mjs ----------------------------------------------------------------------------

/**
 * Read-only. The durable engine owns durable creation (ensureRoute, adoptRoute), so the catalog
 * and an adapter's durable `plan` get their binding facts here, from the same code that later
 * redeems the token. Throws unsupported when the adapter's definition has no durable recipe.
 */
export function durablePlanFacts(request: {
  home: string; adapterId: string; target: string; origin: string | null;
}): Promise<{ planDigest: string; observedResource: string; origin: string | null }>;

// Durable-kind rule for adapters (no declaration; enforced by conformance):
/**
 * For the durable kind, an adapter's `create` and `remove` reject with AdapterEffectError
 * `unsupported`: durable effects run only inside ensureRoute/adoptRoute/closeRoute (revision 3 (d)).
 * Its `plan` returns an AdapterPlan whose `digest` is durablePlanFacts().planDigest, and its
 * `observe` reports the listener with `revision` set to the provider's config revision.
 * Conformance treats durable create/remove as engine-owned when the definition has a durable recipe.
 */

// --- route-catalog.mjs ----------------------------------------------------------------------------

/**
 * One candidate per loaded adapter, ranked by the user's preference list and then by registry
 * order. Inspection makes no provider mutation. A token is issued only for an eligible candidate
 * whose setup state is ready.
 */
export function buildCatalog(query: Query, deps: {
  adapters: Adapter[];
  preferences: string[];
  issue: typeof issueConsentToken;
  durablePlanFacts: typeof durablePlanFacts;
  /** 'linux' is the only supported platform in 0.2.0; every other value makes every candidate unsupported. */
  platform: string;
}): Promise<{ candidates: Candidate[] }>;
