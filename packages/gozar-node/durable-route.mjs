// Durable owned routes: a bounded host transaction outside the session driver.
// The record is authoritative. Intent is written and fsynced before the provider write, and a
// receipt (exact listener + readback) before publication. A fresh process can observe, verify
// and remove the route from the record alone: no controller, gate or timer.
//
// A provider's durable rules change only through its adapter's `durable` facet (adapter-runtime.mjs): the facet
// observes a snapshot with an opaque version and writes with compare-and-set. Core never writes without the version
// of a read, and on a `conflict` it re-reads and re-decides. This file owns the state and the decisions; the facet
// owns provider I/O and the arithmetic of its slots.
import { readdir, readFile, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { portListening } from './target-check.mjs';
import { isDeepStrictEqual } from 'node:util';
import { atomicWrite, processIdentity } from './journal.mjs';
import { trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock, verification, readChallenge,
  challengePath, canonicalAuthority } from './service-state.mjs';
import { durableCapability, admitRouteEffect, routeAuthority } from './plan.mjs';
import { loadAdapters } from './adapter-runtime.mjs';
import { redeemConsentToken, consentBinding, canonicalDigest } from './consent-token.mjs';
import { defaultHome } from './default-home.mjs';

const refuse = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const hash = routeId => createHash('sha256').update(routeId).digest('hex');
const routeDirectory = home => join(home, 'routes');
// Compare-and-set: at most this many read-decide-write rounds, with a short jittered pause between rounds.
export const casAttempts = 3;
export const casBackoffMs = 25;
// A leased rule is renewed from status when it expires within this long.
const renewLeadMs = 60_000;
const reservationWaitSeconds = 30;

// The challenge verifier. Tests replace it with a fake; production never does.
const verifier = { run: verification };
/** Test seam: replace the challenge verifier. Returns a restore function. */
export function setVerifierForTest(replacement) {
  const saved = verifier.run;
  verifier.run = replacement;
  return () => { verifier.run = saved; };
}
// A verifier that holds for one call and the work it starts, so concurrent callers do not share it (used by a route API
// built with a `verify` option). Without one, the replaceable global above answers.
const scopedVerifier = new AsyncLocalStorage();
const runVerifier = check => (scopedVerifier.getStore() ?? verifier.run)(check);
/** Runs `action` with `verify({ origin, target })` as the challenge verifier. */
export const withVerifier = (verify, action) => scopedVerifier.run(verify, action);

function routeIdValue(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw refuse('invalid_input', 'Route ID must be 1..63 lowercase letters, digits or hyphens');
  return value;
}
export function loopbackTarget(value) {
  const match = typeof value === 'string' && /^127\.0\.0\.1:([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw refuse('invalid_input', 'Durable route target must be 127.0.0.1:PORT');
  return value;
}
const targetPort = target => Number(target.slice(target.lastIndexOf(':') + 1));

// The consent copy a host shows before it passes a durable approval tuple.
export function durableConsentText({ routeId, origin, owner }) {
  return `Route ${routeId} stays reachable at ${origin ?? 'its new address'} whether or not ${owner} is running, ` +
    `until you stop it with \`gozar stop --route ${routeId}\`.`;
}

// The loaded adapters that have a durable facet describing a stable address. `deps.adapters` replaces loadAdapters().
async function adaptersOf(deps) { return deps?.adapters ?? loadAdapters(); }
export async function durableAdapters(deps) {
  return (await adaptersOf(deps)).filter(adapter => adapter.durable && durableCapability(adapter.durable.definition));
}
// `asFacts`: the catalog asked for facts about an adapter with no durable recipe (the contract's
// `unsupported`); otherwise a route call named an adapter that cannot keep a stable origin.
function durableEntry(adapters, adapterId, asFacts = false) {
  const adapter = adapters.find(item => item.id === adapterId && item.durable);
  const capability = adapter ? durableCapability(adapter.durable.definition) : null;
  if (!capability && asFacts) throw refuse('provider_unsupported', 'This adapter has no durable recipe');
  if (!capability) throw refuse('adapter_not_durable', 'Selected adapter cannot keep a stable origin');
  return { adapterId, adapter, facet: adapter.durable, capability };
}
const durableContext = home => ({ home, platform: process.platform, now: () => Date.now() });
const providerConflict = facet => Object.assign(new Error('Another program keeps changing the provider config: retry later'),
  { code: 'provider_conflict', provider: facet.family ?? null, nextAction: 'retry later' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// One observation per provider store (adapters that share a providerResource share a store). An entry is what the
// selection and the plan facts read: the adapter, its facet and the snapshot.
export const observeDurableStores = (adapters, home, options) => observeStores(adapters, durableContext(home), options);
async function observeStores(adapters, ctx, { tolerant = false } = {}) {
  const stores = new Map(), entries = [], errors = [];
  for (const adapter of adapters) {
    const key = durableCapability(adapter.durable.definition).providerResource;
    if (!stores.has(key)) stores.set(key, adapter.durable.observe(ctx).then(observed => ({ observed }), error => ({ error })));
    const { observed, error } = await stores.get(key);
    if (error) { errors.push(error); if (!tolerant) throw error; continue; }
    entries.push({ adapterId: adapter.id, adapter, durable: adapter.durable, ...observed });
  }
  return { entries, errors };
}

// --- Plan facts: what a consent token is a receipt for ---
// One function computes them, for the issuer (the catalog, through durablePlanFacts) and for the
// redeemer (ensureRoute and adoptRoute under the reservation lock), so the two cannot disagree.
//
// planDigest covers the adapter's durable recipe, the target and the origin the route would
// publish. observedResource covers the node's DNS name and the state of the ONE candidate
// listener: its port and what the config holds there. An edit to any other port changes neither.

// The slot a first allocation takes: with an origin, only the slot that serves that origin (it must be permitted,
// free and unreserved); without one, the first such slot in the facet's order.
function allocatableSlot(facet, capability, observed, table, { routeId, origin, target }) {
  // An adopt-only slot is for taking over an existing rule; Gozar never writes a new one there.
  const slots = facet.slots(observed.snapshot, { target }).filter(item => !item.adoptOnly);
  const free = item => item.permitted && !facet.occupied(observed.snapshot, item.slot) && !facet.foreign(observed.snapshot, item.slot) &&
    !heldBy(table, { routeId, resource: capability.providerResource, port: item.slot });
  if (origin === null) return { slot: slots.find(free)?.slot };
  const match = slots.find(item => item.origin === origin);
  return match === undefined ? { mismatch: true } : { slot: free(match) ? match.slot : undefined };
}
// The slot the facts are about. With an origin it is the slot that serves it, whatever holds it
// (an adoption observes the rule that is there); without one it is the first allocation.
function candidateOf(facet, capability, observed, table, { routeId, origin, target }) {
  if (origin === null) return allocatableSlot(facet, capability, observed, table, { routeId, origin, target }).slot;
  return facet.slots(observed.snapshot, { target }).find(item => item.origin === origin)?.slot;
}
const originAt = (facet, observed, slot, target) => facet.slots(observed.snapshot, { target }).find(item => item.slot === slot).origin;
const planDigestOf = (adapterId, capability, target, origin) =>
  'sha256:' + canonicalDigest({ adapterId, providerResource: capability.providerResource, recipe: capability.recipe, target, origin });
// Pure given one observation. `table` is the reservation table (empty for a read-only view of an
// adoption, which never allocates). The digest preimage keys (`dnsName`, `port`) are frozen: they match what
// earlier builds computed, so a stored planDigest still compares equal. Core treats them as identity and slot.
export function planFactsFromObservation(observed, { adapterId, facet, capability, target, origin, table = [], routeId }) {
  const slot = candidateOf(facet, capability, observed, table, { routeId, origin, target });
  const wouldPublish = slot === undefined ? null : originAt(facet, observed, slot, target);
  const candidate = slot === undefined ? null : { port: slot, rule: facet.read(observed.snapshot, slot), occupied: facet.occupied(observed.snapshot, slot) };
  return { planDigest: planDigestOf(adapterId, capability, target, wouldPublish),
    observedResource: 'sha256:' + canonicalDigest({ provider: capability.providerResource, dnsName: observed.identity, candidate }),
    origin: wouldPublish, port: slot };
}
async function observedReservations(home) {
  let canonical;
  try { canonical = await canonicalHome(home, false); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const dir = routeDirectory(canonical);
  try { await trustedDirectory(dir); await privateDirectory(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return reservationTable(canonical, dir);
}
// Read-only. Throws provider_unsupported (the generic `unsupported`) when the adapter has no durable recipe.
export async function durablePlanFacts({ home = defaultHome(), adapterId, target, origin = null, adapters }) {
  target = loopbackTarget(target);
  if (origin !== null && typeof origin !== 'string') throw refuse('invalid_input', 'origin must be a string or null');
  const { facet, capability } = durableEntry(await adaptersOf({ adapters }), adapterId, true);
  const observed = await facet.observe(durableContext(home));
  const facts = planFactsFromObservation(observed, { adapterId, facet, capability, target, origin, table: await observedReservations(home) });
  return { planDigest: facts.planDigest, observedResource: facts.observedResource, origin: facts.origin,
    creatableOrigin: origin === null || facet.slots(observed.snapshot, { target }).some(item => !item.adoptOnly && item.permitted && item.origin === origin) };
}
// Read-only: the adapter a durable record pins for this route ID, or null. No lock, no provider call.
// The catalog ranks the pin first, so a later preference change never moves a route.
export async function durablePin({ home = defaultHome(), routeId }) {
  routeIdValue(routeId);
  let canonical;
  try { canonical = await canonicalHome(home, false); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const dir = routeDirectory(canonical);
  try { await trustedDirectory(dir); await privateDirectory(dir); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return (await load(dir, routeId))?.adapterId ?? null;
}
// Opaque reference for one existing provider route; adopt checks it when the caller passes one.
export const migrationRefOf = ({ origin, target, observedResource }) => 'mig_' + canonicalDigest({ origin, target, observedResource }).slice(0, 40);

// --- Records, tombstones and the home-wide reservation lock ---

export async function routesDirectory(home, create) {
  const canonical = await canonicalHome(home, create);
  const dir = routeDirectory(canonical);
  let existed = true;
  try { await trustedDirectory(dir, false); } catch (error) { if (error.code !== 'ENOENT' || !create) throw error; existed = false; }
  if (!existed) { await trustedDirectory(dir, true); await syncDirectory(canonical); }
  await privateDirectory(dir);
  return dir;
}
const recordPath = (dir, routeId) => join(dir, hash(routeId) + '.json');
const tombstonePath = (dir, routeId) => join(dir, hash(routeId) + '.stopped');
function checkRecord(record, routeId) {
  if (record.schemaVersion !== 1 || (routeId !== undefined && record.routeId !== routeId) || record.ownership !== 'gozar-owned' ||
      !Number.isSafeInteger(record.generation)) throw new Error('Invalid durable route record');
  return record;
}
async function load(dir, routeId) {
  try { return checkRecord(await readRecord(recordPath(dir, routeId)), routeId); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const save = (dir, record) => atomicWrite(recordPath(dir, record.routeId), record);
export async function syncDirectory(dir) { const fd = await open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
export async function removeFile(path) { try { await unlink(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function drop(dir, routeId) { await removeFile(recordPath(dir, routeId)); await syncDirectory(dir); }
async function stopped(dir, routeId) {
  try { await readRecord(tombstonePath(dir, routeId)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function refuseUserStop(dir, routeId) {
  if (await stopped(dir, routeId)) throw refuse('stopped_by_user', 'The user stopped this route');
}
// A missing record can still have a user-stop tombstone after completed removal.
export async function isUserStopped({ home = defaultHome(), routeId }) {
  routeIdValue(routeId);
  let dir;
  try { dir = await routesDirectory(home, false); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return stopped(dir, routeId);
}
async function clearStop(dir, routeId) { if (await removeFile(tombstonePath(dir, routeId))) await syncDirectory(dir); }
async function allRecords(dir) {
  let names;
  try { names = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const name of names.sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const record = checkRecord(await readRecord(join(dir, name)));
    if (name !== hash(record.routeId) + '.json') throw new Error('Invalid durable route record');
    records.push(record);
  }
  return records;
}

// One home-wide reservation lock serializes sessions, ensure, adopt and release. Acquisition
// blocks for a bounded time, so a release that arrives during a create runs after it.
async function reserved(home, action) {
  const dir = await routesDirectory(home, true);
  const locks = join(dir, '.locks');
  await trustedDirectory(locks, true);
  await privateDirectory(locks);
  return withExclusiveLock(join(locks, 'reservation'), () => action(dir), { waitSeconds: reservationWaitSeconds })
    .catch(error => { throw error.code === 'busy' ? refuse('busy', 'Another Gozar route operation held the reservation lock for 30 s; retry') : error; });
}

// The reservation table: every listener target and provider port claimed in this home, by a
// durable record (in any state) or by a live session. Read under the reservation lock.
async function reservationTable(home, dir) {
  const entries = [];
  for (const record of await allRecords(dir)) {
    const pin = record.receipt ?? record.intent;
    entries.push({ owner: { routeId: record.routeId }, listener: record.target,
      provider: pin ? { resource: record.providerResource ?? null, ports: [pin.port] } : null });
  }
  let names = [];
  try { names = await readdir(home); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names) {
    const match = /^port-([0-9]+)$/.exec(name);
    if (!match) continue;
    const session = join(home, name);
    const json = async file => { try { return JSON.parse(await readFile(join(session, file), 'utf8')); } catch { return null; } };
    const reservation = await json('reservation.json');
    const live = async value => Boolean(value?.startIdentity && await processIdentity(value.pid) === value.startIdentity);
    const journal = await json('session.json');
    if (!(await live(reservation) || await live(await json('launch.json')) || await live(await json('control.json')) ||
        Object.keys(journal?.owned ?? {}).length)) continue;
    entries.push({ owner: { sessionPort: Number(match[1]) }, listener: `127.0.0.1:${match[1]}`,
      provider: reservation?.providerResource ? { resource: reservation.providerResource, ports: reservation.providerPorts ?? [] } : null });
  }
  return entries;
}
function heldBy(table, { routeId, listener, resource, port }) {
  return table.find(entry => !(routeId !== undefined && entry.owner.routeId === routeId) && (
    (listener !== undefined && entry.listener === listener) ||
    (port !== undefined && entry.provider?.resource === resource && entry.provider.ports.includes(port))));
}
const reservedError = () => refuse('reserved', 'Another session or route already holds this listener or provider port');

// Session reservation for `gozar expose`: refused if a durable route holds the listener or the
// provider port; otherwise recorded with the caller's process identity. A home that cannot hold
// durable state (an unsafe path) has no durable routes, so the session path stays as it was.
export async function reserveSession({ home = defaultHome(), port, providerResource = null, providerPorts = [] }) {
  try { await routesDirectory(home, true); }
  catch (error) { if (error.code === 'unsafe_state_path') return { reserved: false }; throw error; }
  return reserved(home, async dir => {
    const canonical = await canonicalHome(home, true);
    const table = await reservationTable(canonical, dir);
    const listener = `127.0.0.1:${port}`;
    // A session may take any one of its provider ports, so it is refused only when a durable route holds the listener or every one of them.
    const durable = table.filter(entry => entry.owner.routeId);
    const heldPort = port => providerResource && durable.some(entry => entry.provider?.resource === providerResource && entry.provider.ports.includes(port));
    if (durable.some(entry => entry.listener === listener) || (providerPorts.length && providerPorts.every(heldPort))) throw reservedError();
    await atomicWrite(join(canonical, `port-${port}`, 'reservation.json'),
      { pid: process.pid, startIdentity: await processIdentity(process.pid), providerResource, providerPorts });
    return { reserved: true };
  });
}
// Read-only, for service routes: the route ID of a durable record published at origin, if any.
// home must already be canonical.
export async function durableRouteAt(home, origin, deps) {
  const dir = routeDirectory(home);
  try { await trustedDirectory(dir); await privateDirectory(dir); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return (await allRecords(dir)).find(record => (record.origin ?? record.intent?.origin) === origin)?.routeId ?? null;
}
// Read-only: does a durable record hold this listener? Never creates state.
export async function durableListenerHeld({ home = defaultHome(), port }) {
  let records;
  try { records = await allRecords(await routesDirectory(home, false)); }
  catch (error) { if (['ENOENT', 'unsafe_state_path'].includes(error.code)) return false; throw error; }
  return records.some(record => record.target === `127.0.0.1:${port}`);
}

// Read-only: which Gozar route or live session in this home holds each of these provider ports. A port that no
// Gozar route holds is absent from the answer: whatever holds it is not ours. Never creates state.
export async function portHolders({ home = defaultHome(), providerResource, ports }, deps) {
  let dir, canonical;
  try { dir = await routesDirectory(home, false); canonical = await canonicalHome(home, false); }
  catch (error) { if (['ENOENT', 'unsafe_state_path'].includes(error.code)) return []; throw error; }
  const table = await reservationTable(canonical, dir);
  return ports.flatMap(port => { const entry = heldBy(table, { resource: providerResource, port }); return entry ? [{ port, ...entry.owner }] : []; });
}

// --- Verification and reconciliation ---

// Derive current state from the record plus a fresh observation. Never trusts saved readiness.
// While nothing is published, the pinned intent origin is what verification checks.
// The record's `dnsName` and `port` fields are the provider identity and slot (names kept for stored records).
// A receipt or a write-ahead intent taken on an empty slot attributes this exact rule.
// Provider-side foreign ownership (for example a foreground Serve rule) still wins.
function matchesEmptyIntent(record, facet, observed, current) {
  return record.intent?.slotWasEmpty === true && !facet.foreign(observed.snapshot, record.intent.port) &&
    isDeepStrictEqual(current, record.intent.rule);
}

async function reconcile(record, facet, observed, { verify = true } = {}) {
  if (['releasing', 'handing-back', 'address_changed'].includes(record.state)) return { state: record.state };
  const pin = record.receipt ?? record.intent;
  if (observed.identity !== pin.dnsName) return { state: 'address_changed' };
  if (record.state === 'suspended') return { state: 'suspended' };
  const current = facet.read(observed.snapshot, pin.port);
  // An exact intent match is a recoverable create; publication still requires a receipt and verification.
  if (!record.receipt && matchesEmptyIntent(record, facet, observed, current)) return { state: 'creating' };
  if (!record.receipt) return current === null ? { state: 'lost' } : { state: 'uncertain', cleanupDebt: { reason: 'unattributed-rule', port: pin.port } };
  if (current === null) return { state: 'lost' };
  if (!isDeepStrictEqual(current, record.receipt.rule)) return { state: 'uncertain', cleanupDebt: { reason: 'rule-changed', port: pin.port } };
  if (!verify || record.state === 'suspending') return { state: record.state };
  const checked = await runVerifier({ origin: record.origin ?? record.intent.origin, target: record.target, verifyCmd: null });
  return { state: checked.status === 'verified' ? 'usable' : 'unverified', verification: checked };
}

// Live check of what answers on the target right now, independent of the provider.
async function targetCheck(record) {
  const port = targetPort(record.target);
  if (!await portListening(port)) return 'nothing listening';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const nonce = randomBytes(32).toString('hex');
    const authority = canonicalAuthority(new URL(record.origin ?? record.intent.origin).host);
    await readChallenge(new URL(`http://${record.target}${challengePath}?nonce=${nonce}`), authority, port, nonce, controller.signal);
    return 'app answering';
  } catch { return 'another program is listening'; }
  finally { clearTimeout(timer); controller.abort(); }
}

function view(record, current = {}, extra = {}) {
  const state = current.state ?? record.state;
  // `origin` is published only after a verification and pins the address; `allocatedOrigin` is the address this route was
  // given (receipt) or is being given (intent). An app needs it before verification, to answer the challenge at that address.
  const reply = { routeId: record.routeId, generation: record.generation, owner: record.owner, createdAt: record.createdAt, origin: record.origin ?? null,
    allocatedOrigin: record.origin ?? record.receipt?.origin ?? record.intent?.origin ?? null, target: record.target,
    adapterId: record.adapterId, ownership: record.ownership, provenance: record.provenance ?? 'created', lifetime: record.lifetime,
    exposure: 'owner-run', forwards: state === 'suspended' ? 'suspended; no provider forwarding rule' : `forwards to ${record.target} whether or not ${record.owner} is running`,
    idleTimeoutMs: record.idleTimeoutMs ?? null, state, verification: current.verification ?? null,
    cleanupDebt: current.cleanupDebt ?? record.cleanupDebt ?? null, ...extra };
  if (record.state === 'handing-back') reply.handBack = { transfer: record.handBack.transfer, claim: record.handBack.claim };
  return reply;
}

// --- Compare-and-set against the provider ---

// Read, decide, write with the version of the read; on `conflict` mutate nothing and re-decide from a fresh read.
// decide(observed) returns { write: { op: 'put' | 'delete', slot, rule } } to write, or { result } to stop without a write.
async function compareAndSet(facet, ctx, decide) {
  for (let attempt = 0; attempt < casAttempts; attempt++) {
    if (attempt) await pause(casBackoffMs * attempt * (0.5 + Math.random()));
    const observed = await facet.observe(ctx);
    const decision = await decide(observed);
    if (!decision.write) return { observed, decision, written: false };
    const { op, slot, rule, identity } = decision.write;
    const outcome = await facet[op === 'put' ? 'put' : 'delete'](ctx, { snapshot: observed.snapshot, slot, rule, identity, version: observed.version });
    if (outcome === 'written') return { observed, decision, written: true };
    if (outcome !== 'conflict') throw refuse('provider_failed', 'The provider returned an unknown write outcome; nothing else was changed', { provider: facet.family ?? null });
  }
  throw providerConflict(facet);
}

function effectFor(record, { capability, facet }, snapshot, operation) {
  const pin = record.intent;
  const effect = { routeId: record.routeId, generation: record.generation, authorityRef: routeAuthority(record.routeId, record.generation),
    adapterId: record.adapterId, operation, listener: pin.rule,
    bindings: { slot: { type: 'slot', value: pin.port }, identity: { type: 'identity', value: pin.dnsName }, target: { type: 'loopback-target', value: record.target } } };
  return admitRouteEffect(effect, { capability, slots: facet.slots(snapshot, { target: record.target }), rule: facet.expand(record.target),
    routeId: record.routeId, generation: record.generation });
}

// Create (or restore) the listener the record pins, by compare-and-set, then read back, write the
// receipt, verify the pinned origin and only then publish it.
async function createListener(dir, record, entry, { table, firstAllocation, expectedOrigin, ctx }) {
  const { facet, capability } = entry;
  const intendedRule = facet.expand(record.target);
  let saved = null;
  const settle = async () => {
    // Nothing was written: a conflict or a rejected write proves the earlier attempt did not apply.
    if (saved && firstAllocation) await drop(dir, record.routeId);
    else if (saved) await save(dir, { ...record, state: 'lost' });
  };
  const { written, decision } = await compareAndSet(facet, ctx, async observed => {
    let slot;
    if (firstAllocation) {
      const pick = allocatableSlot(facet, capability, observed, table, { routeId: record.routeId, origin: record.consent.origin, target: record.target });
      if (pick.mismatch) return { result: 'address_changed' };
      slot = pick.slot;
      if (slot === undefined) return { result: 'no-port' };
      const candidate = originAt(facet, observed, slot, record.target);
      // The approval was for the address the token saw. A foreign edit that moves the allocation
      // to another slot during a retry makes that approval stale; it never publishes elsewhere.
      if (expectedOrigin !== undefined && expectedOrigin !== candidate) return { result: 'stale' };
      record = { ...record, planDigest: planDigestOf(record.adapterId, capability, record.target, candidate),
        intent: { dnsName: observed.identity, port: slot, mode: capability.mode, origin: candidate, rule: intendedRule, slotWasEmpty: true } };
    } else {
      if (observed.identity !== record.intent.dnsName) return { result: 'address_changed' };
      slot = record.intent.port;
      if (facet.occupied(observed.snapshot, slot) || facet.foreign(observed.snapshot, slot)) return { result: 'occupied' };
      record = { ...record, intent: { ...record.intent, slotWasEmpty: true } };
    }
    const admitted = effectFor(record, entry, observed.snapshot, 'create');
    // Intent is durable before the provider write.
    if (!isDeepStrictEqual(saved, record)) { await save(dir, record); saved = record; }
    return { write: { op: 'put', slot: admitted.slot, rule: admitted.listener } };
  }).catch(async error => {
    if (['provider_conflict', 'provider_failed'].includes(error.code)) await settle();
    throw error;
  });
  if (!written) {
    await settle();
    if (decision.result === 'address_changed') {
      if (!firstAllocation) await save(dir, { ...record, state: 'address_changed' });
      throw refuse('address_changed', 'Provider would publish a different origin; nothing was changed');
    }
    if (decision.result === 'stale') throw refuse('claim_mismatch', 'The provider changed since the user approved this route; nothing was changed. Ask the user again.');
    throw refuse('port_occupied', firstAllocation ? 'Every candidate HTTPS port is occupied or not permitted; existing rules were left untouched'
      : 'The pinned port is occupied by another rule; it was left untouched');
  }
  const { dnsName, port, rule } = record.intent;
  const readback = await facet.observe(ctx);
  if (readback.identity !== dnsName) {
    await save(dir, { ...record, state: 'address_changed' });
    throw refuse('address_changed', 'Provider identity changed during readback; nothing was published');
  }
  const current = facet.read(readback.snapshot, port);
  if (!isDeepStrictEqual(current, rule)) {
    if (current === null) {
      await save(dir, { ...record, state: 'lost' });
      throw refuse('provider_create_failed', 'Provider readback shows no listener; nothing was published');
    }
    // A different listener on the pinned slot cannot be attributed to this call: another
    // program may have replaced it after our write. Leave it in place as cleanup debt.
    await save(dir, { ...record, state: 'uncertain', cleanupDebt: { reason: 'readback-mismatch', port } });
    throw refuse('uncertain', 'Provider readback differs from the intended rule and was left in place; nothing was published');
  }
  // Receipt before publication: the exact listener plus the readback that confirmed it.
  record = { ...record, receipt: { dnsName, port, mode: record.intent.mode, origin: record.intent.origin, rule: current, observedAt: new Date().toISOString() } };
  await save(dir, record);
  return publish(dir, record);
}

// Verify the pinned origin and durably publish it only after verification succeeds.
async function publish(dir, record, checked) {
  checked ??= await runVerifier({ origin: record.origin ?? record.intent.origin, target: record.target, verifyCmd: null });
  // Fence: a concurrent release or hand-back that moved the generation wins.
  const fresh = await load(dir, record.routeId);
  if (!fresh || fresh.generation !== record.generation || ['releasing', 'handing-back', 'suspending', 'suspended'].includes(fresh.state))
    throw refuse('route_releasing', 'The route was released during this call; it was not published');
  const state = checked.status === 'verified' ? 'usable' : 'unverified';
  record = { ...record, state, origin: state === 'usable' ? record.origin ?? record.intent.origin : record.origin ?? null };
  await save(dir, record);
  return { record, verification: checked };
}

// --- Public operations ---

// The consent a request carries: redeem its approval token against the binding built from the
// request itself. The token is spent whatever the outcome.
function approvalOf(approval) {
  if (approval === undefined) return undefined;
  if (approval === null || typeof approval !== 'object' || typeof approval.candidateToken !== 'string' || typeof approval.disclosureRevision !== 'string')
    throw refuse('invalid_input', 'approval must be { candidateToken, disclosureRevision }');
  return approval;
}
async function redeem(home, request, intent, approval) {
  const canonical = await canonicalHome(home, true);
  return redeemConsentToken({ home: canonical, token: approval.candidateToken, providerId: request.providerId,
    binding: consentBinding({ ...request, intent }, canonical, approval.disclosureRevision) });
}
const stale = () => refuse('claim_mismatch', 'The provider changed since the user approved this route; nothing was changed. Ask the user again.');
function requestFields(request) {
  if (request === null || typeof request !== 'object') throw refuse('invalid_input', 'Request must be an object');
  const { usage, home = defaultHome() } = request;
  if (typeof request.owner !== 'string' || !request.owner || request.owner.length > 128) throw refuse('invalid_input', 'Durable route requires an owner app name');
  if (usage?.kind === 'session') throw refuse('durable_lifetime_unsupported', 'Durable routes have no finite lifetime; use a session');
  if (usage?.kind !== 'durable') throw refuse('invalid_input', 'A durable route requires usage { kind: "durable", routeId }');
  if (request.origin !== undefined && typeof request.origin !== 'string') throw refuse('invalid_input', 'origin must be a string');
  return { routeId: routeIdValue(usage.routeId), target: loopbackTarget(request.target), home, owner: request.owner,
    origin: request.origin ?? null, approval: approvalOf(request.approval), reconsent: request.reconsent === true };
}

// Create the route, or reuse the one this record owns. Idempotent.
// The app passes a Query, never an adapter. First creation needs `approval`: a single-use token
// Gozar's catalog issued. Its grant names the adapter; the facts it was issued on are recomputed
// here under the reservation lock. An existing record is the pin and needs no token.
export async function ensureRoute(request, deps) {
  if (request?.intent !== undefined && request.intent !== 'create') throw refuse('invalid_input', 'ensureRoute creates; use adoptRoute for an existing route');
  const { routeId, target, home, owner, origin, approval, reconsent } = requestFields(request);
  const adapters = await adaptersOf(deps), ctx = durableContext(home);
  return reserved(home, async dir => {
    // A user stop is a consent revocation until the user approves again.
    const tombstone = await stopped(dir, routeId);
    if (tombstone && !reconsent) throw refuse('stopped_by_user', 'The user stopped this route; show durable consent again, then pass reconsent: true with a fresh approval, or run `gozar allow --route ' + routeId + '`');
    const finish = async (record, checked) => {
      if (tombstone) await clearStop(dir, routeId);
      return { schemaVersion: 1, route: view(record, { state: record.state, verification: checked }) };
    };
    let record = await load(dir, routeId);
    // Cheap, certain refusals come before a token is spent.
    if (!record) {
      const table = await reservationTable(await canonicalHome(home), dir);
      if (heldBy(table, { routeId, listener: target })) throw reservedError();
    }
    let grant = null;
    if (tombstone || !record) {
      if (!approval) throw refuse('consent_required', tombstone ? 'Clearing a user stop needs a fresh approval from the catalog' : 'A new durable route needs an approval token from the catalog');
      grant = await redeem(home, request, 'create', approval);
    }
    if (record) {
      // The record is authoritative: its adapter and origin are the pin. A different preference or
      // catalog order never moves it, and an approval for another adapter is not used.
      const pinned = record.origin ?? record.intent?.origin;
      if (origin !== null && origin !== pinned) throw refuse('origin_changed', 'This route is pinned to another origin');
      if (record.target !== target || record.owner !== owner) throw refuse('consent_changed', 'Changed route tuple requires new approval');
      if (record.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
      if (record.state === 'releasing') throw refuse('route_releasing', 'Route is releasing; release it again or dismiss its cleanup debt');
      if (['address_changed', 'uncertain'].includes(record.state)) throw refuse(record.state, `Route is ${record.state}; release or adopt it first`);
      const entry = durableEntry(adapters, record.adapterId);
      const { capability } = entry;
      if (record.state === 'suspending') {
        await removeListener(dir, record, adapters, ctx, { suspend: true });
        record = await load(dir, routeId);
      }
      const observed = await entry.facet.observe(ctx);
      const current = await reconcile(record, entry.facet, observed);
      if (current.state === 'creating' && !record.receipt) {
        const pin = record.intent;
        // Reconcile just read the exact rule at this identity and slot. Finish the interrupted create.
        record = { ...record, state: 'creating', cleanupDebt: null,
          receipt: { dnsName: pin.dnsName, port: pin.port, mode: pin.mode, origin: pin.origin,
            rule: entry.facet.read(observed.snapshot, pin.port), observedAt: new Date().toISOString() } };
        await save(dir, record);
        const published = await publish(dir, record);
        return finish(published.record, published.verification);
      }
      if (current.state === 'usable' || current.state === 'unverified') {
        const published = await publish(dir, record, current.verification);
        return finish(published.record, published.verification);
      }
      if (!['lost', 'suspended'].includes(current.state)) {
        await save(dir, { ...record, state: current.state, cleanupDebt: current.cleanupDebt ?? null });
        throw refuse(current.state, `Route is ${current.state}; nothing was changed`);
      }
      // Lost: restore only at the pinned origin, never re-allocate, and only the listener the
      // user approved: a changed durable recipe would publish a different rule.
      if (record.planDigest && record.planDigest !== planDigestOf(record.adapterId, capability, record.target, pinned))
        throw refuse('adapter_changed', 'The pinned adapter now describes a different listener; release the route and create a new one with new approval');
      if (entry.facet.slots(observed.snapshot, { target: record.target }).find(item => item.slot === record.intent.port)?.adoptOnly)
        throw refuse('address_changed', 'The adopted rule is gone and Gozar does not create rules on this adopt-only port; release the route and create a new one with new approval');
      const table = await reservationTable(await canonicalHome(home), dir);
      if (heldBy(table, { routeId, listener: record.target, resource: capability.providerResource, port: record.intent.port })) throw reservedError();
      record = { ...record, state: 'creating', receipt: null, cleanupDebt: null, generation: record.generation + 1 };
      const created = await createListener(dir, record, entry, { table, firstAllocation: false, ctx });
      return finish(created.record, created.verification);
    }
    // First creation: the grant names the adapter, and what the user approved must still be true.
    const entry = durableEntry(adapters, grant.adapterId);
    const { facet, capability } = entry;
    const table = await reservationTable(await canonicalHome(home), dir);
    const facts = planFactsFromObservation(await facet.observe(ctx), { adapterId: grant.adapterId, facet, capability, target, origin, table, routeId });
    if (facts.planDigest !== grant.planDigest || facts.observedResource !== grant.observedResource) throw stale();
    const fresh = { schemaVersion: 1, routeId, owner, adapterId: grant.adapterId, target, origin: null, createdAt: new Date().toISOString(),
      ownership: 'gozar-owned', provenance: 'created', lifetime: capability.lifetime, idleTimeoutMs: capability.idleTimeoutMs,
      providerResource: capability.providerResource, consent: { adapterId: grant.adapterId, target, origin, durable: true },
      generation: 1, state: 'creating', intent: null, receipt: null, cleanupDebt: null };
    const created = await createListener(dir, fresh, entry, { table, firstAllocation: true, expectedOrigin: facts.origin, ctx });
    return finish(created.record, created.verification);
  });
}

// Remove by exact compare-and-set from the receipt or empty-slot intent. A rule Gozar cannot attribute stays in place,
// and the record stays as visible cleanup debt until the rule is gone or the user dismisses it.
async function removeListener(dir, record, adapters, ctx, { suspend = false } = {}) {
  if (!suspend && record.state === 'suspended') {
    await drop(dir, record.routeId);
    return { removed: true, providerRemoved: false, cleanupDebt: null };
  }
  record = { ...record, state: suspend ? 'suspending' : 'releasing' };
  // Withdraw publication durably before touching the provider.
  await save(dir, record);
  const pin = record.receipt ?? record.intent;
  const complete = async providerRemoved => {
    if (suspend) await save(dir, { ...record, state: 'suspended', receipt: null, cleanupDebt: null });
    else await drop(dir, record.routeId);
    return { removed: true, providerRemoved, cleanupDebt: null };
  };
  const keep = async (reason, providerRemoved = false) => {
    if (suspend) throw refuse(reason === 'address_changed' ? reason : 'uncertain', `Cannot suspend: ${reason}; the rule was left in place`);
    const cleanupDebt = { reason, port: pin.port };
    await save(dir, { ...record, cleanupDebt });
    return { removed: false, providerRemoved, cleanupDebt };
  };
  if (!pin) { await drop(dir, record.routeId); return { removed: true, providerRemoved: false, cleanupDebt: null }; }
  // The adapter that wrote the rule may be gone (removed from the registry in a later version). Without its
  // facet nothing can be read or removed, so the record stays as cleanup debt instead of failing the release.
  const entry = adapters.find(item => item.id === record.adapterId && item.durable);
  if (!entry) return keep('adapter-unavailable');
  const facet = entry.durable;
  const { decision, written } = await compareAndSet(facet, ctx, async observed => {
    if (suspend && observed.identity !== pin.dnsName) return { result: 'address_changed' };
    // Read at the identity the rule was written under, not the provider's current one: after a rename the
    // receipted rule may still sit under the old identity, and an equal rule under the new one is not ours.
    const current = facet.read(observed.snapshot, pin.port, pin.dnsName);
    if (current === null) return { result: 'absent' };
    if (!record.receipt && !matchesEmptyIntent(record, facet, observed, current)) return { result: 'unattributed-rule' };
    if (!isDeepStrictEqual(current, pin.rule)) return { result: 'rule-changed' };
    return { write: { op: 'delete', slot: pin.port, rule: pin.rule, identity: pin.dnsName } };
  });
  if (!written) {
    if (decision.result === 'absent') return complete(false);
    return keep(decision.result);
  }
  const after = await facet.observe(ctx);
  if (facet.read(after.snapshot, pin.port, pin.dnsName) !== null) return keep('post-removal-mismatch', true);
  return complete(true);
}

// Withdraw the provider rule while retaining the origin, consent and slot reservation.
export async function suspendRoute({ routeId, home = defaultHome(), expectedGeneration }, deps) {
  routeId = routeIdValue(routeId);
  const adapters = await adaptersOf(deps), ctx = durableContext(home);
  return reserved(home, async dir => {
    await refuseUserStop(dir, routeId);
    let record = await load(dir, routeId);
    if (!record) throw refuse('not_found', 'No durable route has this ID');
    if (expectedGeneration !== undefined && record.generation !== expectedGeneration) throw refuse('route_conflict', 'The route was replaced; this handle is stale');
    if (record.state === 'suspended') return { schemaVersion: 1, route: view(record) };
    if (record.state === 'handing-back') throw refuse('handing_back', 'Confirm or cancel the hand-back before suspending');
    if (record.state === 'releasing') throw refuse('route_releasing', 'Route is releasing; finish releasing it first');
    const { facet } = durableEntry(adapters, record.adapterId);
    const observed = await facet.observe(ctx);
    const current = await reconcile(record, facet, observed, { verify: false });
    if (['uncertain', 'address_changed'].includes(current.state)) throw refuse(current.state, `Route is ${current.state}; nothing was changed`);
    if (facet.slots(observed.snapshot, { target: record.target }).find(item => item.slot === record.intent.port)?.adoptOnly)
      throw refuse('address_changed', 'Cannot suspend an adopt-only port: Gozar cannot restore its rule; leave it running or release it');
    await removeListener(dir, record, adapters, ctx, { suspend: true });
    record = await load(dir, routeId);
    return { schemaVersion: 1, route: view(record) };
  });
}

// mode 'remove': compare-and-set removal. mode 'hand-back': phase 1 of a two-phase hand-back.
// mode 'dismiss': drop a record that only carries cleanup debt, leaving the foreign rule in place.
// No mode clears a user stop.
export async function releaseRoute({ routeId, mode = 'remove', home = defaultHome(), expectedGeneration }, deps) {
  routeId = routeIdValue(routeId);
  if (!['remove', 'hand-back', 'dismiss'].includes(mode)) throw refuse('invalid_input', 'mode must be remove, hand-back or dismiss');
  return reserved(home, async dir => {
    if (mode !== 'remove') await refuseUserStop(dir, routeId);
    const record = await load(dir, routeId);
    // A handle names one generation of a route; a replaced route is not ended by a stale handle.
    if (expectedGeneration !== undefined && record && record.generation !== expectedGeneration) throw refuse('route_conflict', 'The route was replaced; this handle is stale');
    if (mode === 'hand-back') return handBack(dir, record, routeId);
    if (!record) return { schemaVersion: 1, routeId, removed: false, providerRemoved: false, cleanupDebt: null };
    if (record.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
    if (mode === 'dismiss') {
      if (record.state !== 'releasing' || !record.cleanupDebt) throw refuse('nothing_to_dismiss', 'Only a released route with cleanup debt can be dismissed');
      await drop(dir, routeId);
      return { schemaVersion: 1, routeId, removed: true, providerRemoved: false, cleanupDebt: record.cleanupDebt };
    }
    return { schemaVersion: 1, routeId, ...await removeListener(dir, record, await adaptersOf(deps), durableContext(home)) };
  });
}

// The user's stop: a consent revocation, written and fsynced before any provider write or
// record deletion, then compare-and-set removal. Works during a hand-back: the user outranks both owners.
export async function stopRoute({ routeId, home = defaultHome() }, deps) {
  routeId = routeIdValue(routeId);
  return reserved(home, async dir => {
    await atomicWrite(tombstonePath(dir, routeId), { schemaVersion: 1, routeId, stoppedAt: new Date().toISOString() });
    const record = await load(dir, routeId);
    if (!record) return { schemaVersion: 1, routeId, removed: false, providerRemoved: false, cleanupDebt: null, stopped: true };
    return { schemaVersion: 1, routeId, ...await removeListener(dir, record, await adaptersOf(deps), durableContext(home)), stopped: true };
  });
}

// The user's renewed approval (`gozar allow --route ID`). Not part of the app-facing API.
export async function allowRoute({ routeId, home = defaultHome() }) {
  routeId = routeIdValue(routeId);
  return reserved(home, async dir => {
    const wasStopped = await stopped(dir, routeId);
    await clearStop(dir, routeId);
    return { schemaVersion: 1, routeId, allowed: true, wasStopped };
  });
}

// --- Hand-back (two phases) ---

const claimOf = record => ({ dnsName: record.receipt.dnsName, port: record.receipt.port, mode: record.receipt.mode, target: `http://${record.target}` });
async function handBack(dir, record, routeId) {
  if (!record) throw refuse('not_found', 'No durable route has this ID');
  if (record.state === 'handing-back') return { schemaVersion: 1, routeId, claim: record.handBack.claim, transfer: record.handBack.transfer };
  if (!record.receipt) throw refuse('not_owned', 'Gozar holds no receipt for this route, so it has nothing to hand back');
  if (['releasing', 'address_changed', 'uncertain'].includes(record.state)) throw refuse(record.state, `Route is ${record.state}; it cannot be handed back`);
  // A unique token per hand-back: generations restart on re-adoption, so they cannot name a transfer.
  const transfer = randomUUID(), claim = claimOf(record);
  await save(dir, { ...record, generation: record.generation + 1, state: 'handing-back', handBack: { transfer, claim, previousState: record.state } });
  return { schemaVersion: 1, routeId, claim, transfer };
}
async function handBackStep(home, routeId, transfer, step) {
  routeId = routeIdValue(routeId);
  return reserved(home, async dir => {
    const record = await load(dir, routeId);
    if (!record || record.state !== 'handing-back') throw refuse('not_handing_back', 'This route is not being handed back');
    if (transfer !== record.handBack.transfer) throw refuse('stale_transfer', 'The transfer does not match the current hand-back');
    return step(dir, record);
  });
}
// Phase 2: the previous owner has durably taken the rule back. Delete the record and its reservation.
export function confirmHandBack({ routeId, transfer, home = defaultHome() }) {
  return handBackStep(home, routeId, transfer, async (dir, record) => {
    await drop(dir, record.routeId);
    return { schemaVersion: 1, routeId: record.routeId, handedBack: true, claim: record.handBack.claim };
  });
}
// The previous owner never took the rule: return the route to its state before hand-back.
export function cancelHandBack({ routeId, transfer, home = defaultHome() }) {
  return handBackStep(home, routeId, transfer, async (dir, record) => {
    const { handBack: previous, ...rest } = record;
    const restored = { ...rest, generation: record.generation + 1, state: previous.previousState };
    await save(dir, restored);
    return { schemaVersion: 1, route: view(restored) };
  });
}

// --- Adoption ---

// Find the one provider rule that is this target's rule at this origin, across every durable
// adapter and slot. `candidates` is [{ adapterId, durable, snapshot }]. No match: claim_mismatch. More than one:
// ambiguous_route. Either way nothing changes. A match needs the exact rule for this target at the exact origin,
// and nothing foreign (such as a foreground session) on that slot.
export function selectAdoptableRule(candidates, { origin, target }) {
  const matches = [];
  for (const { adapterId, durable, snapshot } of candidates) {
    const rule = durable.expand(target);
    for (const item of durable.slots(snapshot, { target })) {
      if (item.origin !== origin) continue;
      if (!isDeepStrictEqual(durable.read(snapshot, item.slot), rule)) continue;
      if (durable.foreign(snapshot, item.slot)) continue;
      matches.push({ adapterId, slot: item.slot, port: item.slot, rule });
    }
  }
  if (matches.length > 1) throw refuse('ambiguous_route', 'More than one provider rule matches this target and origin; nothing was changed');
  if (!matches.length) throw refuse('claim_mismatch', 'No provider rule matches this target and origin exactly; nothing was changed');
  return matches[0];
}

// Take ownership of an existing provider route with no teardown. Gozar finds the rule itself
// (exact match for this target at this origin); the caller supplies a fenced handover and an
// approval token whose grant must name the adapter of the rule Gozar found. Adopt verifies the
// challenge at the target, so the app must be running and serving it.
export async function adoptRoute(request, deps) {
  if (request?.intent !== undefined && request.intent !== 'adopt') throw refuse('invalid_input', 'adoptRoute adopts; use ensureRoute to create');
  const { routeId, target, home, owner, origin, approval, reconsent } = requestFields(request);
  const { handover, migrationRef } = request;
  if (origin === null) throw refuse('invalid_input', 'Adoption requires the origin to adopt');
  if (migrationRef !== undefined && typeof migrationRef !== 'string') throw refuse('invalid_input', 'migrationRef must be a string');
  const adapters = await durableAdapters(deps), ctx = durableContext(home);
  return reserved(home, async dir => {
    const tombstone = await stopped(dir, routeId);
    if (tombstone && !reconsent) throw refuse('stopped_by_user', 'The user stopped this route; it cannot be adopted until the user approves again (reconsent: true with a fresh approval) or runs `gozar allow --route ' + routeId + '`');
    const existing = await load(dir, routeId);
    if (existing?.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
    if (existing) throw refuse('route_exists', 'Gozar already owns a route with this ID');
    if (typeof handover?.from !== 'string' || !handover.from || !Number.isSafeInteger(handover.generation) || handover.generation < 1)
      throw refuse('handover_required', 'Adoption requires a fenced handover { from, generation } from the previous owner');
    const table = await reservationTable(await canonicalHome(home), dir);
    if (heldBy(table, { routeId, listener: target })) throw reservedError();
    if (!approval) throw refuse('consent_required', 'Adoption needs an approval token from the catalog');
    const before = (await observeStores(adapters, ctx)).entries;
    const found = selectAdoptableRule(before, { origin, target });
    const { adapterId, slot: port, rule } = found;
    const entry = durableEntry(adapters, adapterId);
    const { facet, capability } = entry;
    if (heldBy(table, { routeId, resource: capability.providerResource, port })) throw reservedError();
    const factsOf = observed => planFactsFromObservation(observed, { adapterId, facet, capability, target, origin });
    const seen = factsOf(before.find(item => item.adapterId === adapterId));
    if (migrationRef !== undefined && migrationRef !== migrationRefOf({ origin, target, observedResource: seen.observedResource })) throw stale();
    // The token is spent from here on. Its grant must be for exactly this rule's adapter and state.
    const grant = await redeem(home, request, 'adopt', approval);
    if (grant.adapterId !== adapterId || grant.planDigest !== seen.planDigest || grant.observedResource !== seen.observedResource) throw stale();
    const checked = await runVerifier({ origin, target, verifyCmd: null });
    if (checked.status !== 'verified') throw refuse('verification_failed', 'The route did not pass the challenge; nothing was changed');
    // Re-read: the same match must still hold after verification.
    const afterAll = (await observeStores(adapters, ctx)).entries;
    const again = selectAdoptableRule(afterAll, { origin, target });
    const after = afterAll.find(item => item.adapterId === adapterId);
    if (again.adapterId !== adapterId || again.port !== port || factsOf(after).observedResource !== seen.observedResource)
      throw refuse('claim_mismatch', 'The provider rule changed during verification; nothing was changed');
    const dnsName = after.identity;
    const record = { schemaVersion: 1, routeId, owner, adapterId, target, origin, createdAt: new Date().toISOString(), ownership: 'gozar-owned',
      provenance: 'adopted', handover: { from: handover.from, generation: handover.generation }, lifetime: capability.lifetime,
      idleTimeoutMs: capability.idleTimeoutMs, providerResource: capability.providerResource, planDigest: seen.planDigest,
      consent: { adapterId, target, origin, durable: true }, generation: 1, state: 'usable',
      intent: { dnsName, port, mode: capability.mode, origin, rule }, cleanupDebt: null,
      receipt: { dnsName, port, mode: capability.mode, origin, rule, observedAt: new Date().toISOString() } };
    effectFor(record, entry, after.snapshot, 'create');
    await save(dir, record);
    if (tombstone) await clearStop(dir, routeId);
    return { schemaVersion: 1, route: view(record, { state: 'usable', verification: checked }) };
  });
}

// --- Status ---

// Re-observe and re-verify every durable record. A route verified while nothing is published yet
// is published under the reservation lock; nothing else changes.
export async function statusRoutes({ routeId, home = defaultHome(), canonical = false } = {}, deps) {
  if (routeId !== undefined) routeIdValue(routeId);
  let dir;
  try {
    if (canonical) { dir = routeDirectory(home); await trustedDirectory(dir); await privateDirectory(dir); }
    else dir = await routesDirectory(home, false);
  }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, routes: [], stoppedRoutes: [] }; throw error; }
  const records = (await allRecords(dir)).filter(record => routeId === undefined || record.routeId === routeId);
  const stoppedRoutes = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!/^[0-9a-f]{64}\.stopped$/.test(name)) continue;
    const tombstone = await readRecord(join(dir, name));
    if (routeId === undefined || tombstone.routeId === routeId) stoppedRoutes.push({ routeId: tombstone.routeId, stoppedAt: tombstone.stoppedAt, allow: `gozar allow --route ${tombstone.routeId}` });
  }
  if (!records.length) return { schemaVersion: 1, routes: [], stoppedRoutes };
  const adapters = await adaptersOf(deps), ctx = durableContext(home);
  // One observation per provider store for this call; a failure is reported per route, not thrown.
  const observations = new Map();
  const observeFor = entry => {
    const key = entry.capability.providerResource;
    if (!observations.has(key)) observations.set(key, entry.facet.observe(ctx).then(observed => ({ observed }), cause => ({ error: { code: cause.code ?? null, message: cause.message } })));
    return observations.get(key);
  };
  const routes = [];
  for (let record of records) {
    const check = await targetCheck(record);
    const extra = { targetCheck: check };
    if (check === 'another program is listening' && record.state !== 'suspended') Object.assign(extra, {
      warning: `Another program is listening on ${record.target}; the provider forwards traffic for this route to it.`,
      nextAction: `gozar stop --route ${record.routeId}` });
    let entry = null;
    try { entry = durableEntry(adapters, record.adapterId); } catch (cause) { routes.push({ ...view(record, { state: 'unknown' }, extra), error: { code: cause.code ?? null, message: cause.message } }); continue; }
    const { observed, error } = await observeFor(entry);
    if (!observed) { routes.push({ ...view(record, { state: 'unknown' }, extra), error }); continue; }
    const current = await reconcile(record, entry.facet, observed);
    if (current.state === 'usable' && record.origin === null) {
      // First successful verification after a crash or a failed check: publish it durably.
      const published = await reserved(home, async locked => {
        const fresh = await load(locked, record.routeId);
        if (!fresh || fresh.generation !== record.generation || fresh.origin !== null || !fresh.receipt) return null;
        return (await publish(locked, fresh, current.verification)).record;
      }).catch(() => null);
      if (published) record = published;
      else current.state = 'unverified';
    }
    if (['usable', 'unverified'].includes(current.state)) await renewIfDue(record, entry.facet, observed, ctx, current);
    routes.push(view(record, current, extra));
  }
  return { schemaVersion: 1, routes, stoppedRoutes };
}

// A leased rule that expires soon is renewed from status (and so from watch). A renewal that fails leaves the
// rule in place and reports the route `unverified`: the lease may lapse, and that is never silent.
async function renewIfDue(record, facet, observed, ctx, current) {
  if (!facet.renew || !facet.expiresAt) return;
  const slot = (record.receipt ?? record.intent).port;
  const expiresAt = facet.expiresAt(observed.snapshot, slot);
  if (expiresAt === null || expiresAt === undefined || Date.parse(expiresAt) - Date.now() > renewLeadMs) return;
  try {
    const renewed = await facet.renew(ctx, { slot, rule: record.receipt.rule });
    if (!Number.isFinite(Date.parse(renewed?.expiresAt))) throw new Error('no expiry');
  } catch {
    current.state = 'unverified';
    current.verification = { ...(current.verification ?? {}), status: 'failed', error: 'Lease renewal failed' };
  }
}
