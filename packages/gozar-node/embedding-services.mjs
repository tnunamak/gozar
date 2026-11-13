// Factory-scoped configuration transactions. Only opaque references reach disk.
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome,withExclusiveLock} from './service-state.mjs';
import {atomicWrite} from './journal.mjs';
import {storeSecret,withSecret,deleteSecret} from './secret-store.mjs';

export const embeddingError=(code)=>Object.assign(new Error(code.replaceAll('_',' ')),{code,nextAction:null});
const fail=code=>{throw embeddingError(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const fresh=()=>randomUUID();
const clone=value=>structuredClone(value);
export function createEmbeddingServices({registryId,secretBackend,hostCapabilities={},identity}={}){
 if(typeof registryId!=='string'||!registryId)fail('invalid_input');
 const backend=home=>secretBackend??{
  put:({bytes})=>storeSecret({home,value:bytes}),
  withSecret:({handle},use)=>withSecret(home,handle,use),
  presence:async({handle})=>{try{await withSecret(home,handle,async()=>{});return {known:true,value:true};}catch(e){if(e.code==='setup_required')return {known:true,value:false};throw e;}},
  delete:async({handle})=>{await deleteSecret(home,handle);return {deleted:true};},
 };
 const call=async(home,method,...args)=>{try{return await backend(home)[method](...args);}catch(e){throw embeddingError(e?.code==='secret_backend_locked'?'secret_backend_locked':'secret_backend_unavailable');}};
 async function transaction(home,run){
  home=await canonicalHome(home,true);
  return withExclusiveLock(join(home,'.embedding-lock'),async()=>{
   let state;try{state=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={schemaVersion:1,configs:{},secrets:{},instanceId:fresh()};}
   const result=await run(state,home);await atomicWrite(join(home,'embedding-state.json'),state);return result;
  },{waitSeconds:30});
 }
 const scope=(home,providerId,owner)=>{if(typeof providerId!=='string'||!providerId)fail('invalid_input');return hash(JSON.stringify([registryId,home,owner??null,providerId]));};
 const config=(state,home,providerId,owner)=>{const scopeId=scope(home,providerId,owner);return state.configs[scopeId]??=( {scopeId,revision:fresh(),bindings:{},values:{},drafts:{},uses:[]} );};
 const select=(c,draftId)=>draftId?(c.drafts[draftId]??fail('configuration_stale')):c;
 const compare=(c,revision)=>{if(c.revision!==revision)fail('configuration_stale');};
 async function redacted(home,c){
  const credentials={};for(const [id,handle]of Object.entries(c.bindings)){try{credentials[id]=await call(home,'presence',{scopeId:c.scopeId,handle});}catch(e){credentials[id]={known:false,reason:e.code};}}
  return {scopeId:c.scopeId,revision:c.revision,values:clone(c.values),credentials};
 }
 const referenced=(state,handle)=>Object.values(state.configs).some(c=>Object.values(c.bindings).includes(handle)||Object.values(c.drafts).some(d=>Object.values(d.bindings).includes(handle)));
 async function remove(state,home,handle){const ref=state.secrets[handle];if(!ref||ref.registryId!==registryId)return {discarded:false};if(referenced(state,handle))fail('secret_in_use');await call(home,'delete',{scopeId:ref.scopeId,handle});delete state.secrets[handle];return {discarded:true};}
 const api={hostCapabilities,
  readConfiguration:r=>transaction(r.home,async(s,h)=>redacted(h,select(config(s,h,r.providerId,r.owner),r.draftId))),
  resolveConfiguration:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner),values=clone(c.values);for(const[id,handle]of Object.entries(c.bindings))values[id]=await call(h,'withSecret',{scopeId:c.scopeId,handle},async bytes=>new TextDecoder().decode(bytes));return Object.keys(values).length?values:null;}),
  resolveIdentity:({home,bootId}={})=>transaction(home,async s=>identity?clone(identity):{instanceId:s.instanceId,bootId:bootId??boot}),
  storeSecret:r=>transaction(r.home,async(s,h)=>{
   const c=select(config(s,h,r.providerId,r.owner),r.draftId);compare(c,r.expectedConfigurationRevision);if(c.scopeId!==r.scopeId||typeof r.inputId!=='string'||!r.inputId)fail('invalid_input');
   if(!(r.bytes instanceof Uint8Array)||!r.bytes.length||r.bytes.length>65536)fail('invalid_input');
   const bytes=new Uint8Array(r.bytes);let result;try{result=await call(h,'put',{scopeId:c.scopeId,inputId:r.inputId,revision:c.revision,bytes});}finally{bytes.fill(0);}
   if(typeof result?.handle!=='string'||!result.handle||s.secrets[result.handle])fail('secret_backend_unavailable');
   s.secrets[result.handle]={registryId,scopeId:c.scopeId,inputId:r.inputId,revision:c.revision,draftId:r.draftId??null};return {handle:result.handle};
  }),
  mutateConfiguration:(r,effect)=>transaction(r.home,async(s,h)=>{
   const applied=config(s,h,r.providerId,r.owner),c=select(applied,r.draftId);compare(c,r.expectedConfigurationRevision);if(!r.draftId&&applied.uses.length)fail('configuration_in_use');
   const next={...c,bindings:clone(c.bindings),values:clone(c.values)};let changed=false;
   const tx={resolveConfiguration:async()=>{const values=clone(c.values);for(const[id,handle]of Object.entries(c.bindings))values[id]=await call(h,'withSecret',{scopeId:c.scopeId,handle},async bytes=>new TextDecoder().decode(bytes));return Object.keys(values).length?values:null;},configuration:()=>redacted(h,c),withSecret:async(inputId,handle,use)=>{const ref=s.secrets[handle];if(!ref||ref.registryId!==registryId||ref.scopeId!==c.scopeId||ref.inputId!==inputId||ref.revision!==c.revision||ref.draftId!==(r.draftId??null))fail('invalid_input');return call(h,'withSecret',{scopeId:c.scopeId,handle},use);},
    bindSecret:async(inputId,handle)=>{await tx.withSecret(inputId,handle,async()=>{});next.bindings[inputId]=handle;delete next.values[inputId];changed=true;},
    bindText:(inputId,value)=>{next.values[inputId]=value;delete next.bindings[inputId];changed=true;},markChanged:()=>{changed=true;}};
   const result=await effect(tx);if(changed){next.revision=fresh();if(r.draftId)applied.drafts[r.draftId]=next;else s.configs[c.scopeId]=next;}
   return {result,configuration:await redacted(h,next)};
  }),
  beginConfigurationDraft:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner);compare(c,r.expectedConfigurationRevision);const draftId=fresh();const d={scopeId:c.scopeId,revision:fresh(),baseRevision:c.revision,bindings:clone(c.bindings),values:clone(c.values)};c.drafts[draftId]=d;return {draftId,scopeId:c.scopeId,baseRevision:c.revision,configuration:await redacted(h,d)};}),
  commitConfigurationDraft:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner),d=select(c,r.draftId);if(!r.draftId)fail('invalid_input');compare(d,r.expectedConfigurationRevision);compare(c,d.baseRevision);if(c.uses.length)fail('configuration_in_use');c.bindings=d.bindings;c.values=d.values;c.revision=fresh();delete c.drafts[r.draftId];return redacted(h,c);}),
  discardConfigurationDraft:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner),d=c.drafts[r.draftId];if(!d)return {discarded:false};const owned=Object.entries(s.secrets).filter(([,v])=>v.scopeId===c.scopeId&&v.draftId===r.draftId).map(([k])=>k);delete c.drafts[r.draftId];for(const handle of owned)if(!referenced(s,handle))await remove(s,h,handle);return {discarded:true};}),
  discardSecret:r=>transaction(r.home,(s,h)=>remove(s,h,r.handle)),
  registerConfigurationUse:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner);compare(c,r.revision);const key=JSON.stringify(r.handle);if(!c.uses.includes(key))c.uses.push(key);}),
  releaseConfigurationUse:r=>transaction(r.home,async(s,h)=>{const c=config(s,h,r.providerId,r.owner);c.uses=c.uses.filter(x=>x!==JSON.stringify(r.handle));}),
 };
 const boot=fresh();return api;
}
export const defaultEmbeddingServices=createEmbeddingServices({registryId:'cli-default'});
