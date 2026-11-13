// Stable computation fields and open-ended display facts. Unknown evidence stays explicit.
export const unknown = (reason = 'not-observed') => ({ known: false, reason });
export const known = value => ({ known: true, value });
import { bindingFor, cleanupRecovery } from './embedding-projections.mjs';
export const features = ['structured-state', 'open-facts', 'input-requirements', 'secret-intake',
  'configuration-revisions', 'consent-facts-digest', 'proof-subject', 'host-secret-backend',
  'prerequisite-actions', 'provider-inventory', 'route-binding', 'cleanup-recovery'];

export function availabilityFor(definition) {
  return Object.fromEntries(['session', 'attached', 'durable'].map(kind => [kind,
    definition.availability?.[kind] ?? (definition.supportedKinds.includes(kind)
      ? { state: 'available', reason: 'admitted' } : { state: 'unsupported', reason: 'usage-not-supported' })]));
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

export function configurationFor(actions, saved) {
  const inputRequirements = actions.filter(action => ['provide-secret', 'provide-value'].includes(action.kind)).map(action => ({
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
  const verified = route.verification.status === 'verified' && !expired;
  const verification = { ...route.verification, observedAt:route.verification.observedAt??route.verification.checkedAt??null,subject:route.verification.subject??null, status: verified ? 'verified' : 'unverified', validUntil: proofExpiry,
    results: route.verification.checks.map(check => ({ check, status: verified ? 'passed' : 'unknown' })) };
  let localPort = unknown();
  try { const url = new URL(target.includes('://') ? target : `http://${target}`); localPort = known(Number(url.port || (url.protocol === 'https:' ? 443 : 80))); } catch { /* no recorded target */ }
  return { ...route, schemaVersion: 2,operationId:route.operationId??null,published: expired ? null : route.published, verification, expiresAt: expiry,
    binding:route.binding??bindingFor({observedTarget:undefined,authority:route.ownership==='external-owned'?'owner':'unknown',remedy:null}),
    cleanup:cleanupRecovery(route.cleanup,route.handle),
    routeState: route.cleanup.state === 'unconfirmed' ? 'cleanup-unconfirmed' : expired ? 'expired' : verified ? 'verified'
      : route.state === 'released' ? 'inactive' : route.origin ? 'detected' : 'unknown',
    hostConfiguration: { target: target ? known(target) : unknown(), localPort, bindTarget: bindTarget ? known(bindTarget) : unknown(), origin: route.origin ? known(route.origin) : unknown() },
    facts, actions: route.state === 'released' ? [] : ['stop', 'edit', 'rotate'] };
}
