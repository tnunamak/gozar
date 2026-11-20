// The recipe executor behind a session's `executePlan`, `compareAndRemove` and `prove`.
//
// A session is one thing: the generic session controller in attached-route.mjs (lease, expiry, the gate in front of the app,
// the awaited exact-origin acknowledgment, proof, publication, owner loss, removal receipts). A recipe provider (any adapter that
// declares an operational create plan) differs only in HOW its resource is allocated, removed and proven, and that is what this
// file arranges, in the controller's own process, from the pure core's transitions, the effect driver and the journal
// (session-allocation.mjs): it owns no phase, timer, lifetime or publication of its own.
//
// The core's own proof request (`http-probe`) is kept, never run on its own. The session controller announces the allocated origin,
// waits for the host's exact acknowledgment and only then asks `prove`, which runs that probe through the driver's authorized-vantage
// checks. Removal is the core's stop and reconcile, from the live allocation or, after the controller died, from the journal alone;
// it needs no proof and never invents one.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Journal } from './journal.mjs';
import { SessionAllocation } from './session-allocation.mjs';
import { prepareHost, LOCAL_PLAN_FEATURES } from './host.mjs';
import { loadCore } from './core.mjs';
import { loadCatalog, loadDefinition } from './catalog.mjs';
import { retireInstallKeyLease } from './key-route-lease.mjs';
import { reserveSession, narrowSessionReservation } from './durable-route.mjs';
import { fixtureSpawn } from './fixture-spawn.mjs';
import { PublicRelayVerifier } from './public-relay.mjs';
import { fixtureInterfaceObserver, runtimeFailure } from './adapter-runtime.mjs';
import { cliCommand } from './cli-command.mjs';
import { gozarError, instructionAction } from './error-normalizer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** What the core says, in `snapshot.limitations`, when it stops a session before it changes anything because every port the route may use is taken. */
export const LISTENERS_TAKEN = 'All explicit listener candidates are occupied or protected';

/** The adapters a recovering controller trusts: the saved record, with the current endpoint lifetime when it is exactly the installed plan. */
export function recoveryAdapters(saved, installed) {
  return saved.map(record => {
    const { endpointLifetime: ignored, ...adapter } = record;
    const current = installed.find(item => item.id === adapter.id);
    if (adapter.planVersion === 1 && adapter.ownership === 'owned' && current?.ownership === 'owned' && current.admission?.state === 'admitted' &&
        current.endpointLifetime === 'owned-process' && isDeepStrictEqual(adapter.recipes, current.recipes) &&
        isDeepStrictEqual(adapter.bindings, current.bindings) && isDeepStrictEqual(adapter.admission, current.admission)) return { ...adapter, endpointLifetime: current.endpointLifetime };
    return adapter;
  });
}

/**
 * Removes what a session journal records as owned, in a process that did not allocate it. It replays no create and no remote deletion:
 * only the attributable local handles the journal names. A journal that records no state and no intent proves nothing was allocated.
 */
export async function recoverStop(directory) {
  const journal = new Journal(directory); await journal.load();
  if (!journal.value.state) {
    if (Object.keys(journal.value.owned ?? {}).length || Object.keys(journal.value.intents ?? {}).length)
      throw gozarError('cleanup_debt', 'The recorded session has provider intents but no state; inspect its journal and retry stop');
    throw gozarError('route_not_found', 'No recorded session to stop');
  }
  const step = await loadCore();
  const state = journal.value.state;
  const installed = await loadCatalog(root, { operational: true });
  const allocation = new SessionAllocation({ step, journal, adapters: recoveryAdapters(state.adapters, installed), requirements: state.requirements,
    targetPort: journal.value.targetPort, sessionId: state.sessionId });
  allocation.state = state;
  allocation.driver.recoveryOnly = true;
  allocation.driver.host.features = [...new Set([...LOCAL_PLAN_FEATURES, ...(state.host?.features ?? []).filter(feature => ['probe-assertions', 'client-vantage-probe'].includes(feature))])];
  allocation.driver.authorize(state.selected);
  return allocation.shutdown();
}

const stopped = (result, journal) => result?.snapshot?.phase === 'stopped' && !(result.localCleanupFailures?.length) && Object.keys(journal.value.owned ?? {}).length === 0;

/**
 * The error for a session the core stopped before it was published. When every candidate port is taken the app gets the closest
 * frozen code and a next step that names the ports and, when Gozar knows it, the holder:
 *   route_conflict            another Gozar route or session in this home holds a candidate port: name it, say how to stop it
 *   requirements_unsatisfied  only other listeners hold the ports: nothing Gozar owns can be stopped, and a retry changes nothing
 * Anything else is a plain `provider_unavailable`: provider diagnostics stay inside Gozar.
 */
export async function sessionStartFailure(snapshot, { home, adapterId, loadDefinitionFor, portHoldersOf, sessionPort }) {
  const generic = () => gozarError('provider_unavailable', 'The route could not be started');
  if (!(snapshot?.limitations ?? []).includes(LISTENERS_TAKEN)) return generic();
  let ports = [], holders = [];
  try {
    const definition = await (loadDefinitionFor ?? (id => loadDefinition(root, id)))(adapterId);
    ports = definition.bindings?.port?.candidates ?? [];
    if (ports.length) holders = await (portHoldersOf ?? (await import('./durable-route.mjs')).portHolders)({ home, providerResource: definition.providerResource ?? null, ports, exceptSessionPort: sessionPort });
  } catch { /* the ports are an explanation, not a precondition: without them the generic error stands */ }
  if (!ports.length) return generic();
  const list = ports.length === 2 ? `${ports[0]} and ${ports[1]}` : ports.join(', ');
  const named = holders.map(({ port, routeId, sessionPort }) => routeId !== undefined ? `port ${port} is held by route ${routeId}` : `port ${port} is held by the session on port ${sessionPort}`);
  if (named.length) {
    const first = holders[0];
    const step = first.routeId !== undefined ? `Release route ${first.routeId} (or stop the app that owns it)` : `Stop the session on port ${first.sessionPort}`;
    const how = first.routeId !== undefined ? step : `${step} with: ${cliCommand('stop', first.sessionPort, home)}`;
    return gozarError('route_conflict', `No port is free for this route (${list}): ${named.join('; ')}. Existing listeners were left untouched.`,
      instructionAction('free-route-port', `Free port ${first.port}`, `${how}, then start this route again.`));
  }
  return gozarError('requirements_unsatisfied', `No port is free for this route: ${list} are all in use by other listeners. They were left untouched.`,
    instructionAction('free-route-port', `Free one of ports ${list}`, `Stop whatever listens on port ${ports[0]} or ${ports[1] ?? ports[0]}, then start this route again.`));
}

/**
 * The executor a recipe session's probe runs through. The driver decides what its receipts prove (exact origin, this attempt's nonce, the vantage
 * the core asked for, TLS, SSE, protocols, freshness); the executor only observes from the vantage it declares:
 *   a host-supplied `runtime.probeExecutor`  the host's trusted executor, for the vantages it declares
 *   explicit fixture effects                 the gate's challenge fetched through the declared `network fetch` effect, which can reach only what a
 *                                            fixture opened. Its receipts carry fixture provenance and are never remote evidence.
 *   otherwise                                the public relay: a request pinned to a public DNS answer and a public IP, public vantage only.
 *                                            A tailnet or LAN vantage has no executor, so its proof stays unverified.
 */
export function sessionProbeExecutor({ runtime, gate, now }) {
  if (runtime.probeExecutor) return runtime.probeExecutor;
  if (!runtime.dispatchEffect) return new PublicRelayVerifier();
  return { vantages: ['public', 'tailnet', 'lan'],
    async verify({ origin, vantage, authorization, requirements, signal }) {
      const checked = await gate.verify(origin, { sse: requirements.sse, signal, fetch: runtime.fetch });
      const observedAtMs = now();
      return { probeReceipt: { nonceRef: authorization.nonceRef, verifierRef: authorization.verifierRef, origin, vantage, remote: true, observedAtMs,
        expiresAtMs: Math.min(observedAtMs + 15000, authorization.expiresAtMs), tls: checked.tls, instanceMatched: checked.instanceMatched, sse: checked.sse,
        streamableHttp: false, oauthDcr: false }, provenance: { kind: 'explicit-fixture-effects' } };
    } };
}

/**
 * The effect context's `executePlan` / `compareAndRemove` for one session.
 *   directory      the session directory (the journal lives beside the controller's own files)
 *   gate           () => the controller's gate: the recipe forwards to it, never to the app
 *   runtime        the controller's runtime (fixture `dispatchEffect` and `fetch` for tests, `hostAuthorities`, a host's `probeExecutor`)
 *   onProviderLoss called when an owned process exits on its own; the controller withdraws and removes the route
 */
export function sessionRecipeEffects({ adapter, readContext, request, handle, directory, gate, runtime = {}, operationId = null, owner = null, generation = 1, onProviderLoss }) {
  let live = null, journal = null, reservedPorts = [];
  const definition = adapter.operationalDefinition;
  if (definition?.planVersion !== 1 || definition.ownership !== 'owned' || !definition.recipes?.create)
    return { executePlan: async () => { throw gozarError('unsupported', `${adapter.id} has no admitted operational create plan`); }, compareAndRemove: async () => { throw gozarError('unsupported', `${adapter.id} has no admitted operational remove plan`); } };

  const fixture = request => {
    const operations = adapter.definition.effectOperations ?? [];
    if (!operations.some(row => row.kind === request.kind && row.operation === request.operation)) throw gozarError('unsupported', 'The adapter has not declared this fixture effect operation');
    return runtime.dispatchEffect(request);
  };

  async function allocate(plan) {
    const port = Number(request.target.slice(request.target.lastIndexOf(':') + 1));
    const home = dirname(directory);
    const sessionId = handle.id.split(':').slice(1).join(':');
    const receipt = (candidate = null) => ({ schemaVersion: 1, adapterId: adapter.id, resourceKey: plan.resourceKey, generation,
      identity: { kind: 'session-recipe', sessionId, resourceIds: Object.keys(journal?.value.owned ?? {}) }, readback: { ...plan.readback, origin: candidate ?? plan.readback.origin }, origin: candidate });
    // A refusal that came before anything was allocated: the same receipt removes nothing and ends confirmed, so the controller does not linger as a cleanup channel.
    const refused = error => runtimeFailure(Object.assign(error, { cleanupReceipt: receipt() }));
    await retireInstallKeyLease(home, directory);
    // This controller process holds the provider ports this session may take, so a durable route cannot take one and a second session
    // names this one as the holder. A session may take any one of its ports: it is refused only when a durable route holds every one.
    const providerPort = definition.bindings?.port;
    reservedPorts = providerPort ? (providerPort.value !== undefined ? [providerPort.value] : providerPort.candidates ?? []) : [];
    try {
      await reserveSession({ home, port, providerResource: definition.providerResource ?? null, providerPorts: reservedPorts });
    } catch (error) {
      if (error.code !== 'reserved') throw error;
      throw refused(gozarError('route_conflict', 'A durable route already holds this listener or every provider port this route may use. Existing listeners were left untouched.',
        instructionAction('free-route-port', 'Release the durable route', 'Stop the durable route that holds the port (`gozar status` lists it), then start this route again.')));
    }
    journal = new Journal(directory); await journal.load();
    // An earlier session of this port that never stopped is retired first, from its journal. Only then may a new one allocate.
    if (journal.value.state && journal.value.snapshot?.phase !== 'stopped') {
      const recovered = await recoverStop(directory);
      if (!stopped(recovered, journal)) throw runtimeFailure(gozarError('cleanup_debt', 'Previous session has unresolved cleanup. Stop it first.', instructionAction('stop-session', `Stop the session on port ${port}`, `Run: ${cliCommand('stop', port, home)}`)));
      await journal.load();
    }
    if (Object.keys(journal.value.owned).length) throw runtimeFailure(gozarError('cleanup_debt', 'Cleanup remains pending; stop the recorded session before restarting', instructionAction('stop-session', `Stop the session on port ${port}`, `Run: ${cliCommand('stop', port, home)}`)));
    await journal.save({ operationId, owner });
    const catalog = await loadCatalog(root, { operational: true });
    const adapters = [...catalog.filter(item => item.id !== definition.id), definition];
    const wanted = request.requirements;
    const requirements = { clientReach: wanted.reach, httpsRequired: wanted.transport === 'https', sse: wanted.protocols.includes('sse'),
      streamableHttp: wanted.protocols.includes('streamable-http'), oauthDcr: wanted.protocols.includes('oauth-dcr') };
    const choices = typeof adapter.hostChoices === 'function' ? await adapter.hostChoices(readContext) : {};
    const target = gate();
    const allocation = new SessionAllocation({ step: await loadCore(), journal, adapters, requirements, targetPort: target.port, servicePort: port, sessionId,
      origin: request.origin ?? plan.origin ?? undefined, ...(choices ?? {}), onProviderExit: async () => { await onProviderLoss?.(); } });
    allocation.driver.lifetimeMs = target.lifetimeMs;
    if (runtime.dispatchEffect) {
      allocation.driver.fixtureForward = fixture;
      allocation.driver.interfaceInventory = fixtureInterfaceObserver(adapter.interfaceRecipe, fixture);
      allocation.driver.spawnProcess = fixtureSpawn(fixture);
    }
    live = allocation;
    // From here an owned effect may exist, so no failure leaves without the exact receipt that lets the controller remove it: the receipt names
    // the session and the journal's owned resources, and removal reads the saved journal, not this process's memory. An unexpected error
    // (a failed journal write, a core fault) becomes the generic provider failure, as the adapter wrapper would have made it, and carries that receipt.
    try {
      await prepareHost(allocation.driver, definition, { origin: request.origin ?? plan.origin ?? undefined, gate: target, authorities: runtime.hostAuthorities,
        probeExecutor: sessionProbeExecutor({ runtime, gate: target, now: () => allocation.driver.nowMs() }) });
      await allocation.command({ type: 'detect' });
      await allocation.command({ type: 'recommend' });
      // Another session holding this installation key is a route conflict the app can act on; it is refused before the provider is touched.
      const started = await allocation.command({ type: 'start', adapterId: definition.id, consent: true }).catch(error => { throw error?.code === 'route_conflict' ? refused(error) : error; });
      if (!allocation.heldProbe || !started.snapshot.candidate) {
        // Nothing was announced. The controller removes through the same receipt, so a start that changed nothing ends confirmed and one that did stays debt.
        const failure = await sessionStartFailure(started.snapshot, { home, adapterId: adapter.id, loadDefinitionFor: runtime.loadDefinition, portHoldersOf: runtime.portHolders, sessionPort: port });
        throw runtimeFailure(Object.assign(failure, { cleanupReceipt: receipt() }));
      }
      // The origin names the one provider port this session took; the other candidates are free again for others.
      const taken = Number(new URL(started.snapshot.candidate).port);
      if (reservedPorts.length > 1 && reservedPorts.includes(taken)) await narrowSessionReservation({ home, port, providerPorts: [taken] }).catch(() => {});
      return receipt(started.snapshot.candidate);
    } catch (error) {
      if (error?.cleanupReceipt) throw error;
      throw runtimeFailure(Object.assign(gozarError('provider_unavailable', 'The route could not be started'), { cleanupReceipt: receipt() }));
    }
  }

  async function remove(receipt) {
    // The receipt must name this session and this adapter before anything is read or removed, and a journal recovered from the directory must be
    // this session's own: a receipt or directory that belongs to another allocation changes nothing and leaves the debt where it is.
    const sessionId = handle.id.split(':').slice(1).join(':');
    const unbound = { removed: false, debt: { message: 'The removal receipt does not belong to this session; nothing was changed' } };
    if (receipt?.adapterId !== adapter.id || receipt.identity?.kind !== 'session-recipe' || receipt.identity.sessionId !== sessionId) return unbound;
    let result;
    try {
      if (live && live.sessionId === sessionId) result = await live.shutdown();
      else {
        const saved = new Journal(directory); await saved.load();
        if (saved.value.state && saved.value.state.sessionId !== sessionId) return unbound;
        result = await recoverStop(directory);
      }
    } catch (error) {
      if (error.code === 'route_not_found') return { removed: true, debt: null };
      throw error;
    }
    journal ??= new Journal(directory);
    await journal.load();
    return stopped(result, journal) ? { removed: true, debt: null }
      : { removed: false, debt: { message: 'The recorded owned resource could not be proven removed; retain this handle' } };
  }

  // The proof the session controller requests after the host acknowledged `origin`. What the driver refused, this refuses (it throws).
  // The fixture's loopback transport is not remote evidence, so a fixture receipt reports this-device whatever vantage the core asked for.
  async function prove({ origin, signal, deadlineMs }) {
    if (!live) throw gozarError('verification_failed', 'No allocation is held for this session');
    const result = await live.prove({ origin, signal, deadlineMs });
    return { vantage: result.provenance?.kind === 'explicit-fixture-effects' || result.vantage === 'local' ? 'this-device' : result.vantage };
  }

  return {
    executePlan: plan => allocate(plan),
    compareAndRemove: (receipt) => remove(receipt),
    prove,
  };
}
