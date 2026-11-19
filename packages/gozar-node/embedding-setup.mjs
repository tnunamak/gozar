import {needsSetupOperation,safeSetupAction} from './consent-facts.mjs';
import {configurationFor} from './embedding-state.mjs';
import {createHash} from 'node:crypto';
import {inspectAdapter,detectAdapter,readContextFor, catalogRevisionOf} from './route-catalog.mjs';
import {bindConfiguration} from './adapter-configuration.mjs';
import {checkValue} from './route-setup.mjs';
import {embeddingError} from './embedding-services.mjs';
import {executeArtifact} from './embedding-prerequisites.mjs';
const fail=code=>{throw embeddingError(code);};
export async function runEmbeddingSetup(request,deps){
 const {embeddingServices:services}=deps;
 if(typeof request?.providerId!=='string'||!request.providerId||typeof request.expectedConfigurationRevision!=='string'||!request.actionId)fail('invalid_input');
 if(request.approval?.kind!=='setup')fail('consent_required');
 if(!request.approval?.digest||!request.approval?.disclosureRevision)fail('consent_required');
 const adapter=deps.adapters?.find(a=>a.id===request.providerId);if(!adapter)fail('candidate_stale');
 const platform=deps.platform??process.platform;const read=await readContextFor(deps,request.home,platform);
 const preview=await inspectAdapter(adapter,{...read,providerConfiguration:providerId=>services.resolveConfiguration({...request,providerId})},platform);
 const offered=preview.actions.find(a=>a.id===request.actionId);
 if(needsSetupOperation(offered))fail('setup_required');
 const nonMutating=['open-url','instructions','install-artifact'].includes(offered?.kind);
 const outcome=await services.mutateConfiguration(request,async tx=>{
  const own=bindConfiguration({...read,providerConfiguration:()=>tx.resolveConfiguration()},adapter.id);
  const item=await inspectAdapter(adapter,own,platform);
  const action=item.actions.find(a=>a.id===request.actionId);
  if(needsSetupOperation(action))fail('setup_required');
  if(action?.kind!==offered?.kind)fail('candidate_stale');
  if(!action||action.digest!==request.approval.digest||action.disclosure.revision!==request.approval.disclosureRevision)fail('candidate_stale');
  await deps.validateSetupApproval?.({request,action,adapter,inspection:item,readContext:own,configuration:await tx.configuration()});
  if(['open-url','instructions'].includes(action.kind))return {state:'pending',nextAction:action};
  const inputId=(adapter.definition.inputRequirements??[]).find(i=>i.actionId===action.id)?.id??action.id;
  if(action.kind==='provide-value'){
   if(request.secretHandle!==undefined)fail('invalid_input');if(request.value===undefined)return {state:'pending',nextAction:action};
   const value=checkValue(action.valueFormat,request.value);if(value===null)fail('invalid_input');tx.bindText(inputId,value);return {state:'complete',nextAction:null};
  }
  if(action.kind==='install-artifact'){
   await executeArtifact(action,{hostCapabilities:deps.hostCapabilities??services.hostCapabilities,executor:deps.artifactExecutor,platform,architecture:deps.architecture??process.arch});return {state:'complete',nextAction:null};
  }
  const execute=deps.executeApprovedAction??(async()=>fail('unsupported'));
  const context={...own,withSecret:(handle,use)=>handle===request.secretHandle?tx.withSecret(inputId,handle,use):Promise.reject(embeddingError('invalid_input')),
   configuration:ref=>ref===request.secretHandle&&ref!=null?tx.withSecret(inputId,ref,async bytes=>new Uint8Array(bytes)):own.configuration(ref),
   executeApprovedAction:id=>id===action.id?execute(id):Promise.reject(embeddingError('invalid_input'))};
  if(action.kind==='provide-secret')await tx.withSecret(inputId,request.secretHandle,async()=>{});
  const result=await adapter.setup(context,action.id,request.secretHandle);
  if(!['complete','pending','blocked'].includes(result?.state))fail('internal_error');
  if(result.state==='complete'){if(action.kind==='provide-secret')await tx.bindSecret(inputId,request.secretHandle);else tx.markChanged();}return result;
 },{mutatesConfiguration:!nonMutating});
 // The completed action changed what detection observes: drop the scope's retained entries now, so the
 // catalog revision sweep below reflects the new state and the next polling read awaits fresh detection.
 deps.detection?.invalidate({registryId:deps.registryId,home:request.home,owner:request.owner,providerId:request.providerId});
 return {schemaVersion:1,state:outcome.result.state,nextAction:needsSetupOperation(outcome.result.nextAction)?safeSetupAction(outcome.result.nextAction):outcome.result.nextAction??null,configuration:(await offeredConfiguration(request,outcome.configuration,deps)).configuration,configurationRevision:outcome.configuration.revision,scopeId:outcome.configuration.scopeId,catalogRevision:catalogRevisionOf(await Promise.all(deps.adapters.map(async a=>{
  const scopedRead={...read,providerConfiguration:providerId=>services.resolveConfiguration({...request,providerId,draftId:providerId===request.providerId?request.draftId:undefined})};
  if(!deps.detection)return inspectAdapter(a,scopedRead,platform);
  const cached=await deps.detection.provider({scope:{registryId:deps.registryId,home:request.home,owner:request.owner,
   providerId:a.id,platform,adapter:a,draftId:a.id===request.providerId?request.draftId??null:null},
   readConfiguration:()=>services.readConfiguration({...request,owner:request.owner,providerId:a.id,draftId:a.id===request.providerId?request.draftId:undefined}),
   detect:()=>detectAdapter(a,scopedRead,platform)});
  return cached.inspection;
 })),platform)};
}

export function clearInputActions(configuration){
 return [...new Set([...Object.keys(configuration.values),...Object.keys(configuration.credentials)])].sort().map(inputId=>{
  const body={id:`clear-input-${createHash('sha256').update(inputId).digest('hex').slice(0,24)}`,kind:'clear-input',inputId,label:'Forget configured input',disclosure:{revision:'clear-input-v1',text:'Remove this input reference from the draft. Commit after closing affected routes. Credential bytes and vendor accounts are unchanged.',links:[]}};
  return {...body,digest:`sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`};
 });
}
export async function clearConfigurationInput(request,deps){
 if(!request.draftId||!request.inputId||request.approval?.kind!=='setup')fail('invalid_input');
 const adapter=deps.adapters.find(a=>a.id===request.providerId);if(!adapter)fail('candidate_stale');
 const outcome=await deps.embeddingServices.mutateConfiguration(request,async tx=>{
  const configuration=await tx.configuration();const action=clearInputActions(configuration).find(a=>a.inputId===request.inputId);
  if(!action||action.digest!==request.approval.digest||action.disclosure.revision!==request.approval.disclosureRevision)fail('candidate_stale');
  const read=await readContextFor(deps,request.home,deps.platform??process.platform);
  const own={...read,providerConfiguration:()=>tx.resolveConfiguration()};const inspection=await inspectAdapter(adapter,own,deps.platform??process.platform);
  await deps.validateSetupApproval?.({request,action,adapter,configuration,inspection,readContext:own});tx.clearInput(request.inputId);
 });const offered=await offeredConfiguration(request,outcome.configuration,deps);
 return {...offered.configuration,...(offered.detection?{detection:offered.detection}:{})};
}

// Rebuild offered actions from the persisted scope; hosts never reconstruct consent metadata.
export async function offeredConfiguration(request,snapshot,deps,admission){
 const adapter=deps.adapters.find(a=>a.id===request.providerId);if(!adapter)fail('candidate_stale');
 const platform=deps.platform??process.platform;const read=await readContextFor(deps,request.home,platform);
 const scopedRead={...read,providerConfiguration:providerId=>deps.embeddingServices.resolveConfiguration({...request,providerId})};
 let inspection,detection=null;
 if(deps.detection){
  // The offered-action inspection runs on the cached detection: the draft scope keys it, a cold or
  // expired read answers retained or declared-unknown state (a poll never probes), and an explicit
  // refresh request owns the probes. The declared inputs and action decoration below stay live.
  const cached=await deps.detection.provider({scope:{registryId:deps.registryId,home:request.home,owner:request.owner,
   providerId:adapter.id,platform,adapter,draftId:request.draftId??null},
   readConfiguration:()=>Promise.resolve(snapshot),detect:()=>detectAdapter(adapter,scopedRead,platform),explicit:request.refresh===true,admission});
  inspection=cached.inspection;detection=cached.detection;
 }else inspection=await inspectAdapter(adapter,scopedRead,platform);
 // A failed observation (a locked secret backend) leaves the inspection without actions, but the draft's declared inputs still exist.
 let declared=[];if(inspection.failure&&!inspection.actions.length){try{declared=adapter.configurationActions?adapter.configurationActions():adapter.setupActions({setupNeeded:true});}catch{declared=[];}}
 const raw=[...new Map([...inspection.actions,...(inspection.missingActions??[]),...declared,...clearInputActions(snapshot)].map(a=>[a.id,a])).values()];
 const actions=await Promise.all(raw.map(action=>deps.decorateSetupAction?deps.decorateSetupAction({action,adapter,configuration:snapshot,draftId:request.draftId??null,inspection}):action));
 const configuration={...snapshot,...configurationFor(actions,snapshot,adapter.definition.inputRequirements),actions};
 // `{configuration, detection}`: the honest detection freshness this offered scope was served from.
 return detection?{configuration,detection}:{configuration};
}
export async function readConfigurationDraft(request,deps,admission){
 const draft=await deps.embeddingServices.readConfigurationDraft(request);
 const offered=await offeredConfiguration(request,draft.configuration,deps,admission);
 return {...draft,configuration:offered.configuration,...(offered.detection?{detection:offered.detection}:{})};
}
