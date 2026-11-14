// The consumer API (route-contract.d.ts), wired from the modules that own each part. Apps call these by
// requirement and never name a provider: the catalog picks candidates from the adapter registry, a single-use
// consent token carries the user's approval, and every reply is a RouteView or a GozarThrownError.
//
// `createRouteApi(deps)` exists so a test can replace the adapter registry, platform or state loaders; the
// package root exports the instance with real dependencies. Nothing here names a provider.
import { catalogRoutes as buildCatalog } from './route-catalog.mjs';
import { routeStatus as viewStatus, closeRoute as viewClose, suspendRoute as viewSuspend, projectDurable, propertiesFor } from './route-view.mjs';
import { watchRoutes as pollRoutes } from './route-watch.mjs';
import { getRoutePreferences, setRoutePreferences } from './route-preferences.mjs';
import { runSetupAction as runSetup } from './route-setup.mjs';
import { openAttachedRoute, openSessionRoute, redeemApproval,reviewAttachedConsent,approveAttachedConsent,releaseAttachedConfiguration,releaseSessionConfiguration,sessionConsent } from './attached-route.mjs';
import { peekConsentGrant } from './consent-token.mjs';
import { projectExternal } from './route-view.mjs';
import { resolveClientAddress } from './ingress.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { createEmbeddingServices } from './embedding-services.mjs';
import { listProviders as inventory } from './embedding-inventory.mjs';
import { setupConsentReview,consentSnapshot } from './consent-facts.mjs';
import {offeredConfiguration,readConfigurationDraft,clearConfigurationInput} from './embedding-setup.mjs';
import {withRouteOperation,listRecordedRoutes,recordOperationView,operationReferenceForRoute} from './route-operations.mjs';
import {withServiceContext,reviewExternalConsent,approveExternalConsent} from './service.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';

const lazy = loader => { let loaded; return () => (loaded ??= loader()); };
const engine = lazy(() => import('./durable-route.mjs'));
const legacy = lazy(() => import('./legacy-import.mjs'));
const runtime = lazy(() => import('./adapter-runtime.mjs'));

export function createRouteApi(deps = {}) {
  const platform = () => deps.platform ?? process.platform;
  let loaded;
  const adapters = async () => deps.adapters ?? (loaded ??= runtime().then(module => module.loadAdapters(deps.manifest ? { manifest: deps.manifest, root: deps.root } : undefined)).catch(error => { loaded = undefined; throw error; }));
  let servicesPromise;
  const services = () => servicesPromise ??= (async()=>{
    const registryId = await registryIdentity({...deps,adapters:deps.adapters});
    return {registryId,embeddingServices:deps.embeddingServices??createEmbeddingServices({registryId,secretBackend:deps.secretBackend,hostCapabilities:deps.hostCapabilities,identity:deps.identity})};
  })();
  const shared = async (request={}) => { const resolved=await services(); return ({ adapters: await adapters(), platform: platform(), ...resolved, owner:request.owner,home:request.home,
    ...(deps.manifest ? { registry: { manifest: deps.manifest, root: deps.root } } : {}),
    hostCapabilities:deps.hostCapabilities??{}, ...(deps.dispatchEffect?{dispatchEffect:deps.dispatchEffect}:{}),
    ...(deps.readContext ? { readContext: deps.readContext } : {}),
    decorateSetupAction:({action,adapter,configuration,draftId=null,inspection})=>{
      const review=setupConsentReview({registryId:resolved.registryId,providerId:adapter.id,configuration,draftId,action,facts:catalogFactsFor(inspection??{adapter})});
      return {...action,consent:consentSnapshot(review),review:{canonicalInput:review.canonicalInput}};
    } }); };
  const publicError=cause=>{const normalized=normalizeError(cause),error=gozarError(normalized.code,normalized.message,normalized.nextAction?structuredClone(normalized.nextAction):null);if(normalized.route)error.route=structuredClone(normalized.route);return error;};
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
  async function ownerKept(request) {
    if (typeof request?.approval?.candidateToken !== 'string' || typeof request.home !== 'string') return undefined;
    let grant;
    try { grant = await peekConsentGrant({ home: request.home, token: request.approval.candidateToken }); } catch { return undefined; }
    const adapter = grant && (await adapters()).find(item => item.id === grant.adapterId);
    if (adapter?.definition.ownership !== 'external-owned') return undefined;
    if (request.usage?.kind !== 'durable' || (request.intent !== undefined && request.intent !== 'create')) throw gozarError('invalid_input', 'An owner-run route is created with usage durable and intent create');
    const redeemed = await redeemApproval(request, await shared(request));
    const service = deps.service?.addService ?? (await import('./service.mjs')).addService;
    const context=await shared(request),handle={kind:'external',id:redeemed.plan.origin,generation:0};
    await context.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:adapter.id,revision:redeemed.grant.configurationRevision,handle});
    const {approval,wait,...query}=request;
    const { route } = await service({ origin: redeemed.plan.origin, target: request.target, home: redeemed.home,embedding:{request:query,consentReview:redeemed.consentReview,operationId:request.operationId??null} });
    return projectExternal(route, { handle: { kind: 'external', id: route.origin, generation: 0 } });
  }

  const api = {
    catalogRoutes: query => guard(()=>verified(async () => buildCatalog(query, { ...await shared(query), profileHome: deps.profileHome,
      pinnedAdapterId: async q => q.usage.kind === 'durable' ? (await engine()).durablePin({ home: q.home, routeId: q.usage.routeId }) : null }),query)),

    inspectLegacyRoute: request => guard(async () => (await legacy()).inspectLegacyRoute(request)),

    // The loaded adapters go to every durable engine call as an optional second argument; an engine that does not use it ignores it.
    ensureRoute: request => guard(async()=>withRouteOperation(request,{...await shared(request),status:api.routeStatus,run:()=>verified(async () => (await ownerKept(request)) ?? durableView((await (await engine()).ensureRoute(request, { adapters: await adapters() })).route),request)})),
    adoptRoute: request => guard(() => verified(async () => durableView((await (await engine()).adoptRoute(request, { adapters: await adapters() })).route),request)),

    /** A request with schemaVersion 1 is the route API; anything else is the legacy session call (handled by the caller). */
    expose: request => guard(async () => {
      const options = { ...await shared(request), ...deps.expose };
      if (request?.usage?.kind === 'attached') return withRouteOperation(request,{...options,status:api.routeStatus,run:reservedHandle=>openAttachedRoute(request,{...options,reservedHandle})});
      if (request?.usage?.kind === 'session') return withRouteOperation(request,{...options,status:api.routeStatus,run:reservedHandle=>openSessionRoute(request,{...options,reservedHandle})});
      throw gozarError('invalid_input', "expose needs usage 'session' or 'attached'");
    }),

    routeStatus: request => guard(() => verified(async () => viewStatus(request, { adapters: await adapters(), ...deps.view }),request)),
    closeRoute: request => guard(() => verified(async () => {const reference=await operationReferenceForRoute(request);const view=await viewClose(request, { adapters: await adapters(), ...deps.view });if(view.cleanup.state==='confirmed'){if(request.handle.kind==='attached')await releaseAttachedConfiguration(request,await services());if(request.handle.kind==='session')await releaseSessionConfiguration(request,await services());}return recordOperationView({home:request.home,view,reference});},request)),
    suspendRoute: request => guard(() => verified(async () => viewSuspend(request, { adapters: await adapters(), ...deps.view }),request)),
    watchRoutes:async function*(request){try{for await(const event of pollRoutes(request,{routeStatus:r=>verified(async()=>viewStatus(r,{adapters:await adapters(),...deps.view}),r),...deps.watch}))yield structuredClone(event);}catch(error){throw publicError(error);}},
    getRoutePreferences, setRoutePreferences,
    runSetupAction: request => guard(async () => runSetup(request,await setupDeps(request))),
    listProviders: request => guard(async()=>inventory(request,await shared(request))),
    listRoutes:request=>guard(()=>listRecordedRoutes(request)),
    ...Object.fromEntries(['storeSecret','discardSecret','discardConfigurationDraft'].map(method=>[method,request=>guard(async()=> (await services()).embeddingServices[method](request))])),
    beginConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const draft=await context.embeddingServices.beginConfigurationDraft(request);return {...draft,configuration:await offeredConfiguration({...request,draftId:draft.draftId},draft.configuration,context)};}),
    readConfigurationDraft:request=>guard(async()=>readConfigurationDraft(request,await shared(request))),
    commitConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const snapshot=await context.embeddingServices.commitConfigurationDraft(request);return offeredConfiguration({...request,draftId:undefined},snapshot,context);}),
    clearConfigurationInput:request=>guard(async()=>clearConfigurationInput(request,await setupDeps(request))),
    reviewRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(()=>reviewExternalConsent(request),request):request.handle?.kind==='session'?sessionConsent(request,{adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>(await engine()).reviewDurableConsent(request),request):reviewAttachedConsent(request)),
    approveRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(async()=>projectExternal(await approveExternalConsent(request),{handle:request.handle}),request):request.handle?.kind==='session'?sessionConsent(request,{approve:true,adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>durableView(await (await engine()).approveDurableConsent(request)),request):approveAttachedConsent(request)),
    resolveClientAddress,
  };
  return api;
}
