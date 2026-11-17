// Setup actions a catalog candidate lists. The app passes back exactly what the user approved: the action's
// digest and its disclosure revision. If either moved since, nothing runs (candidate_stale). Gozar runs only
// what an adapter's own `setup` does (kinds gozar-runs and provide-secret); open-url and instructions are steps
// for the user, and Gozar never runs an installer. A provide-value action carries a plain, non-secret `value`
// (a domain, an address): Gozar checks it against the action's `valueFormat` and keeps it as configuration.
import { canonicalHome } from './service-state.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { inspectAdapter, catalogRevisionOf, readContextFor, loadRuntime } from './route-catalog.mjs';
import { supportedPlatform } from './platform.mjs';
import { storeSecret, withSecret, handlePattern } from './secret-store.mjs';
import { bindSetupValue, bindSetupText, discardUnboundSecret, bindConfiguration } from './adapter-configuration.mjs';

export { storeSecret, withSecret };

const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
/** The value a provide-value action accepts for a format, or null when it does not match. */
export function checkValue(format, value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (format === 'domain') return domainPattern.test(text) ? text : null;
  if (format === 'text') return text.length > 0 && text.length <= 1024 && !text.includes('\0') ? text : null;
  if (format === 'https-origin') {
    let url;
    try { url = new URL(text); } catch { return null; }
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname && (url.pathname === '' || url.pathname === '/') ? url.origin : null;
  }
  return null;
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
  if (deps.embeddingServices) return (await import('./embedding-setup.mjs')).runEmbeddingSetup(request, deps);
  // A handle the app provides is Gozar's to clean up: it stays only when this call binds it to the adapter.
  const provided = typeof request?.home === 'string' && request.home && handlePattern.test(request?.secretHandle) ? request.secretHandle : null;
  let bound = false;
  try {
    if (typeof request?.home !== 'string' || !request.home || typeof request.actionId !== 'string' || !request.actionId)
      throw gozarError('invalid_input', 'runSetupAction needs home and actionId');
    refuseApproval(request.approval);
    if (request.value !== undefined && typeof request.value !== 'string') throw gozarError('invalid_input', 'value must be a string');
    if (request.secretHandle !== undefined && !handlePattern.test(request.secretHandle)) throw gozarError('invalid_input', 'secretHandle is not a Gozar secret handle');
    const platform = deps.platform ?? process.platform;
    if (!supportedPlatform(platform)) throw gozarError('unsupported', `Gozar 0.2 does not support setup on ${platform}`);
    const runtime = await loadRuntime();
    if (!deps.adapters && !runtime) throw gozarError('internal_error', 'The adapter registry is not available in this build');
    const adapters = deps.adapters ?? await runtime.loadAdapters();
    const home = await canonicalHome(request.home, true);
    const read = await readContextFor(deps, home, platform);
    const inspect = () => Promise.all(adapters.map(adapter => inspectAdapter(adapter, read, platform)));
    // Two adapters may offer the same action id; the approved digest says which one the user saw.
    const offered = (await inspect()).flatMap(item => item.actions.map(action => ({ item, action }))).filter(entry => entry.action.id === request.actionId);
    const found = offered.find(entry => entry.action.digest === request.approval.digest) ?? offered[0];
    if (!found) throw gozarError('candidate_stale', 'That setup action is no longer offered; ask the catalog again');
    const { item: { adapter }, action } = found;
    if (action.digest !== request.approval.digest || action.disclosure.revision !== request.approval.disclosureRevision)
      throw gozarError('candidate_stale', 'The setup action changed after it was approved; nothing was run, show the user the new action');
    let result;
    if (action.kind === 'open-url' || action.kind === 'instructions') {
      result = { state: 'pending', nextAction: action };
    } else if (action.kind === 'provide-value') {
      if (request.secretHandle !== undefined) throw gozarError('invalid_input', 'A provide-value action takes value, not a secretHandle');
      if (request.value === undefined) return { schemaVersion: 1, state: 'pending', nextAction: action, catalogRevision: catalogRevisionOf(await inspect(), platform) };
      const value = checkValue(action.valueFormat, request.value);
      if (value === null) throw gozarError('invalid_input', `The value does not match the format this action asks for (${action.valueFormat})`);
      await bindSetupText({ home, adapterId: adapter.id, actionId: request.actionId, value });
      result = { state: 'complete', nextAction: null };
    } else {
      if (request.value !== undefined) throw gozarError('invalid_input', 'Only a provide-value action takes value');
      if (action.kind === 'provide-secret' && request.secretHandle === undefined) throw gozarError('invalid_input', 'This action needs a secretHandle from Gozar\'s private store');
      const execute = deps.executeApprovedAction ?? runtime?.executeApprovedAction ?? (async () => { throw gozarError('unsupported', 'No approved-action runner is wired in this build'); });
      const own = bindConfiguration(read, adapter.id);
      const context = { ...own,
        // Beside this adapter's own recorded values, the approved handle is readable, and only during this setup call.
        configuration: ref => ref !== null && ref === request.secretHandle ? withSecret(request.home, ref, async secret => new Uint8Array(secret)) : own.configuration(ref),
        // The adapter may run only the one action the user approved.
        executeApprovedAction: id => id === request.actionId ? execute(id) : Promise.reject(gozarError('invalid_input', 'Only the approved action may run')),
        withSecret: (handle, use) => handle === request.secretHandle ? withSecret(request.home, handle, use) : Promise.reject(gozarError('invalid_input', 'Only the approved secret may be read')) };
      result = await adapter.setup(context, request.actionId, request.secretHandle);
    }
    if (!['complete', 'pending', 'blocked'].includes(result?.state)) throw gozarError('internal_error', 'The adapter returned no setup state');
    if (result.state === 'complete' && action.kind === 'provide-secret') {
      await bindSetupValue({ home, adapterId: adapter.id, actionId: request.actionId, handle: request.secretHandle });
      bound = true;
    }
    return { schemaVersion: 1, state: result.state, nextAction: result.nextAction ?? null, catalogRevision: catalogRevisionOf(await inspect(), platform) };
  } catch (error) { throw normalizeError(error); }
  finally { if (provided && !bound) await discardUnboundSecret({ home: request.home, handle: provided }).catch(() => {}); }
}
