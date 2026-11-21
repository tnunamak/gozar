import { createHash, randomUUID } from 'node:crypto';
import { bindConfiguration } from './adapter-configuration.mjs';
import { catalogFactsFor } from './catalog-facts.mjs';
import { canonicalConsentValue, consentSnapshot, safeSetupAction, setupConsentReview } from './consent-facts.mjs';
import { embeddingError } from './embedding-services.mjs';
import { inputIdOf } from './embedding-state.mjs';
import { executeArtifact } from './embedding-prerequisites.mjs';
import { inspectAdapter, readContextFor } from './route-catalog.mjs';
import { checkValue } from './route-setup.mjs';

const fail = code => { throw embeddingError(code); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048;
const canonical = value => JSON.stringify(canonicalConsentValue(value));
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
const unknown = reason => ({ known: false, reason });
const stateValues = ['authorization-required', 'pending', 'denied', 'expired', 'blocked', 'reconciling', 'complete'];
const recovery = new Set(['reconcile', 'remove-resource', 'revoke-credential', 'stop-connector', 'disconnect']);
const kinds = ['connector', 'tunnel', 'dns', 'credential', 'other'];
const slotPattern = /^[a-z][a-z0-9._-]{0,63}$/;
const slot = value => {
  if (typeof value !== 'string' || !slotPattern.test(value)) fail('invalid_input');
  return value;
};
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function validateRef(request) {
  if (['home', 'owner', 'providerId', 'operationId'].some(key => !text(request?.[key]))) fail('invalid_input');
}

function validatedInput(request) {
  const { expectedConfigurationRevision, expectedSetupRevision, actionId, draftId, approval, value, secretHandle } = request;
  if (!text(expectedConfigurationRevision) || !text(actionId) ||
      (draftId !== undefined && !text(draftId)) ||
      !Number.isSafeInteger(expectedSetupRevision) || expectedSetupRevision < 0 ||
      (value !== undefined && (!text(value) || secretHandle !== undefined)) ||
      (secretHandle !== undefined && !text(secretHandle))) fail('invalid_input');
  if (expectedSetupRevision === 0 && ('approval' in request || 'value' in request || 'secretHandle' in request)) fail('invalid_input');
  return hash({ expectedConfigurationRevision, expectedSetupRevision, actionId, draftId: draftId ?? null,
    approval: approval ?? null, value: value ?? null, secretHandle: secretHandle ?? null });
}

function resourceView(row) {
  const { id: handle, kind, label, identity, presence } = row;
  return { handle, kind, label, ownership: identity ? 'owned' : 'unknown',
    presence, removal: !identity ? 'unconfirmed' : !presence.known ? 'unconfirmed' : presence.value ? 'required' : 'confirmed' };
}

function observeResources(record, observations, now) {
  for (const observation of observations ?? []) {
    const row = record.resources.find(row => row.id === observation?.intentId);
    if (!row || row.settledAbsent || !['pending', 'present', 'absent'].includes(observation.status) ||
        !equal(row.subject, observation.subject ?? null) ||
        !timestamp(observation.observedAt) || Date.parse(observation.observedAt) < Date.parse(row.admittedAt) ||
        Date.parse(observation.observedAt) > now ||
        (row.observedAt && Date.parse(observation.observedAt) < Date.parse(row.observedAt))) continue;
    const exactIdentity = row.identity ?? row.receiptIdentity;
    if (observation.status === 'pending') {
      row.presence = unknown('provider-observation-pending');
    } else if (observation.status === 'present' && observation.identity &&
               (!exactIdentity || equal(exactIdentity, observation.identity))) {
      row.identity = canonicalConsentValue(observation.identity);
      row.presence = { known: true, value: true };
    } else if (observation.status === 'absent' && (exactIdentity
      ? observation.identity && equal(exactIdentity, observation.identity)
      : !observation.identity)) {
      if (exactIdentity) row.identity = exactIdentity;
      row.settledAbsent = true;
      row.presence = { known: true, value: false };
    } else continue;
    row.observedAt = observation.observedAt;
  }
}

async function openContext(request, deps, storage) {
  const adapter = deps.adapters.find(adapter => adapter.id === request.providerId);
  if (!adapter) fail('candidate_stale');
  if (typeof adapter.observeSetup !== 'function') fail('setup_required');
  const read = await readContextFor(deps, storage.home, deps.platform);
  const context = bindConfiguration({ ...read, providerConfiguration: storage.tx.resolveConfiguration,
    configurationPresence: storage.tx.configuration, configurationInUse: storage.tx.inUse }, adapter.id);
  return { adapter, context };
}

async function refresh(request, deps, storage, adapter, context, record, { includeBrowserHandoff = false } = {}) {
  const { tx, stale, withManagementSecret, hasManagementSecret } = storage;
  const configuration = await tx.configuration() ?? { scopeId: record.scopeId, revision: record.configurationRevision };
  const inspection = await inspectAdapter(adapter, context, deps.platform);
  const now = Date.now();
  let observed;
  try {
    observed = await adapter.observeSetup({ ...context, withManagementSecret, hasManagementSecret: name => hasManagementSecret(slot(name)) }, {
      id: request.operationId, cancelled: record.cancelled || stale, resources: structuredClone(record.resources),
      connectorInputs: Object.keys(record.connectorSecrets ?? {}),
      lastActionId: record.lastActionId ?? null,
    });
  } catch {
    observed = { state: 'blocked', nextAction: null };
  }
  if (!(stateValues.includes(observed?.state) || ((record.cancelled || stale) && observed?.state === 'cancelled'))) {
    fail('internal_error');
  }
  observeResources(record, observed.observations, Date.now());

  let raw = observed.nextAction;
  if (raw && !raw.step) fail('internal_error');
  if ((record.cancelled || stale) && !recovery.has(raw?.step.purpose)) raw = null;
  let resource = raw?.step.resourceHandle && record.resources.find(row => row.id === raw.step.resourceHandle);
  if (['remove-resource', 'revoke-credential'].includes(raw?.step.purpose) &&
      !(resource?.identity && resource.presence.known && resource.presence.value)) raw = null;
  if (!raw) resource = null;
  const intent = raw && observed.intent ? canonicalConsentValue(observed.intent) : null;
  if (intent) {
    const matchesExisting = record.resources.some(row => equal(row.subject, intent.subject) &&
      (!row.settledAbsent || row.identity || row.receiptIdentity));
    if (raw.step.purpose !== 'provision' || !kinds.includes(intent.kind) || !text(intent.label) ||
        !intent.subject || matchesExisting) raw = null;
  }

  const candidate = raw ? safeSetupAction(raw) : null;
  if (candidate && ['provide-secret', 'provide-value'].includes(candidate.kind)) candidate.inputId = inputIdOf(adapter, candidate);
  if (candidate && (intent || resource)) candidate.digest = hash([
    candidate.digest, intent, resource ? { id: resource.id, subject: resource.subject, identity: resource.identity ?? null } : null,
  ]);
  const facts = catalogFactsFor(inspection);
  const review = action => setupConsentReview({ registryId: deps.registryId, providerId: adapter.id, configuration,
    draftId: record.draftId, action, facts, operation: { id: request.operationId, revision: record.revision } });
  const offerKey = candidate ? setupConsentReview({ registryId: deps.registryId, providerId: adapter.id, configuration,
    draftId: record.draftId, action: candidate, facts }).consentFactsDigest : null;
  if (record.offerKey !== offerKey) {
    record.offerKey = offerKey;
    record.revision++;
  }
  const observation = observed.evidence;
  const evidence = observation?.operationId === request.operationId && text(observation.stepId) &&
      ['provider', 'host', 'trusted-client'].includes(observation.source) && timestamp(observation.observedAt) &&
      Date.parse(observation.observedAt) >= Date.parse(record.startedAt) && Date.parse(observation.observedAt) <= Date.now() && text(observation.summary)
    ? { known: true, value: { stepId: observation.stepId, source: observation.source,
      observedAt: observation.observedAt, summary: observation.summary } }
    : unknown('setup-evidence-unavailable');
  let state = observed.state;
  if (['denied', 'expired'].includes(state) && !evidence.known) state = 'pending';
  if ((!candidate || state === 'complete') && record.resources.some(row => !row.presence.known)) state = 'reconciling';
  if (stale && !candidate && state !== 'reconciling') state = 'blocked';
  if (record.cancelled) state = 'cancelled';

  const browser = raw?.step.browser;
  let handoffUrl;
  if (includeBrowserHandoff && !record.cancelled && !stale && browser &&
      raw.kind === 'open-url' && Date.parse(browser.expiresAt) > now && state === 'pending') {
    const url = URL.parse(raw.href);
    if (url?.protocol === 'https:' && !url.username && !url.password) handoffUrl = raw.href;
  }
  const nextAction = candidate ? { ...candidate, ...(handoffUrl && { href: handoffUrl }), consent: consentSnapshot(review(candidate)) } : null;
  const view = { schemaVersion: 1, operationId: request.operationId, revision: record.revision,
    scope: { registryId: deps.registryId, scopeId: configuration.scopeId, providerId: request.providerId,
      configurationRevision: configuration.revision, draftId: record.draftId },
    state, evidence, nextAction, resources: record.resources.map(resourceView) };
  return { view, intent, resource };
}

async function execute(request, deps, storage, adapter, context, record, command) {
  const { action, value, resource } = command;
  const { tx } = storage;
  const inputId = inputIdOf(adapter, action);
  if (action.kind === 'provide-secret') await tx.withSecret(inputId, request.secretHandle, async () => {});
  if (['provide-value', 'provide-secret'].includes(action.kind)) tx.assertMutable();
  if (resource && ['remove-resource', 'revoke-credential'].includes(action.step.purpose)) tx.assertUnused();
  if (resource && action.step.purpose !== 'reconcile' && !resource.presence.value) fail('candidate_stale');
  if (action.kind === 'gozar-runs' && typeof adapter.executeSetup !== 'function') fail('unsupported');

  const intent = command.intent && {
    ...command.intent, id: randomUUID(), admittedAt: new Date().toISOString(),
    presence: unknown('provider-observation-pending'),
  };
  if (intent) record.resources.push(intent);
  record.replays[record.revision] = command.fingerprint;
  record.revision++;
  record.lastActionId = action.id;
  await storage.checkpoint();

  let persistenceError;
  const checkpoint = async () => {
    try { await storage.checkpoint(); }
    catch (error) { persistenceError = error; throw error; }
  };
  const assertAdvancing = () => { if (record.cancelled || storage.stale) fail('configuration_stale'); };
  const effectContext = {
    ...context,
    hasManagementSecret: name => storage.hasManagementSecret(slot(name)),
    withInputSecret: use => tx.withSecret(inputId, request.secretHandle, use),
    withManagementSecret: (name, use) => storage.withManagementSecret(slot(name), use),
    retainManagementSecret: name => storage.retainManagementSecret(slot(name), inputId, request.secretHandle),
    disconnectManagementSecret: name => storage.disconnectManagementSecret(slot(name)),
    bindConnectorSecret: (id, bytes) => { assertAdvancing(); return storage.bindConnectorSecret(id, bytes); },
    disconnectConnectorSecret: storage.disconnectConnectorSecret,
    async recordAllocation(identity) {
      if (!intent || !identity || intent.receiptIdentity) fail('invalid_input');
      intent.receiptIdentity = canonicalConsentValue(identity);
      if (intent.kind !== 'credential') await checkpoint();
    },
    bindConfigurationValue: (id, value) => { assertAdvancing(); tx.bindText(id, value); },
    executeApprovedAction: id => {
      if (id !== action.id || typeof deps.executeApprovedAction !== 'function') fail('unsupported');
      return deps.executeApprovedAction(id);
    },
  };

  try {
    if (action.kind === 'install-artifact') {
      await executeArtifact(action, { hostCapabilities: deps.hostCapabilities, executor: deps.artifactExecutor,
        platform: deps.platform, architecture: deps.architecture ?? process.arch });
    }
    const result = await adapter.executeSetup?.(effectContext, { action, value,
      intent: intent ? structuredClone(intent) : null, resource: resource ? structuredClone(resource) : null });
    if (result?.state === 'blocked' || result?.state === 'pending') return result.state;
    if (action.kind === 'provide-value') { assertAdvancing(); tx.bindText(inputId, value); }
    if (result?.bindInputSecret === true && action.kind === 'provide-secret') {
      assertAdvancing();
      await tx.bindSecret(inputId, request.secretHandle);
    }
    const configuration = tx.finish();
    if (configuration) record.configurationRevision = configuration.revision;
    await checkpoint();
  } catch {
    if (persistenceError) throw persistenceError;
    // The checkpoint already admitted this command. Never retry its dispatch on a lost response.
    // Readback, including negative readback, is the adapter's responsibility.
    return 'blocked';
  }
  return 'complete';
}

export async function runSetupOperation(request, deps) {
  validateRef(request);
  const fingerprint = validatedInput(request);
  return deps.embeddingServices.setupTransaction(request, async storage => {
    const { adapter, context } = await openContext(request, deps, storage);
    let { record } = storage;
    if (!record) {
      if (request.expectedSetupRevision !== 0) fail('route_not_found');
      const configuration = await storage.tx.configuration();
      if (storage.stale || configuration?.revision !== request.expectedConfigurationRevision) fail('configuration_stale');
      record = { scopeId: storage.scopeId, draftId: request.draftId ?? null, configurationRevision: configuration.revision,
        revision: 0, startedAt: new Date().toISOString(), cancelled: false, management: {}, replays: { 0: fingerprint }, resources: [] };
      const { view } = await refresh(request, deps, storage, adapter, context, record);
      // Reservation admits no action: setup may have completed since the host's offer.
      if (view.nextAction?.id !== request.actionId && !(view.state === 'complete' && view.nextAction === null)) fail('candidate_stale');
      storage.reserve(record);
      return view;
    }
    if (record.draftId !== (request.draftId ?? null)) fail('configuration_stale');
    const revision = request.expectedSetupRevision;
    if (Object.hasOwn(record.replays, revision)) {
      if (record.replays[revision] !== fingerprint) fail('consent_mismatch');
      return (await refresh(request, deps, storage, adapter, context, record)).view;
    }
    if (record.configurationRevision !== request.expectedConfigurationRevision) fail('configuration_stale');
    const { view, intent, resource } = await refresh(request, deps, storage, adapter, context, record);
    if (revision !== record.revision || view.nextAction?.id !== request.actionId) fail('consent_mismatch');
    if (!request.approval) return { ...view, state: record.cancelled ? 'cancelled' : 'authorization-required' };
    const action = view.nextAction;
    if (request.approval.kind !== 'setup' || request.approval.consentFactsDigest !== action.consent.consentFactsDigest ||
        request.approval.digest !== action.digest || request.approval.disclosureRevision !== action.disclosure.revision) fail('consent_mismatch');
    if ((storage.stale || record.cancelled) && !recovery.has(action.step.purpose)) fail('configuration_stale');
    const value = request.value === undefined ? undefined : checkValue(action.valueFormat, request.value);
    if ((action.kind === 'provide-value' ? !value || (action.step.options && !action.step.options.some(option => option.value === value)) : value !== undefined) ||
        ((action.kind === 'provide-secret') !== (request.secretHandle !== undefined))) fail('invalid_input');
    if (['open-url', 'instructions'].includes(action.kind)) return view;
    return { execution: await execute(request, deps, storage, adapter, context, record,
      { action, value, resource, intent, fingerprint }) };
  }).then(async result => {
    if (!('execution' in result)) return result;
    const view = await readSetupOperation(request, deps);
    if (result.execution !== 'complete' && view.nextAction?.id === request.actionId &&
        ['authorization-required', 'pending', 'blocked'].includes(view.state)) {
      return { ...view, state: result.execution };
    }
    return view;
  });
}

async function updateOperation(request, deps, cancel) {
  validateRef(request);
  return deps.embeddingServices.setupTransaction(request, async storage => {
    const { record } = storage;
    if (!record) fail('route_not_found');
    const { adapter, context } = await openContext(request, deps, storage);
    if (cancel && !record.cancelled) {
      record.cancelled = true;
      record.revision++;
      await storage.checkpoint();
    }
    return (await refresh(request, deps, storage, adapter, context, record, {
      includeBrowserHandoff: !cancel && request.includeBrowserHandoff === true,
    })).view;
  });
}

export const readSetupOperation = (request, deps) => updateOperation(request, deps, false);
export const cancelSetupOperation = (request, deps) => updateOperation(request, deps, true);
