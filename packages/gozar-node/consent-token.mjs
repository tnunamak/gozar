// Consent tokens: a consent receipt for ONE route creation. A token is short-lived, bound to
// {adapterId, target, originClass, owner} and usable once. Only a SHA-256 of the token is stored
// (0600, under <home>/routes/consent/), so a copy of the state directory cannot spend a token.
//
// Single use rests on rename being atomic on one filesystem: the first presentation renames the
// token file to a unique name, and only one concurrent redeemer can win that rename. The token is
// spent whether the redemption succeeds or not, so a wrong target, owner or originClass means the
// app must ask the user again.
//
// Not wired into ensureRoute yet; originClass is an opaque string for now.
import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { atomicWrite } from './journal.mjs';
import { trustedDirectory, privateDirectory } from './service-state.mjs';
import { routesDirectory, syncDirectory, removeFile } from './durable-route.mjs';

const defaultHome = () => process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
const refuse = (code, message) => Object.assign(new Error(message), { code });
const digest = token => createHash('sha256').update(token).digest('hex');
const text = (value, name) => {
  if (typeof value !== 'string' || !value || value.length > 256) throw refuse('invalid_input', `${name} must be a non-empty string`);
  return value;
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function consentDirectory(home, create) {
  const dir = join(await routesDirectory(home, create), 'consent');
  await trustedDirectory(dir, create);
  await privateDirectory(dir);
  return dir;
}

export async function issueConsentToken({ home = defaultHome(), adapterId, target, originClass, owner, ttlMs = 10 * 60_000 }) {
  text(adapterId, 'adapterId'); text(target, 'target'); text(originClass, 'originClass'); text(owner, 'owner');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw refuse('invalid_input', 'ttlMs must be a positive integer');
  const dir = await consentDirectory(home, true);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await atomicWrite(join(dir, `${digest(token)}.json`), { schemaVersion: 1, adapterId, target, originClass, owner, expiresAt });
  return { token, expiresAt };
}

export async function redeemConsentToken({ home = defaultHome(), token, target, originClass, owner }) {
  if (typeof token !== 'string' || !token || token.length > 256) throw refuse('consent_unknown', 'Consent token is unknown or already used');
  let dir;
  try { dir = await consentDirectory(home, false); }
  catch (error) { if (error.code === 'ENOENT') throw refuse('consent_unknown', 'Consent token is unknown or already used'); throw error; }
  const live = join(dir, `${digest(token)}.json`);
  const claimed = join(dir, `${digest(token)}.${randomUUID()}.spent`);
  // The claim: only one renamer finds the file. Everyone else sees ENOENT.
  try { await rename(live, claimed); }
  catch (error) { if (error.code === 'ENOENT') throw refuse('consent_unknown', 'Consent token is unknown or already used'); throw error; }
  let grant;
  try { grant = JSON.parse(await readFile(claimed, 'utf8')); }
  finally { await removeFile(claimed); await syncDirectory(dir); }
  if (!(Date.parse(grant.expiresAt) > Date.now())) throw refuse('consent_expired', 'Consent token expired; ask the user again');
  if (!same(grant.target, target) || !same(grant.originClass, originClass) || !same(grant.owner, owner))
    throw refuse('consent_mismatch', 'Consent token was issued for a different target, owner or origin class; ask the user again');
  return { adapterId: grant.adapterId };
}
