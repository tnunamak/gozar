// Compile only, never execute. Bare imports must resolve the materialized installed package.
import {
 createGozar, type GozarOptions, type Query, type Requirements, type Fact,
 type SetupConsentSnapshot, type RouteConsentSnapshot, type GozarThrownError,
 type RouteView, type SecretBackend, type HostIdentity,
 type RunSetupOperationRequest, type SetupOperation,
} from '@tnunamak/gozar';
import {
 createTestingGozar, fakeRegistry, type TestingEffect, type NetworkEffectRequest,
 type NetworkEffectResult, type SpawnEffectRequest, type SpawnEffectResult,
 type ArtifactEffectRequest, type ArtifactEffectResult, type TestingHarness,
} from '@tnunamak/gozar/testing';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;
type Api = ReturnType<typeof createGozar>;
type Catalog = Awaited<ReturnType<Api['catalogRoutes']>>;
type Draft = Awaited<ReturnType<Api['beginConfigurationDraft']>>;
type DraftRead = Awaited<ReturnType<Api['readConfigurationDraft']>>;
type Setup = Awaited<ReturnType<Api['runSetupAction']>>;
type Inventory = Awaited<ReturnType<Api['listProviders']>>;
type Listed = Awaited<ReturnType<Api['listRoutes']>>;
type NotAny = [
 AssertFalse<IsAny<Api>>, AssertFalse<IsAny<Catalog>>,
 AssertFalse<IsAny<RouteView['consentFactsDigest']>>, AssertFalse<IsAny<RouteView['consentChange']>>,
 AssertFalse<IsAny<Catalog['candidates'][number]>>,
 AssertFalse<IsAny<Draft>>, AssertFalse<IsAny<DraftRead>>,
 AssertFalse<IsAny<Setup>>, AssertFalse<IsAny<Setup['configuration']>>,
 AssertFalse<IsAny<Inventory>>, AssertFalse<IsAny<Listed['routes'][number]>>,
 AssertFalse<IsAny<TestingHarness['gozar']>>, AssertFalse<IsAny<SecretBackend>>,
 AssertFalse<IsAny<HostIdentity>>, AssertFalse<IsAny<GozarThrownError['route']>>,
 AssertFalse<IsAny<Awaited<ReturnType<Api['expose']>>>>,
 AssertFalse<IsAny<Awaited<ReturnType<Api['closeRoute']>>>>,
 AssertFalse<IsAny<Awaited<ReturnType<Api['commitConfigurationDraft']>>>>,
 AssertFalse<IsAny<Awaited<ReturnType<Api['reviewRouteConsent']>>>>,
];

// Existing runtime/schema fields, consumed through installed public declarations.
type RouteConsentFields=Pick<RouteView,'consentFactsDigest'|'consentChange'>;
const absentConsentFields:RouteConsentFields={};
const nullableConsentDigest:RouteConsentFields={consentFactsDigest:null};
const changedConsentFields:RouteConsentFields={
 consentFactsDigest:'current',
 consentChange:{oldDigest:'previous',newDigest:'current',nextAction:null,reason:'configuration-changed'},
};
// @ts-expect-error A digest is nullable text, not a number.
const badConsentDigest:RouteConsentFields={consentFactsDigest:123};
// @ts-expect-error consentChange is optional, but is not nullable.
const badConsentChange:RouteConsentFields={consentChange:null};
// @ts-expect-error All four consentChange members are required.
const incompleteConsentChange:RouteConsentFields={consentChange:{oldDigest:'old',newDigest:'new',nextAction:null}};
type InventoryAvailability=Inventory['providers'][number]['availability'];
const supportedAvailability:InventoryAvailability={
 session:{state:'available',reason:'admitted'},
 attached:{state:'detect-only',reason:'inspection-only'},
 durable:{state:'unsupported',reason:'usage-not-supported'},
};
// @ts-expect-error Setup readiness is not provider availability.
const readyAvailability:InventoryAvailability['session']={state:'ready',reason:'not-availability'};
// @ts-expect-error Setup actions are not provider availability.
const actionAvailability:InventoryAvailability['attached']={state:'action-required',reason:'not-availability'};
// @ts-expect-error Unknown readiness is not provider availability.
const unknownAvailability:InventoryAvailability['durable']={state:'unknown',reason:'not-availability'};
function consumeRouteMetadata(route:RouteView){
 const digest:string|null|undefined=route.consentFactsDigest;
 if(route.consentChange){
  const oldDigest:string=route.consentChange.oldDigest;
  const newDigest:string=route.consentChange.newDigest;
  const reason:string=route.consentChange.reason;
  const nextAction:RouteView['binding']['remedy']=route.consentChange.nextAction;
  if(nextAction){const label:string=nextAction.label;const actionDigest:string=nextAction.digest;void label;void actionDigest;}
  void oldDigest;void newDigest;void reason;
 }
 const authority:'adapter'|'owner'|'unknown'=route.binding.authority;
 const target=route.binding.target;
 if(target.known){const value:string=target.value;void value;}
 else {const reason:string=target.reason;void reason;}
 const expires=route.expiresAt;
 if(expires.known){const value:string=expires.value;void value;}
 else {const reason:string=expires.reason;void reason;}
 if(route.binding.remedy){
  const kind:NonNullable<RouteView['binding']['remedy']>['kind']=route.binding.remedy.kind;
  const label:string=route.binding.remedy.label;
  void kind;void label;
 }
 void digest;void authority;
}

declare const backend: SecretBackend;
declare const identity: HostIdentity;
const options: GozarOptions = {secretBackend:backend,identity,
 manifest:{providers:[{id:'arbitrary-extension',module:'extension.mjs',definition:'extension.json'}]},root:'/installed/extensions'};
const api=createGozar(options);
const requirements: Requirements = {reach:'internet',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]};
const query:Query={schemaVersion:1,owner:'fixture-owner',home:'/fixture/home',target:'127.0.0.1:8080',usage:{kind:'session',lifetimeMs:60000},requirements,operationId:'replay-operation'};
const tls:Requirements={...requirements,transport:'tls'};
const fact:Fact={id:'extension.fact',label:'Extension fact',group:'extension',value:null,known:false,reason:'unobserved',source:'fixture',asOf:null,affectsConsent:true};
declare const setupSnapshot:SetupConsentSnapshot;
declare const routeSnapshot:RouteConsentSnapshot;
const setupAction=setupSnapshot.disclosures.action;
const routeTraffic=routeSnapshot.disclosures.traffic;
const setupKind:'setup'=setupSnapshot.scope.kind;
const routeKind:'route'=routeSnapshot.scope.kind;
// @ts-expect-error Setup snapshots do not have route traffic disclosures.
setupSnapshot.disclosures.traffic;
// @ts-expect-error Route snapshots do not have setup action disclosures.
routeSnapshot.disclosures.action;
// @ts-expect-error Unknown is an observation, never requested reach.
const badRequirements:Requirements={...requirements,reach:'unknown'};
// @ts-expect-error Non-HTTP transport is a literal union, not arbitrary text.
const badTransport:Requirements={...requirements,transport:'udp'};
declare const begin:Parameters<Api['beginConfigurationDraft']>[0];
declare const read:Parameters<Api['readConfigurationDraft']>[0];
declare const commit:Parameters<Api['commitConfigurationDraft']>[0];
declare const setup:Parameters<Api['runSetupAction']>[0];
declare const expose:Parameters<Api['expose']>[0];
async function consume(){
 const catalog=await api.catalogRoutes(query);
 const candidate=catalog.candidates[0];
 const consent:RouteConsentSnapshot=candidate.consent;
 const draft=await api.beginConfigurationDraft(begin);
 const current=await api.readConfigurationDraft(read);
 const configured=await api.commitConfigurationDraft(commit);
 const result=await api.runSetupAction(setup);
 const revision:string=result.configurationRevision;
 const scope:string=result.scopeId;
 const values:Record<string,string>=result.configuration.values;
 const route:RouteView=await api.expose(expose);
 consumeRouteMetadata(route);
 const inventory=await api.listProviders({home:query.home,owner:query.owner});
 const availability:InventoryAvailability=inventory.providers[0].availability;
 const availabilityState:'available'|'detect-only'|'unsupported'=availability.attached.state;
 void availabilityState;
 const replay:RouteView=await api.expose(expose);
 const listed=await api.listRoutes({home:query.home,owner:query.owner});
 const exact:RouteView[]=listed.routes;
 const closed=await api.closeRoute({home:query.home,handle:route.handle,mode:'remove'});
 const cleanup:'none'|'unconfirmed'|'confirmed'=closed.cleanup.state;
 const review=await api.reviewRouteConsent({home:query.home,handle:route.handle});
 const snapshot:RouteConsentSnapshot=review;
 return {consent,draft,current,configured,revision,scope,values,replay,exact,cleanup,snapshot};
}
declare const error:GozarThrownError;
const debt:RouteView|undefined=error.route;
// @ts-expect-error Cleanup route is a typed view, not a string.
const badDebt:string=error.route;
// @ts-expect-error close requires an exact structured handle.
api.closeRoute({home:'/fixture',handle:'route-id',mode:'remove'});
// @ts-expect-error A setup approval cannot authorize route exposure.
api.expose({...expose,approval:{kind:'setup',consentFactsDigest:'fixture',digest:'fixture',disclosureRevision:'fixture'}});
const effect:TestingEffect={kind:'extension',operation:'observe',async handle(input,context){
 const signal:AbortSignal=context.signal;const fixture:true=context.fixture;
 return {input,aborted:signal.aborted,fixture};
}};
const network:NetworkEffectRequest={kind:'network',operation:'exchange',input:{endpoint:'127.0.0.1:8080',transport:'tcp',bytes:'',pinnedCertificate:null,deadlineMs:1000}};
const networkResult:NetworkEffectResult={bytes:''};
const spawn:SpawnEffectRequest={kind:'spawn',operation:'run',input:{program:'fixture',args:[],longRunning:false}};
const spawned:SpawnEffectResult={stdout:'',stderr:'',exitCode:0};
declare const artifact:ArtifactEffectRequest;
const fetched:ArtifactEffectResult={bytes:''};
// @ts-expect-error Network effect transport is not arbitrary.
const invalidNetwork:NetworkEffectRequest={kind:'network',operation:'exchange',input:{endpoint:'fixture',transport:'udp',bytes:'',pinnedCertificate:null,deadlineMs:1}};
// @ts-expect-error Fixture handlers must return JSON-compatible results.
const invalidEffect:TestingEffect={kind:'fixture',operation:'bad',async handle(){return ()=>{};}};
async function fixtures(){
 const registry=await fakeRegistry({id:'arbitrary-extension',kinds:['attached','session'],reach:'internet',transport:'tls',facts:[fact],proofProtocol:'echo'});
 const harness=await createTestingGozar({...options,effects:[effect]});
 try{return await harness.gozar.catalogRoutes({...query,requirements:tls});}
 finally{await harness.close();await registry.cleanup();}
}
void consume;void fixtures;void setupAction;void routeTraffic;void setupKind;void routeKind;
void debt;void network;void networkResult;void spawn;void spawned;void artifact;void fetched;
export type PublicTypesRemainSpecific=NotAny;

// Draft overload and legacy result must both resolve through the installed public root.
declare const setupOperation: RunSetupOperationRequest;
async function consumeSetupOperation(api: Api) {
 const view: SetupOperation = await api.runSetupAction(setupOperation);
 const read: SetupOperation = await api.readSetupOperation(setupOperation);
 const interactive = await api.readSetupOperation({ ...setupOperation, includeBrowserHandoff: true });
 const href: string | undefined = interactive.nextAction?.href;
 // @ts-expect-error the interactive result type requires opting in on the call
 await api.readSetupOperation<true>(setupOperation);
 // @ts-expect-error operation results exclude raw canonical input
 void read.nextAction?.review;
 void href;
 const cancelled: SetupOperation = await api.cancelSetupOperation(setupOperation);
 return [view, read, cancelled];
}
