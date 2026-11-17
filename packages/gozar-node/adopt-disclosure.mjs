// Adopt approvals include the removal consequence. Keep this revision in one place so the
// catalog and redemption path agree on which words the user approved.
import { createHash } from 'node:crypto';
import { canonicalConsentValue, consentFactRows } from './consent-facts.mjs';
export function consentDisclosureRevision(definition, intent = 'create') {
  const base = definition.disclosure.revision + (intent === 'adopt' ? ':adopt-removal-1' : '');
  const rows = consentFactRows(definition.facts ?? []);
  return rows.length ? `${base}-facts-${createHash('sha256').update(JSON.stringify(canonicalConsentValue(rows))).digest('hex').slice(0, 12)}` : base;
}
export const adoptDisclosureRevision = definition => consentDisclosureRevision(definition, 'adopt');
