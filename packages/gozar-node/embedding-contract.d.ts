/** Additive host embedding contract for Gozar 0.4.0. Trusted host APIs only. */
export type Observation<T> = {known:true;value:T}|{known:false;reason:string};
export type HostCapabilities = Record<string,Observation<boolean|string>>;
export interface HostIdentity {instanceId:string;bootId:string}
export interface SecretBackend {
 put(request:{scopeId:string;inputId:string;revision:string;bytes:Uint8Array}):Promise<{handle:string}>;
 withSecret<T>(request:{scopeId:string;handle:string},use:(bytes:Uint8Array)=>Promise<T>):Promise<T>;
 presence(request:{scopeId:string;handle:string}):Promise<Observation<boolean>>;
 delete(request:{scopeId:string;handle:string}):Promise<{deleted:boolean}>;
}
export interface ConfigurationSnapshot {revision:string;scopeId:string;values:Record<string,string>;credentials:Record<string,Observation<boolean>>}
export interface ConfigurationRequest {home:string;owner?:string;providerId:string;expectedConfigurationRevision:string;draftId?:string}
export interface ConfigurationDraft {draftId:string;scopeId:string;baseRevision:string;configuration:ConfigurationSnapshot}
export interface HostEmbeddingMethods {
 storeSecret(request:ConfigurationRequest&{inputId:string;scopeId:string;bytes:Uint8Array}):Promise<{handle:string}>;
 beginConfigurationDraft(request:ConfigurationRequest):Promise<ConfigurationDraft>;
 commitConfigurationDraft(request:ConfigurationRequest&{draftId:string}):Promise<ConfigurationSnapshot>;
 discardConfigurationDraft(request:{home:string;owner?:string;providerId:string;draftId:string}):Promise<{discarded:boolean}>;
 discardSecret(request:{home:string;handle:string}):Promise<{discarded:boolean}>;
 listProviders(request:{home:string;owner?:string;hostCapabilities?:HostCapabilities}):Promise<{schemaVersion:number;catalogRevision:string;observedAt:string;providers:ProviderInventory[]}>;
}
export interface ProviderInventory {
 providerId:string;label:string;reach:string;transport:string;
 availability:Record<'session'|'attached'|'durable',{state:string;reason:string}>;
 prerequisites:unknown[];configuration:ConfigurationSnapshot&{inputRequirements:unknown[];actions:unknown[]};facts:unknown[];
}
export interface RouteBinding {authority:'adapter'|'owner'|'unknown';target:Observation<string>;remedy:unknown|null}
