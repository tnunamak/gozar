import {configurationFor} from './embedding-state.mjs';
import {createHash} from 'node:crypto';
import {inspectAdapter,readContextFor, catalogRevisionOf} from './route-catalog.mjs';
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
 const nonMutating=['open-url','instructions','install-artifact'].includes(offered?.kind);
 const outcome=await services.mutateConfiguration(request,async tx=>{
  const own=bindConfiguration({...read,providerConfiguration:()=>tx.resolveConfiguration()},adapter.id);
  const item=await inspectAdapter(adapter,own,platform);
  const action=item.actions.find(a=>a.id===request.actionId);
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
 return {schemaVersion:1,state:outcome.result.state,nextAction:outcome.result.nextAction??null,configuration:await offeredConfiguration(request,outcome.configuration,deps),configurationRevision:outcome.configuration.revision,scopeId:outcome.configuration.scopeId,catalogRevision:catalogRevisionOf(await Promise.all(deps.adapters.map(a=>inspectAdapter(a,{...read,providerConfiguration:providerId=>services.resolveConfiguration({...request,providerId,draftId:providerId===request.providerId?request.draftId:undefined})},platform))),platform)};
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
 });return offeredConfiguration(request,outcome.configuration,deps);
}

// Rebuild offered actions from the persisted scope; hosts never reconstruct consent metadata.
export async function offeredConfiguration(request,snapshot,deps){
 const adapter=deps.adapters.find(a=>a.id===request.providerId);if(!adapter)fail('candidate_stale');
 const platform=deps.platform??process.platform;const read=await readContextFor(deps,request.home,platform);
 const inspection=await inspectAdapter(adapter,{...read,providerConfiguration:providerId=>deps.embeddingServices.resolveConfiguration({...request,providerId})},platform);
 const raw=[...new Map([...inspection.actions,...(inspection.missingActions??[]),...clearInputActions(snapshot)].map(a=>[a.id,a])).values()];
 const actions=await Promise.all(raw.map(action=>deps.decorateSetupAction?deps.decorateSetupAction({action,adapter,configuration:snapshot,draftId:request.draftId??null,inspection}):action));
 const configuration={...configurationFor(actions,snapshot),...snapshot,actions};
 if(adapter.definition.inputRequirements)configuration.inputRequirements=structuredClone(adapter.definition.inputRequirements);
 return configuration;
}
export async function readConfigurationDraft(request,deps){
 const draft=await deps.embeddingServices.readConfigurationDraft(request);
 return {...draft,configuration:await offeredConfiguration(request,draft.configuration,deps)};
}
