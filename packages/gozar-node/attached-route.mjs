// Attached routes: one provider runtime held by a Gozar controller process, for as long as the process that
// asked for it holds the lease.
//
//   owner (the calling process)  --heartbeat every 5 s, unref'd timer-->  controller (detached child)
//                                                                          holds adapter.create's runtime
// The controller removes the route 20 s after the last heartbeat, or at once on closeRoute. A crashed owner
// therefore costs at most the expiry. Owner loss is final: forwarding closes, one bounded removal is attempted,
// and the controller exits with whatever it still owes (resource or configuration reference) in its journal.
// A foreground CLI owner can run the controller in its own process and hold the lease on stdin instead (runAttachedController with lease 'stdin'): EOF removes the route at once.
// openSessionRoute is the same redemption over the existing session machinery.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { readFile, chmod, unlink, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicWrite, processIdentity } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, withExclusiveLock } from './service-state.mjs';
import { gozarError, instructionAction, normalizeError } from './error-normalizer.mjs';
import { cleanupRecovery } from './embedding-projections.mjs';
import { cliCommand } from './cli-command.mjs';
import { createGate } from './gate.mjs';
import { projectAttached, projectSession, releasedView, recoveryHistory, checkRef, projectControllerObservation, unknownProperties } from './route-view.mjs';
import { validateQuery, adapterRequest, readContextFor, loadRuntime, consentDisclosureRevision,inspectAdapter } from './route-catalog.mjs';
import { supportedPlatform } from './platform.mjs';
import { bindConfiguration } from './adapter-configuration.mjs';
import { recordController, controllerAlive, stopController, withCleanupOutcome } from './controller-start.mjs';
import { routeConsentReview,consentSnapshot,canonicalConsentValue } from './consent-facts.mjs';
import { completeProperties, checksFor } from './route-view.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { startEmbeddingBroker, connectEmbeddingBroker } from './embedding-broker.mjs';
import {testingFetch} from './testing-network.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';
import {ownershipFor,planMatchesOwnership,validateShape} from './adapter-runtime.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {capabilityPrerequisites} from './embedding-prerequisites.mjs';
import {releaseRecordedConfigurationUse} from './runtime-configuration-use.mjs';

export const HEARTBEAT_MS = 5_000;
// Shared by initial verification and custom proof refresh; a previous or future
// observation cannot establish readiness for the current verification attempt.
export function proofObservedDuring(checked, started, ended) {
  const observed = Date.parse(checked?.checkedAt);
  return Number.isFinite(observed) && observed >= started && observed <= ended;
}
export const LEASE_EXPIRY_MS = 20_000;
// After the owner is lost, owned removal gets this long, and each local forwarding close gets LOCAL_CLOSE_MS.
// The controller then exits whatever is still owed; the debt stays in its journal.
const OWNER_LOSS_TEARDOWN_MS = 30_000, LOCAL_CLOSE_MS = 5_000;
const within = (ms, work) => { let timer; return Promise.race([Promise.resolve().then(work).then(() => true, () => false), new Promise(resolve => { timer = setTimeout(resolve, ms, false); })]).finally(() => clearTimeout(timer)); };
const idPattern = /^att_[0-9a-f]{16}$/;
const here = fileURLToPath(import.meta.url);

// --- Redemption, shared by attached and session usage -------------------------------------------

function checkExpose(request, kind) {
  validateQuery({ ...request, usage: request?.usage });
  if (request.usage.kind !== kind) throw gozarError('invalid_input', `This call opens ${kind} usage only`);
  if (typeof request.approval?.candidateToken !== 'string' || !request.approval.candidateToken || typeof request.approval.disclosureRevision !== 'string' ||
      !request.approval.disclosureRevision) throw gozarError('consent_required', 'Approval is required: pass the candidate token and the disclosure revision the user saw');
  if (!['allocated', 'verified'].includes(request.wait)) throw gozarError('invalid_input', "wait must be 'allocated' or 'verified'");
}

// Static availability is an execution boundary, not an approval. Never redeem or
// inspect provider state to reject a named detect-only choice.
export async function preflightExpose(request, deps = {}) {
  validateQuery(request);
  if (!['attached', 'session'].includes(request.usage.kind) ||
      !['allocated', 'verified'].includes(request.wait))
    throw gozarError('invalid_input', 'expose needs attached/session usage and allocated/verified wait');
  if (request.providerId !== undefined) {
    const adapter = (await adaptersOf(deps)).find(item => item.id === request.providerId);
    const availability = adapter?.definition.availability?.[request.usage.kind]?.state;
    if (adapter && (!adapter.definition.supportedKinds.includes(request.usage.kind) ||
        availability === 'detect-only' || availability === 'unsupported'))
      throw gozarError('unsupported', 'This usage is not admitted for execution in this release');
  }
  checkExpose(request, request.usage.kind);
}

async function adaptersOf(deps) {
  if (deps.adapters) return deps.adapters;
  const runtime = await loadRuntime();
  if (!runtime) throw gozarError('internal_error', 'The adapter registry is not available in this build');
  return runtime.loadAdapters();
}

/**
 * Spends the approval's token (single use, whatever the outcome) and re-observes. A token whose plan digest or
 * observed resource moved fails with candidate_stale and changes nothing.
 */
export async function redeemApproval(request, deps) {
  const home = await canonicalHome(request.home, true);
  const tokens = deps.redeem && deps.consentBinding ? null : await import('./consent-token.mjs');
  const { approval, wait, ...query } = request;

  function requireAdmissibleAdapter(adapter) {
    if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available; ask the catalog again');
    if (approval.disclosureRevision !== consentDisclosureRevision(adapter.definition, query.intent)) throw gozarError('candidate_stale', 'Consent-relevant facts changed after approval; ask the catalog again');
    if (!adapter.definition.supportedKinds.includes(request.usage.kind)) throw gozarError('unsupported', 'This route does not support that usage');
    if(adapter.definition.availability?.[request.usage.kind]?.state==='detect-only'||adapter.definition.availability?.[request.usage.kind]?.state==='unsupported')throw gozarError('unsupported','This usage is not admitted for execution in this release');
    const denied=capabilityPrerequisites(adapter.definition,deps.hostCapabilities??{}).find(p=>p.state!=='present');
    if(denied)throw gozarError(denied.state==='denied'?'host_policy_denied':'unsupported','The host has not authorized a required capability');
    const ownership = ownershipFor(adapter.definition);
    if (ownership === 'external-owned' && query.usage.kind === 'attached') throw gozarError('candidate_stale', 'An attached controller needs a Gozar-owned plan');
    return ownership;
  }

  function requireCurrentConsent(configuration, detected) {
    const declared=completeProperties(adapter.properties(detected.facts),adapter.definition,query.usage.kind);
    const properties={...declared,proof:{...declared.proof,checks:checksFor(declared.proof.checks,{sse:query.requirements.protocols.includes('sse')})}};
    const consentReview=routeConsentReview({registryId:deps.registryId,providerId:adapter.id,usage:query.usage,configuration,target:query.target,origin:query.origin,ownership,properties,
      disclosure:{...adapter.definition.disclosure,revision:approval.disclosureRevision},facts:catalogFactsFor({adapter,facts:detected.facts})});
    if(approval.kind!=='route'||approval.consentFactsDigest!==consentReview.consentFactsDigest||grant.consentFactsDigest!==consentReview.consentFactsDigest)throw gozarError('consent_mismatch','Route consent changed; review the current candidate again');
    return consentReview;
  }

  function requireFreshPlan(plan, observed) {
    if (!planMatchesOwnership(plan, ownership) || (ownership === 'external-owned' && plan.origin !== grant.origin) ||
        plan.digest !== grant.planDigest || observed.resourceKey !== grant.observedResource)
      throw gozarError('candidate_stale', 'The provider changed after the user approved; nothing was changed, ask the catalog again');
  }

  const binding = (deps.consentBinding ?? tokens.consentBinding)(query, home, approval.disclosureRevision,approval.consentFactsDigest);
  const grant = await (deps.redeem ?? tokens.redeemConsentToken)({ home, token: approval.candidateToken, binding, providerId: query.providerId });
  const adapter = (await adaptersOf(deps)).find(item => item.id === grant.adapterId);
  const ownership = requireAdmissibleAdapter(adapter);
  const context = bindConfiguration({...await readContextFor(deps, home, deps.platform ?? process.platform,query.owner),origin:query.origin??null}, adapter.id);
  let consentReview;
  if(deps.embeddingServices){
    const configuration=await deps.embeddingServices.readConfiguration({home,owner:query.owner,providerId:adapter.id});
    const detected=await adapter.detect(context);
    consentReview = requireCurrentConsent(configuration, detected);
  }
  const adapterAsk = adapterRequest(query);
  const plan = await adapter.plan(context, adapterAsk);
  const observed = await adapter.observe(context, adapterAsk);
  requireFreshPlan(plan, observed);
  return { home, adapter, grant, plan, request: adapterAsk, context, consentReview };
}

// --- The control channel (owner <-> controller): one JSON line each way, authenticated by a private nonce ---

export function controlAttached(directory, command, timeoutMs = 15_000, {
  readControl = readFile, identify = processIdentity, connect = path => net.createConnection(path),
  setDeadline = setTimeout, clearDeadline = clearTimeout,
} = {}) {
  return new Promise((resolve, reject) => {
    let output = '', settled = false, socket;
    const finish = (error, value) => { if (settled) return; settled = true; clearDeadline(deadline); socket?.destroy(); error ? reject(error) : resolve(value); };
    const deadline = setDeadline(() => finish(gozarError('provider_unavailable', 'The route controller did not answer in time')), timeoutMs);
    readControl(join(directory, 'control.json'), 'utf8').then(async text => {
      const identity = JSON.parse(text);
      if(command.type==='observe'){
        if(!Number.isInteger(identity.pid)||!identity.startIdentity)
          throw gozarError('route_conflict','Incomplete controller process identity');
        const actual=await identify(identity.pid);
        if(!actual)throw Object.assign(new Error('The route controller is not running'),{gone:true});
        if(actual!==identity.startIdentity)throw gozarError('route_conflict','Controller process identity changed');
      } else if (!identity.startIdentity || await identify(identity.pid) !== identity.startIdentity) {
        throw Object.assign(new Error('The route controller is not running'), { gone: true });
      }
      // Identity preparation can outlive the deadline. Never open a late socket.
      if (settled) return;
      socket = connect(join(directory, 'control.sock'));
      socket.once('connect', () => socket.write(`${JSON.stringify({ nonce: identity.nonce, command, ...(command.type==='observe'?{controllerIdentity:{pid:identity.pid,startIdentity:identity.startIdentity}}:{}) })}\n`));
      socket.on('data', chunk => {
        output += chunk;
        if (output.length > 1_048_576) return finish(gozarError('internal_error', 'The controller reply is too large'));
        if (!output.includes('\n')) return;
        try {
          const reply = JSON.parse(output.split('\n')[0]);
          reply.error ? finish(gozarError(reply.error.code, reply.error.message)) : finish(null, reply);
        } catch (error) { finish(error); }
      });
      socket.on('error', error => finish(Object.assign(error, { gone: true })));
      socket.on('end', () => finish(Object.assign(new Error('The controller closed without a reply'), { gone: true })));
    }).catch(error => finish(Object.assign(error, { gone: error.gone ?? error.code === 'ENOENT' })));
  });
}

// --- The owner's side ---------------------------------------------------------------------------

const leases = new Map();
const brokers = new Map();
const localKey = (home, {kind,id,generation}) => JSON.stringify([home,kind,id,generation]);
function holdLease(directory, id, heartbeatMs, owner) {
  const beat = () => controlAttached(directory, { type: 'heartbeat' }, 5_000).catch(() => {});
  // Unref'd: the lease never keeps the owner alive. When the owner exits the beats stop and the expiry ends the route.
  const timer = setInterval(beat, heartbeatMs); timer.unref();
  leases.set(id, {timer,owner}); beat();
}
function dropLease(id) { clearInterval(leases.get(id)?.timer); leases.delete(id); }
async function dropBroker(id){const entry=brokers.get(id);brokers.delete(id);await entry?.broker.close();}

// Fixture-host disposal is not route removal. Only resources created with
// this exact effect dispatcher are ours, independent of a route's debt.
export async function disposeTestingRouteHosts(owner) {
  if (typeof owner !== 'function') return;
  for (const [id, entry] of leases) if (entry.owner === owner) dropLease(id);
  const results = await Promise.allSettled([...brokers]
    .filter(([,entry]) => entry.owner === owner)
    .map(([id]) => dropBroker(id)));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}

async function attachedRoot(home, create = true) {
  const directory = join(home, 'attached');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}
// A status or close never creates state: a missing home or directory is simply no such route.
const routeDirectory = async (home, handle) => {
  if(typeof handle==='string')handle={kind:handle.startsWith('port-')?'session':'attached',id:handle,generation:1};
  const id=handle.id;
  if (handle.kind==='session') {
    const record=await genericSessionRecord({home,handle});
    if (!record) throw gozarError('route_conflict','This session was recorded by an earlier Gozar version; this version does not run its controller');
    return record.directory;
  }
  if (!idPattern.test(id)) throw gozarError('route_not_found', 'Not an attached route id');
  try { return join(await attachedRoot(await canonicalHome(home), false), id); }
  catch (error) { throw error.code === 'ENOENT' ? gozarError('route_not_found', 'No such attached route') : error; }
};
const readJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

async function startFailure(directory,deps,request) {
  const failure = await readJson(join(directory, 'failure.json'));
  if(failure?.nextAction?.kind==='provide-secret'&&deps?.decorateSetupAction&&deps.embeddingServices){
    const bootstrap=await readJson(join(directory,'bootstrap.json')),adapter=(await adaptersOf(deps)).find(a=>a.id===bootstrap.adapterId);
    const configuration=await deps.embeddingServices.readConfiguration({home:request.home,owner:request.owner,providerId:adapter.id});
    const inspection=await inspectAdapter(adapter,await readContextFor(deps,request.home,deps.platform??process.platform,request.owner),deps.platform??process.platform);
    const action=inspection.actions.find(a=>a.id===failure.nextAction.id&&a.digest===failure.nextAction.digest);
    if(action)failure.nextAction=deps.decorateSetupAction({action,adapter,configuration,inspection});
  }
  return failure ? gozarError(failure.code, failure.message,failure.nextAction??null) : null;
}

/** Opens one attached route and returns its RouteView. The calling process holds the lease from here on. */
export async function openAttachedRoute(request, deps = {}) {
  await preflightExpose(request, deps);
  try {
    const session = deps.sessionExecution;
    checkExpose(request, session ? 'session' : 'attached');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const localHome = await canonicalHome(request.home, true);
    const root = await attachedRoot(localHome);
    const id = session?.handle.id ?? deps.reservedHandle?.id??`att_${randomBytes(8).toString('hex')}`;
    const directory = session?.directory ?? join(root, id);
    const handle = session?.handle ?? {kind:'attached',id,generation:1};
    const hostKey = localKey(localHome,handle);
    // Redeem, re-observe and start the controller under one reservation, so two opens cannot both win one resource.
    const controller = await withExclusiveLock(join(root, '.open.lock'), async () => {
      const redeemed = session?.redeemed ?? await redeemApproval(request, { ...deps, adapters }).catch(error => { throw refusedBeforeStart(error, handle, request); });
      // A published attached directory always holds its complete recovery pair: it is built in a private staging name no listing
      // enumerates, then renamed into place. The durable host registration follows that publication, so a hidden stale staging
      // directory owes no registered use and every registered use has exact published custody. A session keeps its own directory,
      // its own lifecycle and its registration inside the broker setup, where the session authority model keeps it.
      const staging = session ? null : join(root, `.staging-${id}-${randomBytes(6).toString('hex')}`);
      const cut = async stage => { await deps.publicationCut?.(stage); };
      let broker, identity, bootstrap = null, published = false, hostTouched = false;
      let hostRegistered = false;
      try {
      if (session) {
        await trustedDirectory(directory, true);
        await privateDirectory(directory);
        const prior=await readJson(join(directory,'bootstrap.json'));
        if(prior) {
          const state=await readJson(join(directory,'state.json')),control=await readJson(join(directory,'control.json'));
          const live=control?.startIdentity&&await processIdentity(control.pid)===control.startIdentity;
          if(prior.execution!=='generic-session-v1'||state?.handle?.id!==prior.handle?.id||state?.handle?.generation!==prior.handle?.generation||state?.lastView?.cleanup?.state!=='confirmed'||live){
            const refusal=gozarError('route_conflict','A retained session already owns this directory');
            const retainedIdentity=prior.handle?.kind===handle.kind&&prior.handle.id===handle.id&&prior.handle.generation===handle.generation;
            throw retainedIdentity?refusal:refusedBeforeStart(refusal,handle,request);
          }
          for(const name of ['state.json','failure.json','control.json'])await unlink(join(directory,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
      } else {
        await cut('directory');
        await trustedDirectory(staging, true);
        await privateDirectory(staging);
      }
      if(deps.embeddingServices){
        hostTouched = true;
        const hostIdentity=await deps.embeddingServices.resolveIdentity({home:redeemed.home});
        broker=await startEmbeddingBroker({services:deps.embeddingServices,home:redeemed.home,identity:hostIdentity,
          dispatchEffect:deps.dispatchEffect,acknowledgeOrigin:deps.acknowledgeOrigin,onLoss:()=>{if(brokers.get(hostKey)?.broker===broker)void controlAttached(directory,{type:'resolver-lost'}).catch(()=>{});}});
        const descriptor=await broker.registerController({identity:hostIdentity});
        identity={instanceId:descriptor.instanceId,bootId:descriptor.bootId};
        brokers.set(hostKey,{broker,owner:deps.dispatchEffect});
      }
      bootstrap = { schemaVersion: 1, id, home: redeemed.home, platform: deps.platform ?? process.platform, adapterId: redeemed.adapter.id, request: redeemed.request, plan: redeemed.plan,
        operationId:request.operationId??null,
        ...(deps.acknowledgeOrigin ? { originAcknowledgment: true, originAckTimeoutMs: deps.originAckTimeoutMs ?? 10_000 } : {}),
        ...(deps.runtimeModules ? { runtimeModules: deps.runtimeModules } : {}),
        ...(session ? {execution:'generic-session-v1',handle,expiresAtMs:session.expiresAtMs} : {}),
        ...(broker?{resolver:broker.descriptor,identity,registryId:deps.registryId,owner:request.owner,consentReview:redeemed.consentReview,fixtureEffects:!!deps.dispatchEffect}:{}),
        ...(deps.registry ? { registry: deps.registry } : {}), leaseExpiryMs: deps.leaseExpiryMs ?? LEASE_EXPIRY_MS, ...(deps.controllerModule ? { controllerModule: deps.controllerModule } : {}) };
      if (session) {
        if(deps.embeddingServices){
          hostRegistered = true;
          await deps.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:redeemed.adapter.id,revision:redeemed.grant.configurationRevision,handle});
        }
        await atomicWrite(join(directory, 'bootstrap.json'), bootstrap);
      } else {
        await cut('bootstrap');
        await atomicWrite(join(staging, 'bootstrap.json'), bootstrap);
        // The recovery identity is persisted, authenticated by the bootstrap beside it, before any controller or provider effect can exist.
        await cut('state');
        await recordPendingStart(staging, JSON.parse(await readFile(join(staging, 'bootstrap.json'), 'utf8')));
        await cut('publish');
        await rename(staging, directory);
        published = true;
        const parent = await open(root, 'r');
        try { await parent.sync(); } finally { await parent.close(); }
        // Complete durable custody is published before the first durable host registration: a use that is
        // registered from here on is always recoverable from the final attached path.
        if(deps.embeddingServices){
          hostRegistered = true;
          await deps.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:redeemed.adapter.id,revision:redeemed.grant.configurationRevision,handle});
        }
      }
      await cut('spawn');
      const stderr=await open(join(directory,'controller-stderr.log'),fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_APPEND|fsConstants.O_NOFOLLOW,0o600);
      let child;
      try {
        await stderr.chmod(0o600);
        child = spawn(process.execPath, [here, '--controller', directory], { detached: true, stdio: ['ignore','ignore',stderr.fd],
          env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
        child.unref();
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      } finally {
        // Diagnostic disposal must not turn an already spawned controller
        // into a resource-free start refusal. Its ownership is returned below.
        await stderr.close().catch(()=>{});
      }
      // The owned ChildProcess is kept before any awaited identity lookup: once a child is spawned it is
      // potentially effectful, and no later failure can be treated as a start that refused before any effect.
      return { pid: child.pid, startIdentity: null, child };
      } catch (error) {
      if (brokers.get(hostKey)?.broker === broker) await dropBroker(hostKey); else await broker?.close().catch(() => {});
      if (session) {
        // A session registers the host's configuration reference before its controller exists. A failure after that registration owes a
        // release of the exact registered handle, or exact retryable debt in the session's own record; it must not leave an orphaned use.
        if (bootstrap && hostRegistered) {
          const view = await unwindUnstartedSession({ directory, bootstrap, services: deps.embeddingServices }).catch(() => null);
          if (view && !error.route) error.route = view;
        }
        throw error;
      }
      // No controller has run, so no provider effect exists. Release what the host registered, or keep exact debt for a later owner.
      if (bootstrap) {
        const view = await unwindUnstartedAttached({ directory, staging, published, bootstrap, services: deps.embeddingServices, hostRegistered }).catch(() => null);
        if (view && !error.route) error.route = view;
      }
      else if (!hostTouched) refusedBeforeStart(error, handle, request);
      throw error;
      } finally {
        if (!session && !published) await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    }, { waitSeconds: 30 });
    // The controller identity is recorded after the reservation ends, so the controller may already be
    // starting when the lookup fails. That is a post-spawn failure: stop the exact owned handle, let the
    // controller's own saved record state what exists, and never journal a refused start, a null receipt or
    // a confirmed absence in its place.
    try { Object.assign(controller, await recordController(controller.child, deps.identityRecorder ? { identity: deps.identityRecorder } : undefined)); }
    catch (error) {
      if (brokers.has(hostKey)) await dropBroker(hostKey);
      const stopped = await stopController(controller);
      const record = await readJson(join(directory, 'state.json')).catch(() => null);
      // Normalize before attaching, so the frozen surface error carries the teardown outcome and the
      // controller's saved view as historical recovery; teardown attests neither current proof nor provider absence.
      const carried = withCleanupOutcome(normalizeError(error), stopped);
      if (record?.lastView && !carried.route) carried.route = startupHistory(record, handle, 'Controller startup identity failed; historical evidence only, retain this handle for cleanup');
      throw carried;
    }
    if (!session) holdLease(directory, hostKey, deps.heartbeatMs ?? HEARTBEAT_MS, deps.dispatchEffect);
    const deadline = Date.now() + (deps.startTimeoutMs ?? 120_000);
    try {
      for (;;) {
        let reply;
        try { reply = await controlAttached(directory, { type: 'status', fresh: request.wait === 'verified', generation:handle.generation, handleId:handle.id }, 30_000); }
        catch (error) {
          if (!error.gone && error.code !== 'provider_unavailable') throw error;
          const failure = await startFailure(directory,deps,request);
          if (failure) throw failure;
          if (!await controllerAlive(controller)) throw gozarError('provider_unavailable', 'The route controller exited before it started the route');
        }
        const view = reply?.view;
        if (view && reply.startupComplete!==false && ['lost', 'released', 'uncertain'].includes(view.state)) throw (await startFailure(directory,deps,request)) ?? gozarError('provider_unavailable', 'The route could not be started');
        if (view?.routeState === 'expired') throw gozarError('verification_failed', 'The route proof expired before publication');
        if (view && reply.startupComplete!==false && (request.wait === 'verified' ? view.state === 'usable' && view.verification.status === 'verified' && view.published !== null : view.state !== 'creating')) return view;
        if (Date.now() >= deadline) throw gozarError(view?.state === 'unverified' ? 'verification_failed' : 'provider_unavailable',
          view?.state === 'unverified' ? 'The route did not pass verification in time' : 'The route did not start in time');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (error) {
      dropLease(hostKey);
      const cleanup=await controlAttached(directory, { type: 'close', generation:handle.generation, handleId:handle.id }, 60_000).catch(() => null);
      if (cleanup?.view) error.route=cleanup.view;
      if(cleanup?.view?.cleanup.state==='unconfirmed'){
        error.route=cleanup.view;
        throw error;
      }
      let retainedDebt=false;
      try {
        if(!cleanup){
          const recorded=await readJson(join(directory,'state.json'));
          if(recorded?.lastView){
            error.route=startupHistory(recorded, handle, 'Controller unavailable during startup; historical evidence only, retain this handle for cleanup');
            retainedDebt=recorded.lastView.cleanup?.state==='unconfirmed';
          }
        }
      } catch(recoveryError) { error=recoveryError; }
      // Only validated cleanup debt may retain the controller. A saved-record refusal still owes owned teardown.
      if(retainedDebt)throw error;
      const stopped=await stopController(controller);await dropBroker(hostKey);
      throw withCleanupOutcome(error, stopped);
    }
  } catch (error) { throw normalizeError(error); }
}

/**
 * Saved view after the controller was lost during startup. Stale publication, ingress and proof always clear; the controller's own
 * journaled cleanup confirmation for this exact handle survives, because it is evidence about the resource, not about the process.
 */
function startupHistory(record, handle, message) {
  const last = record.lastView;
  if (![record.handle, last?.handle].every(saved => saved?.kind === handle.kind && saved.id === handle.id && saved.generation === handle.generation))
    throw gozarError('route_conflict', 'Saved startup recovery does not match this route handle');
  return last.cleanup?.state === 'confirmed' ? releasedView(last, handle) : recoveryHistory(last, message);
}

async function viewFromRecord(directory, handle) {
  const state = await readJson(join(directory, 'state.json'));
  if (!state) throw gozarError('route_not_found', `No attached route ${handle.id}`);
  if (![state.handle, state.lastView?.handle].every(saved => saved?.kind === handle.kind && saved.id === handle.id && saved.generation === handle.generation))
    throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
  return state;
}

/**
 * Private authenticated controller observation; never asks for fresh proof or cleanup. The scope check binds home, handle,
 * generation and the controller's recorded owner; the controller itself checks its process identity and the same handle.
 * `asStatus` is the watch's and the internal close read's use of it (route-view.mjs): the caller is the host's own ordinary
 * status/watch request, which names no owner, so the recorded owner is the scope (a given owner must still equal it), and a
 * controller that is gone answers like `attachedStatus` does (released stays released), still without any effect.
 */
export async function observeAttachedRoute(request,{asStatus=false}={}) {
  const handle=checkRef(request);
  if(!['attached','session'].includes(handle.kind))throw gozarError('unsupported','Not a generic controller handle');
  const home=await canonicalHome(request.home,false),directory=await routeDirectory(home,handle);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  const bound=handle.kind==='attached'?{kind:'attached',id:bootstrap?.id,generation:1}:bootstrap?.handle;
  const owner=asStatus&&request.owner===undefined?bootstrap?.owner:request.owner;
  if(!bootstrap||bootstrap.home!==home||typeof owner!=='string'||owner!==bootstrap.owner||
      bound?.kind!==handle.kind||bound.id!==handle.id||bound.generation!==handle.generation)
    throw gozarError('route_conflict','Observation scope does not match the current controller');
  try {
    return (await controlAttached(directory,{type:'observe',handleKind:handle.kind,handleId:handle.id,generation:handle.generation})).view;
  } catch(error) {
    if(!error.gone&&(asStatus||error.code!=='provider_unavailable'))throw error;
    return recordedView(directory,handle,asStatus,'Current controller observation unavailable; historical evidence only');
  }
}

// What the saved record says when no controller answers: a finished route stays released, anything else is history only.
async function recordedView(directory,handle,releasedStaysReleased,message) {
  const state=await viewFromRecord(directory,handle);
  if(releasedStaysReleased&&(state.phase==='released'||state.lastView?.cleanup.state==='confirmed'))return releasedView(state.lastView,handle);
  return recoveryHistory(state.lastView,message);
}

/**
 * Whether this route's own controller can still move an unverified route to verified. Authenticated like an observation;
 * it never refreshes proof. A lost host resolver can never authorize another proof, and an initial-only proof cannot repeat
 * once settled. `undefined` means the route has no such authority (durable, owner-kept) or it could not be asked.
 */
export async function attachedReplayProgress(request) {
  const handle=checkRef(request);
  if(!['attached','session'].includes(handle.kind))return undefined;
  if(handle.kind==='session'&&!await genericSessionRecord(request))return undefined;
  try {
    const home=await canonicalHome(request.home,false),directory=await routeDirectory(home,handle);
    const reply=await controlAttached(directory,{type:'observe',handleKind:handle.kind,handleId:handle.id,generation:handle.generation});
    const progress=reply.progress;
    if(!progress)return undefined;
    return {viable:progress.resolverLost!==true&&(progress.initialSettled!==true||progress.refreshable===true)};
  } catch(error) {
    if(error.gone)return {viable:false};
    return undefined;
  }
}

/** Fresh proof from the controller. Without a controller the last record is all there is, and it says so. */
export async function attachedStatus(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle);
  try { return (await controlAttached(directory, { type: 'status', fresh: true, generation: handle.generation, handleId:handle.id }, 60_000)).view; }
  catch (error) {
    if (!error.gone) throw error;
    return recordedView(directory, handle, true, 'The route controller stopped before it removed the route');
  }
}

/** Ends the lease now: the controller removes the route and answers with the released view. */
export async function closeAttachedRoute(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle);
  const hostKey = localKey(await canonicalHome(request.home,false),handle);
  dropLease(hostKey);
  try { const result=(await controlAttached(directory, { type: 'close', generation: handle.generation, handleId:handle.id }, 120_000)).view;if(result.cleanup.state==='confirmed')await dropBroker(hostKey);return result; }
  catch (error) {
    if (!error.gone) throw error;
    const state = await viewFromRecord(directory, handle);
    if (state.phase === 'released'||state.lastView?.cleanup.state==='confirmed') return releasedView(state.lastView, handle);
    if (state.resourceRemoval) return recoveryHistory(state.lastView, 'Resource removed; exact configuration reference release remains unconfirmed');
    if (state.unstarted === true) {
      // A start whose controller never persisted past its first act cannot have run a provider effect: the
      // registered configuration reference is the only custody. Settle it exactly under the open lock; a
      // refused release stays recorded debt, never a fabricated confirmation.
      const settled = await settleUnstartedReference(request, directory, handle, deps);
      if (settled) return settled;
    }
    // A historical record without a removal receipt carries debt only. It
    // cannot authenticate provider recovery, and needs no bootstrap to say so.
    if (!state.receipt) return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
    const home=await canonicalHome(request.home,false);
    let root;
    try { root=await attachedRoot(home,false); }
    catch(error){
      if(error.code==='ENOENT')return recoveryHistory(state.lastView,'The route controller stopped before it removed the route');
      throw error;
    }
    return withExclusiveLock(join(root,'.open.lock'),async()=>{
      // Session replacement also needs this open lock. Re-read the exact owner
      // before touching its saved receipt, and do not recover a controller
      // that is still alive merely because its socket did not answer.
      const state=await viewFromRecord(directory,handle);
      if(state.phase==='released'||state.lastView?.cleanup.state==='confirmed')return releasedView(state.lastView,handle);
      if(state.resourceRemoval)return recoveryHistory(state.lastView,'Resource removed; exact configuration reference release remains unconfirmed');
      if(state.unstarted===true)return recoveryHistory(state.lastView,'The pending route start has not settled');
      const bootstrap=await readJson(join(directory,'bootstrap.json'));
      const bound=handle.kind==='session'?bootstrap?.handle:{kind:'attached',id:bootstrap?.id,generation:1};
      if(bootstrap?.home!==home||bootstrap.id!==handle.id||bootstrap.adapterId!==state.adapterId||
         bound?.kind!==handle.kind||bound.id!==handle.id||bound.generation!==handle.generation||
         (request.owner!==undefined&&bootstrap.owner!==request.owner))
        throw gozarError('route_conflict','Recovery scope does not match the retained route');
      const controlPath=join(directory,'control.json'),control=await readJson(controlPath);
      const controllerStillRunning=async value=>Number.isInteger(value?.pid)&&!!value.startIdentity&&
        await processIdentity(value.pid)===value.startIdentity;
      if(await controllerStillRunning(control))throw gozarError('route_conflict','The route controller is still running');
      const managed=['resolver','registryId','owner','consentReview'].some(key=>Object.hasOwn(bootstrap,key));
      if(managed&&(typeof bootstrap.owner!=='string'||!bootstrap.owner||typeof bootstrap.registryId!=='string'||!bootstrap.registryId))
        return recoveryHistory(state.lastView,'Exact configuration reference recovery scope is unavailable');
      // Without an owned receipt, retain debt without loading transient runtime. A session removes through the session recipe's
      // journal-only recovery (no gate, no create path); other routes need the effect context their caller supplies.
      const createSessionContext = handle.kind === 'session' ? (await loadRuntime())?.createAttachedEffectContext : null;
      const effectContext = deps.effectContext ?? (createSessionContext ? ({ adapter, readContext, generation }) => createSessionContext({ generation, adapter, readContext,
        session: { request: state.request, handle, directory, gate: () => { throw gozarError('internal_error', 'A dead controller has no gate'); }, runtime: {}, operationId: state.lastView?.operationId ?? null } }) : null);
      if (!state.receipt || !effectContext) return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
      // The controller died with the route up: remove it from the saved receipt, in this process.
      const adapters = await adaptersOf(deps);
      const adapter = adapters.find(item => item.id === state.adapterId);
      if (!adapter) return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
      const read = bindConfiguration(await readContextFor(deps, await canonicalHome(request.home), deps.platform ?? process.platform), adapter.id);
      const observed = await adapter.observe(read, state.request);
      const removal = await adapter.remove(bindConfiguration({ ...read, generation: state.handle.generation, ...effectContext({ adapter, readContext: read, request: state.request, plan: state.plan, generation: state.handle.generation }) }, adapter.id), state.receipt, observed);
      if(!removal.removed||removal.debt)
        return { ...releasedView(state.lastView, handle), state: 'uncertain', cleanup: { state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' } };
      const released=releasedView(state.lastView,handle);
      // Persist the provider removal before returning its successful receipt.
      // Managed routes still owe their exact configuration use until the host
      // cleanup continuation confirms release; do not mark that debt settled here.
      if(managed){
        const resourceRemoval={schemaVersion:1,registryId:bootstrap.registryId,owner:bootstrap.owner,providerId:adapter.id,handle:structuredClone(handle)};
        const lastView=recoveryHistory(released,'Resource removed; exact configuration reference release remains unconfirmed');
        await atomicWrite(join(directory,'state.json'),{...state,phase:'uncertain',lastView,resourceRemoval,receipt:null,recoveredRemoval:true});
      }else{
        await atomicWrite(join(directory,'state.json'),{...state,phase:'released',lastView:released,receipt:null,resourceRemoval:null});
      }
      const currentControl=await readJson(controlPath);
      if(Number.isInteger(control?.pid)&&currentControl?.pid===control.pid&&currentControl.startIdentity===control.startIdentity&&
         currentControl.nonce===control.nonce&&!await controllerStillRunning(currentControl))
        await unlink(controlPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
      return released;
    },{waitSeconds:30});
  }
}

export async function reviewAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'review-consent',generation:handle.generation})).review;}
export async function approveAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'approve-consent',generation:handle.generation,approvalToken:request.approvalToken,consentFactsDigest:request.consentFactsDigest},60000)).view;}
export async function releaseAttachedConfiguration(request,{embeddingServices,registryId}){
  const handle=checkRef(request),directory=await routeDirectory(request.home,handle);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  await releaseRecordedConfigurationUse({registryId:bootstrap?.registryId,home:request.home,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle:{...handle,generation:1}},{embeddingServices,registryId});
  await dropBroker(localKey(await canonicalHome(request.home,false),handle));
}
export async function releaseSessionConfiguration(request,runtime){
  const generic=await genericSessionRecord(request);
  if(generic){await releaseRecordedConfigurationUse({registryId:generic.bootstrap.registryId,home:request.home,owner:generic.bootstrap.owner,providerId:generic.bootstrap.adapterId,handle:request.handle},runtime);await dropBroker(localKey(await canonicalHome(request.home,false),request.handle));return;}
  const handle=checkRef(request),directory=join(request.home,handle.id.split(':')[0]);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  if(bootstrap?.embedding?.handle.id!==handle.id)return;
  await releaseRecordedConfigurationUse({registryId:bootstrap.embedding.registryId,home:request.home,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle},runtime);
  await dropBroker(localKey(await canonicalHome(request.home,false),handle));
}
export async function sessionConsent(request,{approve=false}={}){
 const handle=checkRef(request);if(handle.kind!=='session')throw gozarError('unsupported','This handle is not a session');
 const generic=await genericSessionRecord(request);
 if(generic)return approve?approveAttachedConsent(request):reviewAttachedConsent(request);
 // A session recorded by an earlier version has no controller this version runs, so it has no current consent authority.
 throw gozarError('route_conflict','This session handle is stale or has no current consent authority');
}

/** Persisted dispatch, never provider-name inference or lookup-failure fallback. */
export async function genericSessionRecord(request) {
  const handle=checkRef(request);
  if(handle.kind!=='session')return null;
  if(!/^port-[0-9]+:[A-Za-z0-9_-]+$/.test(handle.id))throw gozarError('invalid_input','Invalid session handle');
  const directory=join(await canonicalHome(request.home),handle.id.split(':')[0]);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  if(bootstrap?.execution!=='generic-session-v1')return null;
  if(bootstrap.handle?.kind!=='session'||bootstrap.handle.id!==handle.id||bootstrap.handle.generation!==handle.generation)throw gozarError('route_conflict','This session handle is stale');
  return {directory,bootstrap};
}


/** Dispose controller ownership after exact recorded reference release. */
export async function finishCleanupController(request){
  const handle=checkRef(request);
  if(!['attached','session'].includes(handle.kind))return;
  const hostKey=localKey(await canonicalHome(request.home,false),handle);
  dropLease(hostKey);await dropBroker(hostKey);
  if(handle.kind==='session'&&!await genericSessionRecord(request))return; // An earlier version's session has no controller here to finalize.
  const home=await canonicalHome(request.home,false);
  const directory=handle.kind==='attached'?await routeDirectory(home,handle):join(home,handle.id.split(':')[0]);
  // The reference release is confirmed, so the controller may end. Its own persisted removal milestone, the handle, the generation
  // and its private nonce fence the order; a controller that is already gone has nothing left to end.
  try{await controlAttached(directory,{type:'finalize-removal',handleKind:handle.kind,handleId:handle.id,generation:handle.generation,
    ...(typeof request.owner==='string'?{owner:request.owner}:{})},30_000);}
  catch(error){if(!error.gone)throw error;}
}

/** Capture cleanup authority before close can retire the bootstrap. Not allocation identity. */
export async function attachedCleanupReference(request,runtime,operationReference=null) {
  const handle=checkRef(request);
  if(!['attached','session'].includes(handle.kind))return null;
  const home=await canonicalHome(request.home,false);
  const directory=handle.kind==='attached'?await routeDirectory(home,handle):join(home,handle.id.split(':')[0]);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  if(!bootstrap)throw gozarError('cleanup_debt','Cleanup authority is unavailable');
  if(typeof bootstrap.operationId==='string'){
    if(!operationReference)return null; // Standalone cleanup must not adopt operation-bound debt.
    if(operationReference.operationId!==bootstrap.operationId||operationReference.owner!==bootstrap.owner||
        operationReference.handle?.kind!==handle.kind||operationReference.handle.id!==handle.id||
        operationReference.handle.generation!==handle.generation)
      throw gozarError('route_conflict','Cleanup operation does not match its bootstrap');
  }else if(operationReference)throw gozarError('route_conflict','Cleanup bootstrap has no matching operation');
  const bound=handle.kind==='attached'?{kind:'attached',id:bootstrap.id,generation:1}:bootstrap.handle??bootstrap.embedding?.handle;
  // Only an unmarked native bootstrap predates managed custody. Missing or
  // null modern identity must not downgrade generic execution to legacy cleanup.
  // A proofSubject identifies a controller, not configuration ownership.
  if(handle.kind==='session'&&['execution','handle','owner','embedding'].every(key=>!Object.hasOwn(bootstrap,key)))return null;
  if(bound?.kind!==handle.kind||bound.id!==handle.id||bound.generation!==handle.generation)
    throw gozarError('route_conflict','Cleanup handle does not match its bootstrap');
  const registryId=bootstrap.registryId??bootstrap.embedding?.registryId;
  const owner=bootstrap.owner,providerId=bootstrap.adapterId;
  const {cleanupRegistryMatches}=await import('./registry-lineage.mjs');
  if(registryId!==runtime.registryId&&request.mode!=='remove')throw gozarError('cleanup_debt','Earlier registry recovery requires remove mode');
  if(typeof owner!=='string'||!owner||typeof providerId!=='string'||!providerId||!cleanupRegistryMatches(registryId,runtime)||
      (bootstrap.home??bootstrap.embedding?.request?.home)!==home)
    throw gozarError('cleanup_debt','Cleanup scope cannot be verified');
  if(request.owner!==undefined&&request.owner!==owner)throw gozarError('route_conflict','Cleanup owner does not match');
  return {home,owner,providerId,registryId,handle:structuredClone(handle)};
}

/** Persist the route view only after the caller has released its exact managed configuration use. */
export async function finalizeRecoveredRemoval(scope) {
  const {home,handle,owner,providerId,registryId}=scope;
  let directory;
  try { directory=handle.kind==='attached'?await routeDirectory(home,handle):join(home,handle.id.split(':')[0]); }
  catch(error){if(error.code==='route_not_found')return;throw error;}
  if(!(await readJson(join(directory,'state.json')))?.recoveredRemoval)return;
  const root=await attachedRoot(home,false);
  return withExclusiveLock(join(root,'.open.lock'),async()=>{
    const state=await readJson(join(directory,'state.json'));
    if(!state?.recoveredRemoval)return;
    const evidence=state.resourceRemoval;
    const matches=h=>h?.kind===handle.kind&&h.id===handle.id&&h.generation===handle.generation;
    if(!matches(state.handle)||!matches(state.lastView?.handle)||!matches(evidence?.handle))return;
    if(state.adapterId!==providerId||evidence.schemaVersion!==1||evidence.owner!==owner||
       evidence.providerId!==providerId||evidence.registryId!==registryId)
      throw gozarError('cleanup_debt','The recovered removal does not match released configuration use');
    const lastView=releasedView(state.lastView,handle);
    await atomicWrite(join(directory,'state.json'),{...state,phase:'released',lastView,resourceRemoval:null,recoveredRemoval:undefined});
  },{waitSeconds:30});
}

/** Only the controller's persisted post-removal receipt can advance metadata-only recovery. */
export async function attachedRemovalEvidence(request,scope) {
  const handle=checkRef(request);
  const directory=handle.kind==='attached'?await routeDirectory(scope.home,handle):join(scope.home,handle.id.split(':')[0]);
  const state=await readJson(join(directory,'state.json'));
  if(!state?.resourceRemoval)return null;
  const evidence=state.resourceRemoval;
  if(evidence.schemaVersion!==1||evidence.registryId!==scope.registryId||evidence.owner!==scope.owner||
      evidence.providerId!==scope.providerId||evidence.handle?.kind!==handle.kind||evidence.handle.id!==handle.id||
      evidence.handle.generation!==handle.generation||state.handle?.kind!==handle.kind||state.handle.id!==handle.id||state.handle.generation!==handle.generation||
      state.adapterId!==scope.providerId||state.lastView?.handle?.kind!==handle.kind||
      state.lastView.handle.id!==handle.id||state.lastView.handle.generation!==handle.generation)
    throw gozarError('cleanup_debt','Resource-removal evidence does not match cleanup scope');
  return {...state.lastView,handle:structuredClone(handle),state:'released',routeState:'inactive',
    published:null,ingress:null,verification:{...state.lastView.verification,status:'unverified'},cleanup:cleanupRecovery({state:'confirmed'},handle)};
}
// --- The controller -----------------------------------------------------------------------------

const credentialFreeOrigin = (value, properties, schemes) => {
  try { const url = new URL(value); const allowed = schemes ?? (properties?.transport === 'http' && ['lan', 'this-device'].includes(properties?.reach) ? ['http:'] : ['https:']);
    return allowed.includes(url.protocol) && !url.username && !url.password && ['', '/'].includes(url.pathname) && !url.search && !url.hash && url.hostname
      ? (url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin) : null; }
  catch { return null; }
};
// The origin the provider allocated at create is Receipt.origin (amendment 2); nothing else names a published address.
const portOf = target => Number(target.slice(target.lastIndexOf(':') + 1));
const retarget = (plan, from, to) => ({ ...plan, effects: plan.effects.map(effect => effect?.target === from ? { ...effect, target: to } : effect) });
const GATE_LIFETIME_MS = 2_147_483_647;

/**
 * An approval that is refused is refused before a controller, a configuration reference or a provider resource exists, so the operation
 * that reserved the handle owes no cleanup. The refusal carries that first-hand fact; an unrecorded refusal stays unconfirmed debt.
 */
function refusedBeforeStart(error, handle, request) {
  if (error && typeof error === 'object' && !error.route) {
    const lease = { target: request.target, state: 'released', origin: null, properties: unknownProperties(), ingress: null, identity: null,
      limits: { recommendedPollIntervalMs: 5_000, idleTimeoutMs: null }, checkedAtMs: null, cleanup: { state: 'confirmed' } };
    error.route = { ...projectAttached(lease, { handle, now: Date.now() }), operationId: request.operationId ?? null };
  }
  return error;
}

/**
 * The first durable state of an attached allocation: creating, no receipt, nothing published. It is written after the bootstrap
 * and before the controller starts, so a listing never sees a bootstrap without the state that binds it. `unstarted` is the
 * explicit pre-controller phase: the controller's first durable act retires it under the open lock, before any resolver or
 * provider effect, so while it is present no controller has ever persisted past its start and the registered configuration
 * reference is the only custody a later owner must recover. If no controller ever answers, the recorded view is read back as
 * unconfirmed history, never as a removal.
 */
async function recordPendingStart(directory,bootstrap){
  const handle={kind:'attached',id:bootstrap.id,generation:1};
  const lease={target:bootstrap.request.target,state:'creating',origin:null,properties:unknownProperties(),ingress:null,identity:bootstrap.identity??null,
    limits:{recommendedPollIntervalMs:5_000,idleTimeoutMs:null},checkedAtMs:null,cleanup:{state:'none'}};
  await atomicWrite(join(directory,'state.json'),{schemaVersion:1,adapterId:bootstrap.adapterId,request:bootstrap.request,plan:bootstrap.plan,receipt:null,handle,phase:'creating',unstarted:true,
    lastView:{...projectAttached(lease,{handle,now:Date.now()}),operationId:bootstrap.operationId??null,consentFactsDigest:bootstrap.consentReview?.consentFactsDigest??null},resourceRemoval:null});
}

/**
 * A controller's first durable act: retire the owner's pre-controller marker under the open lock, before any resolver,
 * provider or network effect. The owner's refused-start unwind and this retirement serialize on the same lock, and while
 * the marker is present no controller has ever persisted past this point, so settling the registered reference risks
 * no provider custody. A pending record that belongs to another bootstrap is refused, never adopted.
 */
async function clearPendingStart(directory,bootstrap){
  const handle={kind:'attached',id:bootstrap.id,generation:1};
  await withExclusiveLock(join(dirname(directory),'.open.lock'),async()=>{
    const state=await readJson(join(directory,'state.json'));
    // Close may win this lock while the spawned controller is still queued for its first act.
    if(state?.phase==='released'||state?.lastView?.cleanup?.state==='confirmed'||state?.resourceRemoval)
      throw gozarError('route_conflict','The pending attached start has already been closed');
    if(!state?.unstarted)return;
    if(state.handle?.kind!==handle.kind||state.handle.id!==handle.id||state.handle.generation!==handle.generation)
      throw gozarError('route_conflict','The pending start record does not match this bootstrap');
    await atomicWrite(join(directory,'state.json'),{...state,unstarted:undefined});
  },{waitSeconds:30});
}

/**
 * Fresh-owner recovery of the after-registration, before-spawn state, under the same open lock the owner's
 * start holds. The surviving pre-controller marker proves no controller ever persisted past its first act,
 * so the registered configuration reference is the only custody: release it exactly and journal a confirmed,
 * resource-free settlement, or keep the refused release as recorded debt. A record that changed meanwhile, or
 * one that no longer matches its bootstrap, is retained or refused, never adopted as evidence.
 */
async function settleUnstartedReference(request, directory, handle, deps) {
  const bootstrap = await readJson(join(directory, 'bootstrap.json'));
  if (bootstrap?.id !== handle.id || bootstrap.home !== await canonicalHome(request.home, false) ||
      typeof bootstrap.owner !== 'string' || !bootstrap.owner || typeof bootstrap.adapterId !== 'string' || !bootstrap.adapterId ||
      typeof bootstrap.registryId !== 'string' || !bootstrap.registryId)
    throw gozarError('cleanup_debt', 'Cleanup authority is unavailable for the unstarted binding');
  const resolver = { releaseConfigurationUse: use => releaseRecordedConfigurationUse({ registryId: bootstrap.registryId, home: bootstrap.home, ...use },
    { embeddingServices: deps.embeddingServices, registryId: deps.registryId }) };
  return await withExclusiveLock(join(dirname(directory), '.open.lock'), async () => {
    const current = await readJson(join(directory, 'state.json'));
    if (current?.unstarted !== true) return null;
    if (current.handle?.kind !== handle.kind || current.handle.id !== handle.id || current.handle.generation !== handle.generation ||
        current.receipt !== null || current.resourceRemoval)
      throw gozarError('route_conflict', 'The pending start record does not match its bootstrap');
    await recordRefusedStart(directory, bootstrap, resolver, () => false);
    const settled = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    return settled.lastView.cleanup.state === 'confirmed' ? settled.lastView
      : recoveryHistory(settled.lastView, 'Resource removal is not confirmed; retry close with the exact retained handle');
  }, { waitSeconds: 30 });
}

/**
 * A start refused before any adapter loaded has no provider resource to remove. This controller knows that first-hand, so the record
 * says so; only the configuration reference the host registered remains, and its release is confirmed or left as retryable debt.
 */
/**
 * An attached start that failed before its controller existed. Nothing ran, so the host's configuration reference is the only thing
 * to settle: released once and confirmed, or kept as exact debt in a complete published pair for a later owner to retry.
 */
async function unwindUnstartedAttached({directory,staging,published,bootstrap,services,hostRegistered=false}){
  const resolver={releaseConfigurationUse:use=>services.releaseConfigurationUse({home:bootstrap.home,...use})};
  if(!published){
    await trustedDirectory(staging,true);await privateDirectory(staging);
    await atomicWrite(join(staging,'bootstrap.json'),bootstrap);
  }
  const target=published?directory:staging;
  await recordRefusedStart(target,bootstrap,resolver,()=>false,hostRegistered);
  const state=JSON.parse(await readFile(join(target,'state.json'),'utf8'));
  // Confirmed removal of the only host reference leaves nothing to retain; an unconfirmed one is published as debt.
  if(!published&&state.lastView.cleanup.state==='confirmed')return state.lastView;
  if(!published)await rename(staging,directory);
  return state.lastView;
}

/**
 * A session start that failed after its host registration and before its controller ran. Nothing ran, so the registered reference is the only
 * thing to settle: released and confirmed, or kept as exact debt beside the complete bootstrap so a later close retries the exact handle.
 */
async function unwindUnstartedSession({directory,bootstrap,services}){
  const resolver={releaseConfigurationUse:use=>services.releaseConfigurationUse({home:bootstrap.home,...use})};
  await atomicWrite(join(directory,'bootstrap.json'),bootstrap);
  await recordRefusedStart(directory,bootstrap,resolver,()=>false,true);
  return JSON.parse(await readFile(join(directory,'state.json'),'utf8')).lastView;
}

async function recordRefusedStart(directory,bootstrap,resolver,lost,hostRegistered=true){
  const session=bootstrap.execution==='generic-session-v1';
  const handle=session?bootstrap.handle:{kind:'attached',id:bootstrap.id,generation:1};
  const managed=['resolver','registryId','owner','consentReview'].some(name=>Object.hasOwn(bootstrap,name));
  // Only a registration the owner attempted can owe a release: before it, nothing is registered and
  // nothing is retained. A release is exact and idempotent, so an attempt after a committed registration
  // is always safe whether or not the registration's own reply failed.
  let released=!managed||!hostRegistered;
  if(managed&&hostRegistered){
    try{
      if(lost()||!resolver||typeof resolver.releaseConfigurationUse!=='function'||typeof bootstrap.owner!=='string'||!bootstrap.owner||typeof bootstrap.registryId!=='string'||!bootstrap.registryId)throw new Error('reference release unavailable');
      await resolver.releaseConfigurationUse({owner:bootstrap.owner,providerId:bootstrap.adapterId,handle});released=true;
    }catch{released=false;}
  }
  const lease={...(session?{expiresAtMs:bootstrap.expiresAtMs}:{}),target:bootstrap.request.target,state:released?'released':'uncertain',origin:null,properties:unknownProperties(),ingress:null,identity:bootstrap.identity??null,
    limits:{recommendedPollIntervalMs:5_000,idleTimeoutMs:null},checkedAtMs:null,
    cleanup:released?{state:'confirmed'}:{state:'unconfirmed',message:'The start was refused before any provider code ran; configuration reference release remains unconfirmed'}};
  await atomicWrite(join(directory,'state.json'),{schemaVersion:1,adapterId:bootstrap.adapterId,request:bootstrap.request,plan:bootstrap.plan,receipt:null,handle,phase:lease.state,
    lastView:{...projectAttached(lease,{handle,now:Date.now()}),operationId:bootstrap.operationId??null,consentFactsDigest:bootstrap.consentReview?.consentFactsDigest??null},
    resourceRemoval:released?null:{schemaVersion:1,registryId:bootstrap.registryId,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle:structuredClone(handle)}});
}

/**
 * Runs one attached route to its end and resolves with the last RouteView. `runtime` supplies adapters and the
 * admitted effect context; `lease` is 'heartbeat' (a detached controller) or { kind: 'stdin', stream } (a foreground CLI owner).
 */
export async function runAttachedController(directory, runtime = {}) {
  const bootstrap = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
  // First durable act, before any resolver or provider effect: retire the owner's pre-controller marker.
  if (bootstrap.execution !== 'generic-session-v1') await clearPendingStart(directory, bootstrap);
  let resolverLost=false,onResolverLoss=()=>{};
  const resolver=bootstrap.resolver?await connectEmbeddingBroker({descriptor:bootstrap.resolver,identity:bootstrap.identity,onLoss:()=>{resolverLost=true;onResolverLoss();}}):null;
  // Adapter code from a changed registry is never loaded. The refusal is recorded first so the retained directory stays enumerable.
  if(bootstrap.registryId&&await registryIdentity(bootstrap.registry)!==bootstrap.registryId){
    await recordRefusedStart(directory,bootstrap,resolver,()=>resolverLost);
    throw gozarError('artifact_integrity_failed','The controller registry content changed');
  }
  if(resolver)runtime={...runtime,embeddingServices:resolver,owner:bootstrap.owner,...(bootstrap.fixtureEffects?{dispatchEffect:resolver.dispatchEffect.bind(resolver)}:{})};
  // The trusted host declaration of packaged runtime modules crosses as data; the detached controller
  // re-validates identity, version and load through the same shared helper as the host factory.
  if(bootstrap.runtimeModules)runtime={...runtime,runtimeModules:bootstrap.runtimeModules};
  if(bootstrap.fixtureEffects)runtime.fetch=testingFetch(runtime.dispatchEffect);
  const adapters = runtime.adapters ?? await (await loadRuntime())?.loadAdapters?.(bootstrap.registry);
  const adapter = adapters?.find(item => item.id === bootstrap.adapterId);
  if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available');
  const read = bindConfiguration(await readContextFor(runtime, bootstrap.home, bootstrap.platform), adapter.id);
  const now = runtime.now ?? Date.now;
  const expiryMs = bootstrap.leaseExpiryMs ?? LEASE_EXPIRY_MS;
  const session = bootstrap.execution==='generic-session-v1';
  const handle = session ? bootstrap.handle : { kind: 'attached', id: bootstrap.id, generation: 1 };
  if(session && (handle?.kind!=='session'||handle.id!==bootstrap.id||handle.generation!==1||!Number.isFinite(bootstrap.expiresAtMs)))throw gozarError('artifact_integrity_failed','Invalid persisted session identity or expiry');
  if(session && await readJson(join(directory,'state.json')))throw gozarError('route_conflict','This session has already attempted creation');
  const expired=()=>session&&now()>=bootstrap.expiresAtMs;
  const lease = { ...(session?{expiresAtMs:bootstrap.expiresAtMs}:{}), target: bootstrap.request.target, state: 'creating', origin: null, properties: adapter.definition.capabilities, ingress: null, identity:bootstrap.identity??null,
    limits: { recommendedPollIntervalMs: 5_000, idleTimeoutMs: null }, cleanup: { state: 'none' }, checkedAtMs: null };
  let receipt = null, lastBeat = now(), releasing = null, releasingAt = 0, failure = null, gate = null, proofSession = null,initialSettled=false;
  let ownerLost = false, gateClosing = null, proofClosing = null, localCloseUnconfirmed = false;
  const visibleLease = () => {
    if (!ownerLost) return lease;
    if (localCloseUnconfirmed) return { ...lease, state: 'uncertain', cleanup: { state: 'unconfirmed', message: 'Local forwarding closure remains unconfirmed; retain this recovery handle' } };
    return lease.state === 'usable' ? { ...lease, state: 'unverified' } : lease;
  };
  const nonce = randomBytes(32).toString('hex');
  const lastView = () => ({...projectAttached(expired()&&visibleLease().state==='usable'?{...visibleLease(),state:'unverified'}:visibleLease(), { handle, now: now() }),operationId:bootstrap.operationId??null,...(lease.consentChange?{consentChange:lease.consentChange}:{}),consentFactsDigest:lease.approvedReview?.consentFactsDigest??bootstrap.consentReview?.consentFactsDigest??null});
  let resourceRemoval=null;
  let saving = Promise.resolve();
  const save = () => saving = saving.catch(() => {}).then(() => atomicWrite(join(directory, 'state.json'), { schemaVersion: 1, adapterId: adapter.id, request: bootstrap.request, plan: bootstrap.plan,
    receipt, handle, phase: visibleLease().state, lastView: lastView(), resourceRemoval }));
  async function recordRemoval(){
    resourceRemoval={schemaVersion:1,registryId:bootstrap.registryId,owner:bootstrap.owner,providerId:adapter.id,handle:structuredClone(handle)};
    lease.state='uncertain';lease.cleanup={state:'unconfirmed',message:'Resource removed; configuration reference release remains unconfirmed'};
    await save();
  }

  const admitted = (runtime.effectContext ?? (await loadRuntime())?.createAttachedEffectContext)?.({ adapter, readContext: read, request: bootstrap.request, plan: bootstrap.plan, generation: 1,
    ...(session ? { session: { request: bootstrap.request, handle, directory, gate: () => gate, runtime, operationId: bootstrap.operationId ?? null, owner: bootstrap.owner ?? null,
      // An owned provider process that exits by itself ends the session through the same removal as an explicit close.
      onProviderLoss: async () => { await release(); if (lease.cleanup.state === 'confirmed') finish(); } } } : {}) });
  // The effect is admitted for generation 1: a new route. Receipts carry the generation create returns.
  const context = bindConfiguration({ ...read, generation: 1, ...(admitted ?? {}) }, adapter.id);

  // Publication validation. The provider forwards to a gate this controller runs in front of the app (the same
  // gate recipe routes use). Through the public origin the gate proves the origin reaches this instance and,
  // when the route claims SSE, that a timed stream arrives unbuffered. `verifyChallenge` is that proof, so
  // adapter.verify is the one verification path. `validation: 'none'` exists only for controller test modules.
  // A recipe session is proven by the driver's authorized-vantage probe (`admitted.prove`); every other route is proven from this device through the gate.
  const recipeSession = session && Boolean(adapter.operationalDefinition?.recipes?.create);
  // A recipe session is timed for SSE only when its request asked for SSE (the 0.5.1 session rule: the proof matches the requested protocols);
  // every other route is timed for what its provider claims.
  const claimsSse = recipeSession
    ? adapter.definition.capabilities?.protocols?.sse === true && bootstrap.request.requirements?.protocols?.includes('sse') === true
    : adapter.definition.capabilities?.protocols?.sse === true;
  const gateChecked = sse => async origin => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), sse ? 15_000 : 5_000);
    try {
      // A recipe session is proven through the driver's authorized-vantage probe (exact origin, the vantage the core asked for, this attempt's nonce, SSE,
      // protocols). Every other route is proven from this device through the gate.
      const vantage = recipeSession
        ? (await admitted.prove({ origin, signal: controller.signal, deadlineMs: bootstrap.expiresAtMs })).vantage
        : (await gate.verify(origin, { sse, signal: controller.signal, fetch: runtime.fetch }), 'this-device');
      return { status: 'verified', checkedAt: new Date(now()).toISOString(), vantage };
    }
    catch { return { status: 'unverified', checkedAt: new Date(now()).toISOString() }; }
    finally { clearTimeout(timer); }
  };
  const gated = runtime.validation !== 'none';
  const proofAbort = new AbortController();
  let attempt = { id: bootstrap.id, nonce: randomBytes(32).toString('hex'), deadlineMs: session?Math.min(bootstrap.expiresAtMs,now()+120000):now()+120000, signal: proofAbort.signal };
  onResolverLoss=()=>{if(!ownerLost&&!releasing&&lease.cleanup.state!=='confirmed'){lease.state='unverified';proofAbort.abort();void save().catch(()=>{});}};
  Object.assign(context,{signal:attempt.signal,deadlineMs:attempt.deadlineMs,attemptId:attempt.id,operationId:bootstrap.operationId??null});
  lease.approvedReview=bootstrap.consentReview??null;
  const reviewTokens=new Map();
  const safeRefresh=()=>!proofSession||typeof proofSession.refresh==='function';
  const proofAuthorityLost = () => ownerLost || Boolean(releasing) || resolverLost || proofAbort.signal.aborted;
  // Commands run concurrently on one controller and interleave at every await, so an observation also names the exact inputs it read
  // (proof, properties, runtime facts). A result computed from inputs another command has since replaced is dropped, never committed over the newer ones.
  const consentObservation = () => ({attempt, receipt, generation:handle.generation, approvedReview:lease.approvedReview,
    proof:lease.proof, properties:lease.properties, runtimeFacts:lease.runtimeFacts});
  const consentObservationCurrent = observed => !proofAuthorityLost() && !resourceRemoval && !expired() && observed.attempt===attempt &&
    observed.receipt===receipt && observed.generation===handle.generation && observed.approvedReview===lease.approvedReview &&
    observed.proof===lease.proof && observed.properties===lease.properties && observed.runtimeFacts===lease.runtimeFacts;
  const commitConsentEvidence = (observed, staged) => {
    if(!consentObservationCurrent(observed))return false;
    if(staged)lease.facts=staged.facts;
    return true;
  };
  // Before creation, derive current properties from inspection, not the lease's static defaults.
  async function currentConsent(runtimeFacts=receipt?{properties:lease.properties,facts:[...(lease.runtimeFacts??[]),...(lease.proof?.facts??[])]}:undefined){
    if(!lease.approvedReview)return null;
    const original=lease.approvedReview.canonicalInput;
    const current=await currentRouteReview({...bootstrap.request,home:bootstrap.home,owner:bootstrap.owner,origin:original.scope.query.expectedOrigin},adapter,
      {...runtime,embeddingServices:resolver,registryId:bootstrap.registryId,platform:bootstrap.platform},
      {runtimeFacts});
    return {review:current.review,facts:current.facts};
  }
  async function enforceConsent(){
    const observed=consentObservation();
    if(ownerLost||releasing)return false;
    if(resolverLost){lease.state='unverified';return false;}
    let current;
    try { current=await currentConsent(); }
    catch (error) { if(!consentObservationCurrent(observed))return false;await withdrawInvalidObservation();throw error; }
    if(!commitConsentEvidence(observed,current))return false;
    current=current?.review;
    if(current&&current.consentFactsDigest!==lease.approvedReview.consentFactsDigest){
      lease.state='unverified';lease.consentChange={oldDigest:lease.approvedReview.consentFactsDigest,newDigest:current.consentFactsDigest,
        nextAction:safeRefresh()?instructionAction('review-route-consent','Review changed route consent','Call reviewRouteConsent with this route handle, show the returned review and approveRouteConsent after approval.'):null,
        reason:safeRefresh()?'consent-changed':'proof-refresh-unsupported'};
      await save();return false;
    }
    if(lease.consentChange){lease.state='unverified';return false;}
    return true;
  }

  async function checkProof(sse) {
    const endpoint = lease.origin ?? receipt.origin;
    const started=now(),activeAttempt=attempt;
    const checked = proofSession ? await proofSession.verify({ origin: endpoint, receipt, attempt })
      : await adapter.verify(gated ? { ...read, verifyChallenge: gateChecked(sse) } : read, receipt);
    if (proofSession) {
      if (checked.attemptId !== attempt.id || checked.endpoint !== endpoint || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing || ownerLost) {
        return { ...checked, status: 'unverified' };
      }
    }
    const observed=Date.parse(checked.checkedAt);
    if(resolverLost||activeAttempt!==attempt||attempt.signal.aborted||releasing||ownerLost||now()>=attempt.deadlineMs||!proofObservedDuring(checked,started,now()))return {...checked,status:'unverified'};
    // The observation is staged until every common guard has passed: a stale, malformed or out-of-window observation leaves the prior proof and facts as they were.
    if (proofSession) {
      lease.proof = checked;
      lease.facts = [...new Map([...(adapter.definition.facts ?? []), ...(lease.runtimeFacts ?? []), ...(checked.facts ?? [])].map(fact => [fact.id, fact])).values()];
    }
    if(!proofSession)lease.proof={...checked,vantage:checked.vantage??'this-device',checks:checked.status==='verified'?[...(endpoint.startsWith('https:')?['tls']:[]),'nonce',...(sse?['sse']:[])]:[],validUntil:new Date(observed+15000).toISOString()};
    lease.proofSubject=bootstrap.identity?{origin:endpoint,target:bootstrap.request.target,...bootstrap.identity,handleGeneration:handle.generation}:null;
    return checked;
  }

  // The awaited exact-origin host boundary (0.5.2). When the embedding host declared `acknowledgeOrigin`, no
  // publication verification may run until the host has acknowledged THIS exact validated origin for this
  // route, generation and proof attempt, over the authenticated broker. A missing, refused, malformed,
  // stale, aborted or timed-out acknowledgment withdraws the route exactly like a failed verification: it
  // can never publish, never approve a foreign Host (any echo naming another origin, handle or attempt is
  // refused), never revive a lost owner, and never disturbs the retained cleanup receipt.
  const acknowledgeAllocatedOrigin = async origin => {
    if (!bootstrap.originAcknowledgment) return true;
    if (!resolver || resolverLost || ownerLost || releasing || expired()) return false;
    const request = { owner: bootstrap.owner, providerId: adapter.id,
      handle: { kind: handle.kind, id: handle.id, generation: handle.generation },
      operationId: bootstrap.operationId ?? null, target: bootstrap.request.target, origin, attemptId: attempt.id };
    const bounded = new Promise(resolve => { const timer = setTimeout(resolve, bootstrap.originAckTimeoutMs ?? 10_000, null); timer.unref?.(); });
    const aborted = new Promise(resolve => { if (proofAbort.signal.aborted) return resolve(); proofAbort.signal.addEventListener('abort', () => resolve(), { once: true }); });
    let reply;
    try { reply = await Promise.race([resolver.acknowledgeOrigin(request), bounded, aborted]); }
    catch { return false; }
    if (resolverLost || ownerLost || releasing || expired() || proofAbort.signal.aborted) return false;
    return reply?.acknowledged === true && reply.origin === origin &&
      reply.handle?.id === handle.id && reply.handle?.generation === handle.generation &&
      reply.attemptId === attempt.id;
  };

  async function withdrawInvalidObservation(){
    lease.state='unverified';lease.consentChange={reason:'runtime-observation-invalid',
      oldDigest:lease.approvedReview?.consentFactsDigest??'',newDigest:'',
      nextAction:safeRefresh()?instructionAction('review-route-consent','Review route consent','Obtain valid current provider observations, then review and approve route consent before publication can resume.'):null};
    reviewTokens.clear();await save();
  }
  // What the provider reports now: a consent review shows this, not what the last proof saw.
  async function refreshRuntimeFacts(){
    const observed=consentObservation();
    try {
      const facts=await adapter.runtimeFacts(read,receipt);
      const properties=canonicalConsentValue(facts.properties);
      if(validateShape('Properties',properties).length)throw gozarError('invalid_input','Invalid runtime properties');
      if(!consentObservationCurrent(observed))return;
      const staged=await currentConsent({properties,facts:[...(facts.facts??[]),...(lease.proof?.facts??[])]});
      if(!commitConsentEvidence(observed,staged))return;
      Object.assign(lease,{properties,binding:facts.binding,runtimeFacts:facts.facts??[],
        ...(!staged?{facts:[...new Map([...(adapter.definition.facts??[]),...(facts.facts??[]),...(lease.proof?.facts??[])].map(f=>[f.id,f])).values()]}:{})});
    } catch (error) {
      if(!consentObservationCurrent(observed))return;
      // Keep the last valid disclosures as history, but withdraw authority before refusing the observation.
      await withdrawInvalidObservation();throw error;
    }
  }
  let verification;
  function verify(){if(verification)return verification;verification=refreshProof().finally(()=>{verification=null;});return verification;}
  async function refreshProof() {
    if (expired()) { await release(); return; }
    if (!receipt || resourceRemoval || releasing || ownerLost || !initialSettled || failure || lease.cleanup.state==='confirmed') return;
    // Without the host resolver, retain a withdrawn recovery view instead of asking for fresh authority.
    if (resolverLost) { lease.state='unverified'; await save(); return; }
    await refreshRuntimeFacts();
    if(!await enforceConsent())return;
    if (proofAuthorityLost() || (proofSession && !proofSession.refresh)) return;
    try {
      attempt={id:randomUUID(),nonce:randomBytes(32).toString('hex'),deadlineMs:session?Math.min(bootstrap.expiresAtMs,now()+120000):now()+120000,signal:proofAbort.signal};
      if(!proofSession)gate?.rotate();
      const started = now();
      const verification = proofSession
        ? await proofSession.refresh({ origin: lease.origin, receipt, attempt })
        : await checkProof(false);
      if(proofAuthorityLost())return;
      if (proofSession) {
        if (verification.attemptId !== attempt.id || verification.endpoint !== lease.origin || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing) return;
        if (!proofObservedDuring(verification, started, now())) {
          // Retain the original evidence, but withdraw readiness on invalid time.
          lease.state = 'unverified';
          await save();
          return;
        }
        lease.proof = verification;
        lease.facts = [...(adapter.definition.facts ?? []), ...(verification.facts ?? [])];
      }
      if(!await enforceConsent()||proofAuthorityLost())return;
      lease.state = verification.status === 'verified' ? 'usable' : 'unverified'; lease.checkedAtMs = Date.parse(verification.checkedAt); lease.sseChecked = false; await save();
    } catch { if (!proofAuthorityLost()) { lease.state = 'unverified'; await save(); } }
  }
  async function removeRoute() {
    let observed;
    try{observed=await adapter.observe(read,bootstrap.request);}catch{observed={known:false,reason:'provider-observation-unavailable'};}
    return adapter.remove(context, receipt, observed);
  }
  const debtOf = removal => ({ state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' });
  // Control-ready barrier: the authenticated control channel (control.json) is published before the first provider
  // effect, so a caller can always reach, observe and close the controller that holds the allocation custody.
  let controlPublished; const controlReady = new Promise(resolve => { controlPublished = resolve; });
  const creation = (async () => {
    try {
      if(!await controlReady)throw gozarError('internal_error','The controller could not publish its control channel');
      if(session)await save();
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      if (!admitted) throw gozarError('unsupported', 'No admitted effect context is wired for this route');
      if(!await enforceConsent())throw gozarError('consent_mismatch','Consent changed before route creation');
      let plan = bootstrap.plan;
      if (gated && adapter.prepareProof) {
        proofSession = await adapter.prepareProof(read, bootstrap.request, attempt);
        lease.bindTarget = proofSession.target;
        plan = retarget(plan, bootstrap.request.target, proofSession.target);
      } else if (gated) {
        gate = await createGate(portOf(bootstrap.request.target), { lifetimeMs: GATE_LIFETIME_MS, onExpire: () => release().then(finish) });
        lease.bindTarget = `127.0.0.1:${gate.port}`;
        plan = retarget(plan, bootstrap.request.target, lease.bindTarget);
      }
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      if(ownerLost){await closeForwarding();throw gozarError('verification_failed','The owner released the lease before the route was created');}
      receipt = await adapter.create(context, plan);
      if(receipt?.adapterId!==adapter.id||receipt.resourceKey!==plan.resourceKey||receipt.generation!==context.generation||
        receipt.operationId!==undefined&&receipt.operationId!==(bootstrap.operationId??null))throw gozarError('provider_unavailable','The adapter returned a receipt for another allocation');
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      // Keep allocation custody even when the owner retires before optional observations finish.
      await save();
      if(proofAuthorityLost())return;
      const facts = await adapter.runtimeFacts(read, receipt);
      if(proofAuthorityLost())return;
      const origin = credentialFreeOrigin(receipt.origin, facts.properties, adapter.definition.originSchemes);
      if (!origin) throw gozarError('provider_unavailable', 'The provider returned no usable origin');
      Object.assign(lease, { properties: facts.properties,binding:facts.binding, ingress: facts.ingress ?? null, limits: facts.limits,runtimeFacts:facts.facts??[], facts: [...new Map([...(adapter.definition.facts ?? []), ...(facts.facts ?? [])].map(f=>[f.id,f])).values()], origin, state: 'unverified' });
      await save();
      if(!await enforceConsent()||proofAuthorityLost())return;
      // The host boundary: with a declared acknowledgment handler, verification waits for the host to bind
      // this exact origin. Nothing is reported published until the host has answered and the validation passes.
      if (!await acknowledgeAllocatedOrigin(origin))
        throw gozarError('verification_failed', 'The host did not acknowledge the allocated origin; the route was withdrawn');
      // Nothing is reported published until the validation passes; a failed check withdraws the route.
      const checked = await checkProof(claimsSse);
      if(proofAuthorityLost())return;
      if (checked.status !== 'verified') throw gozarError('verification_failed', 'The route did not pass publication validation and was withdrawn');
      if(!await enforceConsent()||proofAuthorityLost())return;
      lease.state = 'usable'; lease.checkedAtMs = Date.parse(checked.checkedAt); lease.sseChecked = gated && claimsSse;
      await save();
    } catch (cause) {
      if(!receipt&&cause.cleanupReceipt){receipt=cause.cleanupReceipt;handle.generation=receipt.generation;}
      const error = normalizeError(cause);
      failure = { code: error.code, message: error.message,nextAction:error.nextAction??null };
      lease.state = 'lost';
      if (receipt) {
        try { const removal = await removeRoute(); if (!removal.removed || removal.debt) Object.assign(lease, { state: 'uncertain', cleanup: debtOf(removal) }); else {lease.cleanup = {state:'confirmed'};await recordRemoval();await releaseUse();lease.cleanup={state:'confirmed'};} }
        catch { Object.assign(lease, { state: 'uncertain', cleanup: { state: 'unconfirmed', message: 'The route could not be withdrawn; close it again' } }); }
      } else { lease.state = 'uncertain'; lease.cleanup = {state:'unconfirmed',message:'Startup failed before an owned runtime receipt was returned'}; }
      await atomicWrite(join(directory, 'failure.json'), failure);
      await save().catch(() => {});
    }
  })().finally(async()=>{
    if(!failure&&proofAuthorityLost()){
      failure={code:'verification_failed',message:'Route verification ended before publication',nextAction:null};
      await atomicWrite(join(directory,'failure.json'),failure).catch(()=>{});
    }
    initialSettled=true;
  });

  async function releaseUse(){
    // Proof identity alone does not claim custody of a configuration reference.
    // Any managed-reference claim, even malformed, still requires confirmed release.
    const managed=['resolver','registryId','owner','consentReview'].some(name=>Object.hasOwn(bootstrap,name));
    if(!managed)return;
    if(resolverLost||!resolver||typeof resolver.releaseConfigurationUse!=='function'||
        typeof bootstrap.owner!=='string'||!bootstrap.owner||
        typeof bootstrap.registryId!=='string'||!bootstrap.registryId)
      throw gozarError('cleanup_debt','Resource removed; configuration reference release remains unconfirmed');
    await resolver.releaseConfigurationUse({owner:bootstrap.owner,providerId:adapter.id,handle});
  }

  function release() {
    proofAbort.abort();
    if(!releasing)releasingAt=now();
    releasing ??= (async () => {
      await creation;
      if (resourceRemoval) {
        // The route is already removed; only the configuration reference remains. A failed release keeps that debt recorded and retryable.
        try {await releaseUse();lease.state='released';lease.cleanup={state:'confirmed'};}
        catch (cause) {lease.state='uncertain';lease.cleanup={state:'unconfirmed',message:'Resource removed; configuration reference release remains unconfirmed'};}
        await save();return;
      }
      if (lease.cleanup.state === 'confirmed') {lease.state='released';await save();return;}
      lease.state = 'releasing'; await save().catch(() => {});
      try {
        if(!receipt)throw gozarError('cleanup_debt','Startup outcome remains unknown; retain this recovery handle');
        const removal = await removeRoute();
        if (removal.removed && !removal.debt) { lease.state = 'released'; lease.cleanup = { state: 'confirmed' };await recordRemoval();await releaseUse();lease.state='released';lease.cleanup={state:'confirmed'}; }
        else { lease.state = 'uncertain'; lease.cleanup = debtOf(removal); }
      } catch (cause) { lease.state = 'uncertain'; lease.cleanup = { state: 'unconfirmed', message: resourceRemoval ? 'Resource removed; configuration reference release remains unconfirmed' : `Removal failed (${normalizeError(cause).code})` }; }
      await save();
    })().finally(()=>{if(lease.cleanup.state==='unconfirmed'&&!ownerLost)releasing=null;});
    return releasing;
  }

  // Local forwarding (the gate, or the adapter's proof session) is the controller's own; closing it needs nothing from the provider
  // or from the configuration reference. Idempotent.
  async function closeForwarding(){
    proofAbort.abort();
    const bound = runtime.ownerLossLocalCloseMs ?? LOCAL_CLOSE_MS;
    if(gate)gateClosing ??= within(bound, () => gate.close());
    if(proofSession)proofClosing ??= within(bound, () => proofSession.close());
    const confirmed = (await Promise.all([gateClosing ?? true, proofClosing ?? true])).every(Boolean);
    if(!confirmed)localCloseUnconfirmed=true;
    return confirmed;
  }
  // Owner loss ends forwarding even when remote removal or reference reconciliation remains uncertain.
  // Failed journal writes retain the previous record and cannot prevent the detached controller from exiting.
  async function abandonOwnerless(){
    if(ownerLost)return;
    ownerLost=true;
    try {
      const localClosed = await closeForwarding();
      const removed = await within(runtime.ownerLossTeardownMs ?? OWNER_LOSS_TEARDOWN_MS, () => release());
      if(!removed || !localClosed){
        lease.state='uncertain';
        lease.cleanup={state:'unconfirmed',message:!localClosed?'Local forwarding closure remains unconfirmed; retain this recovery handle'
          :resourceRemoval?'Resource removed; configuration reference release remains unconfirmed'
          :receipt?'The owner was lost and removal or its journal did not complete; retain this recovery handle':'Startup outcome remains unknown; retain this recovery handle'};
        if(!await within(LOCAL_CLOSE_MS, save))throw new Error('Owner-loss journal unavailable');
      }
    } catch {
      lease.state='uncertain';
      lease.cleanup={state:'unconfirmed',message:'Owner-loss cleanup could not be journaled; the previous recovery record was retained'};
    } finally { finish(); }
  }

  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const sockets = new Set();
  const controllerStartIdentity = await processIdentity(process.pid);
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    let input = '', dispatched = false;
    socket.setTimeout(150_000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      input += chunk;
      if (input.length > 65_536) return socket.destroy();
      if (dispatched || !input.includes('\n')) return;
      dispatched = true;
      const reply = value => socket.end(`${JSON.stringify(value)}\n`);
      try {
        const message = JSON.parse(input.split('\n')[0]);
        if (message.nonce !== nonce) throw gozarError('internal_error', 'Controller identity mismatch');
        const command = message.command ?? {};
        if(command.type==='observe'){
          if(message.controllerIdentity?.pid!==process.pid||!controllerStartIdentity||message.controllerIdentity?.startIdentity!==controllerStartIdentity)
            throw gozarError('route_conflict','Controller process identity changed');
          if(command.handleKind!==handle.kind||command.handleId!==handle.id||command.generation!==handle.generation)
            throw gozarError('route_conflict','Observation handle does not match the controller');
          return reply({view:projectControllerObservation(lastView(),{now:now(),lastBeat,expiryMs,
            heartbeat:!session&&runtime.lease?.kind!=='stdin',expiresAtMs:session?bootstrap.expiresAtMs:null,
            initialSettled,failure,releasing,resourceRemoval,resolverLost,identity:lease.identity}),startupComplete:initialSettled,
            // Authority evidence for a replay: can this controller still produce a fresh proof?
            progress:{initialSettled,resolverLost,refreshable:safeRefresh()}});
        }
        if(session&&command.handleId!==undefined&&command.handleId!==handle.id)throw gozarError('route_conflict','The session was replaced');
        if(expired()&&command.type!=='close'&&command.type!=='finalize-removal'){await release();if(command.type==='status')return reply({view:lastView(),startupComplete:initialSettled});throw gozarError('verification_failed','The session lifetime has expired');}
        if (command.type === 'heartbeat') { if(!session)lastBeat = now(); return reply({ ok: true }); }
        if(command.type==='resolver-lost'){resolverLost=true;lease.state='unverified';proofAbort.abort();await save();return reply({ok:true});}
        if (command.generation !== undefined && command.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        if (command.type === 'status') { if (command.fresh) await verify(); return reply({ view: lastView(),startupComplete:initialSettled }); }
        if(command.type==='review-consent'){
          if(!consentObservationCurrent(consentObservation()))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          lease.state='unverified';lease.consentChange={reason:safeRefresh()?'review-requested':'proof-refresh-unsupported',nextAction:safeRefresh()?instructionAction('review-route-consent','Review route consent','Approve the current review before publication can resume.'):null};await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          if(receipt&&!resourceRemoval&&!releasing&&initialSettled&&!failure)await refreshRuntimeFacts();
          const observed=consentObservation();
          if(!consentObservationCurrent(observed))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          const staged=await currentConsent(),current=staged?.review;
          if(!current)throw gozarError('unsupported','This route has no current consent snapshot');
          const scope={...current.canonicalInput.scope,reviewHandle:handle.id,handleGeneration:handle.generation};
          const {consentReview}=await import('./consent-facts.mjs');
          const review=consentReview({...current.canonicalInput,scope,typedDisclosures:current.canonicalInput.typedDisclosures,facts:current.canonicalInput.facts});
          if(!commitConsentEvidence(observed,staged))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          const token=randomBytes(32).toString('base64url'),expiresAt=new Date(now()+600000).toISOString();
          const snapshot={...consentSnapshot(review),subject:lease.proofSubject??null,approvalToken:token,expiresAt};
          reviewTokens.set(token,{snapshot,current});return reply({review:snapshot});
        }
        if(command.type==='approve-consent'){
          if(!consentObservationCurrent(consentObservation()))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          lease.state='unverified';await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          const stored=reviewTokens.get(command.approvalToken);reviewTokens.delete(command.approvalToken);
          if(receipt&&!resourceRemoval&&!releasing&&initialSettled&&!failure)await refreshRuntimeFacts();
          const observed=consentObservation();
          if(!consentObservationCurrent(observed))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          const staged=await currentConsent(),current=staged?.review;
          if(!stored||Date.parse(stored.snapshot.expiresAt)<=now()||stored.snapshot.consentFactsDigest!==command.consentFactsDigest||stored.current.consentFactsDigest!==current?.consentFactsDigest||JSON.stringify(stored.snapshot.subject)!==JSON.stringify(lease.proofSubject??null))throw gozarError('consent_mismatch','The runtime review changed; request a new review');
          if(!commitConsentEvidence(observed,staged))throw gozarError('consent_mismatch','The route authority changed; request a current review');
          lease.approvedReview=current;delete lease.consentChange;await verify();return reply({view:lastView()});
        }
        if(command.type==='finalize-removal'){
          // Only after the owner released the exact configuration reference, and only from this controller's own removal milestone.
          if(command.handleKind!==handle.kind||command.handleId!==handle.id||command.generation!==handle.generation)throw gozarError('route_conflict','Finalization handle does not match the controller');
          if(command.owner!==undefined&&command.owner!==bootstrap.owner)throw gozarError('route_conflict','Finalization owner does not match the controller');
          await creation;await releasing?.catch(()=>{});
          if(!resourceRemoval||resourceRemoval.handle?.id!==handle.id||resourceRemoval.handle.generation!==handle.generation||resourceRemoval.providerId!==adapter.id)
            throw gozarError('cleanup_debt','This controller has not recorded a resource removal');
          proofAbort.abort();lease.state='released';lease.cleanup={state:'confirmed'};await save();
          reply({view:lastView()});finish();return;
        }
        if (command.type === 'close') {
          // A close that joins a removal already in flight (an automatic retry after the provider process ended) must not return that older
          // attempt's debt as its own answer: the provider may have recovered since it started. Debt from a joined attempt earns one fresh attempt.
          const joined = Boolean(releasing);
          await release();
          if (joined && lease.cleanup.state === 'unconfirmed' && !ownerLost) await release();
          // A removal confirmed to the caller means the local forwarding (the gate, the proof session) no longer accepts either: close it before
          // answering, not after the reply has left. A closure that cannot be confirmed keeps the recovery handle instead of a false confirmation.
          if (lease.cleanup.state === 'confirmed' && !await closeForwarding()) {
            lease.state = 'uncertain';
            lease.cleanup = { state: 'unconfirmed', message: 'Local forwarding closure remains unconfirmed; retain this recovery handle' };
            await within(LOCAL_CLOSE_MS, save);
          }
          reply({ view: lastView() }); if(lease.cleanup.state==='confirmed')finish();return;
        }
        throw gozarError('invalid_input', 'Unsupported controller command');
      } catch (error) { const normalized = normalizeError(error); reply({ error: { code: normalized.code, message: normalized.message } }); }
    });
  });
  const socketPath = join(directory, 'control.sock');
  try {
    await unlink(socketPath).catch(() => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o600);
    await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: controllerStartIdentity, nonce });
  } catch (cause) { controlPublished(false); throw cause; }
  controlPublished(true);

  let monitor;
  const stdin = !session && runtime.lease?.kind === 'stdin' ? runtime.lease.stream : null;
  if (stdin) {
    const gone = () => void abandonOwnerless();
    stdin.once('end', gone); stdin.once('close', gone); stdin.resume();
  } else {
    monitor = setInterval(() => {
      if (ownerLost) return;
      if (session) { if (!releasing && expired()) {lastBeat=now();release().then(()=>{if(lease.cleanup.state==='confirmed')finish();});} return; }
      // An explicit close still in flight owns the removal; one that has hung past the teardown bound no longer does.
      if (now() - lastBeat > expiryMs && (!releasing || now() - releasingAt > (runtime.ownerLossTeardownMs ?? OWNER_LOSS_TEARDOWN_MS))) void abandonOwnerless();
    }, Math.max(20, Math.min(1_000, Math.floor(expiryMs / 4))));
  }
  creation.then(() => { if (failure&&lease.cleanup.state==='confirmed') finish(); });
  await finished;
  clearInterval(monitor);
  // Let the reply to the last command leave before the socket goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  await closeForwarding();
  if(ownerLost && localCloseUnconfirmed)await within(LOCAL_CLOSE_MS, save);
  resolver?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  return lastView();
}

// --- Session usage ------------------------------------------------------------------------------

/**
 * Session usage. The adapter comes from the redeemed grant, never from the request. Every session, whichever provider, runs the
 * generic session controller: the provider differs only in how its resource is allocated and removed (session-recipe.mjs).
 */
export async function openSessionRoute(request, deps = {}) {
  await preflightExpose(request, deps);
  try {
    checkExpose(request, 'session');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const home = await canonicalHome(request.home, true);
    const port = Number(request.target.slice(request.target.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw gozarError('invalid_input', 'target must end in :PORT');
    const stableHandle=deps.reservedHandle??{kind:'session',id:`port-${port}:${randomUUID()}`,generation:1};
    const redeemed = await withExclusiveLock(join(await attachedRoot(home), '.open.lock'), () => redeemApproval(request, { ...deps, adapters }).catch(error => { throw refusedBeforeStart(error, stableHandle, request); }), { waitSeconds: 30 });
    const directory = join(home, `port-${port}`);
    if (stableHandle.kind!=='session'||stableHandle.generation!==1||!new RegExp(`^port-${port}:[A-Za-z0-9_-]+$`).test(stableHandle.id)) throw gozarError('invalid_input','Invalid reserved session handle');
    const expiresAtMs=Date.now()+request.usage.lifetimeMs;
    if (!Number.isFinite(expiresAtMs)||request.usage.lifetimeMs<=0) throw gozarError('invalid_input','A session needs a finite positive lifetime');
    return await openAttachedRoute(request,{...deps,sessionExecution:{redeemed,handle:stableHandle,directory,expiresAtMs}});
  } catch (error) { throw normalizeError(error); }
}

// --- Detached controller entry ------------------------------------------------------------------

if (process.argv[2] === '--controller' && process.argv[1] === here) {
  const directory = process.argv[3];
  try {
    const { controllerModule } = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
    const runtime = controllerModule ? await (await import(pathToFileURL(controllerModule).href)).default() : {};
    await runAttachedController(directory, runtime);
    process.exit(0);
  } catch (cause) {
    const error = normalizeError(cause);
    await atomicWrite(join(directory, 'failure.json'), { code: error.code, message: error.message }).catch(() => {});
    process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exit(1);
  }
}
