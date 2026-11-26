// The consumer API (route-contract.d.ts), wired from the modules that own each part. Apps call these by
// requirement and never name a provider: the catalog picks candidates from the adapter registry, a single-use
// consent token carries the user's approval, and every reply is a RouteView or a GozarThrownError.
//
// `createRouteApi(deps)` exists so a test can replace the adapter registry, platform or state loaders; the
// package root exports the instance with real dependencies. Nothing here names a provider.
import { ownershipFor } from './adapter-runtime.mjs';
import { bindConfiguration } from './adapter-configuration.mjs';
import { catalogRoutes as buildCatalog, readContextFor } from './route-catalog.mjs';
import { routeStatus as viewStatus, closeRoute as viewClose, suspendRoute as viewSuspend, projectDurable, propertiesFor } from './route-view.mjs';
import { watchRoutes as pollRoutes } from './route-watch.mjs';
import { getRoutePreferences, setRoutePreferences } from './route-preferences.mjs';
import { runSetupAction as runSetup } from './route-setup.mjs';
import { openAttachedRoute, openSessionRoute, redeemApproval,reviewAttachedConsent,approveAttachedConsent,releaseAttachedConfiguration,releaseSessionConfiguration,sessionConsent } from './attached-route.mjs';
import { preflightExpose } from './attached-route.mjs';
import { peekConsentGrant } from './consent-token.mjs';
import { projectExternal } from './route-view.mjs';
import { resolveClientAddress } from './ingress.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { createEmbeddingServices } from './embedding-services.mjs';
import { bundledLineage } from './registry-lineage.mjs';
import { inputKindsOf } from './embedding-state.mjs';
import { validatedRuntimeModuleDeclaration } from './runtime-modules.mjs';
import { createDetectionCache } from './detection-cache.mjs';
import { listProviders as inventory } from './embedding-inventory.mjs';
import { setupConsentReview,consentSnapshot,safeSetupAction,needsSetupOperation } from './consent-facts.mjs';
import { runSetupOperation, readSetupOperation, cancelSetupOperation } from './setup-operations.mjs';
import {offeredConfiguration,readConfigurationDraft,clearConfigurationInput} from './embedding-setup.mjs';
import {withRouteOperation,routeGuidanceScope,listRecordedRoutes,recordOperationView,operationReferenceForRoute,retainedOperationView,recordPendingReferenceCleanup,retryRecordedReferenceCleanup,referenceCleanupDebt} from './route-operations.mjs';
import {cleanupReferenceRecord,prepareCleanupReference,recordCleanupRemoval,retryCleanupReference,listCleanupReferences} from './route-operations.mjs';
import {attachedCleanupReference,attachedRemovalEvidence,finishCleanupController,attachedReplayProgress} from './attached-route.mjs';
import {withServiceContext,reviewExternalConsent,approveExternalConsent} from './service.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';

const lazy = loader => { let loaded; return () => (loaded ??= loader()); };
const engine = lazy(() => import('./durable-route.mjs'));
const legacy = lazy(() => import('./legacy-import.mjs'));
const runtime = lazy(() => import('./adapter-runtime.mjs'));

export function createRouteApi(deps = {}) {
  const platform = () => deps.platform ?? process.platform;
  // Trusted host declarations of packaged runtime modules. Structural validation is synchronous; the
  // identity, version and load check happen on every load, in this process and in a detached controller.
  const runtimeModules = deps.runtimeModules === undefined || deps.runtimeModules === null ? undefined
    : Object.fromEntries(Object.entries(deps.runtimeModules)
      .map(([name, declaration]) => [name, validatedRuntimeModuleDeclaration(name, declaration)]));
  // Short-TTL cached detection per full scope (registry, home, owner, provider, platform, configuration
  // revision). Routine cold or expired polls run ZERO live provider probes; an explicit refresh request
  // and the read after a mutation own the probes. Authority paths never read it.
  const detection = deps.detectionCache ?? createDetectionCache({ ttlMs: deps.detectionTtlMs ?? 15_000, now: () => (deps.now ?? Date.now)() });
  let loaded;
  // A read is admitted at the public boundary, before the registry and configuration awaits: refresh reads that
  // overlap share one probe per scope (detection-cache.mjs). The admission ends with the call.
  const admitted = async (request, run) => { const admission = detection.admit(request?.refresh === true); try { return await run(admission); } finally { admission.release(); } };
  const adapters = async () => deps.adapters ?? (loaded ??= runtime().then(module => module.loadAdapters(deps.manifest ? { manifest: deps.manifest, root: deps.root } : undefined)).catch(error => { loaded = undefined; throw error; }));
  let servicesPromise;
  const services = () => servicesPromise ??= (async()=>{
    const registryId = await registryIdentity({...deps,adapters:deps.adapters});
    // The bundled registry keeps one stable storage name across releases. An injected or custom registry has no lineage
    // unless its host declares one: matching definitions are not proof of the same executable.
    const lineage=deps.registryLineage??(deps.adapters||deps.manifest||deps.root?undefined:bundledLineage());
    return {registryId,lineage,embeddingServices:deps.embeddingServices??createEmbeddingServices({registryId,lineage,secretBackend:deps.secretBackend,hostCapabilities:deps.hostCapabilities,identity:deps.identity,
      // What an earlier saved input may become is decided by the provider's own current declaration, never by its id alone.
      currentInputKinds:async providerId=>inputKindsOf((await adapters()).find(adapter=>adapter.id===providerId)),
      observeEarlierSetupOperation:async({home,owner,providerId,operation})=>{
        const adapter=(await adapters()).find(candidate=>candidate.id===providerId);
        if(typeof adapter?.observeSetup!=='function')return null;
        const read=await readContextFor(deps,home,platform(),owner);
        // No configuration resolver, mutation or credential access crosses this migration boundary.
        return adapter.observeSetup({now:read.now,probe:read.probe,home,platform:platform(),configuration:async()=>null,providerConfiguration:async()=>null,
          configurationPresence:async()=>null,hasManagementSecret:()=>false,withManagementSecret:async()=>null},
          {id:'migration-retirement',cancelled:operation.cancelled,resources:[],connectorInputs:[],lastActionId:operation.lastActionId??null});
      }})};
  })();
  const shared = async (request={}) => { const resolved=await services(); return ({ adapters: await adapters(), platform: platform(), ...resolved, owner:request.owner,home:request.home,
    ...(deps.manifest ? { registry: { manifest: deps.manifest, root: deps.root } } : {}),
    hostCapabilities:deps.hostCapabilities??{}, ...(deps.dispatchEffect?{dispatchEffect:deps.dispatchEffect}:{}),
    ...(runtimeModules ? { runtimeModules } : {}),
    ...(deps.acknowledgeOrigin ? { acknowledgeOrigin: deps.acknowledgeOrigin } : {}),
    detection,
    ...(Number.isFinite(deps.originAckTimeoutMs) ? { originAckTimeoutMs: deps.originAckTimeoutMs } : {}),
    ...(deps.readContext ? { readContext: deps.readContext } : {}),
    decorateSetupAction:({action,adapter,configuration,draftId=null,inspection})=>{
      const review=setupConsentReview({registryId:resolved.registryId,providerId:adapter.id,configuration,draftId,action,facts:catalogFactsFor(inspection&&inspection.live!==false?inspection:{adapter})});
      return {...safeSetupAction(action),consent:consentSnapshot(review),...(!needsSetupOperation(action)&&{review:{canonicalInput:review.canonicalInput}})};
    } }); };
  const publicError=cause=>{const normalized=normalizeError(cause),error=gozarError(normalized.code,normalized.message,normalized.nextAction?(needsSetupOperation(normalized.nextAction)?safeSetupAction(normalized.nextAction):structuredClone(normalized.nextAction)):null);if(normalized.route)error.route=structuredClone(normalized.route);return error;};
  const guard = async action => { try { return structuredClone(await action()); } catch (error) { throw publicError(error); } };
  const setupDeps=async request=>{
    const context=await shared(request);
    const invoke=async(operation,input)=>{const adapter=context.adapters.find(a=>a.id===request.providerId);if(!adapter?.definition.effectOperations?.some(row=>row.kind==='artifact'&&row.operation===operation))throw gozarError('unsupported','The adapter has not declared this artifact effect');return context.dispatchEffect({kind:'artifact',operation,input});};
    const artifactExecutor=context.dispatchEffect?{
      async fetchArtifact(artifact){const result=await invoke('fetch',{artifact});if(typeof result?.bytes!=='string'||Buffer.byteLength(result.bytes,'base64')>32*1024*1024)throw gozarError('artifact_integrity_failed','The artifact observation is invalid');return new Uint8Array(Buffer.from(result.bytes,'base64'));},
      async executeArtifact({artifact,effects,bytes}){const result=await invoke('execute',{artifact,effects,bytes:Buffer.from(bytes).toString('base64')});if(result?.executed!==true||result.exitCode!==0)throw gozarError('provider_unavailable','The approved artifact did not execute successfully');return result;},
    }:deps.setup?.artifactExecutor;
    return {...deps.setup,...context,...(artifactExecutor?{artifactExecutor}:{}),validateSetupApproval:({action,adapter,configuration,inspection})=>{
      const review=setupConsentReview({registryId:context.registryId,providerId:adapter.id,configuration,draftId:request.draftId??null,action,facts:catalogFactsFor(inspection??{adapter})});
      if(request.approval?.kind!=='setup'||request.approval.consentFactsDigest!==review.consentFactsDigest)throw gozarError('consent_mismatch','Setup consent changed; review the current action again');
    }};
  };
  // A `verify` option ({ origin, target }) replaces the challenge verifier for the durable calls below. It is for tests.
  const verified=async(action,request={})=>{const module=await engine(),context={...await shared(request),...(deps.verify?{verify:deps.verify}:{})};return withServiceContext(context,()=>module.withRuntimeContext(context,()=>deps.verify?module.withVerifier(deps.verify,action):action()));};

  /** A durable engine reply is a record view; its RouteView needs the adapter's declared properties. */
  async function durableView(reply) {
    const handle = { kind: 'durable', id: reply.routeId, generation: reply.generation };
    return projectDurable(reply, { handle, ...await propertiesFor(reply.adapterId, { adapters: await adapters() }, 'durable') });
  }

  /**
   * A route its owner keeps (the adapter's definition says `ownership: 'external-owned'`) is not created by the durable
   * engine: Gozar records it as a service route and checks it. The approval's grant names the adapter, so this looks
   * at the grant, never at an id. Anything else returns undefined and goes to the durable engine.
   */
  function validateOwnerKeptEnsure(request) {
    if (!['durable', 'session'].includes(request.usage?.kind) || (request.intent !== undefined && request.intent !== 'create')) throw gozarError('invalid_input', 'An owner-run route is created with usage durable or session and intent create');
  }
  async function ownerKept(request) {
    if (typeof request?.approval?.candidateToken !== 'string' || typeof request.home !== 'string') return undefined;
    let grant;
    try { grant = await peekConsentGrant({ home: request.home, token: request.approval.candidateToken }); } catch { return undefined; }
    const adapter = grant && (await adapters()).find(item => item.id === grant.adapterId);
    if (ownershipFor(adapter?.definition) !== 'external-owned') return undefined;
    validateOwnerKeptEnsure(request);
    const redeemed = await redeemApproval(request, await shared(request));
    const service = deps.service?.addService ?? (await import('./service.mjs')).addService;
    const context=await shared(request),handle={kind:'external',id:redeemed.plan.origin,generation:1};
    await context.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:adapter.id,revision:redeemed.grant.configurationRevision,handle});
    const {approval,wait,...query}=request;
    const { route } = await service({ origin: redeemed.plan.origin, target: request.target, home: redeemed.home,embedding:{request:query,consentReview:redeemed.consentReview,operationId:request.operationId??null} });
    return projectExternal(route, { handle: { kind: 'external', id: route.origin, generation: route.generation } });
  }

  async function withRouteGuidance(request, view, beforeClose) {
    if (!view.operationId) return view;
    const context = await shared(request);
    if (!context.adapters.some(adapter => typeof adapter.routeGuidance === 'function')) return view;
    try {
      const intent = await routeGuidanceScope({ ...request, handle: request.handle ?? view.handle }, view, context.registryId, beforeClose);
      const adapter = context.adapters.find(item => item.id === intent?.providerId);
      if (typeof adapter?.routeGuidance !== 'function') return view;
      const scope = { home: request.home, owner: intent.owner, providerId: adapter.id };
      const configuration = await context.embeddingServices.readConfiguration(scope);
      const currentConfiguration = configuration.revision === intent.configurationRevision;
      if (configuration.scopeId !== intent.scopeId || (!currentConfiguration && view.cleanup.state === 'none')) return view;
      const read = await readContextFor(context, request.home, context.platform, intent.owner);
      const listener = view.cleanup.state === 'none' && view.origin && URL.parse(view.origin);
      const routeContext = bindConfiguration({ ...read, origin: view.origin, route: structuredClone(view),
        ...(listener?.hostname && { localPort: Number(listener.port || (listener.protocol === 'https:' ? 443 : listener.protocol === 'http:' ? 80 : 0)) || undefined }),
        providerConfiguration: () => currentConfiguration ? structuredClone(configuration.values) : null,
      }, adapter.id);
      const action = await adapter.routeGuidance(routeContext);
      if (!action) return view;
      return { ...view, binding: { ...view.binding, remedy: safeSetupAction(action) } };
    } catch {
      // Missing guidance does not change the observed route or its proof.
      return view;
    }
  }

  // Observation replaces proof only for a host that declared the acknowledgment handler; without one, the earlier polling watch keeps proving.
  const observing = () => typeof deps.acknowledgeOrigin === 'function';
  const statusOf = (request, observe) => verified(async () => {
    const retained=await cleanupReferenceRecord(request,await services());
    if(retained){
      if(retained.phase!=='prepared')return retained.view;
      // Preparation is intent, not proof of removal. Consult the actual controller.
      let observed;
      try{observed=await viewStatus(request,{adapters:await adapters(),...deps.view,...(observe&&observing()?{observe}:{})});}
      catch(error){if(error.code!=='route_not_found')throw error;}
      const current=await cleanupReferenceRecord(request,await services());
      if(current?.phase!=='prepared')return current?.view??retained.view;
      if(!observed)return current.view;
      if(observed.handle?.kind!==request.handle.kind||observed.handle?.id!==request.handle.id||observed.handle?.generation!==request.handle.generation)
        throw gozarError('route_conflict','Current observation belongs to another handle');
      return observed;
    }
    return viewStatus(request,{adapters:await adapters(),...deps.view,...(observe&&observing()?{observe}:{})});
  },request);
  const routeStatus = request => statusOf(request, false);
  // The watch's read (internal, not part of the public API): the same view, observed rather than proven when a host acknowledgment is declared.
  const observeRoute = request => guard(async () => withRouteGuidance(request, await statusOf(request, true)));

  const api = {
    catalogRoutes: query => guard(()=>verified(async () => buildCatalog(query, { ...await shared(query), profileHome: deps.profileHome,
      pinnedAdapterId: async q => q.usage.kind === 'durable' ? (await engine()).durablePin({ home: q.home, routeId: q.usage.routeId }) : null }),query)),

    inspectLegacyRoute: request => guard(async () => (await legacy()).inspectLegacyRoute(request)),

    // The loaded adapters go to every durable engine call as an optional second argument; an engine that does not use it ignores it.
    ensureRoute: request => guard(async()=>withRouteGuidance(request,await withRouteOperation(request,{
      ...await shared(request),status:routeStatus,progress:attachedReplayProgress,
      prevalidate:async ({external})=>external?validateOwnerKeptEnsure(request):(await engine()).prevalidateDurableEnsure(request),
      run:()=>verified(async () => (await ownerKept(request)) ?? durableView((await (await engine()).ensureRoute(request, { adapters: await adapters() })).route),request)
    }))),
    adoptRoute: request => guard(() => verified(async () => durableView((await (await engine()).adoptRoute(request, { adapters: await adapters() })).route),request)),

    /** A request with schemaVersion 1 is the route API; anything else is the legacy session call (handled by the caller). */
    expose: request => guard(async () => {
      const options = { ...await shared(request), ...deps.expose };
      await preflightExpose(request, options);
      // Recheck the same executable registry snapshot that minted this factory's approval.
      // The detached receiver still verifies at admission for races after reservation.
      if (!deps.adapters) {
        const current = await registryIdentity({ manifest: deps.manifest, root: deps.root }).catch(() => null);
        if (current !== options.registryId) throw gozarError('artifact_integrity_failed', 'The route registry content changed');
      }
      if (request?.usage?.kind === 'attached') return withRouteGuidance(request,await withRouteOperation(request,{...options,status:routeStatus,progress:attachedReplayProgress,run:reservedHandle=>openAttachedRoute(request,{...options,reservedHandle})}));
      if (request?.usage?.kind === 'session') return withRouteGuidance(request,await withRouteOperation(request,{...options,status:routeStatus,progress:attachedReplayProgress,run:async reservedHandle=>(await verified(()=>ownerKept(request),request))??openSessionRoute(request,{...options,reservedHandle})}));
      throw gozarError('invalid_input', "expose needs usage 'session' or 'attached'");
    }),

    routeStatus: request => guard(async () => withRouteGuidance(request, await routeStatus(request))),
    closeRoute: request => guard(async () => {
      let reference;
      const view = await verified(async () => {
        const context=await services();
        const cleanupRuntime={...context,afterReferenceRelease:async()=>{
          try{await viewClose(request,{adapters:await adapters(),...deps.view,...(observing()?{observe:true}:{})});}
          catch(error){if(error.code!=='route_not_found')throw error;}
          await finishCleanupController(request);
        }};
        const retainedCleanup=await cleanupReferenceRecord(request,context);
        if(retainedCleanup&&request.mode!==undefined&&request.mode!=='remove')throw gozarError('invalid_input','Retained cleanup requires mode remove');
        const privateRetry=await retryCleanupReference(request,cleanupRuntime);
        if(privateRetry)return privateRetry;
        let cleanupScope=retainedCleanup?.scope;
        if(request.mode==='remove'&&['attached','session'].includes(request.handle?.kind)&&!cleanupScope){
          try{cleanupScope=await attachedCleanupReference(request,context);}
          catch(error){
            // A start refused before any controller existed journaled its own confirmed, resource-free view; no bootstrap is expected for it.
            const journaled=error.code==='cleanup_debt'?await retainedOperationView(request):null;
            if(journaled?.cleanup.state==='confirmed')return journaled;
            throw error;
          }
          if(cleanupScope)await prepareCleanupReference(cleanupScope);
        }
        // This path consumes only an exact private resource-removal milestone.
        const operationCleanupRuntime={...context,afterReferenceRelease:()=>finishCleanupController(request)};
        const retried=await retryRecordedReferenceCleanup(request,operationCleanupRuntime);
        if(retried)return retried;
        reference=await operationReferenceForRoute(request);
        if(request.owner!==undefined&&reference&&request.owner!==reference.owner)throw gozarError('route_conflict','The retained route belongs to a different owner');
        // Operation-bound bootstrap scope is admitted only with its exact operation reference.
        // Absence is not reference release: journal the debt before invoking current services.
        const operationScope=request.mode==='remove'&&reference&&['attached','session'].includes(request.handle?.kind)
          ?await attachedCleanupReference(request,context,reference):null;
        const reconcileRemoval=async()=>{
          if(!operationScope)return null;
          const evidence=await attachedRemovalEvidence(request,operationScope);
          if(!evidence)return null;
          await recordPendingReferenceCleanup({home:request.home,view:evidence,reference,scope:operationScope});
          return retryRecordedReferenceCleanup(request,operationCleanupRuntime);
        };
        const removed=await reconcileRemoval();
        if(removed)return removed;
        let view;
        try{view=await viewClose(request,{adapters:await adapters(),...deps.view,...(observing()?{observe:true}:{})});}
        catch(error){
          if(error.code!=='route_not_found')throw error;
          if(retainedCleanup)return retainedCleanup.view;
          const retained=await retainedOperationView(request);
          if(!retained)throw error;
          return retained;
        }
        const reconciled=await reconcileRemoval();
        if(reconciled)return reconciled;
        if(cleanupScope){
          const evidence=view.cleanup.state==='confirmed'?view:await attachedRemovalEvidence(request,cleanupScope);
          if(evidence){
            await recordCleanupRemoval(cleanupScope,evidence);
            return retryCleanupReference(request,cleanupRuntime);
          }
          return (await cleanupReferenceRecord(request,context)).view;
        }
        if(view.cleanup.state==='confirmed'&&['attached','session'].includes(request.handle.kind)){
          let debt=referenceCleanupDebt(view);
          try{
            debt=await recordPendingReferenceCleanup({home:request.home,view,reference});
            if(request.handle.kind==='attached')await releaseAttachedConfiguration(request,context);
            else await releaseSessionConfiguration(request,context);
            // Confirm the recorded exact hold too; a missing bootstrap cannot silently skip it.
            const released=await retryRecordedReferenceCleanup(request,context);
            if(released)view=released;
          }catch(cause){
            // Persisted pending milestone survives a new factory and missing route files.
            const error=gozarError('cleanup_debt','Resource removal is confirmed but configuration reference release is unconfirmed',
              debt.cleanup.nextAction,cause);
            error.route=referenceCleanupDebt(debt);
            throw error;
          }
        }
        return recordOperationView({home:request.home,view,reference});
      },request);
      return withRouteGuidance(request,view,reference);
    }),
    suspendRoute: request => guard(() => verified(async () => viewSuspend(request, { adapters: await adapters(), ...deps.view }),request)),
    watchRoutes:async function*(request){try{for await(const event of pollRoutes(request,{routeStatus:observeRoute,...deps.watch}))yield structuredClone(event);}catch(error){throw publicError(error);}},
    getRoutePreferences, setRoutePreferences,
    runSetupAction: request => guard(async () => {
      const context=await setupDeps(request);
      const outcome = request && typeof request === 'object' && ('operationId' in request || 'expectedSetupRevision' in request)
        ? await runSetupOperation(request,context) : await runSetup(request,context);
      // A completed setup or artifact action changed what detection observes: the scope's next read
      // answers declared unknown until an explicit refresh.
      detection.invalidate({ registryId: context.registryId, home: request.home, owner: request.owner, providerId: request.providerId });
      return outcome;
    }),
    readSetupOperation: request => guard(async () => readSetupOperation(request,await setupDeps(request))),
    cancelSetupOperation: request => guard(async () => cancelSetupOperation(request,await setupDeps(request))),
    listProviders: request => guard(()=>admitted(request,async admission=>inventory(request,await shared(request),admission))),
    listRoutes:request=>guard(async()=>{
      const context=await shared(request);
      const base=await listRecordedRoutes(request,context),retained=await listCleanupReferences(request);
      const key=handle=>JSON.stringify([handle.kind,handle.id,handle.generation]);
      const views=new Map(base.routes.map(view=>[key(view.handle),view]));
      for(const view of retained){
        if([...views.values()].some(other=>other.handle.kind===view.handle.kind&&other.handle.id===view.handle.id&&other.handle.generation>view.handle.generation))continue;
        const current=await cleanupReferenceRecord({...request,handle:view.handle},context);
        if(!current)continue;
        if(key(current.scope.handle)!==key(view.handle)||key(current.view.handle)!==key(view.handle))
          throw gozarError('route_conflict','Cleanup observation belongs to another handle');
        // Preparation is only fallback metadata; it cannot erase a live observation.
        if(current.phase!=='prepared'||!views.has(key(view.handle)))views.set(key(view.handle),current.view);
      }
      return {routes:[...views.values()]};
    }),
    ...Object.fromEntries(['storeSecret','discardSecret','discardConfigurationDraft','adoptConfiguration'].map(method=>[method,request=>guard(async()=>{const resolved=await services();const result=await resolved.embeddingServices[method](request);
      // A stored or discarded secret or draft changes what a scope offers: its retained detection is dropped.
      detection.invalidate({registryId:resolved.registryId,home:request.home,owner:request.owner,providerId:request.providerId});return result;})])),
    beginConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const draft=await context.embeddingServices.beginConfigurationDraft(request);
      const offered=await offeredConfiguration({...request,draftId:draft.draftId},draft.configuration,context);
      return {...draft,configuration:offered.configuration,...(offered.detection?{detection:offered.detection}:{})};}),
    readConfigurationDraft:request=>guard(()=>admitted(request,async admission=>readConfigurationDraft(request,await shared(request),admission))),
    commitConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const snapshot=await context.embeddingServices.commitConfigurationDraft(request);
      // The applied configuration moved: the scope's next read answers declared unknown until an explicit refresh.
      detection.invalidate({ registryId: context.registryId, home: request.home, owner: request.owner, providerId: request.providerId });
      const offered=await offeredConfiguration({...request,draftId:undefined},snapshot,context);
      return {...offered.configuration,...(offered.detection?{detection:offered.detection}:{})};}),
    clearConfigurationInput:request=>guard(async()=>{const context=await setupDeps(request);const result=await clearConfigurationInput(request,context);detection.invalidate({registryId:context.registryId,home:request.home,owner:request.owner,providerId:request.providerId});return result;}),
    reviewRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(()=>reviewExternalConsent(request),request):request.handle?.kind==='session'?sessionConsent(request,{adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>(await engine()).reviewDurableConsent(request),request):reviewAttachedConsent(request)),
    approveRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(async()=>projectExternal(await approveExternalConsent(request),{handle:request.handle}),request):request.handle?.kind==='session'?sessionConsent(request,{approve:true,adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>durableView(await (await engine()).approveDurableConsent(request)),request):approveAttachedConsent(request)),
    resolveClientAddress,
  };
  return api;
}
