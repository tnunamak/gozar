// The user's route preference: one small record per real OS user, shared by every app and every app home.
// It lives under the profile home, which is resolved for the real user (passwd entry), not from $HOME, so an
// app that isolates its own HOME still reads and writes the same preference. GOZAR_HOME selects a separate,
// disclosed profile. Writes are compare-and-set on `revision`; only opaque preferenceRef values are stored.
import { join, isAbsolute } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { atomicWrite } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, readRecord, withExclusiveLock } from './service-state.mjs';
import { CODES, gozarError, normalizeError } from './route-view.mjs';

const realUserHome = () => { try { return userInfo().homedir; } catch { return homedir(); } };
export const defaultProfileHome = () => process.env.GOZAR_HOME ?? join(realUserHome(), '.local', 'state', 'gozar');

const refPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
const empty = () => ({ schemaVersion: 1, scope: 'user', revision: 0, adapterPreference: [], onUnavailable: 'ask' });

function checkProfileHome(value) {
  const home = value ?? defaultProfileHome();
  if (typeof home !== 'string' || !isAbsolute(home)) throw gozarError(CODES.invalidInput, 'profileHome must be an absolute path');
  return home;
}

async function preferenceDirectory(profileHome, create) {
  const directory = join(await canonicalHome(profileHome, create), 'preferences');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}

function checkRecord(record) {
  if (record?.schemaVersion !== 1 || record.scope !== 'user' || !Number.isSafeInteger(record.revision) || record.revision < 0 || record.onUnavailable !== 'ask' ||
      !Array.isArray(record.adapterPreference) || record.adapterPreference.some(ref => typeof ref !== 'string' || !refPattern.test(ref)))
    throw gozarError(CODES.internalError, 'The stored route preference is not a valid record');
  return record;
}
async function readPreferences(directory) {
  try { return checkRecord(await readRecord(join(directory, 'user.json'))); }
  catch (error) { if (error.code === 'ENOENT') return empty(); throw error; }
}

export async function getRoutePreferences(request = {}) {
  try {
    const profileHome = checkProfileHome(request.profileHome);
    let directory;
    try { directory = await preferenceDirectory(profileHome, false); }
    catch (error) { if (error.code === 'ENOENT') return empty(); throw error; }
    return await readPreferences(directory);
  } catch (error) { throw normalizeError(error); }
}

export async function setRoutePreferences(request) {
  try {
    const profileHome = checkProfileHome(request?.profileHome);
    const { expectedRevision, adapterPreference, onUnavailable } = request;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw gozarError(CODES.invalidInput, 'expectedRevision must be a non-negative integer');
    if (!Array.isArray(adapterPreference) || adapterPreference.length > 64 || new Set(adapterPreference).size !== adapterPreference.length ||
        adapterPreference.some(ref => typeof ref !== 'string' || !refPattern.test(ref)))
      throw gozarError(CODES.invalidInput, 'adapterPreference must list at most 64 distinct opaque preferenceRef values');
    if (onUnavailable !== 'ask') throw gozarError(CODES.invalidInput, "onUnavailable must be 'ask'");
    const directory = await preferenceDirectory(profileHome, true);
    return await withExclusiveLock(join(directory, '.lock'), async () => {
      const current = await readPreferences(directory);
      if (current.revision !== expectedRevision)
        throw gozarError(CODES.preferenceConflict, `The preference is at revision ${current.revision}, not ${expectedRevision}; read it again and retry`);
      const next = { schemaVersion: 1, scope: 'user', revision: current.revision + 1, adapterPreference: [...adapterPreference], onUnavailable: 'ask' };
      await atomicWrite(join(directory, 'user.json'), next);
      return next;
    }, { waitSeconds: 10 });
  } catch (error) { throw normalizeError(error); }
}
