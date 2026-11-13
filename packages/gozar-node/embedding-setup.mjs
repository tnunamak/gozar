import {inspectAdapter,readContextFor, catalogRevisionOf} from './route-catalog.mjs';
import {bindConfiguration} from './adapter-configuration.mjs';
import {checkValue} from './route-setup.mjs';
import {embeddingError} from './embedding-services.mjs';
import {executeArtifact} from './embedding-prerequisites.mjs';
const fail=code=>{throw embeddingError(code);};
export async function runEmbeddingSetup(request,deps){
 const {embeddingServices:services}=deps;
 if(typeof request?.providerId!=='string'||!request.providerId||typeof request.expectedConfigurationRevision!=='string'||!request.actionId)fail('invalid_input');
 if(!request.approval?.digest||!request.approval?.disclosureRevision)fail('consent_required');
 const adapter=deps.adapters?.find(a=>a.id===request.providerId);if(!adapter)fail('candidate_stale');
 const platform=deps.platform??process.platform;const read=await readContextFor(deps,request.home,platform);
 const outcome=await services.mutateConfiguration(request,async tx=>{
  const own=bindConfiguration({...read,providerConfiguration:()=>tx.resolveConfiguration()},adapter.id);
  const item=await inspectAdapter(adapter,own,platform);
  const action=item.actions.find(a=>a.id===request.actionId);
  if(!action||action.digest!==request.approval.digest||action.disclosure.revision!==request.approval.disclosureRevision)fail('candidate_stale');
  await deps.validateSetupApproval?.({request,action,adapter,configuration:await tx.configuration()});
  if(['open-url','instructions'].includes(action.kind))return {state:'pending',nextAction:action};
  if(action.kind==='provide-value'){
   if(request.secretHandle!==undefined)fail('invalid_input');if(request.value===undefined)return {state:'pending',nextAction:action};
   const value=checkValue(action.valueFormat,request.value);if(value===null)fail('invalid_input');tx.bindText(action.id,value);return {state:'complete',nextAction:null};
  }
  if(action.kind==='install-artifact'){
   await executeArtifact(action,{hostCapabilities:deps.hostCapabilities??services.hostCapabilities,executor:deps.artifactExecutor,platform,architecture:deps.architecture??process.arch});tx.markChanged();return {state:'complete',nextAction:null};
  }
  const inputId=(adapter.definition.inputRequirements??[]).find(i=>i.actionId===action.id)?.id??action.id;
  const execute=deps.executeApprovedAction??(async()=>fail('unsupported'));
  const context={...own,withSecret:(handle,use)=>handle===request.secretHandle?tx.withSecret(inputId,handle,use):Promise.reject(embeddingError('invalid_input')),
   configuration:ref=>ref===request.secretHandle&&ref!=null?tx.withSecret(inputId,ref,async bytes=>new Uint8Array(bytes)):own.configuration(ref),
   executeApprovedAction:id=>id===action.id?execute(id):Promise.reject(embeddingError('invalid_input'))};
  if(action.kind==='provide-secret')await tx.withSecret(inputId,request.secretHandle,async()=>{});
  const result=await adapter.setup(context,action.id,request.secretHandle);
  if(!['complete','pending','blocked'].includes(result?.state))fail('internal_error');
  if(result.state==='complete'){if(action.kind==='provide-secret')await tx.bindSecret(inputId,request.secretHandle);else tx.markChanged();}return result;
 });
 return {schemaVersion:1,...outcome.result,configurationRevision:outcome.configuration.revision,scopeId:outcome.configuration.scopeId,catalogRevision:catalogRevisionOf([],platform)};
}
