import {createHash} from 'node:crypto';
import {embeddingError} from './embedding-services.mjs';
// Artifact acquisition and execution are host capabilities, never shell recipes.
// Only the declared artifact/effects DTO crosses this boundary, not arbitrary action data.
function approvedDescriptor(action,platform,architecture){
 let snapshot;
 try{
  const {artifact:a,effects:e}=action??{};
  snapshot=structuredClone({artifact:{url:a?.url,sha256:a?.sha256,platform:a?.platform,architecture:a?.architecture},
   effects:{writes:e?.writes,networkOrigins:e?.networkOrigins,requiresPrivilege:e?.requiresPrivilege,restartRequired:e?.restartRequired}});
 }catch{throw embeddingError('unsupported');}
 const {artifact,effects}=snapshot;
 if(typeof artifact.url!=='string'||!/^https:\/\//.test(artifact.url)||typeof artifact.sha256!=='string'||!/^[a-f0-9]{64}$/.test(artifact.sha256)||
  artifact.platform!==platform||artifact.architecture!==architecture||
  !Array.isArray(effects.writes)||!effects.writes.every(x=>typeof x==='string')||
  !Array.isArray(effects.networkOrigins)||!effects.networkOrigins.every(x=>typeof x==='string')||
  typeof effects.requiresPrivilege!=='boolean'||typeof effects.restartRequired!=='boolean')throw embeddingError('unsupported');
 Object.freeze(effects.writes);Object.freeze(effects.networkOrigins);Object.freeze(effects);Object.freeze(artifact);
 return Object.freeze(snapshot);
}
function admit(capabilities,id){
 const observation=capabilities?.[id];
 if(observation?.known===true&&observation.value===false)throw embeddingError('host_policy_denied');
 if(observation?.known!==true||observation.value!==true)throw embeddingError('unsupported');
}
export async function executeArtifact(action,{hostCapabilities={},executor,platform=process.platform,architecture=process.arch}={}){
 const fetchCallback=executor?.fetchArtifact,executeCallback=executor?.executeArtifact;
 if(typeof fetchCallback!=='function'||typeof executeCallback!=='function')throw embeddingError('unsupported');
 const fetch=fetchCallback.bind(executor),execute=executeCallback.bind(executor);
 const {artifact,effects}=approvedDescriptor(action,platform,architecture);
 const admitCurrent=()=>{admit(hostCapabilities,'installer.execute');if(effects.requiresPrivilege)admit(hostCapabilities,'privilege.elevate');};
 admitCurrent();
 const fetched=await fetch(artifact);
 if(!(fetched instanceof Uint8Array))throw embeddingError('artifact_integrity_failed');
 // Copy before verifying: the fetcher's retained alias must not become execution authority.
 const bytes=new Uint8Array(fetched);
 if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw embeddingError('artifact_integrity_failed');
 admitCurrent();
 return execute({artifact,effects,bytes});
}
export function capabilityPrerequisites(definition,hostCapabilities={}){
 return (definition.requiredCapabilities??[]).map(id=>{const seen=hostCapabilities[id];return {id,label:id,observation:seen??{known:false,reason:'host-capability-undeclared'},state:!seen?.known?'unknown':seen.value===true?'present':seen.value===false?'denied':'unsupported',observedAt:null,version:{known:false,reason:'not-observed'},remedy:null};});
}
