// Durable owned routes: a bounded host transaction outside the session driver.
// The record is authoritative. Intent is written before the provider command and a
// receipt (exact provider rule + readback) before publication. A fresh process can
// observe, verify and remove the route from the record alone: no controller, gate or timer.
import { readdir, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { atomicWrite } from './journal.mjs';
import { trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock, verification } from './service-state.mjs';

const defaultHome = () => process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
// Spike scope: Tailscale --bg only. G1 moves these declarations into adapter data.
const durableAdapters = {
  'tailscale-funnel': { mode: 'funnel', lifetime: 'provider-persistent', addressStability: 'stable', capabilityPorts: true },
  'tailscale-private': { mode: 'serve', lifetime: 'provider-persistent', addressStability: 'stable', capabilityPorts: false },
};
const candidatePorts = [443, 8443, 10000];
const funnelPortsKey = /^https:\/\/tailscale\.com\/cap\/funnel-ports\?ports=([0-9,]+)$/;
const refuse = (code, message) => Object.assign(new Error(message), { code });
const hash = routeId => createHash('sha256').update(routeId).digest('hex');
const routeDirectory = home => join(home, 'routes');

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

function tailscale(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tailscale', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '', done = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(refuse('provider_timeout', 'Tailscale command timed out')); }, 20000);
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 65536) { child.kill('SIGKILL'); finish(refuse('provider_output', 'Tailscale output exceeds limit')); } });
    child.once('error', () => finish(refuse('provider_unavailable', 'Tailscale CLI is unavailable')));
    child.once('close', code => finish(null, { code, stdout }));
  });
}
async function tailscaleJson(args) {
  const { code, stdout } = await tailscale(args);
  if (code !== 0) throw refuse('provider_unavailable', `tailscale ${args.join(' ')} failed`);
  try { return JSON.parse(stdout || '{}'); } catch { throw refuse('provider_output', 'Tailscale returned malformed JSON'); }
}
// One fresh observation of node identity and the whole serve config.
async function observe() {
  const status = await tailscaleJson(['status', '--json', '--peers=false']);
  if (status.BackendState !== 'Running' || typeof status.Self?.DNSName !== 'string') throw refuse('provider_not_running', 'Tailscale is not running');
  const dnsName = status.Self.DNSName.replace(/\.$/, '').toLowerCase();
  const funnelPorts = Object.keys(status.Self.CapMap ?? {}).flatMap(key => funnelPortsKey.exec(key)?.[1].split(',').map(Number) ?? []);
  return { dnsName, funnelPorts, config: await tailscaleJson(['serve', 'status', '--json']) };
}
// The exact provider rule a durable route owns: one HTTPS listener with one root proxy.
const ruleFor = (mode, target) => ({ tcp: { HTTPS: true }, web: { Handlers: { '/': { Proxy: `http://${target}` } } }, funnel: mode === 'funnel' ? true : null });
const ruleAt = (config, dnsName, port) => ({ tcp: config.TCP?.[port] ?? null, web: config.Web?.[`${dnsName}:${port}`] ?? null,
  funnel: config.AllowFunnel?.[`${dnsName}:${port}`] ?? null });
const occupied = (config, dnsName, port) => Object.values(ruleAt(config, dnsName, port)).some(value => value !== null) ||
  Object.values(config.Foreground ?? {}).some(session => session?.TCP?.[port] || session?.Web?.[`${dnsName}:${port}`]);
// Config expected after removing exactly one listener; anything else changed concurrently.
function without(config, dnsName, port) {
  const next = structuredClone(config);
  for (const [key, field] of [['TCP', String(port)], ['Web', `${dnsName}:${port}`], ['AllowFunnel', `${dnsName}:${port}`]]) {
    if (!next[key]) continue;
    delete next[key][field];
    if (!Object.keys(next[key]).length) delete next[key];
  }
  return next;
}

async function routesDirectory(home, create) {
  const dir = routeDirectory(await canonicalHome(home, create));
  await trustedDirectory(dir, create);
  await privateDirectory(dir);
  return dir;
}
async function load(dir, routeId) {
  try {
    const record = await readRecord(join(dir, hash(routeId) + '.json'));
    if (record.schemaVersion !== 1 || record.routeId !== routeId || record.ownership !== 'gozar-owned') throw new Error('Invalid durable route record');
    return record;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const save = (dir, record) => atomicWrite(join(dir, hash(record.routeId) + '.json'), record);
const tombstonePath = (dir, routeId) => join(dir, hash(routeId) + '.stopped');
async function syncDirectory(dir) { const fd = await open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function remove(path) { try { await unlink(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
// One home-wide reservation lock serializes every durable allocation and release.
async function reserved(home, action) {
  const dir = await routesDirectory(home, true);
  const locks = join(dir, '.locks');
  await trustedDirectory(locks, true);
  await privateDirectory(locks);
  return withExclusiveLock(join(locks, 'reservation'), () => action(dir));
}

function view(record, state, extra = {}) {
  return { routeId: record.routeId, owner: record.owner, createdAt: record.createdAt, origin: record.origin, target: record.target,
    adapterId: record.adapterId, ownership: record.ownership, lifetime: record.lifetime, state,
    verification: extra.verification ?? null, cleanupDebt: extra.cleanupDebt ?? record.cleanupDebt ?? null };
}
// Derive current state from the record plus a fresh observation. Never trusts saved readiness.
async function reconcile(record, observed) {
  if (record.state === 'releasing') return { state: 'releasing' };
  if (record.state === 'address_changed') return { state: 'address_changed' };
  const pin = record.receipt ?? record.intent;
  if (observed.dnsName !== pin.dnsName) return { state: 'address_changed' };
  const current = ruleAt(observed.config, pin.dnsName, pin.port);
  const absent = Object.values(current).every(value => value === null);
  // Intent without a receipt proves only that Gozar meant to create the rule.
  if (!record.receipt) return absent ? { state: 'lost' } : { state: 'uncertain', cleanupDebt: { reason: 'unattributed-rule', port: pin.port } };
  if (absent) return { state: 'lost' };
  if (!isDeepStrictEqual(current, record.receipt.rule)) return { state: 'uncertain', cleanupDebt: { reason: 'rule-changed', port: pin.port } };
  const checked = await verification({ origin: record.origin, target: record.target, verifyCmd: null });
  return { state: checked.status === 'verified' ? 'usable' : 'unverified', verification: checked };
}

// Create the route, or reuse the one this record owns. Idempotent.
export async function ensureRoute({ routeId, owner, adapterId, target, origin, approvals = [], reconsent = false, lifetimeMs, home = defaultHome() }) {
  routeId = routeIdValue(routeId); target = loopbackTarget(target);
  if (typeof owner !== 'string' || !owner || owner.length > 128) throw refuse('invalid_input', 'Durable route requires an owner app name');
  const adapter = durableAdapters[adapterId];
  if (!adapter || adapter.addressStability !== 'stable') throw refuse('adapter_not_durable', 'Selected adapter cannot keep a stable origin');
  if (lifetimeMs !== undefined) throw refuse('durable_lifetime_unsupported', 'Durable routes have no finite lifetime; use a session');
  return reserved(home, async dir => {
    // A user stop is sticky until the host shows durable consent again.
    if (!reconsent) {
      try { await readRecord(tombstonePath(dir, routeId)); throw refuse('stopped_by_user', 'The user stopped this route; show durable consent again and pass reconsent: true'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let record = await load(dir, routeId);
    const tuple = { adapterId, target, durable: true };
    if (record) {
      if (record.adapterId !== adapterId) throw refuse('adapter_changed', 'This route is pinned to another adapter');
      if (origin !== undefined && origin !== record.origin && origin !== record.intent.origin) throw refuse('origin_changed', 'This route is pinned to another origin');
      if (record.target !== target || record.owner !== owner) throw refuse('consent_changed', 'Changed route tuple requires new approval');
      if (['releasing', 'address_changed', 'uncertain'].includes(record.state)) throw refuse(record.state === 'releasing' ? 'route_releasing' : record.state, `Route is ${record.state}; release or adopt it first`);
    } else if (!approvals.some(item => item?.adapterId === adapterId && item.target === target && item.durable === true && (item.origin ?? null) === (origin ?? null))) {
      throw refuse('consent_required', 'No approved durable tuple for this adapter and target');
    }
    const observed = await observe();
    if (record) {
      const current = await reconcile(record, observed);
      if (current.state === 'usable' || current.state === 'unverified') {
        if (reconsent) await remove(tombstonePath(dir, routeId));
        return { schemaVersion: 1, route: view(record, current.state, current) };
      }
      if (current.state !== 'lost') {
        await save(dir, { ...record, state: current.state, cleanupDebt: current.cleanupDebt ?? null });
        throw refuse(current.state, `Route is ${current.state}; nothing was changed`);
      }
      // Lost: restore only at the pinned origin, never re-allocate.
      if (occupied(observed.config, record.intent.dnsName, record.intent.port)) throw refuse('port_occupied', 'The pinned port is occupied by another rule');
      record = { ...record, state: 'creating', receipt: null, generation: record.generation + 1 };
    } else {
      const ports = adapter.capabilityPorts ? candidatePorts.filter(port => observed.funnelPorts.includes(port)) : candidatePorts;
      const port = ports.find(port => !occupied(observed.config, observed.dnsName, port));
      if (port === undefined) throw refuse('port_occupied', 'Every candidate HTTPS port is occupied or not permitted; existing rules were left untouched');
      const candidate = originOf(observed.dnsName, port);
      if (origin !== undefined && origin !== candidate) throw refuse('address_changed', 'Provider would publish a different origin');
      record = { schemaVersion: 1, routeId, owner, adapterId, target, origin: null, createdAt: new Date().toISOString(), ownership: 'gozar-owned',
        lifetime: adapter.lifetime, consent: { ...tuple, origin: origin ?? null }, generation: 1, state: 'creating',
        intent: { dnsName: observed.dnsName, port, mode: adapter.mode, origin: candidate, rule: ruleFor(adapter.mode, target) }, receipt: null, cleanupDebt: null };
    }
    // Intent is durable before the provider command runs.
    await save(dir, record);
    const { dnsName, port, mode, rule } = record.intent;
    const created = await tailscale([mode, '--bg', ...(mode === 'funnel' ? ['--yes'] : []), `--https=${port}`, '--set-path=/', `http://${target}`]);
    const readback = (await observe()).config;
    const current = ruleAt(readback, dnsName, port);
    if (created.code !== 0 || !isDeepStrictEqual(current, rule)) {
      const absent = Object.values(current).every(value => value === null);
      await save(dir, { ...record, state: absent ? 'lost' : 'uncertain', cleanupDebt: absent ? null : { reason: 'readback-mismatch', port } });
      throw refuse(absent ? 'provider_create_failed' : 'uncertain', 'Provider readback does not match the intended rule; nothing was published');
    }
    // Receipt before publication: provider resource identity plus the readback that confirmed it.
    record = { ...record, receipt: { dnsName, port, mode, rule: current, observedAt: new Date().toISOString() } };
    await save(dir, record);
    const checked = await verification({ origin: record.intent.origin, target, verifyCmd: null });
    const state = checked.status === 'verified' ? 'usable' : 'unverified';
    record = { ...record, state, origin: state === 'usable' ? record.intent.origin : record.origin };
    await save(dir, record);
    if (reconsent) await remove(tombstonePath(dir, routeId));
    return { schemaVersion: 1, route: view(record, state, { verification: checked }) };
  });
}

// Remove by exact compare-and-remove from the receipt. A rule Gozar cannot attribute stays in place.
export async function releaseRoute({ routeId, mode = 'remove', home = defaultHome(), stoppedByUser = false }) {
  routeId = routeIdValue(routeId);
  if (mode !== 'remove') throw refuse('not_implemented', 'Only remove is implemented');
  return reserved(home, async dir => {
    let record = await load(dir, routeId);
    const finish = async reply => {
      if (stoppedByUser) await atomicWrite(tombstonePath(dir, routeId), { schemaVersion: 1, routeId, stoppedAt: new Date().toISOString() });
      else await remove(tombstonePath(dir, routeId));
      return { schemaVersion: 1, routeId, ...reply };
    };
    if (!record) return finish({ removed: false, providerRemoved: false, cleanupDebt: null });
    // Withdraw publication durably before touching the provider.
    record = { ...record, state: 'releasing' };
    await save(dir, record);
    const pin = record.receipt ?? record.intent;
    const before = await observe();
    const current = ruleAt(before.config, pin.dnsName, pin.port);
    const absent = Object.values(current).every(value => value === null);
    const drop = async () => { await unlink(join(dir, hash(routeId) + '.json')); await syncDirectory(dir); };
    if (absent) { await drop(); return finish({ removed: true, providerRemoved: false, cleanupDebt: null }); }
    if (!record.receipt) {
      // Intent only: the rule may be another program's. Leave it and report it.
      const cleanupDebt = { reason: 'unattributed-rule', port: pin.port };
      await drop(); return finish({ removed: true, providerRemoved: false, cleanupDebt });
    }
    if (before.dnsName !== pin.dnsName || !isDeepStrictEqual(current, record.receipt.rule)) {
      const cleanupDebt = { reason: 'rule-changed', port: pin.port };
      await save(dir, { ...record, cleanupDebt });
      return finish({ removed: false, providerRemoved: false, cleanupDebt });
    }
    // The Tailscale CLI exposes no serve-config ETag, so this removal is not conditional on
    // the readback above. The post-removal comparison detects edits to other listeners only.
    const removed = await tailscale(['serve', `--https=${pin.port}`, 'off']);
    const after = (await observe()).config;
    if (removed.code !== 0 || !isDeepStrictEqual(after, without(before.config, pin.dnsName, pin.port))) {
      const cleanupDebt = { reason: 'post-removal-mismatch', port: pin.port };
      await save(dir, { ...record, cleanupDebt });
      return finish({ removed: false, providerRemoved: removed.code === 0, cleanupDebt });
    }
    await drop();
    return finish({ removed: true, providerRemoved: true, cleanupDebt: null });
  });
}
export const stopRoute = ({ routeId, home }) => releaseRoute({ routeId, mode: 'remove', home, stoppedByUser: true });

// Re-observe and re-verify every durable record. Read-only.
export async function statusRoutes({ routeId, home = defaultHome() } = {}) {
  if (routeId !== undefined) routeIdValue(routeId);
  let dir, names;
  try { dir = await routesDirectory(home, false); names = await readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, routes: [] }; throw error; }
  const records = [];
  for (const name of names.sort()) {
    if (!/^[0-9a-f]{64}\.json$/.test(name) || (routeId !== undefined && name !== hash(routeId) + '.json')) continue;
    const record = await readRecord(join(dir, name));
    if (record.schemaVersion !== 1 || name !== hash(record.routeId) + '.json') throw new Error('Invalid durable route record');
    records.push(record);
  }
  if (!records.length) return { schemaVersion: 1, routes: [] };
  let observed = null, error = null;
  try { observed = await observe(); } catch (cause) { error = cause.message; }
  const routes = [];
  for (const record of records) {
    if (!observed) { routes.push({ ...view(record, 'unknown'), error }); continue; }
    const current = await reconcile(record, observed);
    routes.push(view(record, current.state, current));
  }
  return { schemaVersion: 1, routes };
}
