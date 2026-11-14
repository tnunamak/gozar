// Durable host intent identity precedes allocation. A retained reservation is never a retry command.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome,trustedDirectory,privateDirectory,readRecord,withExclusiveLock} from './service-state.mjs';
import {atomicWrite,processIdentity} from './journal.mjs';
import {canonicalDigest,peekConsentGrant} from './consent-token.mjs';
import {unknownProperties,projectSession,projectDurable} from './route-view.mjs';
import {enrichRoute} from './embedding-state.mjs';
import {gozarError} from './error-normalizer.mjs';
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
export async function withRouteOperation(request,{registryId,embeddingServices,run,status}){
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
  const handle=newHandle(request);
  if(handle.kind==='durable'){const existing=await optionalRead(join(home,'routes',hash(handle.id)+'.json'));if(existing)handle.generation=existing.generation;}
  const value={schemaVersion:1,owner:request.owner,operationId:request.operationId,intent,intentDigest,phase:'starting',view:startingRoute(handle,request.target,request.operationId)};
  await atomicWrite(path,value);winner=true;return value;
 },{waitSeconds:30});
 // A stop can complete while the allocating caller awaits its result. Never let that
 // caller replace durable terminal evidence with its stale successful snapshot.
 const persist=async(value)=>withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const current=checkRecord(await readRecord(path));
  if(current.view.cleanup.state==='confirmed')return structuredClone(current.view);
  await atomicWrite(path,value);return structuredClone(value.view);
 },{waitSeconds:30});
 if(!winner){
  if(record.view.cleanup.state==='confirmed')return structuredClone(record.view);
  try{return {...await status({home,handle:record.view.handle}),operationId:request.operationId};}
  catch(error){
   if(!['route_not_found','provider_unavailable',...(record.phase==='starting'?['route_conflict']:[])].includes(error.code))throw error;
   // No answering creator is not evidence that allocation never happened, nor
   // authority to replay a previously published address as current proof.
   return {...structuredClone(record.view),state:'uncertain',routeState:'cleanup-unconfirmed',published:null,ingress:null,
    verification:{...record.view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  }
 }
 try{const view={...await run(record.view.handle),operationId:request.operationId};record.view=view;record.phase='allocated';return await persist(record);}
 catch(error){
  record.phase='recovery';let recovered=error.route;
  if(!recovered)try{recovered=await status({home,handle:record.view.handle});}catch{}
  record.view=recovered?{...recovered,operationId:request.operationId}:{...record.view,state:'uncertain',routeState:'cleanup-unconfirmed',cleanup:{state:'unconfirmed',nextAction:null},published:null};
  error.route=await persist(record);throw error;
 }
}

export async function recordOperationView({home,view}){
 let dir;try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return view;throw error;}
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  for(const name of await readdir(dir)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const path=join(dir,name),record=checkRecord(await readRecord(path));if(JSON.stringify(record.view.handle)!==JSON.stringify(view.handle))continue;record.view={...view,operationId:record.operationId};record.phase=view.cleanup.state==='confirmed'?'terminal':'recovery';await atomicWrite(path,record);view=record.view;}
  return view;
 },{waitSeconds:30});
}

/** Read persisted snapshots only. Listing never mints consent or refreshes a provider proof. */
export async function listRecordedRoutes({home,owner}={},deps={}){
 if(owner!==undefined&&(typeof owner!=='string'||!owner))throw gozarError('invalid_input','owner must be a non-empty string');
 home=await canonicalHome(home,false);const routes=new Map();
 const put=view=>routes.set(JSON.stringify(view.handle),{...view,operationId:view.operationId??null});
 const names=async dir=>{try{await trustedDirectory(dir,false);return await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 for(const entry of await names(join(home,'operations'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=checkRecord(await readRecord(join(home,'operations',entry.name)));if(owner===undefined||record.owner===owner)put(record.view);}
 for(const entry of await names(join(home,'attached'))){if(!entry.isDirectory()||!/^att_[a-f0-9]{16}$/.test(entry.name))continue;const root=join(home,'attached',entry.name),bootstrap=await readRecord(join(root,'bootstrap.json'));if(owner!==undefined&&bootstrap.owner!==owner)continue;const record=await optionalRead(join(root,'state.json'));if(!record)continue;if(!record.lastView?.handle)throw gozarError('provider_unavailable','The attached recovery snapshot is unreadable');let view=record.lastView;
  const controller=await optionalRead(join(root,'control.json'));
  if(view.state!=='released'&&(!controller||await processIdentity(controller.pid)!==controller.startIdentity))view={...view,state:'uncertain',published:null,routeState:'cleanup-unconfirmed',verification:{...view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  put({...view,operationId:bootstrap.operationId??routes.get(JSON.stringify(view.handle))?.operationId??null});
 }
 for(const entry of await names(join(home,'routes'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=await readRecord(join(home,'routes',entry.name));if(!record.routeId||!Number.isSafeInteger(record.generation))throw gozarError('provider_unavailable','The durable route record is unreadable');if(owner!==undefined&&record.owner!==owner)continue;const handle={kind:'durable',id:record.routeId,generation:record.generation};const previous=routes.get(JSON.stringify(handle));put({...projectDurable(record,{handle,properties:unknownProperties()}),operationId:record.operationId??previous?.operationId??null});}
 for(const entry of await names(home)){if(!entry.isDirectory()||!/^port-[0-9]+$/.test(entry.name))continue;const bootstrap=await optionalRead(join(home,entry.name,'bootstrap.json'));if(!bootstrap||(owner!==undefined&&bootstrap.owner!==owner))continue;const journal=await optionalRead(join(home,entry.name,'session.json'));if(!journal?.snapshot)continue;const handle={kind:'session',id:`${entry.name}:${journal.snapshot.sessionId}`,generation:1};put({...projectSession({snapshot:journal.snapshot},{handle,properties:unknownProperties()}),operationId:bootstrap.operationId??routes.get(JSON.stringify(handle))?.operationId??null});}
 return {routes:[...routes.values()]};
}
