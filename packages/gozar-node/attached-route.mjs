// Attached routes: one provider runtime held by a Gozar controller process, for as long as the process that
// asked for it holds the lease.
//
//   owner (the calling process)  --heartbeat every 5 s, unref'd timer-->  controller (detached child)
//                                                                          holds adapter.create's runtime
// The controller removes the route 20 s after the last heartbeat, or at once on closeRoute. A crashed owner
// therefore costs at most the expiry. A foreground CLI owner can run the controller in its own process and
// hold the lease on stdin instead (runAttachedController with lease 'stdin'): EOF removes the route at once.
// openSessionRoute is the same redemption over the existing session machinery.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, chmod, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicWrite, processIdentity } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, withExclusiveLock } from './service-state.mjs';
import { gozarError, instructionAction, normalizeError } from './error-normalizer.mjs';
import { cliCommand } from './cli-command.mjs';
import { createGate } from './gate.mjs';
import { projectAttached, projectSession, releasedView, checkRef } from './route-view.mjs';
import { validateQuery, adapterRequest, readContextFor, loadRuntime, consentDisclosureRevision } from './route-catalog.mjs';
import { supportedPlatform } from './platform.mjs';
import { bindConfiguration } from './adapter-configuration.mjs';
import { recordController, controllerAlive, stopController, withCleanupOutcome } from './controller-start.mjs';
import { routeConsentReview,consentSnapshot } from './consent-facts.mjs';
import { completeProperties, checksFor } from './route-view.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { startEmbeddingBroker, connectEmbeddingBroker } from './embedding-broker.mjs';
import {testingFetch} from './testing-network.mjs';

export const HEARTBEAT_MS = 5_000;
export const LEASE_EXPIRY_MS = 20_000;
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
  const binding = (deps.consentBinding ?? tokens.consentBinding)(query, home, approval.disclosureRevision,approval.consentFactsDigest);
  const grant = await (deps.redeem ?? tokens.redeemConsentToken)({ home, token: approval.candidateToken, binding, providerId: query.providerId });
  const adapter = (await adaptersOf(deps)).find(item => item.id === grant.adapterId);
  if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available; ask the catalog again');
  if (approval.disclosureRevision !== consentDisclosureRevision(adapter.definition, query.intent)) throw gozarError('candidate_stale', 'Consent-relevant facts changed after approval; ask the catalog again');
  if (!adapter.definition.supportedKinds.includes(request.usage.kind)) throw gozarError('unsupported', 'This route does not support that usage');
  const context = bindConfiguration(await readContextFor(deps, home, deps.platform ?? process.platform,query.owner), adapter.id);
  let consentReview;
  if(deps.embeddingServices){
    const configuration=await deps.embeddingServices.readConfiguration({home,owner:query.owner,providerId:adapter.id});
    const detected=await adapter.detect(context);
    const declared=completeProperties(adapter.properties(detected.facts),adapter.definition,query.usage.kind);
    const properties={...declared,proof:{...declared.proof,checks:checksFor(declared.proof.checks,{sse:query.requirements.protocols.includes('sse')})}};
    consentReview=routeConsentReview({registryId:deps.registryId,providerId:adapter.id,usage:query.usage,configuration,target:query.target,origin:query.origin,properties,
      disclosure:{...adapter.definition.disclosure,revision:approval.disclosureRevision},facts:adapter.definition.facts??[]});
    if(approval.kind!=='route'||approval.consentFactsDigest!==consentReview.consentFactsDigest||grant.consentFactsDigest!==consentReview.consentFactsDigest)throw gozarError('consent_mismatch','Route consent changed; review the current candidate again');
  }
  const adapterAsk = adapterRequest(query);
  const plan = await adapter.plan(context, adapterAsk);
  const observed = await adapter.observe(context, adapterAsk);
  if (plan.digest !== grant.planDigest || observed.resourceKey !== grant.observedResource)
    throw gozarError('candidate_stale', 'The provider changed after the user approved; nothing was changed, ask the catalog again');
  return { home, adapter, grant, plan, request: adapterAsk, context, consentReview };
}

// --- The control channel (owner <-> controller): one JSON line each way, authenticated by a private nonce ---

export function controlAttached(directory, command, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let output = '', settled = false, socket;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); socket?.destroy(); error ? reject(error) : resolve(value); };
    const deadline = setTimeout(() => finish(gozarError('provider_unavailable', 'The route controller did not answer in time')), timeoutMs);
    readFile(join(directory, 'control.json'), 'utf8').then(async text => {
      const identity = JSON.parse(text);
      if (!identity.startIdentity || await processIdentity(identity.pid) !== identity.startIdentity) throw Object.assign(new Error('The route controller is not running'), { gone: true });
      socket = net.createConnection(join(directory, 'control.sock'));
      socket.once('connect', () => socket.write(`${JSON.stringify({ nonce: identity.nonce, command })}\n`));
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
function holdLease(directory, id, heartbeatMs) {
  const beat = () => controlAttached(directory, { type: 'heartbeat' }, 5_000).catch(() => {});
  // Unref'd: the lease never keeps the owner alive. When the owner exits the beats stop and the expiry ends the route.
  const timer = setInterval(beat, heartbeatMs); timer.unref();
  leases.set(id, timer); beat();
}
function dropLease(id) { clearInterval(leases.get(id)); leases.delete(id); }
async function dropBroker(id){const broker=brokers.get(id);brokers.delete(id);await broker?.close();}

async function attachedRoot(home, create = true) {
  const directory = join(home, 'attached');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}
// A status or close never creates state: a missing home or directory is simply no such route.
const routeDirectory = async (home, id) => {
  if (!idPattern.test(id)) throw gozarError('route_not_found', 'Not an attached route id');
  try { return join(await attachedRoot(await canonicalHome(home), false), id); }
  catch (error) { throw error.code === 'ENOENT' ? gozarError('route_not_found', 'No such attached route') : error; }
};
const readJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

async function startFailure(directory) {
  const failure = await readJson(join(directory, 'failure.json'));
  return failure ? gozarError(failure.code, failure.message) : null;
}

/** Opens one attached route and returns its RouteView. The calling process holds the lease from here on. */
export async function openAttachedRoute(request, deps = {}) {
  try {
    checkExpose(request, 'attached');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const root = await attachedRoot(await canonicalHome(request.home, true));
    const id = `att_${randomBytes(8).toString('hex')}`, directory = join(root, id);
    // Redeem, re-observe and start the controller under one reservation, so two opens cannot both win one resource.
    const controller = await withExclusiveLock(join(root, '.open.lock'), async () => {
      const redeemed = await redeemApproval(request, { ...deps, adapters });
      await trustedDirectory(directory, true);
      await privateDirectory(directory);
      let broker,identity;
      if(deps.embeddingServices){
        const hostIdentity=await deps.embeddingServices.resolveIdentity({home:redeemed.home});
        broker=await startEmbeddingBroker({services:deps.embeddingServices,home:redeemed.home,identity:hostIdentity,
          dispatchEffect:deps.dispatchEffect,onLoss:()=>{if(brokers.has(id))void controlAttached(directory,{type:'resolver-lost'}).catch(()=>{});}});
        const descriptor=await broker.registerController();
        identity={instanceId:descriptor.instanceId,bootId:descriptor.bootId};
        brokers.set(id,broker);
        try{await deps.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:redeemed.adapter.id,revision:redeemed.grant.configurationRevision,handle:{kind:'attached',id,generation:1}});}
        catch(error){await dropBroker(id);throw error;}
      }
      await atomicWrite(join(directory, 'bootstrap.json'), { schemaVersion: 1, id, home: redeemed.home, platform: deps.platform ?? process.platform, adapterId: redeemed.adapter.id, request: redeemed.request, plan: redeemed.plan,
        ...(broker?{resolver:broker.descriptor,identity,registryId:deps.registryId,owner:request.owner,consentReview:redeemed.consentReview,fixtureEffects:!!deps.dispatchEffect}:{}),
        ...(deps.registry ? { registry: deps.registry } : {}), leaseExpiryMs: deps.leaseExpiryMs ?? LEASE_EXPIRY_MS, ...(deps.controllerModule ? { controllerModule: deps.controllerModule } : {}) });
      const child = spawn(process.execPath, [here, '--controller', directory], { detached: true, stdio: 'ignore',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
      child.unref();
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      return await recordController(child);
    }, { waitSeconds: 30 });
    holdLease(directory, id, deps.heartbeatMs ?? HEARTBEAT_MS);
    const deadline = Date.now() + (deps.startTimeoutMs ?? 120_000);
    try {
      for (;;) {
        let reply;
        try { reply = await controlAttached(directory, { type: 'status', fresh: request.wait === 'verified' }, 30_000); }
        catch (error) {
          if (!error.gone && error.code !== 'provider_unavailable') throw error;
          const failure = await startFailure(directory);
          if (failure) throw failure;
          if (!await controllerAlive(controller)) throw gozarError('provider_unavailable', 'The route controller exited before it started the route');
        }
        const view = reply?.view;
        if (view && ['lost', 'released', 'uncertain'].includes(view.state)) throw (await startFailure(directory)) ?? gozarError('provider_unavailable', 'The route could not be started');
        if (view?.routeState === 'expired') throw gozarError('verification_failed', 'The route proof expired before publication');
        if (view && (request.wait === 'verified' ? view.state === 'usable' && view.verification.status === 'verified' && view.published !== null : view.state !== 'creating')) return view;
        if (Date.now() >= deadline) throw gozarError(view?.state === 'unverified' ? 'verification_failed' : 'provider_unavailable',
          view?.state === 'unverified' ? 'The route did not pass verification in time' : 'The route did not start in time');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (error) {
      dropLease(id);
      const cleanup=await controlAttached(directory, { type: 'close' }, 60_000).catch(() => null);
      if(cleanup?.view?.cleanup.state==='unconfirmed'){
        error.route=cleanup.view;
        throw error;
      }
      const recorded=await readJson(join(directory,'state.json'));
      if(!cleanup&&recorded?.lastView?.cleanup.state==='unconfirmed'){
        error.route=recorded.lastView;
        throw error;
      }
      const stopped=await stopController(controller);await dropBroker(id);
      throw withCleanupOutcome(error, stopped);
    }
  } catch (error) { throw normalizeError(error); }
}

async function viewFromRecord(directory, handle) {
  const state = await readJson(join(directory, 'state.json'));
  if (!state) throw gozarError('route_not_found', `No attached route ${handle.id}`);
  if (state.handle.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
  return state;
}

/** Fresh proof from the controller. Without a controller the last record is all there is, and it says so. */
export async function attachedStatus(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle.id);
  try { return (await controlAttached(directory, { type: 'status', fresh: true, generation: handle.generation }, 60_000)).view; }
  catch (error) {
    if (!error.gone) throw error;
    const state = await viewFromRecord(directory, handle);
    if (state.phase === 'released') return releasedView(state.lastView, handle);
    return { ...state.lastView, state: 'uncertain', routeState: 'cleanup-unconfirmed', published: null, ingress: null,
      cleanup: { state: 'unconfirmed', message: 'The route controller stopped before it removed the route' } };
  }
}

/** Ends the lease now: the controller removes the route and answers with the released view. */
export async function closeAttachedRoute(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle.id);
  dropLease(handle.id);
  try { const result=(await controlAttached(directory, { type: 'close', generation: handle.generation }, 120_000)).view;if(result.cleanup.state==='confirmed')await dropBroker(handle.id);return result; }
  catch (error) {
    if (!error.gone) throw error;
    const state = await viewFromRecord(directory, handle);
    if (state.phase === 'released') return releasedView(state.lastView, handle);
    // The controller died with the route up: remove it from the saved receipt, in this process.
    const adapters = await adaptersOf(deps);
    const adapter = adapters.find(item => item.id === state.adapterId);
    if (!adapter || !state.receipt || !deps.effectContext) return { ...state.lastView, state: 'uncertain', routeState: 'cleanup-unconfirmed', published: null, ingress: null,
      cleanup: { state: 'unconfirmed', message: 'The route controller stopped before it removed the route' } };
    const read = bindConfiguration(await readContextFor(deps, await canonicalHome(request.home), deps.platform ?? process.platform), adapter.id);
    const observed = await adapter.observe(read, state.request);
    const removal = await adapter.remove(bindConfiguration({ ...read, generation: state.handle.generation, ...deps.effectContext({ adapter, readContext: read, request: state.request, plan: state.plan, generation: state.handle.generation }) }, adapter.id), state.receipt, observed);
    return removal.removed && !removal.debt ? releasedView(state.lastView, handle)
      : { ...releasedView(state.lastView, handle), state: 'uncertain', cleanup: { state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' } };
  }
}

export async function reviewAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'review-consent',generation:handle.generation})).review;}
export async function approveAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'approve-consent',generation:handle.generation,approvalToken:request.approvalToken,consentFactsDigest:request.consentFactsDigest},60000)).view;}

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
 * Runs one attached route to its end and resolves with the last RouteView. `runtime` supplies adapters and the
 * admitted effect context; `lease` is 'heartbeat' (a detached controller) or { kind: 'stdin', stream } (a foreground CLI owner).
 */
export async function runAttachedController(directory, runtime = {}) {
  const bootstrap = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
  if(bootstrap.registryId&&await registryIdentity(bootstrap.registry)!==bootstrap.registryId)throw gozarError('artifact_integrity_failed','The controller registry content changed');
  let resolverLost=false;
  const resolver=bootstrap.resolver?await connectEmbeddingBroker({descriptor:bootstrap.resolver,identity:bootstrap.identity,onLoss:()=>{resolverLost=true;}}):null;
  if(resolver)runtime={...runtime,embeddingServices:resolver,owner:bootstrap.owner,...(bootstrap.fixtureEffects?{dispatchEffect:resolver.dispatchEffect.bind(resolver)}:{})};
  if(bootstrap.fixtureEffects)runtime.fetch=testingFetch(runtime.dispatchEffect);
  const adapters = runtime.adapters ?? await (await loadRuntime())?.loadAdapters?.(bootstrap.registry);
  const adapter = adapters?.find(item => item.id === bootstrap.adapterId);
  if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available');
  const read = bindConfiguration(await readContextFor(runtime, bootstrap.home, bootstrap.platform), adapter.id);
  const now = runtime.now ?? Date.now;
  const expiryMs = bootstrap.leaseExpiryMs ?? LEASE_EXPIRY_MS;
  const handle = { kind: 'attached', id: bootstrap.id, generation: 0 };
  const lease = { target: bootstrap.request.target, state: 'creating', origin: null, properties: adapter.definition.capabilities, ingress: null, identity:bootstrap.identity??null,
    limits: { recommendedPollIntervalMs: 5_000, idleTimeoutMs: null }, cleanup: { state: 'none' }, checkedAtMs: null };
  let receipt = null, lastBeat = now(), releasing = null, failure = null, gate = null, proofSession = null;
  const nonce = randomBytes(32).toString('hex');
  const lastView = () => ({...projectAttached(lease, { handle, now: now() }),...(lease.consentChange?{consentChange:lease.consentChange}:{}),consentFactsDigest:lease.approvedReview?.consentFactsDigest??bootstrap.consentReview?.consentFactsDigest??null});
  const save = () => atomicWrite(join(directory, 'state.json'), { schemaVersion: 1, adapterId: adapter.id, request: bootstrap.request, plan: bootstrap.plan,
    receipt, handle, phase: lease.state, lastView: lastView() });

  const admitted = (runtime.effectContext ?? (await loadRuntime())?.createAttachedEffectContext)?.({ adapter, readContext: read, request: bootstrap.request, plan: bootstrap.plan, generation: 1 });
  // The effect is admitted for generation 1: a new route. Receipts carry the generation create returns.
  const context = bindConfiguration({ ...read, generation: 1, ...(admitted ?? {}) }, adapter.id);

  // Publication validation. The provider forwards to a gate this controller runs in front of the app (the same
  // gate recipe routes use). Through the public origin the gate proves the origin reaches this instance and,
  // when the route claims SSE, that a timed stream arrives unbuffered. `verifyChallenge` is that proof, so
  // adapter.verify is the one verification path. `validation: 'none'` exists only for controller test modules.
  const claimsSse = adapter.definition.capabilities?.protocols?.sse === true;
  const gateChecked = sse => async origin => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), sse ? 15_000 : 5_000);
    try { await gate.verify(origin, { sse, signal: controller.signal, fetch: runtime.fetch }); return { status: 'verified', checkedAt: new Date(now()).toISOString() }; }
    catch { return { status: 'unverified', checkedAt: new Date(now()).toISOString() }; }
    finally { clearTimeout(timer); }
  };
  const gated = runtime.validation !== 'none';
  const proofAbort = new AbortController();
  const attempt = { id: bootstrap.id, nonce: randomBytes(32).toString('hex'), deadlineMs: now() + 120_000, signal: proofAbort.signal };
  Object.assign(context,{signal:attempt.signal,deadlineMs:attempt.deadlineMs,attemptId:attempt.id});
  lease.approvedReview=bootstrap.consentReview??null;
  const reviewTokens=new Map();
  const safeRefresh=()=>!proofSession||typeof proofSession.refresh==='function';
  async function currentConsent(){
    if(!lease.approvedReview)return null;
    const original=lease.approvedReview.canonicalInput;
    const configuration=await resolver.readConfiguration({owner:bootstrap.owner,providerId:adapter.id});
    return routeConsentReview({registryId:bootstrap.registryId,providerId:adapter.id,usage:bootstrap.request.usage,configuration,
      target:bootstrap.request.target,origin:original.scope.query.expectedOrigin,
      properties:completeProperties(lease.properties,adapter.definition,bootstrap.request.usage.kind),disclosure:original.typedDisclosures.disclosure,
      facts:lease.facts??adapter.definition.facts??[]});
  }
  async function enforceConsent(){
    if(resolverLost){lease.state='unverified';return false;}
    const current=await currentConsent();
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
    const checked = proofSession ? await proofSession.verify({ origin: endpoint, receipt, attempt })
      : await adapter.verify(gated ? { ...read, verifyChallenge: gateChecked(sse) } : read, receipt);
    if (proofSession) {
      if (checked.attemptId !== attempt.id || checked.endpoint !== endpoint || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing) {
        return { ...checked, status: 'unverified' };
      }
      lease.proof = checked;
      lease.facts = [...new Map([...(adapter.definition.facts ?? []), ...(lease.runtimeFacts ?? []), ...(checked.facts ?? [])].map(fact => [fact.id, fact])).values()];
    }
    if(resolverLost||attempt.signal.aborted||releasing||now()>=attempt.deadlineMs)return {...checked,status:'unverified'};
    lease.proofSubject=bootstrap.identity?{origin:endpoint,target:bootstrap.request.target,...bootstrap.identity,handleGeneration:handle.generation}:null;
    return checked;
  }

  async function verify() {
    if (!receipt || releasing) return;
    const facts=await adapter.runtimeFacts(read,receipt);
    Object.assign(lease,{properties:facts.properties,runtimeFacts:facts.facts??[],facts:[...new Map([...(adapter.definition.facts??[]),...(facts.facts??[]),...(lease.proof?.facts??[])].map(f=>[f.id,f])).values()]});
    if(!await enforceConsent())return;
    if (proofSession && !proofSession.refresh) return;
    try {
      attempt.deadlineMs = now() + 120_000;
      const verification = proofSession
        ? await proofSession.refresh({ origin: lease.origin, receipt, attempt })
        : await checkProof(false);
      if (proofSession) {
        if (verification.attemptId !== attempt.id || verification.endpoint !== lease.origin || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing) return;
        lease.proof = verification;
        lease.facts = [...(adapter.definition.facts ?? []), ...(verification.facts ?? [])];
      }
      if (!releasing&&await enforceConsent()) { lease.state = verification.status === 'verified' ? 'usable' : 'unverified'; lease.checkedAtMs = Date.parse(verification.checkedAt); lease.sseChecked = false; await save(); }
    } catch { if (!releasing) { lease.state = 'unverified'; await save(); } }
  }
  async function removeRoute() {
    const observed = await adapter.observe(read, bootstrap.request);
    return adapter.remove(context, receipt, observed);
  }
  const debtOf = removal => ({ state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' });
  const creation = (async () => {
    try {
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
      receipt = await adapter.create(context, plan);
      handle.generation = receipt.generation;
      const facts = await adapter.runtimeFacts(read, receipt);
      const origin = credentialFreeOrigin(receipt.origin, facts.properties, adapter.definition.originSchemes);
      if (!origin) throw gozarError('provider_unavailable', 'The provider returned no usable origin');
      Object.assign(lease, { properties: facts.properties, ingress: facts.ingress ?? null, limits: facts.limits,runtimeFacts:facts.facts??[], facts: [...new Map([...(adapter.definition.facts ?? []), ...(facts.facts ?? [])].map(f=>[f.id,f])).values()], origin, state: 'unverified' });
      await save();
      if(!await enforceConsent())return;
      // Nothing is reported published until the validation passes; a failed check withdraws the route.
      const checked = await checkProof(claimsSse);
      if (checked.status !== 'verified') throw gozarError('verification_failed', 'The route did not pass publication validation and was withdrawn');
      if(!await enforceConsent())return;
      lease.state = 'usable'; lease.checkedAtMs = Date.parse(checked.checkedAt); lease.sseChecked = gated && claimsSse;
      await save();
    } catch (cause) {
      if(!receipt&&cause.cleanupReceipt){receipt=cause.cleanupReceipt;handle.generation=receipt.generation;}
      const error = normalizeError(cause);
      failure = { code: error.code, message: error.message };
      lease.state = 'lost';
      if (receipt) {
        try { const removal = await removeRoute(); if (!removal.removed || removal.debt) Object.assign(lease, { state: 'uncertain', cleanup: debtOf(removal) }); else {lease.cleanup = {state:'confirmed'};await releaseUse();} }
        catch { Object.assign(lease, { state: 'uncertain', cleanup: { state: 'unconfirmed', message: 'The route could not be withdrawn; close it again' } }); }
      } else { lease.state = 'uncertain'; lease.cleanup = {state:'unconfirmed',message:'Startup failed before an owned runtime receipt was returned'}; }
      await atomicWrite(join(directory, 'failure.json'), failure);
      await save().catch(() => {});
    }
  })();

  async function releaseUse(){if(resolver&&bootstrap.owner)await resolver.releaseConfigurationUse({owner:bootstrap.owner,providerId:adapter.id,handle:{kind:'attached',id:bootstrap.id,generation:1}});}

  function release() {
    proofAbort.abort();
    releasing ??= (async () => {
      await creation;
      if (lease.cleanup.state === 'confirmed') return;
      lease.state = 'releasing'; await save().catch(() => {});
      try {
        if(!receipt)throw gozarError('cleanup_debt','Startup outcome remains unknown; retain this recovery handle');
        const removal = await removeRoute();
        if (removal.removed && !removal.debt) { lease.state = 'released'; lease.cleanup = { state: 'confirmed' };await releaseUse(); }
        else { lease.state = 'uncertain'; lease.cleanup = debtOf(removal); }
      } catch (cause) { lease.state = 'uncertain'; lease.cleanup = { state: 'unconfirmed', message: `Removal failed (${normalizeError(cause).code})` }; }
      await save();
    })().finally(()=>{if(lease.cleanup.state==='unconfirmed')releasing=null;});
    return releasing;
  }

  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const sockets = new Set();
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
        if (command.type === 'heartbeat') { lastBeat = now(); return reply({ ok: true }); }
        if(command.type==='resolver-lost'){resolverLost=true;lease.state='unverified';proofAbort.abort();await save();return reply({ok:true});}
        if (command.generation !== undefined && command.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        if (command.type === 'status') { if (command.fresh) await verify(); return reply({ view: lastView() }); }
        if(command.type==='review-consent'){
          lease.state='unverified';await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          const current=await currentConsent();if(!current)throw gozarError('unsupported','This route has no current consent snapshot');
          const scope={...current.canonicalInput.scope,reviewHandle:handle.id,handleGeneration:handle.generation};
          const {consentReview}=await import('./consent-facts.mjs');
          const review=consentReview({...current.canonicalInput,scope,typedDisclosures:current.canonicalInput.typedDisclosures,facts:lease.facts??adapter.definition.facts??[]});
          const token=randomBytes(32).toString('base64url'),expiresAt=new Date(now()+600000).toISOString();
          const snapshot={...consentSnapshot(review),subject:lease.proofSubject??null,approvalToken:token,expiresAt};
          reviewTokens.set(token,{snapshot,current});return reply({review:snapshot});
        }
        if(command.type==='approve-consent'){
          lease.state='unverified';await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          const stored=reviewTokens.get(command.approvalToken);reviewTokens.delete(command.approvalToken);
          const current=await currentConsent();
          if(!stored||Date.parse(stored.snapshot.expiresAt)<=now()||stored.snapshot.consentFactsDigest!==command.consentFactsDigest||stored.current.consentFactsDigest!==current?.consentFactsDigest||JSON.stringify(stored.snapshot.subject)!==JSON.stringify(lease.proofSubject??null))throw gozarError('consent_mismatch','The runtime review changed; request a new review');
          lease.approvedReview=current;delete lease.consentChange;await verify();return reply({view:lastView()});
        }
        if (command.type === 'close') { await release(); reply({ view: lastView() }); if(lease.cleanup.state==='confirmed')finish();return; }
        throw gozarError('invalid_input', 'Unsupported controller command');
      } catch (error) { const normalized = normalizeError(error); reply({ error: { code: normalized.code, message: normalized.message } }); }
    });
  });
  const socketPath = join(directory, 'control.sock');
  await unlink(socketPath).catch(() => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce });

  let monitor;
  const stdin = runtime.lease?.kind === 'stdin' ? runtime.lease.stream : null;
  if (stdin) {
    const gone = () => release().then(()=>{if(lease.cleanup.state==='confirmed')finish();});
    stdin.once('end', gone); stdin.once('close', gone); stdin.resume();
  } else {
    monitor = setInterval(() => { if (!releasing && now() - lastBeat > expiryMs) {lastBeat=now();release().then(()=>{if(lease.cleanup.state==='confirmed')finish();});} }, Math.max(20, Math.min(1_000, Math.floor(expiryMs / 4))));
  }
  creation.then(() => { if (failure&&lease.cleanup.state==='confirmed') finish(); });
  await finished;
  clearInterval(monitor);
  // Let the reply to the last command leave before the socket goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  await gate?.close().catch(() => {});
  await proofSession?.close().catch(() => {});
  resolver?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  return lastView();
}

// --- Session usage ------------------------------------------------------------------------------

async function legacyStartSession({ home, directory, adapterId, port, lifetimeMs, origin, requirements }) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { loadCatalog, loadDefinition } = await import('./catalog.mjs');
  const { launch } = await import('./daemon.mjs');
  const catalog = await loadCatalog(root, { operational: true });
  const definition = await loadDefinition(root, adapterId);
  return launch(directory, { adapters: [...catalog.filter(item => item.id !== definition.id), definition],
    requirements: { clientReach: requirements.reach, httpsRequired: requirements.transport === 'https', sse: requirements.protocols.includes('sse'),
      streamableHttp: requirements.protocols.includes('streamable-http'), oauthDcr: requirements.protocols.includes('oauth-dcr') },
    targetPort: port, adapterId, lifetimeMs, origin: origin ?? undefined, operational: definition.planVersion === 1, consent: true, approveOrigin: true },
  join(root, 'bin', 'gozar.mjs'));
}

/**
 * Session usage over the existing session machinery. The adapter comes from the redeemed grant, never from the
 * request; the legacy controller (startSession) enforces the lifetime.
 */
export async function openSessionRoute(request, deps = {}) {
  try {
    checkExpose(request, 'session');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const home = await canonicalHome(request.home, true);
    const port = Number(request.target.slice(request.target.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw gozarError('invalid_input', 'target must end in :PORT');
    const redeemed = await withExclusiveLock(join(await attachedRoot(home), '.open.lock'), () => redeemApproval(request, { ...deps, adapters }), { waitSeconds: 30 });
    const directory = join(home, `port-${port}`);
    let reply = await (deps.startSession ?? legacyStartSession)({ home, directory, adapterId: redeemed.adapter.id, port, lifetimeMs: request.usage.lifetimeMs,
      origin: request.origin ?? redeemed.plan.origin ?? null, requirements: request.requirements, wait: request.wait });
    const sessionId = reply.snapshot?.sessionId;
    const handle = { kind: 'session', id: sessionId ? `port-${port}:${sessionId}` : `port-${port}`, generation: 1 };
    const project = value => projectSession(value, { handle, properties: redeemed.adapter.definition.capabilities, now: (deps.now ?? Date.now)() });
    // Like an attached route, a session returns when `wait` is met and fails, cleaned up, when it cannot be.
    try {
      const deadline = Date.now() + (deps.startTimeoutMs ?? 120_000);
      for (;;) {
        const view = project(reply);
        if (['lost', 'released', 'uncertain'].includes(view.state)) throw await sessionStartFailure(reply, { home, adapterId: redeemed.adapter.id, deps });
        if (request.wait === 'verified' ? view.state === 'usable' : view.origin !== null) return view;
        if (Date.now() >= deadline) throw gozarError(view.state === 'unverified' ? 'verification_failed' : 'provider_unavailable',
          view.state === 'unverified' ? 'The route did not pass verification in time' : 'The route did not start in time');
        await new Promise(resolve => setTimeout(resolve, deps.pollMs ?? 250));
        try { reply = await (deps.sessionStatus ?? (async () => (await import('./daemon.mjs')).control(directory, { type: 'status' }, 30_000)))(); }
        catch (cause) { throw gozarError('provider_unavailable', 'The session controller stopped before the route was ready', null, cause); }
      }
    } catch (error) { throw await failedSessionStart(directory, error, deps); }
  } catch (error) { throw normalizeError(error); }
}

/**
 * What the core says, in `snapshot.limitations`, when it stops a session before it changes anything because every port the
 * route may use is taken. The core owns the sentence; the session-ports test reads it from the real core.
 */
export const LISTENERS_TAKEN = 'All explicit listener candidates are occupied or protected';

const portList = ports => ports.length === 2 ? `${ports[0]} and ${ports[1]}` : ports.join(', ');

/**
 * The error for a session that ended before it was published. When the core stopped it because every candidate port is
 * taken, the app gets the closest frozen code and a next step that names the ports and, when Gozar knows it, the holder:
 *   route_conflict            another Gozar route or session in this home holds a candidate port: name it, say how to stop it
 *   requirements_unsatisfied  only other listeners hold the ports: nothing Gozar owns can be stopped, and a retry changes nothing
 * Anything else is a plain `provider_unavailable`: provider diagnostics stay inside Gozar.
 */
async function sessionStartFailure(reply, { home, adapterId, deps }) {
  const generic = () => gozarError('provider_unavailable', 'The route could not be started');
  if (!(reply.snapshot?.limitations ?? []).includes(LISTENERS_TAKEN)) return generic();
  let ports = [], holders = [];
  try {
    const definition = await (deps.loadDefinition ?? (async id => (await import('./catalog.mjs')).loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), id)))(adapterId);
    ports = definition.bindings?.port?.candidates ?? [];
    if (ports.length) holders = await (deps.portHolders ?? (await import('./durable-route.mjs')).portHolders)({ home, providerResource: definition.providerResource ?? null, ports });
  } catch { /* the ports are an explanation, not a precondition: without them the generic error stands */ }
  if (!ports.length) return generic();
  const named = holders.map(({ port, routeId, sessionPort }) => routeId !== undefined ? `port ${port} is held by route ${routeId}` : `port ${port} is held by the session on port ${sessionPort}`);
  if (named.length) {
    const first = holders[0];
    const step = first.routeId !== undefined ? `Release route ${first.routeId} (or stop the app that owns it)` : `Stop the session on port ${first.sessionPort}`;
    const how = first.routeId !== undefined ? step : `${step} with: ${cliCommand('stop', first.sessionPort, home)}`;
    return gozarError('route_conflict', `No port is free for this route (${portList(ports)}): ${named.join('; ')}. Existing listeners were left untouched.`,
      instructionAction('free-route-port', `Free port ${first.port}`, `${how}, then start this route again.`));
  }
  return gozarError('requirements_unsatisfied', `No port is free for this route: ${portList(ports)} are all in use by other listeners. They were left untouched.`,
    instructionAction('free-route-port', `Free one of ports ${portList(ports)}`, `Stop whatever listens on port ${ports[0]} or ${ports[1] ?? ports[0]}, then start this route again.`));
}

/**
 * A session that did not reach `wait` must not keep running: stop it through the session's own path (which removes the
 * provider state), then prove the controller process is gone. The reported error stays the original one unless cleanup is unconfirmed.
 */
async function failedSessionStart(directory, error, deps) {
  let identity = null;
  try { identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8')); } catch {}
  let stopped = null, stopFailure = null;
  try { stopped = await (deps.stopSession ?? (async () => (await import('./daemon.mjs')).stopSession(directory)))(); } catch (cause) { stopFailure = cause; }
  const outcome = identity?.startIdentity ? await stopController({ pid: identity.pid, startIdentity: identity.startIdentity }) : { state: 'gone' };
  const unconfirmed = stopFailure || stopped?.snapshot?.phase === 'cleanup-pending' || stopped?.localCleanupFailures?.length;
  const stop = `Run: ${cliCommand('stop', Number(directory.slice(directory.lastIndexOf('-') + 1)), dirname(directory))}`;
  return withCleanupOutcome(unconfirmed ? gozarError('cleanup_debt', 'The route failed to start and its cleanup is not confirmed; stop the session again',
    instructionAction('stop-session', 'Stop the failed session', stop), error) : error, outcome);
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
    process.exit(1);
  }
}
