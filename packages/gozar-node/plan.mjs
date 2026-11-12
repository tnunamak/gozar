import { selectedInterfaceAddress } from './interfaces.mjs';
import { safeOrigin } from './catalog.mjs';
import { isDeepStrictEqual } from 'node:util';
import { expandPlan } from './bindings.mjs';
import { scopedReceipt, privateMaterializationScope } from './materialization.mjs';
import { transportEndpoint, assertTransportMapping } from './transport.mjs';
export { expandPlan } from './bindings.mjs';

const metadata = new Set(['id', 'sessionId', 'generation', 'operation', 'adapterId', 'resourceId', 'recipeRef', 'stepId', 'stage', 'bindings', 'bindingRefs', 'ownership']);
const planFields = new Set(['before', 'after', 'requires', 'ledger', 'parser', 'captures', 'assert']);
const executableFields = new Set(['kind', 'program', 'args', 'timeoutMs', 'maxOutputBytes', 'process', 'resourceId', 'signal', 'graceMs', 'thenSignal', 'confirmExit', 'afterExit', 'targetHost', 'targetPort', 'bindAddress', 'port', 'url', 'vantage', 'sse', 'streamableHttp', 'oauthDcr', 'handleRef', 'delayMs', 'longRunning', 'collectMs', 'lifetimeMs', 'cleanupPrivateArtifacts']);
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,512}$/.test(value);
const integerPort = value => Number.isSafeInteger(value) && value > 0 && value <= 65535;

export function validateBinding(type, value, targetPort) {
  switch (type) {
    case 'transport-endpoint': return transportEndpoint(value);
    case 'bool': return typeof value === 'boolean';
    case 'port': case 'unused-port': return integerPort(value);
    case 'loopback-port': return integerPort(value) && value === targetPort;
    case 'reserved-unused-port': return Number.isSafeInteger(value) && value >= 0 && value <= 65535;
    case 'dns-name': return typeof value === 'string' && value.length <= 253 && value.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
    case 'mount': return typeof value === 'string' && /^\/[A-Za-z0-9_/-]*$/.test(value) && !value.includes('..') && value.length <= 128;
    case 'opaque-ref': case 'opaque-private-reference': case 'resource-handle': return opaque(value);
    case 'literal': return typeof value === 'boolean' || (Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,512}$/.test(value));
    case 'selected-interface-address': return selectedInterfaceAddress(value);
    case 'origin': case 'credential-free-https-origin': case 'loopback-http-origin':
      try {
        if (safeOrigin(value) !== value) return false;
        const url = new URL(value);
        if (type === 'credential-free-https-origin') return url.protocol === 'https:';
        if (type === 'loopback-http-origin') return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && Number(url.port) === targetPort;
        return true;
      } catch { return false; }
    default: return false;
  }
}


export function recipeAt(adapter, recipeRef) {
  if (typeof recipeRef !== 'string') throw new Error('Operational effect requires recipeRef');
  const parts = recipeRef.split('/');
  const root = adapter.recipes?.[parts[0]];
  if (!root || !['detect', 'create', 'remove'].includes(parts[0])) throw new Error('Unknown admitted recipe path');
  if (parts.length === 2 && parts[1] === 'execute') return { recipe: root, stage: 'execute', stepId: 'execute', operation: parts[0] };
  if (parts.length === 3 && ['before', 'after'].includes(parts[1])) {
    const step = root[parts[1]]?.find(step => step.id === parts[2]);
    if (step?.recipe && !step.recipe.before && !step.recipe.after) return { recipe: step.recipe, stage: parts[1], stepId: step.id, operation: parts[0] };
  }
  throw new Error('Effect recipeRef does not name an exact admitted plan step');
}

export function admitPlanEffect(effect, { adapters, sessionId, targetPort, features, host, nowMs, owned = {} }) {
  const adapter = adapters.find(record => record.id === effect.adapterId);
  if (!adapter || adapter.planVersion !== 1 || adapter.admission?.state !== 'admitted' ||
      !Array.isArray(adapter.admission.requiredFeatures) || adapter.admission.requiredFeatures.some(feature => !features.includes(feature))) throw new Error('Operational plan feature admission failed');
  const located = recipeAt(adapter, effect.recipeRef);
  const expectedOperation = ['before', 'after'].includes(located.stage) ? 'observe' : located.operation;
  if (located.stage !== effect.stage || located.stepId !== effect.stepId || expectedOperation !== effect.operation) throw new Error('Operational step identity mismatch');
  if (effect.sessionId !== sessionId) throw new Error('Operational session mismatch');
  const bindings = effect.bindings ?? {};
  if (Object.keys(bindings).length > 32 || Object.keys(effect.bindingRefs ?? {}).length !== Object.keys(bindings).length) throw new Error('Invalid operational binding scope');
  for (const [name, binding] of Object.entries(bindings)) {
    const resource = owned[effect.resourceId];
    if (name === 'resourceId' && binding.type === 'resource-handle' && resource?.sessionId === sessionId && binding.value === resource.id && binding.authorityRef === resource.continuityRef) continue;
    const spec = adapter.bindings?.[name];
    if (!spec || binding.type !== spec.type || !opaque(binding.authorityRef) || effect.bindingRefs[name] !== binding.authorityRef) throw new Error('Binding is outside the admitted definition');
    if (resource?.sessionId === sessionId && resource.bindings?.[name] && JSON.stringify(resource.bindings[name]) === JSON.stringify(binding)) continue;
    const hostBinding = host.bindings?.[name];
    if (hostBinding) {
      if (['sessionId', 'generation', 'observedAtMs', 'expiresAtMs', 'mode', 'parentMode'].some(key => Object.hasOwn(binding, key) && binding[key] !== hostBinding[key])) throw new Error('Binding receipt differs from host authority');
      if (hostBinding.authorityRef !== binding.authorityRef || hostBinding.sessionId !== sessionId || hostBinding.observedAtMs > nowMs || hostBinding.expiresAtMs <= nowMs ||
          (['session-private-path', 'credential-reference'].includes(hostBinding.type) ? hostBinding.handleRef !== binding.handleRef : !isDeepStrictEqual(hostBinding.value, binding.value))) throw new Error('Host binding authority is stale or mismatched');
    } else {
      if (binding.authorityRef !== `plan:${effect.generation}:${name}` || !(Object.hasOwn(spec, 'value') || (spec.source && spec.pointer))) throw new Error('Binding lacks host authority or a declared captured source');
      if (Object.hasOwn(spec, 'value') && JSON.stringify(binding.value) !== JSON.stringify(spec.value)) throw new Error('Literal binding changed');
    }
    if (spec.type === 'unused-port' && (!spec.candidates?.includes(binding.value) || spec.protectedPorts?.includes(binding.value))) throw new Error('Listener binding is outside the explicit unprotected candidates');
    if (binding.hostAuthority !== undefined && binding.hostAuthority !== binding.authorityRef) throw new Error('Binding host authority mismatch');
    const scope = { sessionId, generation: effect.generation, nowMs, hostBindings: host.bindings };
    if (['credential-reference', 'transport-endpoint'].includes(binding.type) || spec.materialize) {
      if (!scopedReceipt(hostBinding, scope) || !scopedReceipt(binding, scope)) throw new Error('Binding lacks exact generation authority');
    }
    if (binding.type === 'credential-reference') {
      if (!opaque(binding.handleRef) || Object.keys(binding).some(key => !['type', 'handleRef', 'sessionId', 'generation', 'authorityRef', 'hostAuthority', 'observedAtMs', 'expiresAtMs'].includes(key))) throw new Error('Credential binding must contain only scoped opaque authority');
    } else if (binding.type === 'session-private-path') {
      if (!hostBinding || binding.mode !== '0600' || binding.parentMode !== '0700' || !opaque(binding.handleRef)) throw new Error('Private binding lacks exact session authority');
      if (Object.keys(binding).some(key => !['type', 'handleRef', 'sessionId', 'generation', 'authorityRef', 'observedAtMs', 'expiresAtMs', 'mode', 'parentMode', 'materialization', 'hostAuthority'].includes(key))) throw new Error('Private binding contains undeclared material');
      if (spec.materialize) {
        const declaration = privateMaterializationScope(spec, bindings, host.facts ?? {}, scope);
        const file = owned[binding.handleRef];
        if (!file?.materialized || file.sessionId !== sessionId || file.generation !== effect.generation || file.adapterId !== adapter.id || file.bindingName !== name || file.declarationHash !== declaration.declarationHash) throw new Error('Private artifact does not match its exact materialization declaration');
        if (!isDeepStrictEqual(binding.materialization, declaration.materialization) || !isDeepStrictEqual(hostBinding.materialization, binding.materialization)) throw new Error('Private materialization reference authority mismatch');
      }
    } else if (!validateBinding(binding.type, binding.value, targetPort)) throw new Error('Binding value does not match its approved type or target');
  }
  if (located.operation === 'create' && located.stage === 'execute') {
    for (const rule of located.recipe.requires ?? []) {
      if (rule.op === 'transport-mapping') {
        const mapping = assertTransportMapping(rule, host, bindings, { sessionId, generation: effect.generation, nowMs });
        if (mapping.upstream.hostname !== '127.0.0.1' || mapping.upstream.port !== targetPort) throw new Error('Transport mapping upstream differs from the approved loopback target');
      }
      if (rule.op === 'verified' && Object.hasOwn(rule, 'value')) {
        const fact = host.facts?.[rule.fact];
        if (!scopedReceipt(fact, { sessionId, generation: effect.generation, nowMs }) || !isDeepStrictEqual(fact.value, expandPlan(rule.value, bindings))) throw new Error('Exact scoped fact authority mismatch');
      }
    }
  }
  const recipe = Object.fromEntries(Object.entries(located.recipe).filter(([key]) => !planFields.has(key) && key !== 'process'));
  const process = located.recipe.process;
  if (process?.mode === 'owned-long-running') {
    recipe.longRunning = true; recipe.lifetimeMs = process.lifetimeMs;
    if (process.collectMs !== undefined) recipe.collectMs = process.collectMs;
  }
  if (Object.keys(recipe).some(key => !executableFields.has(key))) throw new Error('Unsupported operational execution field');
  const expected = expandPlan(recipe, bindings);
  const payload = Object.fromEntries(Object.entries(effect).filter(([key]) => !metadata.has(key)));
  // resourceId is authoritative metadata for cleanup, not a recipe-supplied grant.
  delete expected.resourceId;
  if (Object.keys(payload).some(key => !executableFields.has(key))) throw new Error('Undeclared operational effect field');
  const keys = new Set([...Object.keys(expected), ...Object.keys(payload)]);
  if ([...keys].some(key => JSON.stringify(expected[key]) !== JSON.stringify(payload[key]))) throw new Error('Effect payload differs from its exact admitted recipe step');
  if (['before', 'after'].includes(located.stage) && (recipe.kind === 'owned-process' || recipe.kind === 'local-forwarder' || recipe.process?.mode === 'owned-long-running')) throw new Error('Observation step cannot allocate or stop a resource');
  return { adapter, recipe: located.recipe, bindings };
}

// Route-scoped admission for durable routes. A durable route has no session, so its authority
// is the route record: route ID, record generation and `route:<routeId>:<generation>`. The
// listener rule comes from the adapter's declared durableRecipe, never from inline code.
const durableTransports = new Set(['tailscale-localapi-serve-config']);
const loopbackTarget = value => typeof value === 'string' && /^127\.0\.0\.1:([0-9]{1,5})$/.test(value) && integerPort(Number(value.split(':')[1]));
export const routeAuthority = (routeId, generation) => `route:${routeId}:${generation}`;

// The durable capability of one adapter definition, or null if it cannot hold a stable origin.
export function durableCapability(definition) {
  const recipe = definition?.durableRecipe;
  if (definition?.addressStability !== 'stable' || definition.durableLifetime !== 'provider-persistent' || !recipe ||
      !durableTransports.has(recipe.transport) || !['funnel', 'serve'].includes(recipe.mode) ||
      !Array.isArray(recipe.candidatePorts) || !recipe.candidatePorts.length || !recipe.candidatePorts.every(integerPort) || !recipe.listener) return null;
  return { adapterId: definition.id, lifetime: definition.durableLifetime, idleTimeoutMs: definition.idleTimeoutMs ?? null,
    providerResource: definition.providerResource, mode: recipe.mode, candidatePorts: [...recipe.candidatePorts],
    portsFromCapability: recipe.portsFromCapability ?? null, recipe };
}

// Admit one durable listener effect against the adapter recipe and the route's own authority.
// Returns the exact listener the host may write; anything else is refused before any mutation.
export function admitRouteEffect(effect, { definition, routeId, generation }) {
  const capability = durableCapability(definition);
  if (!capability || effect.adapterId !== definition.id) throw new Error('Adapter is not admitted for durable routes');
  if (effect.routeId !== routeId || effect.generation !== generation || !Number.isSafeInteger(generation) || generation < 1 ||
      effect.authorityRef !== routeAuthority(routeId, generation)) throw new Error('Durable effect lacks exact route authority');
  if (!['create', 'remove'].includes(effect.operation)) throw new Error('Unknown durable operation');
  const { port, dnsName, target } = effect.bindings ?? {};
  if (Object.keys(effect.bindings ?? {}).sort().join() !== 'dnsName,port,target') throw new Error('Durable binding scope is not exact');
  if (port?.type !== 'port' || !capability.candidatePorts.includes(port.value)) throw new Error('Durable port is outside the declared candidates');
  if (dnsName?.type !== 'dns-name' || !validateBinding('dns-name', dnsName.value)) throw new Error('Durable DNS name is invalid');
  if (target?.type !== 'loopback-target' || !loopbackTarget(target.value)) throw new Error('Durable target must be 127.0.0.1:PORT');
  const listener = expandPlan(capability.recipe.listener, { target });
  if (!isDeepStrictEqual(effect.listener, listener)) throw new Error('Durable listener differs from the admitted recipe');
  return { mode: capability.mode, port: port.value, dnsName: dnsName.value, hostPort: `${dnsName.value}:${port.value}`, listener };
}
