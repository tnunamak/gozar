// Durable owned routes: a bounded host transaction outside the session driver.
// The record is authoritative. Intent is written and fsynced before the provider write, and a
// receipt (exact listener + readback) before publication. A fresh process can observe, verify
// and remove the route from the record alone: no controller, gate or timer.
//
// Tailscale listeners change only through the LocalAPI with ETag compare-and-set
// (tailscale-localapi.mjs). Gozar never writes serve config without If-Match, and on a 412 it
// re-reads and re-decides. No durable path runs the `tailscale` CLI.
import { readdir, readFile, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { atomicWrite, processIdentity } from './journal.mjs';
import { trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock, verification, readChallenge,
  challengePath, canonicalAuthority } from './service-state.mjs';
import { loadDefinition } from './catalog.mjs';
import { durableCapability, admitRouteEffect, routeAuthority } from './plan.mjs';
import * as localapi from './tailscale-localapi.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const defaultHome = () => process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
const refuse = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const hash = routeId => createHash('sha256').update(routeId).digest('hex');
const routeDirectory = home => join(home, 'routes');
const casAttempts = 3;
const reservationWaitSeconds = 30;

function routeIdValue(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) throw refuse('invalid_input', 'Route ID must be 1..63 lowercase letters, digits or hyphens');
  return value;
}
function loopbackTarget(value) {
  const match = typeof value === 'string' && /^127\.0\.0\.1:([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw refuse('invalid_input', 'Durable route target must be 127.0.0.1:PORT');
  return value;
}
const originOf = (dnsName, port) => port === 443 ? `https://${dnsName}` : `https://${dnsName}:${port}`;
const targetPort = target => Number(target.slice(target.lastIndexOf(':') + 1));

// The consent copy a host shows before it passes a durable approval tuple.
export function durableConsentText({ routeId, origin, owner }) {
  return `Route ${routeId} stays reachable at ${origin ?? 'its new address'} whether or not ${owner} is running, ` +
    `until you stop it with \`gozar stop --route ${routeId}\`.`;
}

async function durableDefinition(adapterId) {
  let definition;
  try { definition = await loadDefinition(root, adapterId); } catch { definition = null; }
  const capability = durableCapability(definition);
  if (!capability) throw refuse('adapter_not_durable', 'Selected adapter cannot keep a stable origin');
  return { definition, capability };
}

// --- Provider observation and listener arithmetic (Tailscale serve config) ---

async function observe() {
  const node = await localapi.getNode();
  const { config, etag } = await localapi.getServeConfig();
  return { ...node, config, etag };
}
const ruleAt = (config, dnsName, port) => ({ tcp: config.TCP?.[port] ?? null, web: config.Web?.[`${dnsName}:${port}`] ?? null,
  funnel: config.AllowFunnel?.[`${dnsName}:${port}`] ?? null });
const absent = rule => Object.values(rule).every(value => value === null);
const occupied = (config, dnsName, port) => !absent(ruleAt(config, dnsName, port)) || config.TCP?.[port] !== undefined ||
  Object.values(config.Foreground ?? {}).some(session => session?.TCP?.[port] || session?.Web?.[`${dnsName}:${port}`]);
function withListener(config, dnsName, port, listener) {
  const next = structuredClone(config), hostPort = `${dnsName}:${port}`;
  (next.TCP ??= {})[port] = listener.tcp;
  (next.Web ??= {})[hostPort] = listener.web;
  if (listener.funnel !== null) (next.AllowFunnel ??= {})[hostPort] = listener.funnel;
  return next;
}
// Config without exactly one listener.
function without(config, dnsName, port) {
  const next = structuredClone(config);
  for (const [key, field] of [['TCP', String(port)], ['Web', `${dnsName}:${port}`], ['AllowFunnel', `${dnsName}:${port}`]]) {
    if (!next[key]) continue;
    delete next[key][field];
    if (!Object.keys(next[key]).length) delete next[key];
  }
  return next;
}

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
      provider: pin ? { resource: record.providerResource ?? 'tailscale-https-port', ports: [pin.port] } : null });
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
  return table.find(entry => entry.owner.routeId !== routeId && (
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
    if (table.some(entry => entry.owner.routeId && (entry.listener === listener ||
        (providerResource && entry.provider?.resource === providerResource && providerPorts.some(item => entry.provider.ports.includes(item))))))
      throw reservedError();
    await atomicWrite(join(canonical, `port-${port}`, 'reservation.json'),
      { pid: process.pid, startIdentity: await processIdentity(process.pid), providerResource, providerPorts });
    return { reserved: true };
  });
}
// Read-only, for service routes: the route ID of a durable record published at origin, if any.
// home must already be canonical.
export async function durableRouteAt(home, origin) {
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

// --- Verification and reconciliation ---

// Derive current state from the record plus a fresh observation. Never trusts saved readiness.
// While nothing is published, the pinned intent origin is what verification checks.
async function reconcile(record, observed, { verify = true } = {}) {
  if (['releasing', 'handing-back', 'address_changed'].includes(record.state)) return { state: record.state };
  const pin = record.receipt ?? record.intent;
  if (observed.dnsName !== pin.dnsName) return { state: 'address_changed' };
  const current = ruleAt(observed.config, pin.dnsName, pin.port);
  // Intent without a receipt proves only that Gozar meant to create the rule.
  if (!record.receipt) return absent(current) ? { state: 'lost' } : { state: 'uncertain', cleanupDebt: { reason: 'unattributed-rule', port: pin.port } };
  if (absent(current)) return { state: 'lost' };
  if (!isDeepStrictEqual(current, record.receipt.rule)) return { state: 'uncertain', cleanupDebt: { reason: 'rule-changed', port: pin.port } };
  if (!verify) return { state: record.state };
  const checked = await verification({ origin: record.origin ?? record.intent.origin, target: record.target, verifyCmd: null });
  return { state: checked.status === 'verified' ? 'usable' : 'unverified', verification: checked };
}

// Live check of what answers on the target right now, independent of the provider.
async function targetCheck(record) {
  const port = targetPort(record.target);
  const listening = await new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
  });
  if (!listening) return 'nothing listening';
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
  const reply = { routeId: record.routeId, owner: record.owner, createdAt: record.createdAt, origin: record.origin ?? null, target: record.target,
    adapterId: record.adapterId, ownership: record.ownership, provenance: record.provenance ?? 'created', lifetime: record.lifetime,
    exposure: 'owner-run', forwards: `forwards to ${record.target} whether or not ${record.owner} is running`,
    idleTimeoutMs: record.idleTimeoutMs ?? null, state, verification: current.verification ?? null,
    cleanupDebt: current.cleanupDebt ?? record.cleanupDebt ?? null, ...extra };
  if (record.state === 'handing-back') reply.handBack = { transfer: record.handBack.transfer, claim: record.handBack.claim };
  return reply;
}

// --- Compare-and-set against the serve config ---

// Read, decide, write with If-Match; on 412 mutate nothing and re-decide from a fresh read.
// decide(observed) returns { write: config } to write, or { result } to stop without a write.
async function compareAndSet(decide) {
  for (let attempt = 0; attempt < casAttempts; attempt++) {
    const observed = await observe();
    const decision = await decide(observed);
    if (!decision.write) return { observed, decision, written: false };
    if (await localapi.setServeConfig(decision.write, observed.etag)) return { observed, decision, written: true };
  }
  throw localapi.conflict();
}

function effectFor(record, definition, operation) {
  const pin = record.intent;
  const effect = { routeId: record.routeId, generation: record.generation, authorityRef: routeAuthority(record.routeId, record.generation),
    adapterId: record.adapterId, operation, listener: pin.rule,
    bindings: { port: { type: 'port', value: pin.port }, dnsName: { type: 'dns-name', value: pin.dnsName }, target: { type: 'loopback-target', value: record.target } } };
  return admitRouteEffect(effect, { definition, routeId: record.routeId, generation: record.generation });
}

// Create (or restore) the listener the record pins, by compare-and-set, then read back, write the
// receipt, verify the pinned origin and only then publish it.
async function createListener(dir, record, { definition, capability, table, firstAllocation }) {
  const intendedRule = expandListener(capability, record.target);
  let saved = null;
  const settle = async () => {
    // Nothing was written: a 412 or a rejected write proves the earlier attempt did not apply.
    if (saved && firstAllocation) await drop(dir, record.routeId);
    else if (saved) await save(dir, { ...record, state: 'lost' });
  };
  const { written, decision } = await compareAndSet(async observed => {
    let port;
    if (firstAllocation) {
      const permitted = capability.portsFromCapability ? capability.candidatePorts.filter(item => observed.funnelPorts.includes(item)) : capability.candidatePorts;
      port = permitted.find(item => !occupied(observed.config, observed.dnsName, item) &&
        !heldBy(table, { routeId: record.routeId, resource: capability.providerResource, port: item }));
      if (port === undefined) return { result: 'no-port' };
      const candidate = originOf(observed.dnsName, port);
      if (record.consent.origin !== null && record.consent.origin !== candidate) return { result: 'address_changed' };
      record = { ...record, intent: { dnsName: observed.dnsName, port, mode: capability.mode, origin: candidate, rule: intendedRule } };
    } else {
      if (observed.dnsName !== record.intent.dnsName) return { result: 'address_changed' };
      port = record.intent.port;
      if (occupied(observed.config, observed.dnsName, port)) return { result: 'occupied' };
    }
    const admitted = effectFor(record, definition, 'create');
    // Intent is durable before the provider write.
    if (!isDeepStrictEqual(saved, record)) { await save(dir, record); saved = record; }
    return { write: withListener(observed.config, admitted.dnsName, admitted.port, admitted.listener) };
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
    throw refuse('port_occupied', firstAllocation ? 'Every candidate HTTPS port is occupied or not permitted; existing rules were left untouched'
      : 'The pinned port is occupied by another rule; it was left untouched');
  }
  const { dnsName, port, rule } = record.intent;
  const readback = await observe();
  const current = ruleAt(readback.config, dnsName, port);
  if (!isDeepStrictEqual(current, rule)) {
    if (absent(current)) {
      await save(dir, { ...record, state: 'lost' });
      throw refuse('provider_create_failed', 'Provider readback shows no listener; nothing was published');
    }
    // A different listener on the pinned port cannot be attributed to this call: another
    // program may have replaced it after our write. Leave it in place as cleanup debt.
    await save(dir, { ...record, state: 'uncertain', cleanupDebt: { reason: 'readback-mismatch', port } });
    throw refuse('uncertain', 'Provider readback differs from the intended rule and was left in place; nothing was published');
  }
  // Receipt before publication: the exact listener plus the readback that confirmed it.
  record = { ...record, receipt: { dnsName, port, mode: record.intent.mode, origin: record.intent.origin, rule: current, observedAt: new Date().toISOString() } };
  await save(dir, record);
  return publish(dir, record);
}
const expandListener = (capability, target) => JSON.parse(JSON.stringify(capability.recipe.listener).replaceAll('{target}', target));

// Verify the pinned origin and durably publish it only after verification succeeds.
async function publish(dir, record, checked) {
  checked ??= await verification({ origin: record.origin ?? record.intent.origin, target: record.target, verifyCmd: null });
  // Fence: a concurrent release or hand-back that moved the generation wins.
  const fresh = await load(dir, record.routeId);
  if (!fresh || fresh.generation !== record.generation || ['releasing', 'handing-back'].includes(fresh.state))
    throw refuse('route_releasing', 'The route was released during this call; it was not published');
  const state = checked.status === 'verified' ? 'usable' : 'unverified';
  record = { ...record, state, origin: state === 'usable' ? record.origin ?? record.intent.origin : record.origin ?? null };
  await save(dir, record);
  return { record, verification: checked };
}

// --- Public operations ---

// Create the route, or reuse the one this record owns. Idempotent.
export async function ensureRoute({ routeId, owner, adapterId, target, origin, approvals = [], reconsent = false, lifetimeMs, home = defaultHome() }) {
  routeId = routeIdValue(routeId); target = loopbackTarget(target);
  if (typeof owner !== 'string' || !owner || owner.length > 128) throw refuse('invalid_input', 'Durable route requires an owner app name');
  if (lifetimeMs !== undefined) throw refuse('durable_lifetime_unsupported', 'Durable routes have no finite lifetime; use a session');
  if (!Array.isArray(approvals)) throw refuse('invalid_input', 'approvals must be an ordered list of approved tuples');
  await durableDefinition(adapterId);
  return reserved(home, async dir => {
    // A user stop is a consent revocation until the user approves again.
    if (await stopped(dir, routeId) && !reconsent) throw refuse('stopped_by_user', 'The user stopped this route; show durable consent again and pass reconsent: true, or run `gozar allow --route ' + routeId + '`');
    const finish = async (record, checked) => {
      if (reconsent) await clearStop(dir, routeId);
      return { schemaVersion: 1, route: view(record, { state: record.state, verification: checked }) };
    };
    let record = await load(dir, routeId);
    if (record) {
      // The record is authoritative: its adapter and origin are the pin.
      if (adapterId !== record.adapterId && adapterId !== record.consent?.requestedAdapterId) throw refuse('adapter_changed', 'This route is pinned to another adapter');
      const pinned = record.origin ?? record.intent?.origin;
      if (origin !== undefined && origin !== pinned) throw refuse('origin_changed', 'This route is pinned to another origin');
      if (record.target !== target || record.owner !== owner) throw refuse('consent_changed', 'Changed route tuple requires new approval');
      if (record.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
      if (record.state === 'releasing') throw refuse('route_releasing', 'Route is releasing; release it again or dismiss its cleanup debt');
      if (['address_changed', 'uncertain'].includes(record.state)) throw refuse(record.state, `Route is ${record.state}; release or adopt it first`);
      const { definition, capability } = await durableDefinition(record.adapterId);
      const observed = await observe();
      const current = await reconcile(record, observed);
      if (current.state === 'usable' || current.state === 'unverified') {
        const published = await publish(dir, record, current.verification);
        return finish(published.record, published.verification);
      }
      if (current.state !== 'lost') {
        await save(dir, { ...record, state: current.state, cleanupDebt: current.cleanupDebt ?? null });
        throw refuse(current.state, `Route is ${current.state}; nothing was changed`);
      }
      // Lost: restore only at the pinned origin, never re-allocate.
      const table = await reservationTable(await canonicalHome(home), dir);
      if (heldBy(table, { routeId, listener: record.target, resource: capability.providerResource, port: record.intent.port })) throw reservedError();
      record = { ...record, state: 'creating', receipt: null, cleanupDebt: null, generation: record.generation + 1 };
      const created = await createListener(dir, record, { definition, capability, table, firstAllocation: false });
      return finish(created.record, created.verification);
    }
    // First allocation: the requested adapter's own approved tuple first, then each other
    // approved adapter in the host's order. A fallback never uses another adapter's approval.
    const approved = item => item?.target === target && item.durable === true && (item.origin ?? null) === (origin ?? null);
    if (!approvals.some(item => approved(item) && item.adapterId === adapterId)) throw refuse('consent_required', 'No approved durable tuple for this adapter and target');
    const order = [adapterId, ...approvals.filter(item => approved(item) && item.adapterId !== adapterId).map(item => item.adapterId)];
    const table = await reservationTable(await canonicalHome(home), dir);
    if (heldBy(table, { routeId, listener: target })) throw reservedError();
    let failure;
    for (const candidateId of [...new Set(order)]) {
      let definition, capability;
      try { ({ definition, capability } = await durableDefinition(candidateId)); } catch (error) { failure ??= error; continue; }
      const fresh = { schemaVersion: 1, routeId, owner, adapterId: candidateId, target, origin: null, createdAt: new Date().toISOString(),
        ownership: 'gozar-owned', provenance: 'created', lifetime: capability.lifetime, idleTimeoutMs: capability.idleTimeoutMs,
        providerResource: capability.providerResource, consent: { adapterId: candidateId, target, origin: origin ?? null, durable: true, requestedAdapterId: adapterId },
        generation: 1, state: 'creating', intent: null, receipt: null, cleanupDebt: null };
      try {
        const created = await createListener(dir, fresh, { definition, capability, table, firstAllocation: true });
        return finish(created.record, created.verification);
      } catch (error) {
        // Fallback only when this adapter could not allocate; any other outcome stops here.
        if (error.code !== 'port_occupied') throw error;
        failure = error;
      }
    }
    throw failure;
  });
}

// Remove by exact compare-and-set from the receipt. A rule Gozar cannot attribute stays in place,
// and the record stays as visible cleanup debt until the rule is gone or the user dismisses it.
async function removeListener(dir, record) {
  record = { ...record, state: 'releasing' };
  // Withdraw publication durably before touching the provider.
  await save(dir, record);
  const pin = record.receipt ?? record.intent;
  const keep = async (reason, providerRemoved = false) => {
    const cleanupDebt = { reason, port: pin.port };
    await save(dir, { ...record, cleanupDebt });
    return { removed: false, providerRemoved, cleanupDebt };
  };
  if (!pin) { await drop(dir, record.routeId); return { removed: true, providerRemoved: false, cleanupDebt: null }; }
  const { decision, written } = await compareAndSet(async observed => {
    const current = ruleAt(observed.config, pin.dnsName, pin.port);
    if (absent(current)) return { result: 'absent' };
    if (!record.receipt) return { result: 'unattributed-rule' };
    if (!isDeepStrictEqual(current, record.receipt.rule)) return { result: 'rule-changed' };
    return { write: without(observed.config, pin.dnsName, pin.port) };
  });
  if (!written) {
    if (decision.result === 'absent') { await drop(dir, record.routeId); return { removed: true, providerRemoved: false, cleanupDebt: null }; }
    return keep(decision.result);
  }
  const after = await observe();
  if (!absent(ruleAt(after.config, pin.dnsName, pin.port))) return keep('post-removal-mismatch', true);
  await drop(dir, record.routeId);
  return { removed: true, providerRemoved: true, cleanupDebt: null };
}

// mode 'remove': compare-and-set removal. mode 'hand-back': phase 1 of a two-phase hand-back.
// mode 'dismiss': drop a record that only carries cleanup debt, leaving the foreign rule in place.
// No mode clears a user stop.
export async function releaseRoute({ routeId, mode = 'remove', home = defaultHome() }) {
  routeId = routeIdValue(routeId);
  if (!['remove', 'hand-back', 'dismiss'].includes(mode)) throw refuse('invalid_input', 'mode must be remove, hand-back or dismiss');
  return reserved(home, async dir => {
    const record = await load(dir, routeId);
    if (mode === 'hand-back') return handBack(dir, record, routeId);
    if (!record) return { schemaVersion: 1, routeId, removed: false, providerRemoved: false, cleanupDebt: null };
    if (record.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
    if (mode === 'dismiss') {
      if (record.state !== 'releasing' || !record.cleanupDebt) throw refuse('nothing_to_dismiss', 'Only a released route with cleanup debt can be dismissed');
      await drop(dir, routeId);
      return { schemaVersion: 1, routeId, removed: true, providerRemoved: false, cleanupDebt: record.cleanupDebt };
    }
    return { schemaVersion: 1, routeId, ...await removeListener(dir, record) };
  });
}

// The user's stop: a consent revocation, written and fsynced before any provider write or
// record deletion, then compare-and-set removal. Works during a hand-back: the user outranks both owners.
export async function stopRoute({ routeId, home = defaultHome() }) {
  routeId = routeIdValue(routeId);
  return reserved(home, async dir => {
    await atomicWrite(tombstonePath(dir, routeId), { schemaVersion: 1, routeId, stoppedAt: new Date().toISOString() });
    const record = await load(dir, routeId);
    if (!record) return { schemaVersion: 1, routeId, removed: false, providerRemoved: false, cleanupDebt: null, stopped: true };
    return { schemaVersion: 1, routeId, ...await removeListener(dir, record), stopped: true };
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

// Every adapter whose definition declares a durable capability, from the shipped manifest.
async function durableAdapters() {
  const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
  const found = [];
  for (const file of manifest.definitions) {
    const adapterId = file.replace(/\.definition\.json$/, '');
    let definition;
    try { definition = await loadDefinition(root, adapterId); } catch { continue; }
    const capability = durableCapability(definition);
    if (capability) found.push({ adapterId, definition, capability });
  }
  return found;
}

// Find the one provider rule that is this target's rule at this origin, across every durable
// adapter and candidate port. No match: claim_mismatch. More than one: ambiguous_route. Either
// way nothing changes. A match needs the exact rule for this target at the exact origin, and no
// foreground session on that port.
export function selectAdoptable(adapters, observed, { origin, target }) {
  const matches = [];
  for (const { adapterId, capability } of adapters) {
    const rule = expandListener(capability, target);
    for (const port of capability.candidatePorts) {
      if (originOf(observed.dnsName, port) !== origin) continue;
      if (!isDeepStrictEqual(ruleAt(observed.config, observed.dnsName, port), rule)) continue;
      if (Object.values(observed.config.Foreground ?? {}).some(session => session?.TCP?.[port] || session?.Web?.[`${observed.dnsName}:${port}`])) continue;
      matches.push({ adapterId, port, rule });
    }
  }
  if (matches.length > 1) throw refuse('ambiguous_route', 'More than one provider rule matches this target and origin; nothing was changed');
  if (!matches.length) throw refuse('claim_mismatch', 'No provider rule matches this target and origin exactly; nothing was changed');
  return matches[0];
}

// Take ownership of an existing provider route with no teardown: Gozar finds the rule itself
// (exact match for this target at this origin) and the caller supplies a fenced handover.
export async function adoptRoute({ routeId, owner, target, origin, handover, approvals = [], home = defaultHome() }) {
  routeId = routeIdValue(routeId); target = loopbackTarget(target);
  owner ??= handover?.from;
  if (typeof owner !== 'string' || !owner || owner.length > 128) throw refuse('invalid_input', 'Durable route requires an owner app name');
  const adapters = await durableAdapters();
  return reserved(home, async dir => {
    if (await stopped(dir, routeId)) throw refuse('stopped_by_user', 'The user stopped this route; it cannot be adopted until the user allows it again');
    const existing = await load(dir, routeId);
    if (existing?.state === 'handing-back') throw refuse('handing_back', 'This route is being handed back; confirm or cancel the hand-back first');
    if (existing) throw refuse('route_exists', 'Gozar already owns a route with this ID');
    if (typeof handover?.from !== 'string' || !handover.from || !Number.isSafeInteger(handover.generation) || handover.generation < 1)
      throw refuse('handover_required', 'Adoption requires a fenced handover { from, generation } from the previous owner');
    const table = await reservationTable(await canonicalHome(home), dir);
    if (heldBy(table, { routeId, listener: target })) throw reservedError();
    if (typeof origin !== 'string') throw refuse('invalid_input', 'Adoption requires the origin to adopt');
    const before = await observe();
    const found = selectAdoptable(adapters, before, { origin, target });
    const { adapterId, port, rule } = found;
    const { definition, capability } = adapters.find(item => item.adapterId === adapterId);
    if (heldBy(table, { routeId, resource: capability.providerResource, port })) throw reservedError();
    if (!approvals.some(item => item?.adapterId === adapterId && item.target === target && item.durable === true && item.origin === origin))
      throw refuse('consent_required', 'No approved durable tuple for this adapter, target and origin');
    const checked = await verification({ origin, target, verifyCmd: null });
    if (checked.status !== 'verified') throw refuse('verification_failed', 'The route did not pass the challenge; nothing was changed');
    // Re-read: the same match must still hold after verification.
    const after = await observe();
    const again = selectAdoptable(adapters, after, { origin, target });
    if (again.adapterId !== adapterId || again.port !== port) throw refuse('claim_mismatch', 'The provider rule changed during verification; nothing was changed');
    const dnsName = after.dnsName;
    const record = { schemaVersion: 1, routeId, owner, adapterId, target, origin, createdAt: new Date().toISOString(), ownership: 'gozar-owned',
      provenance: 'adopted', handover: { from: handover.from, generation: handover.generation }, lifetime: capability.lifetime,
      idleTimeoutMs: capability.idleTimeoutMs, providerResource: capability.providerResource,
      consent: { adapterId, target, origin, durable: true, requestedAdapterId: adapterId }, generation: 1, state: 'usable',
      intent: { dnsName, port, mode: capability.mode, origin, rule }, cleanupDebt: null,
      receipt: { dnsName, port, mode: capability.mode, origin, rule, observedAt: new Date().toISOString() } };
    effectFor(record, definition, 'create');
    await save(dir, record);
    return { schemaVersion: 1, route: view(record, { state: 'usable', verification: checked }) };
  });
}

// --- Status ---

// Re-observe and re-verify every durable record. A route verified while nothing is published yet
// is published under the reservation lock; nothing else changes.
export async function statusRoutes({ routeId, home = defaultHome(), canonical = false } = {}) {
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
  let observed = null, error = null;
  try { observed = await observe(); } catch (cause) { error = { code: cause.code ?? null, message: cause.message }; }
  const routes = [];
  for (let record of records) {
    const check = await targetCheck(record);
    const extra = { targetCheck: check };
    if (check === 'another program is listening') Object.assign(extra, {
      warning: `Another program is listening on ${record.target}; the provider forwards traffic for this route to it.`,
      nextAction: `gozar stop --route ${record.routeId}` });
    if (!observed) { routes.push({ ...view(record, { state: 'unknown' }, extra), error }); continue; }
    const current = await reconcile(record, observed);
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
    routes.push(view(record, current, extra));
  }
  return { schemaVersion: 1, routes, stoppedRoutes };
}
