// Durable host intent identity precedes allocation. A retained reservation is never a retry command.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome,trustedDirectory,privateDirectory,readRecord,withExclusiveLock} from './service-state.mjs';
import {atomicWrite,processIdentity} from './journal.mjs';
import {canonicalDigest,peekConsentGrant} from './consent-token.mjs';
import {unknownProperties,projectSession,projectDurable,projectExternal,recoveryHistory} from './route-view.mjs';
import {enrichRoute} from './embedding-state.mjs';
import {releaseRecordedConfigurationUse} from './runtime-configuration-use.mjs';
import {gozarError,instructionAction} from './error-normalizer.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const optionalRead=async path=>{try{return await readRecord(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function directory(home,create){const path=join(await canonicalHome(home,create),'operations');await trustedDirectory(path,create);await privateDirectory(path);return path;}
const checkRecord=record=>{
 if(record?.schemaVersion!==1||typeof record.owner!=='string'||typeof record.operationId!=='string'||typeof record.intentDigest!=='string'||!record.view?.handle)throw gozarError('provider_unavailable','The operation recovery record is unreadable');
 return record;
};
export function startingRoute(handle,target,operationId){
 return {...enrichRoute({handle,origin:null,published:null,state:'creating',ownership:'gozar-owned',properties:unknownProperties(),ingress:null,
  verification:{status:'unverified',checkedAt:null,vantage:'none',checks:[]},limits:{recommendedPollIntervalMs:1000,idleTimeoutMs:null},cleanup:{state:'none'}},{target}),operationId};
}
function newHandle(request){
 if(request.usage.kind==='attached')return {kind:'attached',id:`att_${randomBytes(8).toString('hex')}`,generation:1};
 if(request.usage.kind==='session'){const port=request.target.split(':').at(-1);return {kind:'session',id:`port-${port}:${randomUUID()}`,generation:1};}
 return {kind:'durable',id:request.usage.routeId,generation:1};
}
export async function withRouteOperation(request,{registryId,embeddingServices,adapters,run,status}){
 if(request.operationId===undefined)return run(null);
 if(typeof request.operationId!=='string'||!request.operationId||request.operationId.length>256||typeof request.owner!=='string'||!request.owner)throw gozarError('invalid_input','A route operation needs a non-empty operationId and owner');
 const home=await canonicalHome(request.home,true),dir=await directory(home,true),path=join(dir,hash(JSON.stringify([request.owner,request.operationId]))+'.json');
 let winner=false;
 const record=await withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const prior=await optionalRead(path);if(prior)checkRecord(prior);
  const grant=await peekConsentGrant({home,token:request.approval?.candidateToken});
  const providerId=request.providerId??grant?.adapterId??prior?.intent.providerId;
  if(!providerId)throw gozarError('consent_required','The operation needs a current exact provider approval');
  const configuration=await embeddingServices.readConfiguration({home,owner:request.owner,providerId});
  const intent={registryId,providerId,configurationRevision:configuration.revision,scopeId:configuration.scopeId,usage:request.usage,
    owner:request.owner,target:request.target,origin:request.origin??null,requirements:request.requirements,route:request.route??null,intent:request.intent??'create',
    consentFactsDigest:request.approval?.consentFactsDigest??grant?.consentFactsDigest??prior?.intent.consentFactsDigest??null};
  const intentDigest=canonicalDigest(intent);
  if(prior){if(prior.intentDigest!==intentDigest)throw gozarError('operation_conflict','This operationId already names a different route intent');return prior;}
  const external=adapters?.find(a=>a.id===providerId)?.definition.ownership==='external-owned';
  const origin=request.origin??grant?.origin??(prior?.view.handle.kind==='external'?prior.view.handle.id:null);
  if(external&&!origin)throw gozarError('consent_required','An owner route needs the approved exact origin');
  const handle=external?{kind:'external',id:origin,generation:1}:newHandle(request);
  if(handle.kind==='durable'){const existing=await optionalRead(join(home,'routes',hash(handle.id)+'.json'));if(existing)handle.generation=existing.generation;}
  const value={schemaVersion:1,owner:request.owner,operationId:request.operationId,intent,intentDigest,phase:'starting',view:startingRoute(handle,request.target,request.operationId)};
  await atomicWrite(path,value);winner=true;return value;
 },{waitSeconds:30});
 // Allocation completion and Stop persist under the same reservation lock.
 const persist=async value=>withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const current=checkRecord(await readRecord(path));
  if(current.view.cleanup.state==='confirmed')return structuredClone(current.view);
  await atomicWrite(path,value);return structuredClone(value.view);
 },{waitSeconds:30});
 if(!winner){
  if(record.view.cleanup.state==='confirmed')return structuredClone(record.view);
  try{return {...await status({home,handle:record.view.handle}),operationId:request.operationId};}
  catch(error){
   if(error.code==='route_conflict'){const reference=await operationReferenceForRoute({home,handle:record.view.handle});if(reference?.owner===record.owner&&reference.operationId===record.operationId)return {...await status({home,handle:reference.handle}),operationId:request.operationId};}
   if(!['route_not_found','provider_unavailable',...(record.phase==='starting'?['route_conflict']:[])].includes(error.code))throw error;
   return {...structuredClone(record.view),state:'uncertain',routeState:'cleanup-unconfirmed',published:null,ingress:null,
    verification:{...record.view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  }
 }
 try{const view={...await run(record.view.handle),operationId:request.operationId};record.view=view;record.phase='allocated';return await persist(record);}
 catch(error){
  record.phase='recovery';let recovered=error.route;
  if(!recovered)try{recovered=await status({home,handle:record.view.handle});}catch(statusError){
   if(statusError.code==='route_conflict'){
    // Follow a committed restoration only for the exact operation and owner.
    try{
     const reference=await operationReferenceForRoute({home,handle:record.view.handle});
     if(reference?.owner===record.owner&&reference.operationId===record.operationId)
      recovered=await status({home,handle:reference.handle});
    }catch{}
   }
  }
  record.view=recovered?{...recovered,operationId:request.operationId}:{...record.view,state:'uncertain',routeState:'cleanup-unconfirmed',cleanup:{state:'unconfirmed',nextAction:null},published:null};
  error.route=await persist(record);throw error;
 }
}

export async function operationReferenceForRoute({home,handle}={}){
 if(typeof home!=='string'||!handle)return null;
 let record,owner,operationId,currentHandle=handle;
 if(handle.kind==='durable'){record=await optionalRead(join(home,'routes',hash(handle.id)+'.json'));owner=record?.owner;operationId=record?.operationId;if(record)currentHandle={...handle,generation:record.generation};}
 else if(handle.kind==='attached'){if(!/^att_[a-f0-9]{16}$/.test(handle.id))return null;record=await optionalRead(join(home,'attached',handle.id,'bootstrap.json'));owner=record?.owner;operationId=record?.operationId;}
 else if(handle.kind==='session'){const name=handle.id.split(':')[0];if(!/^port-[0-9]+$/.test(name))return null;record=await optionalRead(join(home,name,'bootstrap.json'));owner=record?.owner;operationId=record?.operationId;}
 else if(handle.kind==='external'){record=await optionalRead(join(home,'services',hash(handle.id)+'.json'));owner=record?.embedding?.request.owner;operationId=record?.embedding?.operationId;}
 return typeof owner==='string'&&typeof operationId==='string'?{owner,operationId,handle:currentHandle}:null;
}
export async function recordOperationView({home,view,reference}){
 if(!reference)return view;
 let dir;try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return view;throw error;}
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const path=join(dir,hash(JSON.stringify([reference.owner,reference.operationId]))+'.json'),record=await optionalRead(path);if(!record)return view;checkRecord(record);
  if(record.view.handle.kind!==view.handle.kind||record.view.handle.id!==view.handle.id)return view;
  if(record.owner!==reference.owner||record.operationId!==reference.operationId||
     !sameHandle(reference.handle,view.handle))return view;
  if(record.view.handle.generation!==view.handle.generation){
   // A committed durable restoration may precede its operation-journal update.
   // The facade obtained this exact reference before generation-fenced close.
   if(view.handle.kind!=='durable'||record.view.handle.generation>=view.handle.generation||
      !Number.isSafeInteger(view.handle.generation)||record.phase==='terminal')return view;
   // A replacement committed during close dominates this older reply.
   const current=await operationReferenceForRoute({home,handle:view.handle});
   if(current&&(!sameHandle(current.handle,view.handle)||current.owner!==reference.owner||
      current.operationId!==reference.operationId))return view;
  }
  if(view.cleanup.state==='confirmed')delete record.referenceCleanup;
  record.view={...view,operationId:record.operationId};record.phase=view.cleanup.state==='confirmed'?'terminal':'recovery';await atomicWrite(path,record);return record.view;
 },{waitSeconds:30});
}


const sameHandle=(a,b)=>a?.kind===b?.kind&&a?.id===b?.id&&a?.generation===b?.generation;
export function referenceCleanupDebt(view){
 return {...view,state:'uncertain',routeState:'cleanup-unconfirmed',published:null,ingress:null,
  verification:{...view.verification,status:'unverified',results:(view.verification?.results??[]).map(row=>({...row,status:'unknown'}))},
  cleanup:{state:'unconfirmed',nextAction:instructionAction('retry-reference-release','Retry configuration reference release',
   'Call closeRoute with this exact retained handle and mode remove; resource removal is already recorded.')}};
}
function validReferenceRecord(record){
 checkRecord(record);
 if(record.intent?.owner!==record.owner||canonicalDigest(record.intent)!==record.intentDigest||
    typeof record.intent.registryId!=='string'||!record.intent.registryId||
    typeof record.intent.providerId!=='string'||!record.intent.providerId||
    !['attached','session'].includes(record.view.handle.kind))
  throw gozarError('cleanup_debt','The recorded configuration reference scope cannot be verified');
 return record;
}
/** Called only after the facade has obtained confirmed resource removal from viewClose. */
export async function recordPendingReferenceCleanup({home,view,reference}){
 if(!reference)return referenceCleanupDebt(view);
 home=await canonicalHome(home,false);
 const dir=await directory(home,false),path=join(dir,hash(JSON.stringify([reference.owner,reference.operationId]))+'.json');
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const record=validReferenceRecord(await readRecord(path));
  if(record.owner!==reference.owner||record.operationId!==reference.operationId||
     !sameHandle(record.view.handle,view.handle)||view.cleanup?.state!=='confirmed')
   throw gozarError('route_conflict','Reference cleanup does not match the recorded operation');
  const resourceView={...view,published:null,ingress:null,verification:{...view.verification,status:'unverified'},operationId:record.operationId};
  record.referenceCleanup={intentDigest:record.intentDigest,handle:structuredClone(view.handle),
   scope:{registryId:record.intent.registryId,home,owner:record.owner,providerId:record.intent.providerId,handle:structuredClone(view.handle)},
   resourceView};
  record.view=referenceCleanupDebt(resourceView);record.phase='recovery';
  await atomicWrite(path,record);return record.view;
 },{waitSeconds:30});
}
/** A private library-written milestone, never caller flags, authorizes metadata-only recovery. */
export async function retryRecordedReferenceCleanup({home,handle,owner}={},runtime={}){
 if(!['attached','session'].includes(handle?.kind))return null;
 try{home=await canonicalHome(home,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 let dir;try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const matches=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
   if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
   const path=join(dir,entry.name),record=checkRecord(await readRecord(path));
   if(entry.name!==hash(JSON.stringify([record.owner,record.operationId]))+'.json')throw gozarError('cleanup_debt','Operation filename mismatch');
   if(!sameHandle(record.view.handle,handle)||(owner!==undefined&&owner!==record.owner))continue;
   matches.push({path,record});
  }
  if(!matches.length)return null;
  if(matches.length!==1)throw gozarError('cleanup_debt','Ambiguous reference cleanup ownership');
  const {path,record}=matches[0],pending=record.referenceCleanup;
  if(!pending)return null;
  validReferenceRecord(record);
  const expected={registryId:record.intent.registryId,home,owner:record.owner,providerId:record.intent.providerId,handle:record.view.handle};
  if(pending.intentDigest!==record.intentDigest||!sameHandle(pending.handle,handle)||
     canonicalDigest(pending.scope)!==canonicalDigest(expected)||!sameHandle(pending.resourceView?.handle,handle)||
     pending.resourceView?.cleanup?.state!=='confirmed'||pending.resourceView.operationId!==record.operationId)
   throw gozarError('cleanup_debt','Recorded resource-removal evidence does not match this reference');
  try{await releaseRecordedConfigurationUse(pending.scope,runtime);await runtime.afterReferenceRelease?.();}
  catch(cause){
   record.view=referenceCleanupDebt(pending.resourceView);record.phase='recovery';await atomicWrite(path,record);
   const error=gozarError('cleanup_debt','Resource removal is confirmed but configuration reference release failed',record.view.cleanup.nextAction,cause);
   error.route=structuredClone(record.view);throw error;
  }
  record.view={...pending.resourceView,state:'released',routeState:'released',cleanup:{state:'confirmed'}};
  record.phase='terminal';delete record.referenceCleanup;await atomicWrite(path,record);
  return structuredClone(record.view);
 },{waitSeconds:30});
}

/** Missing route files are not absence evidence; only exact terminal journals are. */
export async function retainedOperationView({home,handle,owner}={}){
 if(!['durable','attached','session'].includes(handle?.kind))return null;
 let dir;
 try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const matches=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
  const record=checkRecord(await readRecord(join(dir,entry.name)));
  if(entry.name!==hash(JSON.stringify([record.owner,record.operationId]))+'.json')
   throw gozarError('provider_unavailable','The operation recovery filename does not match its identity');
  const ref=record.view.handle;
  if(ref.kind!==handle.kind||ref.id!==handle.id||ref.generation!==handle.generation||
    (owner!==undefined&&record.owner!==owner))continue;
  matches.push(record);
 }
 if(!matches.length)return null;
 // A nonterminal sibling is not erased by a terminal snapshot of another operation.
 const debt=matches.find(record=>record.phase!=='terminal'||record.view.state!=='released'||record.view.cleanup?.state!=='confirmed');
 if(debt)return recoveryHistory(structuredClone(debt.view),'Retained operation has no confirmed provider absence; retry cleanup with the original provider available.');
 return structuredClone(matches[0].view);
}

/** Read persisted snapshots only. Listing never mints consent or refreshes a provider proof. */
export async function listRecordedRoutes({home,owner}={},deps={}){
 if(owner!==undefined&&(typeof owner!=='string'||!owner))throw gozarError('invalid_input','owner must be a non-empty string');
 home=await canonicalHome(home,false);const routes=new Map(),referencePending=new Set();
 const routeKey=handle=>JSON.stringify([handle.kind,handle.id]);
 const put=view=>{
  const key=routeKey(view.handle),previous=routes.get(key);
  // Enumeration order is not lifecycle order. A stale active snapshot cannot
  // undo exact terminal evidence, and an older generation cannot hide a newer one.
  if(previous){
   if(referencePending.has(key)&&previous.handle.generation===view.handle.generation)return;
   if(previous.handle.generation>view.handle.generation)return;
   if(previous.handle.generation===view.handle.generation&&previous.state==='released'&&previous.cleanup?.state==='confirmed')return;
  }
  routes.set(key,{...view,operationId:view.operationId??null});
 };
 const names=async dir=>{try{await trustedDirectory(dir,false);return await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 for(const entry of await names(join(home,'operations'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=checkRecord(await readRecord(join(home,'operations',entry.name)));if(owner===undefined||record.owner===owner){put(record.view);if(record.referenceCleanup)referencePending.add(routeKey(record.view.handle));}}
 for(const entry of await names(join(home,'attached'))){if(!entry.isDirectory()||!/^att_[a-f0-9]{16}$/.test(entry.name))continue;const root=join(home,'attached',entry.name),bootstrap=await readRecord(join(root,'bootstrap.json'));if(owner!==undefined&&bootstrap.owner!==owner)continue;const record=await optionalRead(join(root,'state.json'));if(!record)continue;if(!record.lastView?.handle)throw gozarError('provider_unavailable','The attached recovery snapshot is unreadable');let view=record.lastView;
  const controller=await optionalRead(join(root,'control.json'));
  if(view.state!=='released'&&(!controller||await processIdentity(controller.pid)!==controller.startIdentity))view={...view,state:'uncertain',published:null,routeState:'cleanup-unconfirmed',verification:{...view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  put({...view,operationId:bootstrap.operationId??routes.get(routeKey(view.handle))?.operationId??null});
 }
 for(const entry of await names(join(home,'routes'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=await readRecord(join(home,'routes',entry.name));if(record?.schemaVersion!==1||typeof record.routeId!=='string'||!record.routeId||record.ownership!=='gozar-owned'||typeof record.owner!=='string'||!record.owner||!Number.isSafeInteger(record.generation)||record.generation<1||entry.name!==hash(record.routeId)+'.json')throw gozarError('provider_unavailable','The durable route record is unreadable');if(owner!==undefined&&record.owner!==owner)continue;const handle={kind:'durable',id:record.routeId,generation:record.generation};const previous=routes.get(routeKey(handle));put({...projectDurable(record,{handle,properties:unknownProperties()}),operationId:record.operationId??previous?.operationId??null});}
 for(const entry of await names(home)){if(!entry.isDirectory()||!/^port-[0-9]+$/.test(entry.name))continue;const bootstrap=await optionalRead(join(home,entry.name,'bootstrap.json'));if(!bootstrap||(owner!==undefined&&bootstrap.owner!==owner))continue;const journal=await optionalRead(join(home,entry.name,'session.json'));if(!journal?.snapshot)continue;const handle={kind:'session',id:`${entry.name}:${journal.snapshot.sessionId}`,generation:1};put({...projectSession(journal.embeddingView??{snapshot:journal.snapshot},{handle,properties:unknownProperties()}),operationId:bootstrap.operationId??routes.get(routeKey(handle))?.operationId??null});}
 for(const entry of await names(join(home,'services'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=await readRecord(join(home,'services',entry.name));if(record.ownership!=='external-owned'||typeof record.origin!=='string')throw gozarError('provider_unavailable','The owner-route recovery record is unreadable');if(owner!==undefined&&record.embedding?.request.owner!==owner)continue;put(projectExternal(record,{handle:{kind:'external',id:record.origin,generation:record.generation??0}}));}
 // A disk snapshot is recovery evidence. Only routeStatus can obtain a fresh subject-bound proof.
 return {routes:[...routes.values()].map(view=>view.state==='released'?view:{...view,state:view.state==='usable'?'unverified':view.state,published:null,
  routeState:view.cleanup.state==='unconfirmed'?'cleanup-unconfirmed':view.origin?'detected':'unknown',verification:{...view.verification,status:'unverified',results:(view.verification.results??[]).map(result=>({...result,status:'unknown'}))}})};
}
