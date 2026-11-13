import type {GozarOptions,createGozar} from './route-contract';
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface TestingEffectContext {signal:AbortSignal;fixture:true}
export interface TestingEffect {kind:string;operation:string;handle(input:JsonValue,context:TestingEffectContext):Promise<JsonValue>}
/** Exact initial SDK effect operations. Handler input may include synthetic credentials; trace never does. */
export type ListenerEffectRequest =
 | {kind:'sdk-listener';operation:'detect';input:Record<string,never>}
 | {kind:'sdk-listener';operation:'open';input:{options:{addr:string;authtoken:string;domain?:string;proto?:'tcp'|'tls';remote_addr?:string}}}
 | {kind:'sdk-listener';operation:'read'|'close';input:{handle:string}};
export type ListenerEffectResult = {available:boolean}|{handle:string;url:string}|{present:false}|{present:true;url:string}|{closed:boolean};
export type NetworkEffectRequest =
 | {kind:'network';operation:'fetch';input:{url:string;method:string;headers:Record<string,string>}}
 | {kind:'network';operation:'exchange';input:{endpoint:string;transport:'tcp'|'tls';bytes:string;pinnedCertificate:string|null;deadlineMs:number}};
export type NetworkEffectResult =
 | {status:number;headers:Record<string,string>;chunks:{data:string;delayMs:number}[]}
 | {bytes:string;certificate?:string};
export interface TestingHarness {gozar:ReturnType<typeof createGozar>;events:{sequence:number;kind:string;operation:string;state:'requested'|'completed'|'failed';fixture:true}[];close():Promise<void>}
export function createTestingGozar(options:GozarOptions&{effects:TestingEffect[]}):Promise<TestingHarness>;
