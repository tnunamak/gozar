import {instructionAction} from './error-normalizer.mjs';
export function bindingFor({observedTarget,authority='unknown',remedy=null}={}){
 const target=observedTarget?.known===true&&typeof observedTarget.value==='string'?{known:true,value:observedTarget.value}:{known:false,reason:observedTarget?.reason??'effective-target-not-observed'};
 return {authority:['adapter','owner'].includes(authority)?authority:'unknown',target,remedy};
}
// The action invokes the existing public closeRoute path; this module owns no receipt lifecycle.
export function cleanupRecovery(cleanup,handle){
 return {...cleanup,nextAction:cleanup.state==='unconfirmed'?instructionAction('retry-close','Retry route cleanup',`Call closeRoute again with the retained route handle (${handle?.kind??'unknown'}).`):null};
}
