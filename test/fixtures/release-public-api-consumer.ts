// Compile only, never execute. Bare imports must resolve the materialized installed package.
import {
 createGozar, type GozarOptions, type Query, type Requirements, type Fact,
 type SetupConsentSnapshot, type RouteConsentSnapshot, type GozarThrownError,
 type RouteView, type SecretBackend, type HostIdentity,
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
