// Consent tokens: a consent receipt for ONE route creation or adoption. Gozar's catalog issues a
// token for an eligible candidate; the app passes it back as `approval.candidateToken`. The token
// is short-lived, bound to everything the user was shown (see ConsentBinding in
// internal-seams.d.ts) and usable once. It also carries the grant: which adapter, and the plan
// digest and observed provider resource the catalog saw. The app never names an adapter.
//
// Only a SHA-256 of the token and a digest of its binding are stored (0600, under
// <home>/routes/consent/), so a copy of the state directory cannot spend a token or read what it
// was bound to.
//
// Single use rests on rename being atomic on one filesystem: the first presentation renames the
// token file to a unique name, and only one concurrent redeemer can win that rename. The token is
// spent whether the redemption succeeds or not, so any difference between the binding at issue and
// at redemption means the app must ask the user again.
import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, rename, stat, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './journal.mjs';
import { trustedDirectory, privateDirectory, canonicalHome } from './service-state.mjs';
import { defaultHome } from './default-home.mjs';

const refuse = (code, message) => Object.assign(new Error(message), { code });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const defaultTtlMs = 10 * 60_000;
// The longest time a token can live. It also bounds how long a leftover file can be a live token.
const maxTtlMs = 60 * 60_000;
const unknownToken = () => refuse('consent_unknown', 'Consent token is unknown or already used');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Canonical JSON: object keys sorted at every depth, so two equal bindings always hash alike.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const canonicalDigest = value => sha256(JSON.stringify(canonical(value)));
const bindingDigest = canonicalDigest;

// Pure: builds the binding from a request so issuer and redeemer cannot disagree.
export function consentBinding(query, canonicalHome, disclosureRevision, consentFactsDigest) {
  return {
    owner: query.owner, home: canonicalHome, target: query.target, usage: structuredClone(query.usage),
    intent: query.intent ?? 'create', requirements: structuredClone(query.requirements),
    route: query.route ?? null, origin: query.origin ?? null, disclosureRevision,
    ...(consentFactsDigest ? {consentFactsDigest} : {}),
    // providerId is not part of the binding: the token's grant already names the one adapter it approves, and an app
    // that listed every provider must be able to send back the id the user chose. redeemConsentToken checks it instead.
  };
}
function checkBinding(binding) {
  const ok = plain(binding) && ['owner', 'home', 'target', 'disclosureRevision'].every(key => text(binding[key])) &&
    plain(binding.usage) && ['durable', 'session', 'attached'].includes(binding.usage.kind) && plain(binding.requirements) &&
    ['create', 'adopt'].includes(binding.intent) && [binding.route, binding.origin].every(value => value === null || text(value));
  if (!ok) throw refuse('invalid_input', 'Consent binding is incomplete');
  return binding;
}
function checkGrant(grant) {
  if (!plain(grant) || !['adapterId', 'planDigest', 'observedResource'].every(key => text(grant[key])))
    throw refuse('invalid_input', 'Consent grant needs adapterId, planDigest and observedResource');
  return { adapterId: grant.adapterId, planDigest: grant.planDigest, observedResource: grant.observedResource,
    ...Object.fromEntries(['consentFactsDigest','configurationRevision','scopeId'].filter(key=>grant[key]!==undefined).map(key=>[key,grant[key]])) };
}

async function consentDirectory(home, create) {
  const canonicalPath = await canonicalHome(home, create);
  const routes = join(canonicalPath, 'routes');
  for (const dir of [routes, join(routes, 'consent')]) { await trustedDirectory(dir, create); await privateDirectory(dir); }
  return join(routes, 'consent');
}
async function syncDirectory(dir) { const fd = await open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
const removeFile = path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });

// Remove expired token files and leftovers a crash left behind (a claimed `.spent` file or an
// unfinished write) once they are older than the longest TTL. A token that is still live is kept.
async function sweep(dir) {
  const now = Date.now();
  const aged = async path => { try { return now - (await stat(path)).mtimeMs > maxTtlMs; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if (/^[0-9a-f]{64}\.json$/.test(name)) {
      let expired;
      try { expired = !(Date.parse(JSON.parse(await readFile(path, 'utf8')).expiresAt) > now); }
      catch (error) { if (error.code === 'ENOENT') continue; expired = await aged(path); }
      if (expired) await removeFile(path);
    } else if (/^[0-9a-f]{64}\..+\.(spent|tmp)$/.test(name) && await aged(path)) await removeFile(path);
  }
}

export async function issueConsentToken({ home = defaultHome(), binding, grant, ttlMs = defaultTtlMs }) {
  checkBinding(binding); grant = checkGrant(grant);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > maxTtlMs) throw refuse('invalid_input', `ttlMs must be a positive integer of at most ${maxTtlMs}`);
  const dir = await consentDirectory(home, true);
  await sweep(dir);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await atomicWrite(join(dir, `${sha256(token)}.json`), { schemaVersion: 2, bindingDigest: bindingDigest(binding), grant, expiresAt });
  return { token, expiresAt };
}

/** The grant a live token carries, without spending it; null when the token is unknown or expired. The bearer already holds the token. */
export async function peekConsentGrant({ home = defaultHome(), token }) {
  if (typeof token !== 'string' || !token || token.length > 256) return null;
  try {
    const stored = JSON.parse(await readFile(join(await consentDirectory(home, false), `${sha256(token)}.json`), 'utf8'));
    return Date.parse(stored.expiresAt) > Date.now() ? checkGrant(stored.grant) : null;
  } catch { return null; }
}

/** `providerId`, when the request names one, must be the adapter the token approves. */
export async function redeemConsentToken({ home = defaultHome(), token, binding, providerId }) {
  if (typeof token !== 'string' || !token || token.length > 256) throw unknownToken();
  checkBinding(binding);
  if (providerId !== undefined && !text(providerId)) throw refuse('invalid_input', 'providerId must be a non-empty string');
  let dir;
  try { dir = await consentDirectory(home, false); }
  catch (error) { if (error.code === 'ENOENT') throw unknownToken(); throw error; }
  const live = join(dir, `${sha256(token)}.json`);
  const claimed = join(dir, `${sha256(token)}.${randomUUID()}.spent`);
  // The claim: only one renamer finds the file. Everyone else sees ENOENT.
  try { await rename(live, claimed); }
  catch (error) { if (error.code === 'ENOENT') throw unknownToken(); throw error; }
  let stored;
  try { stored = JSON.parse(await readFile(claimed, 'utf8')); }
  finally { await removeFile(claimed); await syncDirectory(dir); }
  if (!(Date.parse(stored.expiresAt) > Date.now())) throw refuse('consent_expired', 'Consent token expired; ask the user again');
  if (!same(stored.bindingDigest, bindingDigest(binding)))
    throw refuse('consent_mismatch', 'Consent token was issued for a different request; ask the user again');
  const grant = checkGrant(stored.grant);
  if (providerId !== undefined && grant.adapterId !== providerId)
    throw refuse('consent_mismatch', 'Consent token approves a different provider than the request names; ask the user again');
  return grant;
}
