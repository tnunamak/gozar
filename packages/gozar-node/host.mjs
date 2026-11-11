import { PublicRelayVerifier } from './public-relay.mjs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { safeOrigin } from './catalog.mjs';

// Feature names describe implemented boundaries. Remote execution is an injected trusted capability.
export const LOCAL_PLAN_FEATURES = ['recipe-sequence', 'typed-bindings', 'predicate-parser', 'owned-resource-ledger',
  'owned-process', 'interface-forwarder', 'private-file-reference', 'unused-port-selection'];

export async function prepareHost(driver, adapter, { origin, gate, probeExecutor, authorities = {} } = {}) {
  const nowMs = driver.nowMs(), expiresAtMs = nowMs + 900_000;
  const host = { nowMs, features: [...LOCAL_PLAN_FEATURES], bindings: {}, facts: {}, probe: null };
  if (gate) {
    host.features.push('probe-assertions');
    host.probe = { nonceRef: gate.nonceRef, verifierRef: gate.verifierRef, expiresAtMs, ...(probeExecutor instanceof PublicRelayVerifier ? { allowPublicRelay:true } : {}) };
  }
  if (probeExecutor) host.features.push('client-vantage-probe');
  const receipt = value => ({ value, authorityRef: randomUUID(), sessionId: driver.sessionId, observedAtMs: nowMs, expiresAtMs });
  for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
    if (Object.hasOwn(spec, 'value') || (spec.source && spec.pointer)) continue;
    let value;
    if (spec.type === 'loopback-port') value = driver.targetPort;
    else if (spec.type === 'loopback-http-origin') value = `http://127.0.0.1:${driver.targetPort}`;
    else if (spec.type === 'credential-free-https-origin' && origin) {
      value = safeOrigin(origin);
      if (!value.startsWith('https://')) throw new Error('External origin requires HTTPS');
    } else if (spec.type === 'selected-interface-address' && driver.bindAddresses.length === 1) {
      const selected = driver.bindAddresses[0];
      if (Object.values(networkInterfaces()).flat().some(address => address.address === selected && !address.internal)) value = selected;
    } else if (spec.type === 'session-private-path') {
      const { fileHandle } = await driver.privateFiles.create();
      host.bindings[name] = { ...receipt(undefined), type: spec.type, handleRef: fileHandle, mode: '0600', parentMode: '0700' };
      delete host.bindings[name].value;
    }
    if (value !== undefined) host.bindings[name] = { ...receipt(value), type: spec.type };
  }
  const exactInterface = driver.bindAddresses.length === 1 && Object.values(networkInterfaces()).flat().some(address => address.address === driver.bindAddresses[0] && !address.internal);
  if (exactInterface) host.facts['selected-interface-still-present'] = receipt(true);
  if (exactInterface && driver.firewallApproved) host.facts['firewall-user-approved'] = receipt(true);
  // Current profile, remote address reachability, provider permission and remote continuity are never synthesized.
  const supplied = typeof authorities === 'function' ? await authorities({ sessionId: driver.sessionId, adapterId: adapter.id, targetPort: driver.targetPort, nowMs, expiresAtMs, bindings: adapter.bindings }) : authorities;
  for (const [name, fact] of Object.entries(supplied.facts ?? {})) {
    if (fact.sessionId === driver.sessionId && fact.observedAtMs <= nowMs && fact.expiresAtMs > nowMs && fact.authorityRef) host.facts[name] = structuredClone(fact);
  }
  for (const [name, binding] of Object.entries(supplied.bindings ?? {})) {
    if (binding.sessionId === driver.sessionId && binding.observedAtMs <= nowMs && binding.expiresAtMs > nowMs && binding.authorityRef && adapter.bindings?.[name]?.type === binding.type) host.bindings[name] = structuredClone(binding);
  }
  driver.host = host; driver.publicRelay = probeExecutor instanceof PublicRelayVerifier; driver.gate = gate; driver.probeExecutor = probeExecutor;
  return host;
}
