// consent-v1 is an encoding contract. Changing its meaning requires a new version.
import { createHash } from 'node:crypto';
const invalid = () => { throw Object.assign(new Error('Consent data must be unambiguous JSON'), { code: 'invalid_input' }); };

export function canonicalConsentValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : invalid();
  if (typeof value !== 'object' || ancestors.has(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return invalid();
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))) return invalid();
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) return invalid();
      return canonicalConsentValue(descriptor.value, next);
    });
  }
  return Object.fromEntries(keys.sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) return invalid();
    return [key, canonicalConsentValue(descriptor.value, next)];
  }));
}

export function consentFactRows(facts) {
  if (!Array.isArray(facts)) return invalid();
  const seen = new Set(), rows = [];
  for (const fact of facts) {
    canonicalConsentValue(fact);
    if (!fact || ['id', 'label', 'group', 'source'].some(key => typeof fact[key] !== 'string' || !fact[key]) ||
        typeof fact.known !== 'boolean' || typeof fact.affectsConsent !== 'boolean' || seen.has(fact.id)) return invalid();
    seen.add(fact.id);
    if (!(fact.value === null || ['string', 'boolean', 'number'].includes(typeof fact.value)) ||
        (!fact.known && (typeof fact.reason !== 'string' || !fact.reason)) ||
        (fact.reason !== undefined && fact.reason !== null && typeof fact.reason !== 'string')) return invalid();
    if (fact.affectsConsent) rows.push({ id: fact.id, label: fact.label, value: fact.known ? fact.value : null,
      known: fact.known, reason: fact.reason ?? null, group: fact.group, affectsConsent: true, source: fact.source });
  }
  return rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function consentReview({ scope, typedDisclosures, facts }) {
  const canonicalInput = canonicalConsentValue({ version: 'consent-v1', scope, typedDisclosures, facts: consentFactRows(facts) });
  const canonicalJson = JSON.stringify(canonicalInput);
  return { canonicalInput, canonicalJson, consentFactsDigest: `consent-v1:${createHash('sha256').update(canonicalJson, 'utf8').digest('hex')}` };
}

// Keep the selected fields explicit: observations and polling dates do not grant authority.
export function routeConsentReview({ registryId, providerId, usage, configuration, target, origin, properties, disclosure, facts }) {
  return consentReview({ scope: { kind: 'route', registryId, providerId, configurationRevision: configuration.revision,
    scopeId: configuration.scopeId, query: { usage, reach: properties.reach, transport: properties.transport, target, expectedOrigin: origin ?? null } },
  typedDisclosures: { reach: properties.reach, transport: properties.transport, traffic: properties.traffic,
    address: properties.address, cost: { kind: properties.cost.kind }, lifetimes: properties.lifetimes,
    supervision: properties.supervision, protocols: properties.protocols, disclosure }, facts });
}

export function setupConsentReview({ registryId, providerId, configuration, draftId = null, action, facts }) {
  return consentReview({ scope: { kind: 'setup', registryId, scopeId: configuration.scopeId, providerId,
    configurationRevision: configuration.revision, draftId, actionId: action.id,
    disclosureRevision: action.disclosure.revision, actionDigest: action.digest },
    typedDisclosures: { action }, facts });
}

/** Display exactly the redacted authority-bearing values; timestamps carry no approval. */
export function consentSnapshot(review){
  return structuredClone({scope:review.canonicalInput.scope,consentFactsDigest:review.consentFactsDigest,
    facts:review.canonicalInput.facts.map(row=>({...row,asOf:null})),disclosures:review.canonicalInput.typedDisclosures});
}
