// What a user told one adapter during setup. The core keeps one record per adapter at <home>/setup/<adapterId>.json:
// {schemaVersion:1, values:{[actionId]: secretHandle}, text?:{[actionId]: string}}. A secret stays in the secret
// store; the record only says which handle answers which action. A plain value (a `provide-value` action: a domain,
// an address) is not a secret and is kept as text in the same private record. `bindConfiguration` is the one place that turns the record into
// the `configuration(ref)` every adapter context carries, so an adapter reads its own values and nobody else's.
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { atomicWrite } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, checkedFile, withExclusiveLock } from './service-state.mjs';
import { gozarError } from './error-normalizer.mjs';
import { handlePattern, withSecret, deleteSecret } from './secret-store.mjs';

const idPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LOCK = '.lock';

async function setupDirectory(home, create) {
  const directory = join(await canonicalHome(home, create), 'setup');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}

const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

const textLimit = 2048;
/** The handle bound to each action id and the plain values for one adapter, as null-prototype maps. Absent record: both empty. */
async function readRecord(directory, adapterId) {
  let file, text;
  try { file = await checkedFile(join(directory, `${adapterId}.json`), constants.O_RDONLY, 'setup record'); }
  catch (error) { if (missing(error)) return { bindings: Object.create(null), plain: Object.create(null) }; throw error; }
  try { text = await file.readFile('utf8'); } finally { await file.close(); }
  let record;
  try { record = JSON.parse(text); } catch { record = null; }
  const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (record?.schemaVersion !== 1 || !object(record.values) || (record.text !== undefined && !object(record.text)))
    throw gozarError('internal_error', 'The setup record is not valid');
  const bindings = Object.create(null), plain = Object.create(null);
  for (const [key, handle] of Object.entries(record.values)) if (keyPattern.test(key) && handlePattern.test(handle)) bindings[key] = handle;
  for (const [key, value] of Object.entries(record.text ?? {})) if (keyPattern.test(key) && typeof value === 'string' && value.length <= textLimit) plain[key] = value;
  return { bindings, plain };
}
const readBindings = async (directory, adapterId) => (await readRecord(directory, adapterId)).bindings;

const locked = async (directory, action) => withExclusiveLock(join(directory, LOCK), action, { waitSeconds: 30 });

/**
 * Binds `handle` to `actionId` for one adapter, then deletes the handle it replaced. The record is committed
 * before anything is deleted, so a crash between the two leaves a stray secret file, never a dangling binding.
 */
export async function bindSetupValue({ home, adapterId, actionId, handle }) {
  if (!idPattern.test(adapterId) || !keyPattern.test(actionId) || !handlePattern.test(handle)) throw gozarError('invalid_input', 'The setup value cannot be recorded');
  const directory = await setupDirectory(home, true);
  const replaced = await locked(directory, async () => {
    const { bindings, plain } = await readRecord(directory, adapterId);
    const previous = bindings[actionId] ?? null;
    const { [actionId]: _gone, ...keep } = plain;
    await atomicWrite(join(directory, `${adapterId}.json`), { schemaVersion: 1, values: { ...bindings, [actionId]: handle }, ...(Object.keys(keep).length ? { text: keep } : {}) });
    return previous;
  });
  if (replaced && replaced !== handle) await deleteSecret(home, replaced);
}

/** Records a plain (non-secret) value an adapter's `provide-value` action collected. It replaces an earlier value for that action. */
export async function bindSetupText({ home, adapterId, actionId, value }) {
  if (!idPattern.test(adapterId) || !keyPattern.test(actionId) || typeof value !== 'string' || !value || value.length > textLimit) throw gozarError('invalid_input', 'The setup value cannot be recorded');
  const directory = await setupDirectory(home, true);
  const replaced = await locked(directory, async () => {
    const { bindings, plain } = await readRecord(directory, adapterId);
    const { [actionId]: _gone, ...keepBindings } = bindings;
    await atomicWrite(join(directory, `${adapterId}.json`), { schemaVersion: 1, values: { ...keepBindings }, text: { ...plain, [actionId]: value } });
    return bindings[actionId] ?? null;
  });
  if (replaced) await deleteSecret(home, replaced);
}

/** Deletes a provided handle's secret unless some adapter's record already binds it. */
export async function discardUnboundSecret({ home, handle }) {
  if (typeof handle !== 'string' || !handlePattern.test(handle)) return;
  let directory;
  try { directory = await setupDirectory(home, false); }
  catch (error) { if (!missing(error)) throw error; return deleteSecret(home, handle); }
  await locked(directory, async () => {
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json')) continue;
      const bindings = await readBindings(directory, name.slice(0, -'.json'.length));
      if (Object.values(bindings).includes(handle)) return;
    }
    await deleteSecret(home, handle);
  });
}

/** The values the user gave this adapter, keyed by action id, or null when none is bound. */
async function boundValues(home, adapterId) {
  if (typeof home !== 'string' || !home || !idPattern.test(adapterId)) return null;
  let directory;
  try { directory = await setupDirectory(home, false); } catch (error) { if (missing(error)) return null; throw error; }
  const { bindings, plain } = await readRecord(directory, adapterId);
  const values = { ...plain };
  for (const [actionId, handle] of Object.entries(bindings)) {
    try { values[actionId] = await withSecret(home, handle, async bytes => new TextDecoder().decode(bytes)); }
    catch (error) { if (error?.code !== 'setup_required') throw error; } // a value whose file is gone is simply unset
  }
  return Object.keys(values).length ? values : null;
}

/**
 * Returns `context` with `configuration` bound to one adapter. With a null ref it answers that adapter's own
 * values (or null); a named ref keeps the context's own lookup. Every context an adapter receives passes
 * through here: catalog, setup, plan, observe, and the effect contexts of attached, session and durable routes.
 */
export function bindConfiguration(context, adapterId) {
  const named = context.configuration;
  return { ...context, configuration: ref => (ref === null || ref === undefined ? boundValues(context.home, adapterId) : named(ref)) };
}
