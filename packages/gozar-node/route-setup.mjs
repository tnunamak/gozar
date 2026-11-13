// Setup actions a catalog candidate lists. The app passes back exactly what the user approved: the action's
// digest and its disclosure revision. If either moved since, nothing runs (candidate_stale). Gozar runs only
// what an adapter's own `setup` does (kinds gozar-runs and provide-secret); open-url and instructions are steps
// for the user, and Gozar never runs an installer.
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { canonicalHome, trustedDirectory, privateDirectory, checkedFile } from './service-state.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { inspectAdapter, catalogRevisionOf, readContextFor, loadRuntime } from './route-catalog.mjs';
import { supportedPlatform } from './platform.mjs';

const handlePattern = /^sec_[0-9a-f]{32}$/;
const maxSecretBytes = 65_536;

async function secretDirectory(home, create) {
  const directory = join(await canonicalHome(home, create), 'secrets');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}

/** Stores one secret 0600 in Gozar's private store and returns its handle. The handle is the only thing that travels. */
export async function storeSecret({ home, value }) {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value ?? []);
  if (!bytes.length || bytes.length > maxSecretBytes) throw gozarError('invalid_input', 'A secret must be 1..65536 bytes');
  const directory = await secretDirectory(home, true);
  const handle = `sec_${randomBytes(16).toString('hex')}`;
  const file = await open(join(directory, handle), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); bytes.fill(0); }
  return { handle };
}

/** Hands one secret to `use` and clears its copy afterwards. The handle is validated before it reaches a path. */
export async function withSecret(home, handle, use) {
  if (typeof handle !== 'string' || !handlePattern.test(handle)) throw gozarError('invalid_input', 'secretHandle is not a Gozar secret handle');
  const directory = await secretDirectory(home, false).catch(error => { throw error.code === 'ENOENT' ? gozarError('setup_required', 'The secret is not in the private store') : error; });
  let file;
  try { file = await checkedFile(join(directory, handle), constants.O_RDONLY, 'secret'); }
  catch (error) { throw error.code === 'ENOENT' ? gozarError('setup_required', 'The secret is not in the private store') : error; }
  const buffer = Buffer.alloc(maxSecretBytes + 1);
  try {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxSecretBytes) throw gozarError('invalid_input', 'The stored secret is too large');
    return await use(new Uint8Array(buffer.subarray(0, bytesRead)));
  } finally { buffer.fill(0); await file.close(); }
}

const refuseApproval = approval => {
  if (typeof approval?.digest !== 'string' || !approval.digest || typeof approval.disclosureRevision !== 'string' || !approval.disclosureRevision)
    throw gozarError('consent_required', 'No approval for this setup action; ask the user and pass the action digest and disclosure revision');
};

/**
 * Runs one approved setup action. Returns SetupActionResult. Throws candidate_stale, with nothing run, when the
 * action is gone or its digest or disclosure moved since the user approved it.
 */
export async function runSetupAction(request, deps = {}) {
  try {
    if (typeof request?.home !== 'string' || !request.home || typeof request.actionId !== 'string' || !request.actionId)
      throw gozarError('invalid_input', 'runSetupAction needs home and actionId');
    refuseApproval(request.approval);
    if (request.secretHandle !== undefined && !handlePattern.test(request.secretHandle)) throw gozarError('invalid_input', 'secretHandle is not a Gozar secret handle');
    const platform = deps.platform ?? process.platform;
    if (!supportedPlatform(platform)) throw gozarError('unsupported', `Gozar 0.2 does not support setup on ${platform}`);
    const runtime = await loadRuntime();
    if (!deps.adapters && !runtime) throw gozarError('internal_error', 'The adapter registry is not available in this build');
    const adapters = deps.adapters ?? await runtime.loadAdapters();
    const read = await readContextFor(deps, await canonicalHome(request.home, true), platform);
    const inspect = () => Promise.all(adapters.map(adapter => inspectAdapter(adapter, read, platform)));
    const found = (await inspect()).flatMap(item => item.actions.map(action => ({ item, action }))).find(entry => entry.action.id === request.actionId);
    if (!found) throw gozarError('candidate_stale', 'That setup action is no longer offered; ask the catalog again');
    const { item: { adapter }, action } = found;
    if (action.digest !== request.approval.digest || action.disclosure.revision !== request.approval.disclosureRevision)
      throw gozarError('candidate_stale', 'The setup action changed after it was approved; nothing was run, show the user the new action');
    let result;
    if (action.kind === 'open-url' || action.kind === 'instructions') {
      result = { state: 'pending', nextAction: action };
    } else {
      if (action.kind === 'provide-secret' && request.secretHandle === undefined) throw gozarError('invalid_input', 'This action needs a secretHandle from Gozar\'s private store');
      const execute = deps.executeApprovedAction ?? runtime?.executeApprovedAction ?? (async () => { throw gozarError('unsupported', 'No approved-action runner is wired in this build'); });
      const context = { ...read,
        // The approved handle is the only secret configuration(ref) can return, and only during this setup call.
        configuration: ref => ref !== null && ref === request.secretHandle ? withSecret(request.home, ref, async secret => new Uint8Array(secret)) : read.configuration(ref),
        // The adapter may run only the one action the user approved.
        executeApprovedAction: id => id === request.actionId ? execute(id) : Promise.reject(gozarError('invalid_input', 'Only the approved action may run')),
        withSecret: (handle, use) => handle === request.secretHandle ? withSecret(request.home, handle, use) : Promise.reject(gozarError('invalid_input', 'Only the approved secret may be read')) };
      result = await adapter.setup(context, request.actionId, request.secretHandle);
    }
    if (!['complete', 'pending', 'blocked'].includes(result?.state)) throw gozarError('internal_error', 'The adapter returned no setup state');
    return { schemaVersion: 1, state: result.state, nextAction: result.nextAction ?? null, catalogRevision: catalogRevisionOf(await inspect(), platform) };
  } catch (error) { throw normalizeError(error); }
}
