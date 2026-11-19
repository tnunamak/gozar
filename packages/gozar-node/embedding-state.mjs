// Stable computation fields and open-ended display facts. Unknown evidence stays explicit.
export const unknown = (reason = 'not-observed') => ({ known: false, reason });
export const known = value => ({ known: true, value });
import { needsSetupOperation } from './consent-facts.mjs';
import { bindingFor, cleanupRecovery } from './embedding-projections.mjs';
export const features = ['structured-state', 'open-facts', 'input-requirements', 'secret-intake',
  'configuration-revisions', 'consent-facts-digest', 'proof-subject', 'host-secret-backend',
  'prerequisite-actions', 'provider-inventory', 'route-binding', 'cleanup-recovery'];

/**
 * What the host's declared boundary means for one adapter. A host that declared `acknowledgeOrigin` is told, before any
 * consent, which usage cannot run through that boundary: the legacy recipe session controller never asks the host to
 * acknowledge its allocated origin, so a session on it is refused at execution (openSessionRoute). Advertising it as
 * available would let the owner consent to a start that can only fail. Generic-runtime sessions, attached and durable
 * routes all ask, and stay available. One rule, read by the catalog, the provider inventory and the execution preflight.
 */
export const ORIGIN_ACKNOWLEDGMENT_UNSUPPORTED = 'origin-acknowledgment-unsupported';
export const hostBoundaryOf = deps => ({ acknowledgesOrigin: typeof deps?.acknowledgeOrigin === 'function' });
export const sessionBlockedByBoundary = (adapter, host) => host?.acknowledgesOrigin === true && adapter?.sessionExecution === 'recipe';

export function availabilityFor(definition, { adapter, host } = {}) {
  const availability = Object.fromEntries(['session', 'attached', 'durable'].map(kind => [kind,
    definition.availability?.[kind] ?? (definition.supportedKinds.includes(kind)
      ? { state: 'available', reason: 'admitted' } : { state: 'unsupported', reason: 'usage-not-supported' })]));
  if (availability.session.state === 'available' && sessionBlockedByBoundary(adapter, host))
    availability.session = { state: 'unsupported', reason: ORIGIN_ACKNOWLEDGMENT_UNSUPPORTED };
  return availability;
}

export function prerequisitesFor(inspection, observedAt) {
  const { facts, adapter } = inspection;
  const actions = [...(inspection.missingActions ?? []), ...inspection.actions];
  const declarations = adapter.definition.prerequisites ?? [{ id: 'local-setup', label: 'Local prerequisites', observation: 'detected' }];
  return declarations.map(item => {
    const observed = facts?.[item.observation];
    return { id: item.id, label: item.label,
      state: observed === true ? 'present' : observed === false ? 'missing' : observed === 'denied' ? 'denied' : 'unknown',
      observedAt, version: unknown(), remedy: item.actionId ? actions.find(action => action.id === item.actionId) ?? null : actions[0] ?? null };
  });
}

export function configurationFor(actions, saved, declared) {
  const inputRequirements = declared?structuredClone(declared):actions.filter(action => !needsSetupOperation(action) && ['provide-secret', 'provide-value'].includes(action.kind)).map(action => ({
    id: action.id, actionId: action.id, label: action.secretLabel ?? action.valueLabel ?? action.label,
    kind: action.valueFormat ?? 'text', secret: action.kind === 'provide-secret', help: action.help ?? action.label,
    required: action.required !== false, obtainUrl: action.obtainUrl ?? null, validation: 'syntax-only',
  }));
  return { inputRequirements, ...(saved.revision ? {revision:saved.revision,scopeId:saved.scopeId} : {}), values: saved.values, credentials: Object.fromEntries(inputRequirements.filter(field => field.secret)
    .map(field => [field.id, saved.credentials[field.id] ?? known(false)])),
    actions: actions.filter(action => ['provide-secret', 'provide-value'].includes(action.kind)) };
}

export function cleanupForSession(reply) {
  const snapshot = reply.snapshot ?? {};
  if (['cleanup-pending', 'stopping'].includes(snapshot.phase) || reply.localCleanupFailures?.length) return { state: 'unconfirmed' };
  if (snapshot.phase === 'stopped') {
    const confirmed = Array.isArray(reply.localCleanupFailures) && !reply.localCleanupFailures.length &&
      (snapshot.resources ?? []).every(resource => resource.ownership !== 'owned' || resource.cleanup === 'removed');
    return { state: confirmed ? 'confirmed' : 'unconfirmed' };
  }
  return { state: 'none' };
}

export function enrichRoute(route, { target, bindTarget, expiresAt, validUntil, now = Date.now(), facts = [] } = {}) {
  const expiry = typeof expiresAt === 'string' ? known(expiresAt) : unknown();
  const proofExpiry = typeof validUntil === 'string' ? known(validUntil) : unknown();
  const expired = [expiry, proofExpiry].some(item => item.known && Date.parse(item.value) <= now);
  const verified = route.verification.status === 'verified' && !expired && route.verification.subject!=null;
  const verification = { ...route.verification, observedAt:route.verification.observedAt??route.verification.checkedAt??null,subject:route.verification.subject??null, status: verified ? 'verified' : 'unverified', validUntil: proofExpiry,
    results: route.verification.checks.map(check => ({ check, status: verified ? 'passed' : 'unknown' })) };
  let localPort = unknown();
  try { const url = new URL(target.includes('://') ? target : `http://${target}`); localPort = known(Number(url.port || (url.protocol === 'https:' ? 443 : 80))); } catch { /* no recorded target */ }
  return { ...route,state:route.state==='usable'&&!verified?'unverified':route.state, schemaVersion: 2,operationId:route.operationId??null,published: verified ? route.published : null, verification, expiresAt: expiry,
    binding:route.binding??bindingFor({observedTarget:undefined,authority:route.ownership==='external-owned'?'owner':'unknown',remedy:null}),
    cleanup:cleanupRecovery(route.cleanup,route.handle),
    routeState: route.cleanup.state === 'unconfirmed' ? 'cleanup-unconfirmed' : expired ? 'expired' : verified ? 'verified'
      : route.state === 'released' ? 'inactive' : route.origin ? 'detected' : 'unknown',
    hostConfiguration: { target: target ? known(target) : unknown(), localPort, bindTarget: bindTarget ? known(bindTarget) : unknown(), origin: route.origin ? known(route.origin) : unknown() },
    facts, actions: route.state === 'released' ? [] : route.consentChange?.reason==='proof-refresh-unsupported'?['stop']:['stop', 'edit', 'rotate'] };
}
