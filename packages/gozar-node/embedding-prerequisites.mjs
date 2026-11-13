import {createHash} from 'node:crypto';
import {embeddingError} from './embedding-services.mjs';
// Artifact acquisition and execution are host capabilities, never shell recipes.
export async function executeArtifact(action,{hostCapabilities={},executor,platform=process.platform,architecture=process.arch}={}){
 const capability=hostCapabilities['installer.execute'];
 if(!capability?.known||capability.value!==true||!executor)throw embeddingError('unsupported');
 const {artifact,effects}=action;
 if(!artifact||!effects||artifact.platform!==platform||artifact.architecture!==architecture||!/^https:\/\//.test(artifact.url)||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw embeddingError('unsupported');
 if(effects.requiresPrivilege&&!(hostCapabilities['privilege.elevate']?.known===true&&hostCapabilities['privilege.elevate'].value===true))throw embeddingError('host_policy_denied');
 const bytes=await executor.fetchArtifact(artifact);
 if(!(bytes instanceof Uint8Array)||createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw embeddingError('artifact_integrity_failed');
 return executor.executeArtifact({artifact,effects,bytes});
}
export function capabilityPrerequisites(definition,hostCapabilities={}){
 return (definition.requiredCapabilities??[]).map(id=>{const seen=hostCapabilities[id];return {id,label:id,observation:seen??{known:false,reason:'host-capability-undeclared'},state:!seen?.known?'unknown':seen.value===true?'present':seen.value===false?'denied':'unsupported',observedAt:null,version:{known:false,reason:'not-observed'},remedy:null};});
}
