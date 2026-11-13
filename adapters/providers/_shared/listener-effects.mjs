// Fixture transport replaces effects, while the real adapter retains lifecycle and receipt checks.
import {effectError} from '../../../packages/gozar-node/adapter-runtime.mjs';
export async function listenerSdk(ctx,loadSdk){
 if(!ctx.dispatchEffect)return loadSdk();
 const invoke=(operation,input)=>ctx.dispatchEffect({kind:'sdk-listener',operation,input});
 const detected=await invoke('detect',{});
 if(detected?.available!==true)throw effectError('setup_required','The listener runtime is unavailable in this fixture');
 const listener=record=>{
  if(typeof record?.handle!=='string'||!record.handle||typeof record?.url!=='string')throw effectError('provider_unavailable','The fixture listener effect returned an invalid resource');
  return {id:()=>record.handle,url:()=>record.url,close:()=>invoke('close',{handle:record.handle})};
 };
 return {forward:async options=>listener(await invoke('open',{options})),getListener:async handle=>{
  const result=await invoke('read',{handle});
  if(result?.present===false)return null;
  if(result?.present!==true)throw effectError('provider_unavailable','The fixture listener presence is unknown');
  return listener({handle,url:result.url});
 }};
}
