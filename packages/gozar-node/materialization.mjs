import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expandPlan } from './bindings.mjs';

const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,512}$/.test(value);
export function scopedReceipt(receipt, { sessionId, generation, nowMs }) {
  return Number.isSafeInteger(generation) && generation > 0 && receipt && opaque(receipt.authorityRef) && receipt.sessionId === sessionId && receipt.generation === generation &&
    Number.isSafeInteger(receipt.observedAtMs) && Number.isSafeInteger(receipt.expiresAtMs) && receipt.observedAtMs <= nowMs && receipt.expiresAtMs > nowMs;
}

export function privateMaterializationScope(spec, bindings, facts, scope) {
  const declaration = spec?.materialize;
  if (spec?.type !== 'session-private-path' || !declaration || !['text', 'json'].includes(declaration.format) ||
      Object.keys(declaration).some(key => !['format', 'template', 'credentialRefs', 'requires'].includes(key)) ||
      !Array.isArray(declaration.credentialRefs) || !declaration.credentialRefs.length || declaration.credentialRefs.length > 16 || new Set(declaration.credentialRefs).size !== declaration.credentialRefs.length ||
      !Array.isArray(declaration.requires) || !declaration.requires.length || declaration.requires.length > 32 || !Object.hasOwn(declaration, 'template') || JSON.stringify(declaration.template).length > 32768) throw new Error('Invalid private materialization declaration');
  const checkReferences = value => {
    if (typeof value === 'string') {
      for (const [, name] of value.matchAll(/\{([^{}]+)\}/g)) {
        const binding = bindings[name], authority = scope.hostBindings?.[name] ?? binding;
        if (!binding || binding.authorityRef !== authority?.authorityRef || !isDeepStrictEqual(binding.value, authority.value) || binding.handleRef !== authority.handleRef ||
            (binding.authorityRef !== `plan:${scope.generation}:${name}` && !scopedReceipt(authority, scope))) throw new Error('Private template binding lacks fresh exact generation authority');
      }
    } else if (value && typeof value === 'object') for (const item of Object.values(value)) checkReferences(item);
  };
  checkReferences(declaration.template);
  for (const rule of declaration.requires) checkReferences(rule.value);
  const credentialRefs = {};
  for (const name of declaration.credentialRefs) {
    const binding = bindings[name];
    if (!opaque(name) || binding?.type !== 'credential-reference' || !opaque(binding.handleRef) || Object.keys(binding).some(key => !['type', 'handleRef', 'authorityRef', 'hostAuthority', 'sessionId', 'generation', 'observedAtMs', 'expiresAtMs'].includes(key)) || (binding.hostAuthority !== undefined && binding.hostAuthority !== binding.authorityRef) || !scopedReceipt(binding, scope)) throw new Error('Credential reference lacks fresh exact session authority');
    credentialRefs[name] = binding.handleRef;
  }
  for (const rule of declaration.requires) {
    const fact = facts[rule.fact];
    if (rule.op !== 'verified' || !Object.hasOwn(rule, 'value') || Object.keys(rule).some(key => !['op', 'fact', 'value'].includes(key)) ||
        !scopedReceipt(fact, scope) || !isDeepStrictEqual(fact.value, expandPlan(rule.value, bindings))) throw new Error('Private materialization requires a fresh exact scoped fact');
  }
  const used = new Set();
  const template = (value, depth = 0) => {
    if (depth > 16 || (value && typeof value === 'object' && Object.keys(value).length > 64)) throw new Error('Private template exceeds structural limits');
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'credential-ref') {
      if (Object.keys(value).some(key => !['kind', 'binding'].includes(key)) || !Object.hasOwn(credentialRefs, value.binding)) throw new Error('Private template credential binding is outside its declaration');
      used.add(value.binding);
      return { kind: 'credential-ref', handleRef: credentialRefs[value.binding] };
    }
    if (Array.isArray(value)) return value.map(item => template(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, template(item, depth + 1)]));
    return typeof value === 'string' ? expandPlan(value, bindings) : value;
  };
  const renderedTemplate = template(declaration.template);
  if (used.size !== declaration.credentialRefs.length) throw new Error('Private template does not use its exact declared credential bindings');
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const declarationHash = createHash('sha256').update(JSON.stringify(canonical({ format: declaration.format, template: renderedTemplate, credentialRefs }))).digest('hex');
  return { format: declaration.format, template: renderedTemplate, credentialRefs: Object.values(credentialRefs), materialization: { credentialRefs }, declarationHash };
}

export async function materializePrivateBinding({ spec, bindings, facts, sessionId, generation, nowMs, files, adapterId, bindingName }) {
  const declaration = privateMaterializationScope(spec, bindings, facts, { sessionId, generation, nowMs });
  const { fileHandle } = await files.create({ ...declaration, generation, materialized: true, adapterId, bindingName });
  return { type: 'session-private-path', handleRef: fileHandle, mode: '0600', parentMode: '0700', sessionId, generation,
    authorityRef: randomUUID(), observedAtMs: nowMs, expiresAtMs: Math.min(...declaration.credentialRefs.map(ref =>
      Object.values(bindings).find(binding => binding.type === 'credential-reference' && binding.handleRef === ref).expiresAtMs),
    ...spec.materialize.requires.map(rule => facts[rule.fact].expiresAtMs)), materialization: declaration.materialization };
}
