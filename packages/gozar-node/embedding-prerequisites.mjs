import {createHash} from 'node:crypto';
import {embeddingError} from './embedding-services.mjs';
// Artifact acquisition and execution are trusted host capabilities, never shell recipes.
// Approval descriptors are data records. Clone first, then freeze the entire record
// graph so neither the caller nor a callback can accidentally rewrite approval data.
function approvalSnapshot(value){
 const copy=structuredClone(value),seen=new WeakSet();
 function freeze(record){
  if(!record||typeof record!=='object'||seen.has(record))return record;
  if(!Array.isArray(record)&&Object.getPrototypeOf(record)!==Object.prototype&&Object.getPrototypeOf(record)!==null)throw embeddingError('unsupported');
  seen.add(record);
  for(const child of Object.values(record))freeze(child);
  return Object.freeze(record);
 }
 return freeze(copy);
}
function admit(hostCapabilities,effects){
 const capability=hostCapabilities['installer.execute'];
 if(capability?.known!==true)throw embeddingError('unsupported');
 if(capability.value===false)throw embeddingError('host_policy_denied');
 if(capability.value!==true)throw embeddingError('unsupported');
 if(effects.requiresPrivilege&&!(hostCapabilities['privilege.elevate']?.known===true&&hostCapabilities['privilege.elevate'].value===true))throw embeddingError('host_policy_denied');
}
export async function executeArtifact(action,{hostCapabilities={},executor,platform=process.platform,architecture=process.arch}={}){
 const {artifact,effects}=approvalSnapshot({artifact:action.artifact,effects:action.effects});
 if(!artifact||!effects||artifact.platform!==platform||artifact.architecture!==architecture||!/^https:\/\//.test(artifact.url)||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw embeddingError('unsupported');
 admit(hostCapabilities,effects);
 if(typeof executor?.fetchArtifact!=='function'||typeof executor?.executeArtifact!=='function')throw embeddingError('unsupported');
 // Bind both callbacks before yielding, preserving their receiver and error identity.
 const fetch=executor.fetchArtifact.bind(executor),execute=executor.executeArtifact.bind(executor);
 const fetched=await fetch(artifact);
 if(!(fetched instanceof Uint8Array))throw embeddingError('artifact_integrity_failed');
 // Own the byte buffer we verify, not the fetcher's mutable view.
 const bytes=Uint8Array.from(fetched);
 if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw embeddingError('artifact_integrity_failed');
 // Observations remain caller-owned and may have been revoked while fetching.
 admit(hostCapabilities,effects);
 return execute({artifact,effects,bytes});
}
export function capabilityPrerequisites(definition,hostCapabilities={}){
 return (definition.requiredCapabilities??[]).map(id=>{const seen=hostCapabilities[id];return {id,label:id,observation:seen??{known:false,reason:'host-capability-undeclared'},state:seen?.known!==true?'unknown':seen.value===true?'present':seen.value===false?'denied':'unsupported',observedAt:null,version:{known:false,reason:'not-observed'},remedy:null};});
}
