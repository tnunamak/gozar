import type {Configuration,Reach,Properties,Prerequisite,Fact,Action,Availability} from './route-contract.js';
/** Additive host embedding contract for Gozar 0.4.0. Trusted host APIs only. */
export type Observation<T> = {known:true;value:T}|{known:false;reason:string};
export type HostCapabilityId = 'installer.execute'|'privilege.elevate'|'secrets.backend'|'runtime.attached'|'runtime.durable'|(string & {});
export type HostCapabilities = Partial<Record<HostCapabilityId,Observation<boolean|string>>>;
export interface HostIdentity {instanceId:string;bootId:string}
export interface SecretBackend {
 put(request:{scopeId:string;inputId:string;revision:string;bytes:Uint8Array}):Promise<{handle:string}>;
 withSecret<T>(request:{scopeId:string;handle:string},use:(bytes:Uint8Array)=>Promise<T>):Promise<T>;
 presence(request:{scopeId:string;handle:string}):Promise<Observation<boolean>>;
 delete(request:{scopeId:string;handle:string}):Promise<{deleted:boolean}>;
}
export interface ConfigurationSnapshot {revision:string;scopeId:string;values:Record<string,string>;credentials:Record<string,Observation<boolean>>}
export interface ConfigurationRequest {home:string;owner?:string;providerId:string;expectedConfigurationRevision:string;draftId?:string}
export type DetectionFreshness={checkedAt:string|null;fresh:boolean;refreshing:boolean};
export interface ConfigurationDraft {draftId:string;scopeId:string;baseRevision:string;configuration:Configuration;detection?:DetectionFreshness}
export interface HostEmbeddingMethods {
 storeSecret(request:ConfigurationRequest&{inputId:string;scopeId:string;bytes:Uint8Array}):Promise<{handle:string;configurationRevision:string;scopeId:string}>;
 readConfigurationDraft(request:{home:string;owner?:string;providerId:string;draftId:string;refresh?:boolean}):Promise<ConfigurationDraft>;
 clearConfigurationInput(request:ConfigurationRequest&{draftId:string;inputId:string;approval:{kind:'setup';digest:string;disclosureRevision:string;consentFactsDigest:string}}):Promise<Configuration&{detection?:DetectionFreshness}>;
 beginConfigurationDraft(request:ConfigurationRequest&{refresh?:boolean}):Promise<ConfigurationDraft>;
 commitConfigurationDraft(request:ConfigurationRequest&{draftId:string}):Promise<Configuration&{detection?:DetectionFreshness}>;
 discardConfigurationDraft(request:{home:string;owner?:string;providerId:string;draftId:string}):Promise<{discarded:boolean}>;
 discardSecret(request:{home:string;handle:string}):Promise<{discarded:boolean}>;
 /** Trusted host decision: carry the one earlier configuration saved under `fromRegistryId` into the stable scope. Refuses with configuration_migration_required when nothing matches, the saved inputs do not fit, a draft or operation is open, or a configuration already exists. */
 adoptConfiguration(request:{home:string;owner?:string;providerId:string;fromRegistryId:string}):Promise<Configuration>;
 listProviders(request:{home:string;owner?:string;hostCapabilities?:HostCapabilities;refresh?:boolean}):Promise<{schemaVersion:number;catalogRevision:string;observedAt:string;providers:ProviderInventory[]}>;
}
export interface ProviderInventory {
 providerId:string;label:string;reach:Reach;transport:Properties['transport'];
 availability:Availability;
 prerequisites:Prerequisite[];configuration:Configuration;facts:Fact[];
 /** Present when the host factory caches polling reads: the honest freshness of this row's detection. */
 detection?:DetectionFreshness;
}
export interface RouteBinding {authority:'adapter'|'owner'|'unknown';target:Observation<string>;remedy:Action|null}
