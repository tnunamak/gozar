import { PublicRelayVerifier } from './public-relay.mjs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { safeOrigin } from './catalog.mjs';
import { installIdentity } from './install-key.mjs';
import { dirname } from 'node:path';
import { selectedInterfaceAddress } from './interfaces.mjs';
import { createHash } from 'node:crypto';
import { acquireInstallKeyLease } from './key-route-lease.mjs';

// Feature names describe implemented boundaries. Remote execution is an injected trusted capability.
export const LOCAL_PLAN_FEATURES = ['recipe-sequence', 'typed-bindings', 'predicate-parser', 'owned-resource-ledger',
  'owned-process', 'interface-forwarder', 'private-file-reference', 'private-file-materialization', 'transport-origin-mapping', 'unused-port-selection', 'install-ed25519', 'json-event-origin', 'immutable-origin'];

export async function prepareHost(driver, adapter, { origin, gate, probeExecutor, authorities = {}, generation = 1, resolveCredential } = {}) {
  const nowMs = driver.nowMs(), expiresAtMs = nowMs + 900_000;
  const host = { nowMs, features: [...LOCAL_PLAN_FEATURES], bindings: {}, facts: {}, probe: null };
  if (gate) {
    host.features.push('probe-assertions');
    host.probe = { nonceRef: gate.nonceRef, verifierRef: gate.verifierRef, expiresAtMs, ...(probeExecutor instanceof PublicRelayVerifier ? { allowPublicRelay:true } : {}) };
  }
  if (probeExecutor) host.features.push('client-vantage-probe');
  const receipt = (value, expiry = expiresAtMs) => ({ value, generation, authorityRef: randomUUID(), sessionId: driver.sessionId, observedAtMs: nowMs, expiresAtMs: expiry });
  const stableBindingExpiry = driver.lifetimeMs !== undefined && Number.isFinite(gate?.expiresAtMs) ? gate.expiresAtMs : expiresAtMs;
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
      if (selectedInterfaceAddress(selected) && Object.values(networkInterfaces()).flat().some(address => address.address === selected && !address.internal)) value = selected;
    } else if (spec.type === 'session-private-path' && !spec.materialize && !spec.provision) {
      const { fileHandle } = await driver.privateFiles.create();
      host.bindings[name] = { ...receipt(undefined), type: spec.type, handleRef: fileHandle, mode: '0600', parentMode: '0700' };
      delete host.bindings[name].value;
    }
    if (value !== undefined) {
      const expiry = ['loopback-port', 'loopback-http-origin', 'credential-free-https-origin'].includes(spec.type) ? stableBindingExpiry : expiresAtMs;
      host.bindings[name] = { ...receipt(value, expiry), type: spec.type };
    }
  }
  const exactInterface = driver.bindAddresses.length === 1 && selectedInterfaceAddress(driver.bindAddresses[0]) && Object.values(networkInterfaces()).flat().some(address => address.address === driver.bindAddresses[0] && !address.internal);
  if (exactInterface) host.facts['selected-interface-still-present'] = receipt({ address: driver.bindAddresses[0] });
  if (exactInterface && driver.firewallApproved) host.facts['firewall-user-approved'] = receipt({ bindAddress: driver.bindAddresses[0], port: 0, targetHost: '127.0.0.1', targetPort: driver.targetPort, scheme: 'http' });
  // Current profile, remote address reachability, provider permission and remote continuity are never synthesized.
  const supplied = typeof authorities === 'function' ? await authorities({ sessionId: driver.sessionId, adapterId: adapter.id, targetPort: driver.targetPort, nowMs, expiresAtMs, bindings: adapter.bindings }) : authorities;
  for (const [name, fact] of Object.entries(supplied.facts ?? {})) {
    if (fact.sessionId === driver.sessionId && fact.observedAtMs <= nowMs && fact.expiresAtMs > nowMs && fact.authorityRef) host.facts[name] = structuredClone(fact);
  }
  for (const [name, binding] of Object.entries(supplied.bindings ?? {})) {
    if (binding.sessionId === driver.sessionId && binding.observedAtMs <= nowMs && binding.expiresAtMs > nowMs && binding.authorityRef && adapter.bindings?.[name]?.type === binding.type) host.bindings[name] = structuredClone(binding);
  }
  driver.host = host;
  if (resolveCredential) driver.privateFiles.resolveCredential = resolveCredential;
  for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
    if (spec.materialize) await driver.materializePrivateFile(adapter.id, name, { generation });
  }
  driver.publicRelay = probeExecutor instanceof PublicRelayVerifier; driver.gate = gate; driver.probeExecutor = probeExecutor;
  return host;
}

// Installation identities are created only after the selected route is approved.
export async function acquireInstallIdentityLease(driver, adapter, targetPort = driver.targetPort) {
  const provision = Object.values(adapter?.bindings ?? {}).some(binding => binding.provision === 'install-ed25519');
  if (!provision) return null;
  const home = dirname(driver.journal.directory);
  const identity = await installIdentity(home);
  const keyFingerprint = createHash('sha256').update(identity).digest('hex');
  return acquireInstallKeyLease({ home, keyFingerprint, sessionDirectory:driver.journal.directory,
    sessionId:driver.sessionId, targetPort });
}

export async function prepareInstallIdentities(driver, adapter) {
  for (const [name, spec] of Object.entries(adapter?.bindings ?? {})) {
    if (!spec.provision || driver.host.bindings[name]) continue;
    if (spec.provision !== 'install-ed25519' || spec.type !== 'session-private-path' || Object.keys(spec).some(key => !['type', 'provision'].includes(key)) ||
        adapter.planVersion !== 1 || adapter.admission?.state !== 'admitted' || !adapter.admission.requiredFeatures?.includes('install-ed25519') ||
        !adapter.admission.requiredFeatures.every(feature => driver.host.features.includes(feature))) throw new Error('Identity provisioning is not admitted');
    if (driver.stopped) return;
    const content = await installIdentity(dirname(driver.journal.directory));
    if (driver.stopped) return;
    const { fileHandle } = await driver.privateFiles.create({ template: content });
    if (driver.stopped) { await driver.privateFiles.remove(fileHandle); return; }
    const nowMs = driver.nowMs();
    driver.host.bindings[name] = { type: 'session-private-path', handleRef: fileHandle, mode: '0600', parentMode: '0700',
      generation: 1, authorityRef: randomUUID(), sessionId: driver.sessionId, observedAtMs: nowMs,
      expiresAtMs: driver.gate?.expiresAtMs ?? nowMs + 900000 };
  }
}
