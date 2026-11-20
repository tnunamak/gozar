// Factory-scoped configuration transactions. Only opaque references reach disk.
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {canonicalHome,withExclusiveLock,checkedFile,trustedDirectory,privateDirectory} from './service-state.mjs';
import {atomicWrite} from './journal.mjs';
import {storeSecret,withSecret,deleteSecret,handlePattern} from './secret-store.mjs';
import {BUNDLED_LINEAGE_ID,PUBLISHED_REGISTRY_IDS,isBundledLineage} from './registry-lineage.mjs';

export const embeddingError=(code)=>Object.assign(new Error(code.replaceAll('_',' ')),{code,nextAction:null});
const fail=code=>{throw embeddingError(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const fresh=()=>randomUUID();
const clone=value=>structuredClone(value);
// Internal holds are JSON data, not public RouteHandles. Keep the existing
// JSON.stringify representation (including key order); never normalize identity.
function reservationKey(value){
 const ancestors=new Set();
 const check=item=>{
  if(item===null||typeof item==='string'||typeof item==='boolean')return;
  if(typeof item==='number'){if(!Number.isFinite(item))fail('invalid_input');return;}
  if(typeof item!=='object'||ancestors.has(item))fail('invalid_input');
  const array=Array.isArray(item),prototype=Object.getPrototypeOf(item);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail('invalid_input');
  ancestors.add(item);
  const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
  if(array&&keys.length!==item.length+1)fail('invalid_input');
  for(const key of keys){
   if(array&&key==='length')continue;
   const descriptor=descriptors[key];
   if(typeof key!=='string'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('invalid_input');
   if(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=item.length))fail('invalid_input');
   check(descriptor.value);
  }
  ancestors.delete(item);
 };
 try{check(value);const key=JSON.stringify(value);if(typeof key!=='string')fail('invalid_input');return key;}
 catch{fail('invalid_input');}
}
const registryIdPattern=/^registry-v1:[0-9a-f]{64}$/,lineageIdPattern=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const refuseMigration=reason=>{throw Object.assign(embeddingError('configuration_migration_required'),{reason,message:`configuration migration required: ${{
 ambiguous:'more than one earlier configuration matches this provider; choose one with adoptConfiguration({fromRegistryId})',
 incompatible:'the saved inputs do not match the inputs this release can carry forward; nothing was changed',
 taken:'the earlier configuration already moved to another registry lineage',
 conflict:'a configuration already exists here; discard it before adopting an earlier one',
 absent:'no earlier configuration exists for this home, owner and provider under that registry',
 inflight:'a setup draft, setup operation or operation-held credential is still open for the earlier configuration; finish or discard it first',
 in_use:'a route still holds the earlier configuration; remove that route (or release its exact handle) first. Nothing was changed',
}[reason]}`});};
// `lineage` gives the storage a stable custodian name: {id, replaces:[earlier registry ids]}.
// Only the bundled lineage may use the reserved name and the published registry ids. The lineage names whose scope may be
// recomputed; it never says which saved inputs are valid. The provider's current declaration does (`currentInputKinds`).
function checkedLineage(lineage){
 if(lineage===undefined||isBundledLineage(lineage))return lineage;
 if(!plain(lineage)||Object.keys(lineage).some(key=>!['id','replaces'].includes(key))||typeof lineage.id!=='string'||!lineageIdPattern.test(lineage.id)||lineage.id===BUNDLED_LINEAGE_ID||!Array.isArray(lineage.replaces)
  ||!lineage.replaces.every(id=>typeof id==='string'&&registryIdPattern.test(id)&&!PUBLISHED_REGISTRY_IDS.includes(id)))fail('invalid_input');
 return lineage;
}
// Durable write of the whole state file for the transaction that owns it. Only a migration claim uses it inside a read-only transaction.
const persisters=new WeakMap();
// `currentInputKinds(providerId)` is the host-trusted, side-effect-free answer to "which input ids may this provider's
// current release hold, and in which role ('secret' | 'text')?". Unknown means no carry-forward: it fails closed.
export function createEmbeddingServices({registryId,secretBackend,hostCapabilities={},identity,lineage:declaredLineage,currentInputKinds}={}){
 const lineage=checkedLineage(declaredLineage);
 // The custodian names the storage owner. Without a lineage it is the content registry id (storage stays per content).
 const custodian=lineage?.id??registryId;
 if(identity&&(!identity.instanceId||typeof identity.instanceId!=='string'||!identity.bootId||typeof identity.bootId!=='string'))fail('invalid_input');
 if(typeof registryId!=='string'||!registryId)fail('invalid_input');
 const backend=home=>secretBackend??{
  put:({bytes})=>storeSecret({home,value:bytes}),
  withSecret:({handle},use)=>withSecret(home,handle,use),
  presence:async({handle})=>{try{await withSecret(home,handle,async()=>{});return {known:true,value:true};}catch(e){if(e.code==='setup_required')return {known:true,value:false};throw e;}},
  delete:async({handle})=>{await deleteSecret(home,handle);return {deleted:true};},
 };
 const call=async(home,method,...args)=>{try{return await backend(home)[method](...args);}catch(e){throw embeddingError(e?.code==='secret_backend_locked'?'secret_backend_locked':'secret_backend_unavailable');}};
 // Presence is authoritative: observe every binding before requesting any bytes.
 // A migrated secret keeps the scope it was stored under: a delegated backend addresses its item by that scope.
 const backendScope=(s,c,handle)=>s.secrets[handle]?.backendScopeId??c.scopeId;
 async function resolvedValues(home,s,c){
  const values=clone(c.values),present=[];
  for(const[id,handle]of Object.entries(c.bindings)){
   const observation=await call(home,'presence',{scopeId:backendScope(s,c,handle),handle});
   if(observation?.known!==true||typeof observation.value!=='boolean')fail(observation?.reason==='secret_backend_locked'?'secret_backend_locked':'secret_backend_unavailable');
   if(observation.value)present.push([id,handle]);else delete values[id];
  }
  for(const[id,handle]of present)values[id]=await call(home,'withSecret',{scopeId:backendScope(s,c,handle),handle},async bytes=>new TextDecoder().decode(bytes));
  return Object.keys(values).length?values:null;
 }
 async function transaction(home,run,{readOnly=false}={}){
  home=await canonicalHome(home,true);
  return withExclusiveLock(join(home,'.embedding-lock'),async()=>{
   let state;try{const file=await checkedFile(join(home,'embedding-state.json'),constants.O_RDONLY,'embedding state');try{state=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}}catch(e){if(e.code!=='ENOENT')throw e;state={schemaVersion:1,configs:{},secrets:{},instanceId:fresh()};}
   if(state?.schemaVersion!==1||!state.configs||!state.secrets||typeof state.instanceId!=='string')fail('internal_error');
   const persist=()=>atomicWrite(join(home,'embedding-state.json'),state);persisters.set(state,persist);
   const checkpoint=async()=>{if(readOnly)fail('internal_error');await persist();};
   const result=await run(state,home,checkpoint);if(!readOnly)await checkpoint();return result;
  },{waitSeconds:30});
 }
 const scope=(home,providerId,owner)=>{if(owner!==undefined&&(typeof owner!=='string'||!owner))fail('invalid_input');if(typeof providerId!=='string'||!providerId)fail('invalid_input');return hash(JSON.stringify([custodian,home,owner??null,providerId]));};
 const legacyScope=(earlierRegistryId,home,providerId,owner)=>hash(JSON.stringify([earlierRegistryId,home,owner??null,providerId]));
 // Recompute the earlier scope from a trusted registry id and the exact home, owner and provider. Never scan or guess.
 function candidates(state,home,providerId,owner,scopeId,fromIds){
  const found=[];
  for(const R of fromIds){
   const key=legacyScope(R,home,providerId,owner),rec=state.configs[key];if(!rec)continue;
   if(rec.migratedTo&&rec.migratedTo!==scopeId)refuseMigration('taken');
   if(rec.migratedTo)refuseMigration('incompatible');
   found.push({R,key,rec});
  }
  return found;
 }
 // The earlier record moves to the stable scope in one in-memory edit that is made durable by ONE atomic write (the claim)
 // before the caller may ask the backend for anything. Until that write is renamed nothing changed, so a fault leaves the
 // earlier state intact and no byte was released. After it, only the claimant can reach the record: a rival lineage sees
 // the tombstone and is refused. The earlier record stays as a tombstone, and the retained backend scope keeps every
 // opaque handle usable.
 async function adopt(state,providerId,scopeId,{R,key,rec}){
  const sound=plain(rec)&&rec.scopeId===key&&plain(rec.bindings)&&plain(rec.values)&&plain(rec.drafts)&&typeof rec.revision==='string'&&Array.isArray(rec.uses)&&rec.uses.every(x=>typeof x==='string');
  if(!sound)refuseMigration('incompatible');
  // Open drafts, setup operations and operation-held credentials are not ordinary bindings: refuse until they are closed.
  if(Object.keys(rec.drafts).length||Object.values(state.secrets).some(ref=>ref.scopeId===key&&(ref.draftId||ref.operationId))
   ||Object.values(state.setupOperations??{}).some(op=>op?.scopeId===key))refuseMigration('inflight');
  for(const [inputId,handle]of Object.entries(rec.bindings)){
   const ref=typeof handle==='string'?state.secrets[handle]:undefined;
   if(!ref||ref.registryId!==R||ref.scopeId!==key||ref.inputId!==inputId||ref.draftId||ref.operationId||ref.backendScopeId!==undefined)refuseMigration('incompatible');
  }
  for(const value of Object.values(rec.values))if(typeof value!=='string')refuseMigration('incompatible');
  // The provider's CURRENT declaration decides: an id must still exist there with the role it was saved in. No declaration, no carry-forward.
  const kinds=await currentInputKinds?.(providerId);
  if(!plain(kinds))refuseMigration('incompatible');
  if(Object.keys(rec.bindings).some(id=>kinds[id]!=='secret')||Object.keys(rec.values).some(id=>kinds[id]!=='text'))refuseMigration('incompatible');
  // A reservation was made through the earlier registry, and only that registry's release (or the exact handle, see
  // releaseConfigurationUse) ends it. Copying it would leave the stable scope held after that release.
  if(rec.uses.length)refuseMigration('in_use');
  for(const handle of Object.values(rec.bindings))Object.assign(state.secrets[handle],{registryId:custodian,scopeId,backendScopeId:key});
  rec.migratedTo=scopeId;
  const adopted=state.configs[scopeId]={scopeId,revision:rec.revision,bindings:clone(rec.bindings),values:clone(rec.values),drafts:{},uses:[],migratedFrom:[key]};
  await persisters.get(state)();
  return adopted;
 }
 const config=async(state,home,providerId,owner)=>{
  const scopeId=scope(home,providerId,owner);if(state.configs[scopeId])return state.configs[scopeId];
  const found=candidates(state,home,providerId,owner,scopeId,lineage?.replaces??[]);
  if(found.length>1)refuseMigration('ambiguous');
  if(found.length===1)return adopt(state,providerId,scopeId,found[0]);
  const c={scopeId,revision:fresh(),bindings:{},values:{},drafts:{},uses:[]};
  // Legacy records have home/provider scope only. Never claim them for a named owner.
  if(!secretBackend&&/^[a-z0-9][a-z0-9._-]{0,127}$/.test(providerId)){
   let file;try{await trustedDirectory(join(home,'setup'),false);await privateDirectory(join(home,'setup'));file=await checkedFile(join(home,'setup',`${providerId}.json`),constants.O_RDONLY,'legacy setup record');}
   catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}
   if(file){let legacy;try{legacy=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
    if(owner!==undefined)fail('configuration_migration_required');
    if(legacy?.schemaVersion!==1||!legacy.values||typeof legacy.values!=='object'||Array.isArray(legacy.values))fail('configuration_migration_required');
    for(const [inputId,handle]of Object.entries(legacy.values)){
     if(!handlePattern.test(handle))fail('configuration_migration_required');
     c.bindings[inputId]=handle;state.secrets[handle]??={registryId:custodian,scopeId,inputId,revision:c.revision,draftId:null};
     if(state.secrets[handle].scopeId!==scopeId)fail('configuration_migration_required');
    }
    for(const [inputId,value]of Object.entries(legacy.text??{})){if(typeof value!=='string')fail('configuration_migration_required');c.values[inputId]=value;}
   }
  }
  state.configs[scopeId]=c;
  // A record imported with bindings claims those handles: make that durable before any read releases their bytes.
  if(Object.keys(c.bindings).length)await persisters.get(state)();
  return c;
 };
 const select=(c,draftId)=>draftId?(c.drafts[draftId]??fail('configuration_stale')):c;
 const compare=(c,revision)=>{if(c.revision!==revision)fail('configuration_stale');};
 async function redacted(home,s,c){
  const credentials={};for(const [id,handle]of Object.entries(c.bindings)){try{credentials[id]=await call(home,'presence',{scopeId:backendScope(s,c,handle),handle});}catch(e){credentials[id]={known:false,reason:e.code};}}
  return {scopeId:c.scopeId,revision:c.revision,values:clone(c.values),credentials};
 }
 const referenced=(state,handle)=>Object.values(state.configs).some(c=>!c.migratedTo&&(Object.values(c.bindings).includes(handle)||Object.values(c.drafts).some(d=>Object.values(d.bindings).includes(handle))));
 async function remove(state,home,handle,{operationId}={}){
  const ref=state.secrets[handle];if(!ref||ref.registryId!==custodian)return {discarded:false};
  if((ref.operationId&&ref.operationId!==operationId)||referenced(state,handle))fail('secret_in_use');
  const presence=async()=>{
   const result=await call(home,'presence',{scopeId:ref.backendScopeId??ref.scopeId,handle});
   if(result?.known!==true||typeof result.value!=='boolean')fail(result?.reason==='secret_backend_locked'?'secret_backend_locked':'secret_backend_unavailable');
   return result.value;
  };
  if(await presence()){
   await call(home,'delete',{scopeId:ref.backendScopeId??ref.scopeId,handle});
   if(await presence())fail('secret_backend_unavailable');
  }
  delete state.secrets[handle];return {discarded:true};
 }
 async function putSecret(s,h,c,draftId,inputId,input){
  if(typeof inputId!=='string'||!inputId||!(input instanceof Uint8Array)||!input.length||input.length>65536)fail('invalid_input');
  const bytes=new Uint8Array(input);
  let result;
  try{result=await call(h,'put',{scopeId:c.scopeId,inputId,revision:c.revision,bytes});}finally{bytes.fill(0);}
  if(typeof result?.handle!=='string'||!result.handle||Object.hasOwn(s.secrets,result.handle))fail('secret_backend_unavailable');
  s.secrets[result.handle]={registryId:custodian,scopeId:c.scopeId,inputId,revision:c.revision,draftId:draftId??null};
  return result.handle;
 }
 function configurationTransaction(s,h,r,applied,c){
  const assertCurrent=()=>{if(!c)fail('configuration_stale');};
  const assertUnused=()=>{if(applied.uses.length)fail('configuration_in_use');};
  const assertMutable=()=>{assertCurrent();if(!r.draftId)assertUnused();};
  const next=c&&{...c,bindings:clone(c.bindings),values:clone(c.values)};
  let changed=false;
  const tx={
   assertMutable,assertUnused,inUse:()=>applied.uses.length>0,
   clearInput:inputId=>{assertMutable();if(!r.draftId)fail('invalid_input');delete next.bindings[inputId];delete next.values[inputId];changed=true;},
   unbindSecret:handle=>{
    assertUnused();
    // A draft can be committed or discarded after setup. Search this scope only.
    for(const config of [applied,...Object.values(applied.drafts)]){
     const ids=Object.keys(config.bindings).filter(id=>config.bindings[id]===handle);
     if(!ids.length)continue;
     for(const id of ids)delete config.bindings[id];
     config.revision=fresh();
    }
   },
   resolveConfiguration:()=>c?resolvedValues(h,s,c):null,
   configuration:()=>c?redacted(h,s,c):null,
   withSecret:async(inputId,handle,use)=>{
    assertCurrent();
    const ref=s.secrets[handle],current=c.bindings[inputId]===handle;
    const intake=ref?.revision===c.revision&&ref?.draftId===(r.draftId??null);
    if(!ref||ref.operationId||ref.registryId!==custodian||ref.scopeId!==c.scopeId||ref.inputId!==inputId||!(current||intake))fail('invalid_input');
    return call(h,'withSecret',{scopeId:backendScope(s,c,handle),handle},use);
   },
   bindSecret:async(inputId,handle)=>{assertMutable();await tx.withSecret(inputId,handle,async()=>{});next.bindings[inputId]=handle;delete next.values[inputId];changed=true;},
   bindText:(inputId,value)=>{assertMutable();next.values={...next.values,[inputId]:value};delete next.bindings[inputId];changed=true;},
   markChanged:()=>{assertMutable();changed=true;},
   finish:()=>{
    if(!changed)return c;
    next.revision=fresh();
    if(r.draftId)applied.drafts[r.draftId]=next;else s.configs[c.scopeId]=next;
    return next;
   },
  };
  return tx;
 }
 const api={hostCapabilities,
  readConfiguration:r=>transaction(r.home,async(s,h)=>redacted(h,s,select(await config(s,h,r.providerId,r.owner),r.draftId))),
  readConfigurationDraft:r=>transaction(r.home,async(s,h)=>{if(!r.draftId)fail('invalid_input');const c=await config(s,h,r.providerId,r.owner),d=select(c,r.draftId);return {draftId:r.draftId,scopeId:d.scopeId,baseRevision:d.baseRevision,configuration:await redacted(h,s,d)};},{readOnly:true}),
  resolveConfiguration:r=>transaction(r.home,async(s,h)=>{const c=select(await config(s,h,r.providerId,r.owner),r.draftId);return resolvedValues(h,s,c);},{readOnly:true}),
  // Trusted host decision: carry one named earlier registry's configuration into the stable scope. Used to choose
  // between several candidates or to name a predecessor that no lineage declares. Never overwrites a used configuration.
  adoptConfiguration:r=>transaction(r.home,async(s,h)=>{
   const from=r.fromRegistryId;
   if(typeof from!=='string'||!registryIdPattern.test(from)||typeof r.providerId!=='string'||!r.providerId||(r.owner!==undefined&&(typeof r.owner!=='string'||!r.owner)))fail('invalid_input');
   if(PUBLISHED_REGISTRY_IDS.includes(from)&&!isBundledLineage(lineage))fail('invalid_input');
   const scopeId=scope(h,r.providerId,r.owner),existing=s.configs[scopeId];
   if(existing?.migratedFrom?.includes(legacyScope(from,h,r.providerId,r.owner)))return redacted(h,s,existing);
   const [found]=candidates(s,h,r.providerId,r.owner,scopeId,[from]);
   if(!found)refuseMigration('absent');
   if(existing){
    const pristine=!Object.keys(existing.bindings).length&&!Object.keys(existing.values).length&&!Object.keys(existing.drafts).length&&!existing.uses.length&&!existing.migratedFrom;
    if(!pristine)refuseMigration('conflict');
    delete s.configs[scopeId];
   }
   return redacted(h,s,await adopt(s,r.providerId,scopeId,found));
  }),
  resolveIdentity:({home,bootId}={})=>transaction(home,async s=>identity?clone(identity):{instanceId:s.instanceId,bootId:bootId??boot}),
  storeSecret:r=>transaction(r.home,async(s,h)=>{
   const c=select(await config(s,h,r.providerId,r.owner),r.draftId);compare(c,r.expectedConfigurationRevision);if(c.scopeId!==r.scopeId)fail('invalid_input');
   const handle=await putSecret(s,h,c,r.draftId,r.inputId,r.bytes);
   return {handle,configurationRevision:c.revision,scopeId:c.scopeId};
  }),
  mutateConfiguration:(r,effect,{mutatesConfiguration=true}={})=>transaction(r.home,async(s,h)=>{
   const applied=await config(s,h,r.providerId,r.owner),c=select(applied,r.draftId);
   compare(c,r.expectedConfigurationRevision);
   const tx=configurationTransaction(s,h,r,applied,c);
   if(mutatesConfiguration)tx.assertMutable();
   const result=await effect(tx);
   return {result,configuration:await redacted(h,s,tx.finish())};
  }),
  setupTransaction:(r,run)=>transaction(r.home,async(s,h,checkpoint)=>{
   const scopeId=scope(h,r.providerId,r.owner);
   const key=hash(JSON.stringify([registryId,r.operationId]));
   const journal=s.setupOperations??={};
   const record=journal[key];
   if(record&&record.scopeId!==scopeId)fail('configuration_stale');
   const applied=await config(s,h,r.providerId,r.owner);
   const draftId=record?record.draftId:r.draftId??null;
   const c=draftId?applied.drafts[draftId]:applied;
   const stale=!c||(draftId&&c.baseRevision!==applied.revision)||(record&&record.configurationRevision!==c.revision);
   const tx=configurationTransaction(s,h,{...r,draftId},applied,stale?null:c);
   // Observe journal custody without asking the backend to release credential bytes.
   const managementHandle=slot=>{
    const handle=record?.management?.[slot],ref=s.secrets[handle];
    return ref?.scopeId===scopeId&&ref.registryId===custodian&&ref.operationId===r.operationId?handle:null;
   };
   return run({
    home:h,scopeId,record,stale:!!stale,tx,checkpoint,
    reserve:record=>{journal[key]=record;},
    hasManagementSecret:slot=>managementHandle(slot)!==null,
    withManagementSecret:async(slot,use)=>{
     const handle=managementHandle(slot);
     return handle===null?null:call(h,'withSecret',{scopeId:backendScope(s,{scopeId},handle),handle},use);
    },
    retainManagementSecret:async(slot,inputId,handle)=>{
     await tx.withSecret(inputId,handle,async()=>{});
     if(Object.hasOwn(record.management,slot))await remove(s,h,record.management[slot],{operationId:r.operationId});
     s.secrets[handle]={...s.secrets[handle],draftId:null,operationId:r.operationId};
     record.management[slot]=handle;
    },
    disconnectManagementSecret:async slot=>{
     const handle=record.management[slot];
     if(!handle)return;
     await remove(s,h,handle,{operationId:r.operationId});
     delete record.management[slot];
    },
    bindConnectorSecret:async(inputId,bytes)=>{
     tx.assertMutable();
     const handle=await putSecret(s,h,c,draftId,inputId,bytes);
     await tx.bindSecret(inputId,handle);
     (record.connectorSecrets??={})[inputId]=handle;
    },
    disconnectConnectorSecret:async inputId=>{
     const handle=record.connectorSecrets?.[inputId];
     if(!handle)return;
     tx.unbindSecret(handle);
     await checkpoint();
     await remove(s,h,handle);
     delete record.connectorSecrets[inputId];
    },
   });
  }),
  beginConfigurationDraft:r=>transaction(r.home,async(s,h)=>{const c=await config(s,h,r.providerId,r.owner);compare(c,r.expectedConfigurationRevision);const draftId=fresh();const d={scopeId:c.scopeId,revision:fresh(),baseRevision:c.revision,bindings:clone(c.bindings),values:clone(c.values)};c.drafts[draftId]=d;return {draftId,scopeId:c.scopeId,baseRevision:c.revision,configuration:await redacted(h,s,d)};}),
  commitConfigurationDraft:r=>transaction(r.home,async(s,h)=>{const c=await config(s,h,r.providerId,r.owner),d=select(c,r.draftId);if(!r.draftId)fail('invalid_input');compare(d,r.expectedConfigurationRevision);compare(c,d.baseRevision);if(c.uses.length)fail('configuration_in_use');c.bindings=d.bindings;c.values=d.values;c.revision=fresh();delete c.drafts[r.draftId];return redacted(h,s,c);}),
  discardConfigurationDraft:r=>transaction(r.home,async(s,h,checkpoint)=>{
   if(typeof r.draftId!=='string'||!r.draftId)fail('invalid_input');
   const c=await config(s,h,r.providerId,r.owner),d=c.drafts[r.draftId];
   const owned=Object.entries(s.secrets).filter(([,v])=>v.registryId===custodian&&v.scopeId===c.scopeId&&v.draftId===r.draftId).map(([handle])=>handle);
   // Detach first. Secret metadata retains the authority to retry orphan cleanup.
   if(d){delete c.drafts[r.draftId];await checkpoint();}
   const presence=async handle=>{
    const result=await call(h,'presence',{scopeId:backendScope(s,c,handle),handle});
    if(result?.known!==true||typeof result.value!=='boolean')fail(result?.reason==='secret_backend_locked'?'secret_backend_locked':'secret_backend_unavailable');
    return result.value;
   };
   for(const handle of owned){
    if(referenced(s,handle))continue;
    if(await presence(handle)){
     await call(h,'delete',{scopeId:backendScope(s,c,handle),handle});
     if(await presence(handle))fail('secret_backend_unavailable');
    }
    delete s.secrets[handle];
    // Keep each confirmed removal durable before starting the next backend call.
    await checkpoint();
   }
   return {discarded:!!d};
  }),
  discardSecret:r=>transaction(r.home,(s,h)=>remove(s,h,r.handle)),
  registerConfigurationUse:async r=>{
   if(!r||typeof r.home!=='string'||!r.home)fail('invalid_input');
   const key=reservationKey(r.handle);
   scope(r.home,r.providerId,r.owner);
   return transaction(r.home,async(s,h)=>{const c=await config(s,h,r.providerId,r.owner);compare(c,r.revision);if(!c.uses.includes(key))c.uses.push(key);});
  },
  releaseConfigurationUse:async r=>{
   if(!r||typeof r.home!=='string'||!r.home)fail('invalid_input');
   const handleKey=reservationKey(r.handle);
   // Validate scope before storage; never call config() or a credential backend.
   scope(r.home,r.providerId,r.owner);
   try{
    const home=await canonicalHome(r.home,false);
    return await withExclusiveLock(join(home,'.embedding-lock'),async()=>{
     let file;
     try{file=await checkedFile(join(home,'embedding-state.json'),constants.O_RDONLY,'embedding state');}
     catch(error){if(error.code==='ENOENT')return;throw error;}
     let state;try{state=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
     if(state?.schemaVersion!==1||!state.configs||typeof state.configs!=='object'||Array.isArray(state.configs))fail('secret_backend_unavailable');
     // The stable scope, plus any earlier registry's record that has not moved yet: its reservation was made under that
     // registry, and migration waits for it. Only the exact handle for this exact home, owner and provider is dropped;
     // no configuration is removed and no absence is inferred.
     const scopeId=scope(home,r.providerId,r.owner),keys=[scopeId];
     for(const R of lineage?.replaces??[]){const key=legacyScope(R,home,r.providerId,r.owner);if(state.configs[key]&&!state.configs[key].migratedTo)keys.push(key);}
     let changed=false;
     for(const key of keys){
      const c=state.configs[key];
      if(c===undefined)continue;
      if(c?.scopeId!==key||!Array.isArray(c.uses)||!c.uses.every(x=>typeof x==='string'))fail('secret_backend_unavailable');
      const uses=c.uses.filter(x=>x!==handleKey);
      if(uses.length!==c.uses.length){c.uses=uses;changed=true;}
     }
     if(changed)await atomicWrite(join(home,'embedding-state.json'),state);
    },{waitSeconds:30});
   }catch(error){if(error?.code==='invalid_input')throw error;throw embeddingError('secret_backend_unavailable');}
  },
 };
 const boot=fresh();return api;
}
