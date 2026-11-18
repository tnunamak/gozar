// Durable host intent identity precedes allocation. A retained reservation is never a retry command.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome,trustedDirectory,privateDirectory,readRecord,withExclusiveLock} from './service-state.mjs';
import {atomicWrite} from './journal.mjs';
import {canonicalDigest,peekConsentGrant} from './consent-token.mjs';
import {unknownProperties,projectSession,projectDurable,projectExternal,recoveryHistory,propertiesFor} from './route-view.mjs';
import {ownershipFor} from './adapter-runtime.mjs';
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
 return {...enrichRoute({handle,origin:null,published:null,state:'creating',ownership:handle.kind==='external'?'external-owned':'gozar-owned',properties:unknownProperties(),ingress:null,
  verification:{status:'unverified',checkedAt:null,vantage:'none',checks:[]},limits:{recommendedPollIntervalMs:1000,idleTimeoutMs:null},cleanup:{state:'none'}},{target}),operationId};
}
function newHandle(request){
 if(request.usage.kind==='attached')return {kind:'attached',id:`att_${randomBytes(8).toString('hex')}`,generation:1};
 if(request.usage.kind==='session'){const port=request.target.split(':').at(-1);return {kind:'session',id:`port-${port}:${randomUUID()}`,generation:1};}
 return {kind:'durable',id:request.usage.routeId,generation:1};
}
// Fresh proofs this incarnation may attempt for a route with no controller before the replay settles as recovery.
const REPROOF_ATTEMPTS=3;
export async function withRouteOperation(request,{registryId,embeddingServices,adapters,run,status,progress,startTimeoutMs=120_000,replayWait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
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
  const external=ownershipFor(adapters?.find(a=>a.id===providerId)?.definition)==='external-owned';
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
  if(current.referenceCleanup)return pendingReferenceView(current,home);
  if(current.view.cleanup.state==='confirmed')return structuredClone(current.view);
  await atomicWrite(path,value);return structuredClone(value.view);
 },{waitSeconds:30});
 if(!winner){
  let currentRecord=record;
  // All replay decisions linearize at a current locked read, including immediate replies.
  // This observer never writes the stale status over the operation journal.
  const observe=async view=>withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
   const current=checkRecord(await readRecord(path));
   if(current.owner!==record.owner||current.operationId!==record.operationId||current.intentDigest!==record.intentDigest||
      canonicalDigest(current.intent)!==current.intentDigest||current.view.handle.kind!==record.view.handle.kind||current.view.handle.id!==record.view.handle.id)
    throw gozarError('operation_conflict','The operation recovery identity changed');
   currentRecord=structuredClone(current);
   if(current.referenceCleanup)return pendingReferenceView(current,home);
   if(current.view.cleanup.state==='confirmed')return structuredClone(current.view);
   if(view&&view.handle?.kind==='durable'&&current.view.handle.kind==='durable'&&view.handle.id===current.view.handle.id&&
      Number.isSafeInteger(view.handle.generation)&&Number.isSafeInteger(current.view.handle.generation)&&
      current.view.handle.generation>view.handle.generation)return structuredClone(current.view);
   return view;
  },{waitSeconds:30});
  const immediate=await observe(null);
  if(immediate)return immediate;
  const waits=request.wait==='verified'||request.wait==='allocated';
  const timeout=Number.isFinite(startTimeoutMs)&&startTimeoutMs>=0?startTimeoutMs:120_000;
  const deadline=Date.now()+timeout;
  // Only delays and status IO share this budget. Journal observations acquire
  // the independent reservation lock (up to 30s each); no lock spans status IO.
  const bounded=async action=>{
   if(!waits)return {value:await action()};
   const remaining=deadline-Date.now();if(remaining<=0)return {expired:true};
   let timer;
   try{
    const result=await Promise.race([
     Promise.resolve().then(action).then(value=>({value})),
     new Promise(resolve=>{timer=setTimeout(()=>resolve({expired:true}),remaining);}),
    ]);
    // A late IO completion cannot turn an elapsed deadline into success.
    return Date.now()>=deadline?{expired:true}:result;
   }catch(error){if(waits&&Date.now()>=deadline)return {expired:true};throw error;}
   finally{clearTimeout(timer);}
  };
  const recovery=()=>({...structuredClone(currentRecord.view),state:'uncertain',routeState:'cleanup-unconfirmed',published:null,ingress:null,
   verification:{...currentRecord.view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}});
  const atDeadline=async()=>{
   const terminal=await observe(null);if(terminal)return terminal;
   // Historical settled failure is not a fresh readiness promise.
   if(currentRecord.phase==='recovery'&&(currentRecord.view.cleanup?.state!=='none'||currentRecord.view.verification?.status==='failed'))return structuredClone(currentRecord.view);
   const error=gozarError('provider_unavailable','The original route operation did not finish in time');
   // Never decorate an arbitrary (possibly frozen) provider error.
   error.route=currentRecord.phase==='starting'?recovery():structuredClone(currentRecord.view);
   throw error;
  };
  // True only when the route's own authority says another read cannot become verified.
  let stale=0,booted;
  const cannotProgress=async view=>{
   if(view.consentChange?.reason==='host-resolver-unavailable')return true;
   const asked=progress?await bounded(()=>progress({home,owner:record.owner,handle:view.handle})).catch(()=>({})):{};
   if(asked.value)return asked.value.viable===false;
   // No controller to ask: this incarnation's own fresh proofs are the evidence, and they must repeat.
   if(booted===undefined)booted=await (async()=>embeddingServices.resolveIdentity({home}))().catch(()=>null);
   const subject=view.verification?.subject;
   stale=booted&&subject&&subject.instanceId===booted.instanceId&&subject.bootId===booted.bootId?stale+1:0;
   return stale>=REPROOF_ATTEMPTS;
  };
  // Status may refresh proof; never call it while the winner owns startup.
  while(waits&&currentRecord.phase==='starting'){
   let delayed;
   try{delayed=await bounded(()=>replayWait(Math.min(150,Math.max(0,deadline-Date.now()))));}
   catch(error){
    const terminal=await observe(null);if(terminal)return terminal;
    if(currentRecord.phase!=='starting')break;
    const refusal=gozarError('provider_unavailable','The original route operation did not finish in time',undefined,error);
    refusal.route=recovery();throw refusal;
   }
   const terminal=await observe(null);if(terminal)return terminal;
   if(delayed.expired)return atDeadline();
  }
  for(;;){
   let refreshed;
   try{
    refreshed=await bounded(async()=>{
     try{return {...await status({home,handle:currentRecord.view.handle}),operationId:request.operationId};}
     catch(error){
      if(error.code==='route_conflict'&&(!waits||Date.now()<deadline)){
       const reference=await operationReferenceForRoute({home,handle:currentRecord.view.handle});
       if(reference?.owner===record.owner&&reference.operationId===record.operationId&&(!waits||Date.now()<deadline))
        return {...await status({home,handle:reference.handle}),operationId:request.operationId};
      }
      throw error;
     }
    });
   }catch(error){
    const terminal=await observe(null);if(terminal)return terminal;
    if(!['route_not_found','provider_unavailable',...(currentRecord.phase==='starting'?['route_conflict']:[])].includes(error.code))throw error;
    // Creator loss remains a recovery read, including a stronger verified call.
    return observe(recovery());
   }
   if(refreshed.expired)return atDeadline();
   const view=await observe(refreshed.value);
   const live=view.cleanup?.state==='none'&&view.verification?.status!=='failed'&&
    !['released','failed','blocked'].includes(view.state);
   if(request.wait!=='verified'||!live||
      view.verification?.status==='verified'&&typeof view.published==='string'&&view.published.length>0)return view;
   // Creator loss: settle with the retained recovery view only on authority evidence, never on a bare unverified read.
   if(await cannotProgress(view))return observe(recoveryHistory(structuredClone(view),'The route creator is gone and its proof cannot progress; retry close with the retained handle.'));
   // Allocated is not verified: wait only for current live readiness, never
   // reallocate or demand publication from retained historical cleanup debt.
   let delayed;
   try{delayed=await bounded(()=>replayWait(Math.min(150,Math.max(0,deadline-Date.now()))));}
   catch(error){
    const terminal=await observe(null);if(terminal)return terminal;
    const refusal=gozarError('provider_unavailable','The original route operation did not finish in time',undefined,error);
    refusal.route=structuredClone(currentRecord.view);throw refusal;
   }
   const terminal=await observe(null);if(terminal)return terminal;
   if(delayed.expired)return atDeadline();
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
  // A failure whose own view confirms cleanup (a refusal before any resource existed) is settled, not retained as recovery debt.
  if(recovered&&record.view.cleanup?.state==='confirmed')record.phase='terminal';
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
/** Find the already scoped route demand without copying a view or creating an association. */
export async function routeGuidanceScope({ home, owner, handle }, view, registryId, beforeClose = null) {
  if (!view.operationId || !sameHandle(view.handle, handle)) return null;
  const reference = await operationReferenceForRoute({ home, handle }) ??
    (view.cleanup.state === 'confirmed' ? beforeClose : null);
  if (!reference || reference.operationId !== view.operationId || !sameHandle(reference.handle, handle)) return null;
  if (owner !== undefined && owner !== reference.owner) return null;
  let dir;
  try { dir = await directory(home, false); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const record = await optionalRead(join(dir, hash(JSON.stringify([reference.owner, reference.operationId])) + '.json'));
  if (!record || record.owner !== reference.owner || record.operationId !== reference.operationId ||
      !sameHandle(record.view.handle, handle) || record.intent?.registryId !== registryId ||
      record.intent.owner !== reference.owner || canonicalDigest(record.intent) !== record.intentDigest) return null;
  if (record.view.cleanup.state === 'confirmed' && view.cleanup.state !== 'confirmed') return null;
  return record.intent;
}

export async function recordOperationView({home,view,reference}){
 if(!reference)return view;
 let dir;try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return view;throw error;}
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const path=join(dir,hash(JSON.stringify([reference.owner,reference.operationId]))+'.json'),record=await optionalRead(path);if(!record)return view;checkRecord(record);
  if(record.view.handle.kind!==view.handle.kind||record.view.handle.id!==view.handle.id)return view;
  if(record.owner!==reference.owner||record.operationId!==reference.operationId||
     (reference.handle!==undefined&&!sameHandle(reference.handle,view.handle)))return view;
  if(record.view.handle.generation!==view.handle.generation){
   // A committed durable restoration may precede its operation-journal update.
   // The facade obtained this exact reference before generation-fenced close.
   if(!sameHandle(reference.handle,view.handle)||view.handle.kind!=='durable'||record.view.handle.generation>=view.handle.generation||
      !Number.isSafeInteger(view.handle.generation)||record.phase==='terminal')return view;
   // A replacement committed during close dominates this older reply.
   const current=await operationReferenceForRoute({home,handle:view.handle});
   if(current&&(!sameHandle(current.handle,view.handle)||current.owner!==reference.owner||
      current.operationId!==reference.operationId))return view;
  }
  if(record.referenceCleanup)return pendingReferenceView(record,await canonicalHome(home,false));
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
// Ordinary writers may observe debt but only exact metadata retry may finish it.
function pendingReferenceView(record,home){
 validReferenceRecord(record);
 const pending=record.referenceCleanup,handle=record.view.handle;
 const expected={registryId:record.intent.registryId,home,owner:record.owner,providerId:record.intent.providerId,handle};
 if(!pending||pending.intentDigest!==record.intentDigest||!sameHandle(pending.handle,handle)||
    canonicalDigest(pending.scope)!==canonicalDigest(expected)||!sameHandle(pending.resourceView?.handle,handle)||
    pending.resourceView?.cleanup?.state!=='confirmed'||pending.resourceView.operationId!==record.operationId)
  throw gozarError('cleanup_debt','Recorded resource-removal evidence does not match this reference');
 return referenceCleanupDebt(structuredClone(pending.resourceView));
}
/** Called only after confirmed provider absence from viewClose or validated controller removal evidence. */
export async function recordPendingReferenceCleanup({home,view,reference,scope}){
 if(!reference)return referenceCleanupDebt(view);
 home=await canonicalHome(home,false);
 const dir=await directory(home,false),path=join(dir,hash(JSON.stringify([reference.owner,reference.operationId]))+'.json');
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const record=validReferenceRecord(await readRecord(path));
  if(record.owner!==reference.owner||record.operationId!==reference.operationId||
     !sameHandle(record.view.handle,view.handle)||view.cleanup?.state!=='confirmed')
   throw gozarError('route_conflict','Reference cleanup does not match the recorded operation');
  const expectedScope={registryId:record.intent.registryId,home,owner:record.owner,
   providerId:record.intent.providerId,handle:record.view.handle};
  if(scope!==undefined&&(canonicalDigest(scope)!==canonicalDigest(expectedScope)||
     !sameHandle(reference.handle,view.handle)))
   throw gozarError('route_conflict','Removal evidence scope does not match the operation intent');
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

/** Read current cached controller evidence only; never refresh proof or invoke providers. */
export async function listRecordedRoutes({home,owner}={},deps={}){
 if(owner!==undefined&&(typeof owner!=='string'||!owner))throw gozarError('invalid_input','owner must be a non-empty string');
 home=await canonicalHome(home,false);
 const routes=new Map(),priorities=new Map(),current=new Map();
 const routeKey=handle=>JSON.stringify([handle.kind,handle.id]);
 const history=view=>view.state==='released'&&view.cleanup?.state==='confirmed'?view:
  recoveryHistory(view,'Current cached authority unavailable; retained evidence only.');
 const put=(view,priority=0)=>{
  const key=routeKey(view.handle),previous=routes.get(key);
  if(previous&&(previous.handle.generation>view.handle.generation||
   previous.handle.generation===view.handle.generation&&(priorities.get(key)??0)>priority))return;
  routes.set(key,{...view,operationId:view.operationId??null});priorities.set(key,priority);
 };
 const names=async dir=>{try{await trustedDirectory(dir,false);return await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 const lifecycle=async()=>{
  for(const entry of await names(join(home,'operations'))){
   if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
   const record=checkRecord(await readRecord(join(home,'operations',entry.name)));
   if(entry.name!==hash(JSON.stringify([record.owner,record.operationId]))+'.json')throw gozarError('cleanup_debt','Operation filename mismatch');
   if(owner!==undefined&&record.owner!==owner)continue;
   if(record.referenceCleanup)put(pendingReferenceView(record,home),30);
   else if(record.phase==='terminal'&&record.view.state==='released'&&record.view.cleanup?.state==='confirmed')put(record.view,40);
   else put(history(record.view),0);
  }
  for(const record of await cleanupRecords(home)){
   if(owner!==undefined&&record.scope.owner!==owner)continue;
   put(record.view,record.phase==='terminal'?40:record.phase==='resource-removed'?30:-1);
  }
 };
 const boundContext=(bootstrap,native=false)=>{
  const binding=native?bootstrap.embedding:bootstrap;
  return typeof deps.registryId==='string'&&deps.registryId.length>0&&binding?.registryId===deps.registryId&&
   Array.isArray(deps.adapters)&&deps.adapters.some(adapter=>adapter.id===bootstrap.adapterId);
 };
 // Both controller families authenticate the live incarnation. A subsequent disk
 // binding check prevents a replacement during the await from acquiring its reply.
 const observe=async(root,bootstrap,handle,fallback,native=false)=>{
  if(!boundContext(bootstrap,native))return history(fallback);
  try{
   let view,expiresAtMs;
   if(native){
    const binding=bootstrap.embedding;
    if(typeof bootstrap.owner!=='string'||!bootstrap.owner||
       !sameHandle(binding?.handle,handle)||binding.request?.owner!==bootstrap.owner||
       binding.request?.home!==home||bootstrap.sessionId!==handle.id.split(':')[1])
     throw gozarError('route_conflict','Native observation binding changed');
    const {observeSession}=await import('./daemon.mjs');
    const reply=await observeSession(root,{sessionId:bootstrap.sessionId,handleGeneration:handle.generation});
    if(reply.owner!==bootstrap.owner||reply.snapshot?.adapterId!==bootstrap.adapterId||
       reply.proofSubject?.instanceId!==binding.identity?.instanceId||reply.proofSubject?.bootId!==binding.identity?.bootId)
     throw gozarError('route_conflict','Native observation identity changed');
    view=projectSession(reply,{handle,now:Date.now(),...await propertiesFor(bootstrap.adapterId,deps,'session')});
    expiresAtMs=reply.expiresAtMs??reply.snapshot?.expiresAtMs;
    // A session must have a finite absolute lifetime, never an inferred duration.
    if(!Number.isFinite(expiresAtMs))return history(view);
   }else{
    const {observeAttachedRoute}=await import('./attached-route.mjs');
    view=await observeAttachedRoute({home,owner:bootstrap.owner,handle});
    expiresAtMs=bootstrap.expiresAtMs??null;
   }
   const after=await optionalRead(join(root,'bootstrap.json'));
   if(!after||canonicalDigest(after)!==canonicalDigest(bootstrap)||!sameHandle(view.handle,handle))
    throw gozarError('route_conflict','Controller binding changed during enumeration');
   current.set(routeKey(handle),{view,expiresAtMs,root,bootstrap,native});
   return view;
  }catch(error){
   if(error.code==='route_conflict')throw error;
   return history(fallback);
  }
 };
 await lifecycle();
 for(const entry of await names(join(home,'attached'))){
  if(!entry.isDirectory()||!/^att_[a-f0-9]{16}$/.test(entry.name))continue;
  const root=join(home,'attached',entry.name),bootstrap=await readRecord(join(root,'bootstrap.json'));
  if(owner!==undefined&&bootstrap.owner!==owner)continue;
  const record=await optionalRead(join(root,'state.json')),handle={kind:'attached',id:entry.name,generation:1};
  if(!record?.lastView?.handle||!sameHandle(record.handle,handle)||!sameHandle(record.lastView.handle,handle)||
     bootstrap.id!==entry.name||bootstrap.home!==home||typeof bootstrap.owner!=='string')
   throw gozarError('provider_unavailable','The attached recovery binding is unreadable');
  const view=record.resourceRemoval?referenceCleanupDebt(record.lastView):
   record.phase==='released'||record.lastView.cleanup?.state==='confirmed'?record.lastView:
   await observe(root,bootstrap,handle,record.lastView);
  put({...view,operationId:bootstrap.operationId??view.operationId??null},record.resourceRemoval?30:view.cleanup?.state==='confirmed'?40:10);
 }
 for(const entry of await names(join(home,'routes'))){
  if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
  const record=await readRecord(join(home,'routes',entry.name));
  if(record?.schemaVersion!==1||typeof record.routeId!=='string'||!record.routeId||record.ownership!=='gozar-owned'||typeof record.owner!=='string'||!record.owner||!Number.isSafeInteger(record.generation)||record.generation<1||entry.name!==hash(record.routeId)+'.json')throw gozarError('provider_unavailable','The durable route record is unreadable');
  if(owner!==undefined&&record.owner!==owner)continue;
  const handle={kind:'durable',id:record.routeId,generation:record.generation};
  put(history({...projectDurable(record,{handle,properties:unknownProperties()}),operationId:record.operationId??null}),10);
 }
 for(const entry of await names(home)){
  if(!entry.isDirectory()||!/^port-[0-9]+$/.test(entry.name))continue;
  const root=join(home,entry.name),bootstrap=await optionalRead(join(root,'bootstrap.json'));
  if(!bootstrap||(owner!==undefined&&bootstrap.owner!==owner))continue;
  if(bootstrap.execution==='generic-session-v1'){
   const handle=bootstrap.handle,record=await optionalRead(join(root,'state.json'));
   if(handle?.kind!=='session'||typeof handle.id!=='string'||!handle.id.startsWith(entry.name+':')||handle.generation!==1||
      bootstrap.home!==home||!record?.lastView||!sameHandle(record.handle,handle)||!sameHandle(record.lastView.handle,handle))
    throw gozarError('provider_unavailable','The generic session recovery binding is unreadable');
   const view=record.resourceRemoval?referenceCleanupDebt(record.lastView):
    record.phase==='released'||record.lastView.cleanup?.state==='confirmed'?record.lastView:
    await observe(root,bootstrap,handle,record.lastView);
   put({...view,operationId:bootstrap.operationId??view.operationId??null},record.resourceRemoval?30:view.cleanup?.state==='confirmed'?40:10);
   continue;
  }
  const journal=await optionalRead(join(root,'session.json'));
  if(!journal?.snapshot)throw gozarError('provider_unavailable','The native session recovery snapshot is unreadable');
  const handle={kind:'session',id:entry.name+':'+journal.snapshot.sessionId,generation:1};
  const fallback=projectSession(journal.embeddingView??{snapshot:journal.snapshot},{handle,properties:unknownProperties()});
  put({...await observe(root,bootstrap,handle,fallback,true),operationId:bootstrap.operationId??fallback.operationId??null},10);
 }
 for(const entry of await names(join(home,'services'))){
  if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
  const record=await readRecord(join(home,'services',entry.name));
  if(record.ownership!=='external-owned'||typeof record.origin!=='string')throw gozarError('provider_unavailable','The owner-route recovery record is unreadable');
  if(owner!==undefined&&record.embedding?.request.owner!==owner)continue;
  put(history(projectExternal(record,{handle:{kind:'external',id:record.origin,generation:record.generation??0}})),10);
 }
 // Re-read lifecycle after every controller await has completed. Exact removal
 // and terminal records dominate cached views; prepared remains fallback only.
 for(const [key,observed] of current){
  const after=await optionalRead(join(observed.root,'bootstrap.json'));
  if(!after||canonicalDigest(after)!==canonicalDigest(observed.bootstrap)){
   put(history(observed.view),20);continue;
  }
  const record=await optionalRead(join(observed.root,observed.native?'session.json':'state.json'));
  if(!record){put(history(observed.view),20);continue;}
  if(observed.native){
   if(record.snapshot?.sessionId!==observed.bootstrap.sessionId){put(history(observed.view),20);continue;}
   if(record.snapshot?.phase!=='published-ready')put(history(observed.view),20);
  }else{
   if(!sameHandle(record.handle,observed.view.handle))throw gozarError('route_conflict','Controller generation changed');
   if(record.resourceRemoval)put(referenceCleanupDebt(record.lastView),30);
   else if(record.phase==='released'||record.lastView?.cleanup?.state==='confirmed')put(record.lastView,40);
   else if(record.phase==='failed'||record.phase==='blocked')put(history(observed.view),20);
  }
 }
 await lifecycle();
 const now=Date.now();
 return {routes:[...routes.values()].map(view=>{
  const observed=current.get(routeKey(view.handle));
  if(!observed||!sameHandle(observed.view.handle,view.handle)||(priorities.get(routeKey(view.handle))??0)>=30)return view;
  const until=view.verification?.validUntil;
  if(view.state!=='usable'||view.cleanup?.state!=='none'||view.verification?.status!=='verified'||view.consentChange||
    until?.known!==true||!Number.isFinite(Date.parse(until.value))||Date.parse(until.value)<=now||
    observed.expiresAtMs!==null&&(!Number.isFinite(observed.expiresAtMs)||observed.expiresAtMs<=now))return history(view);
  return view;
 })};
}


// Cleanup-only authority is separate from optional allocation operation intents.
async function cleanupDirectory(home,create=false){
 const dir=join(await canonicalHome(home,create),'reference-cleanup');
 await trustedDirectory(dir,create);await privateDirectory(dir);return dir;
}
const cleanupKey=handle=>hash(JSON.stringify([handle.kind,handle.id,handle.generation]));
function checkCleanupRecord(record,home,name){
 const scope=record?.scope,handle=scope?.handle;
 if(record?.schemaVersion!==1||record.kind!=='configuration-reference-cleanup'||
    !['prepared','resource-removed','terminal'].includes(record.phase)||
    !['attached','session'].includes(handle?.kind)||typeof handle.id!=='string'||!handle.id||
    !Number.isSafeInteger(handle.generation)||handle.generation<1||
    typeof scope.owner!=='string'||!scope.owner||typeof scope.providerId!=='string'||!scope.providerId||
    typeof scope.registryId!=='string'||!scope.registryId||scope.home!==home||
    record.scopeDigest!==canonicalDigest(scope)||name!==cleanupKey(handle)+'.json'||
    !sameHandle(record.view?.handle,handle))
  throw gozarError('cleanup_debt','The private cleanup reference cannot be verified');
 if(record.phase!=='prepared'&&(!sameHandle(record.resourceView?.handle,handle)||record.resourceView?.cleanup?.state!=='confirmed'))
  throw gozarError('cleanup_debt','The resource-removal receipt cannot be verified');
 if(record.phase==='terminal'&&(record.view.state!=='released'||record.view.cleanup?.state!=='confirmed'))
  throw gozarError('cleanup_debt','Terminal cleanup evidence cannot be verified');
 return record;
}
async function cleanupRecords(home){
 let dir;try{dir=await cleanupDirectory(home);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const rows=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(entry.name==='.cleanup-lock')continue;
  // journal.atomicWrite creates only regular <record>.UUIDv4.tmp siblings.
  // Never read them as authority; symlinks and malformed authoritative records still fail closed.
  if(entry.isFile()&&/^[a-f0-9]{64}\.json\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(entry.name))continue;
  if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))throw gozarError('cleanup_debt','Unexpected cleanup reference entry');
  rows.push(checkCleanupRecord(await readRecord(join(dir,entry.name)),home,entry.name));
 }
 return rows;
}
export async function cleanupReferenceRecord({home,owner,handle}={},runtime={}){
 if(!['attached','session'].includes(handle?.kind))return null;
 try{home=await canonicalHome(home,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const rows=(await cleanupRecords(home)).filter(row=>row.scope.handle.kind===handle.kind&&row.scope.handle.id===handle.id);
 if(!rows.length)return null;
 const row=rows.find(row=>sameHandle(row.scope.handle,handle));
 if(!row||owner!==undefined&&row.scope.owner!==owner)throw gozarError('route_conflict','Cleanup reference belongs to another handle or owner');
 if(runtime.registryId!==undefined&&runtime.registryId!==row.scope.registryId)throw gozarError('cleanup_debt','Cleanup registry no longer matches');
 return row;
}
export async function prepareCleanupReference(scope){
 const home=await canonicalHome(scope.home,false),dir=await cleanupDirectory(home,true),name=cleanupKey(scope.handle)+'.json';
 return withExclusiveLock(join(dir,'.cleanup-lock'),async()=>{
  const prior=await optionalRead(join(dir,name));
  if(prior){checkCleanupRecord(prior,home,name);if(canonicalDigest(scope)!==prior.scopeDigest)throw gozarError('route_conflict','Cleanup scope changed');return prior;}
  const record={schemaVersion:1,kind:'configuration-reference-cleanup',scope:structuredClone(scope),scopeDigest:canonicalDigest(scope),
   phase:'prepared',view:recoveryHistory(startingRoute(scope.handle,null),'Resource removal is not confirmed; retry close with the exact retained handle.')};
  checkCleanupRecord(record,home,name);await atomicWrite(join(dir,name),record);return record;
 },{waitSeconds:30});
}
export async function recordCleanupRemoval(scope,view){
 const home=await canonicalHome(scope.home,false),dir=await cleanupDirectory(home),name=cleanupKey(scope.handle)+'.json';
 return withExclusiveLock(join(dir,'.cleanup-lock'),async()=>{
  const record=checkCleanupRecord(await readRecord(join(dir,name)),home,name);
  if(record.scopeDigest!==canonicalDigest(scope)||!sameHandle(view.handle,scope.handle)||view.cleanup?.state!=='confirmed')
   throw gozarError('cleanup_debt','Cleanup removal receipt does not match');
  if(record.phase==='terminal')return record;
  record.resourceView={...view,published:null,ingress:null,verification:{...view.verification,status:'unverified'}};
  record.view=referenceCleanupDebt(record.resourceView);record.phase='resource-removed';
  await atomicWrite(join(dir,name),record);return record;
 },{waitSeconds:30});
}
export async function retryCleanupReference(request,runtime){
 const found=await cleanupReferenceRecord(request,runtime);
 if(!found||found.phase==='prepared')return null;
 const home=found.scope.home,dir=await cleanupDirectory(home),name=cleanupKey(found.scope.handle)+'.json';
 return withExclusiveLock(join(dir,'.cleanup-lock'),async()=>{
  const record=checkCleanupRecord(await readRecord(join(dir,name)),home,name);
  if(record.scopeDigest!==found.scopeDigest)throw gozarError('cleanup_debt','Cleanup scope changed during retry');
  if(record.phase==='terminal')return structuredClone(record.view);
  if(record.phase!=='resource-removed')return null;
  try{await releaseRecordedConfigurationUse(record.scope,runtime);await runtime.afterReferenceRelease?.();}
  catch(cause){const error=gozarError('cleanup_debt','Resource removed but exact configuration reference remains',record.view.cleanup.nextAction,cause);error.route=structuredClone(record.view);throw error;}
  record.view={...record.resourceView,state:'released',routeState:'released',cleanup:{state:'confirmed'}};
  record.phase='terminal';await atomicWrite(join(dir,name),record);return structuredClone(record.view);
 },{waitSeconds:30});
}
export async function listCleanupReferences({home,owner}={}){
 home=await canonicalHome(home,false);
 return (await cleanupRecords(home)).filter(row=>owner===undefined||row.scope.owner===owner).map(row=>structuredClone(row.view));
}
