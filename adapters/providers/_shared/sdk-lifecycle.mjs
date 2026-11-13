// Exact listener custody survives startup failure, late allocation and uncertain close.
import {randomUUID} from 'node:crypto';
import {effectError} from '../../../packages/gozar-node/adapter-runtime.mjs';
const debt=()=>({removed:false,debt:{code:'close_failed',reason:'listener-absence-unconfirmed',message:'The owned listener has not confirmed absence; retry cleanup.'}});
export function safeListenerError(error){
 if(error?.code==='unsupported')return effectError('unsupported','The declared listener effect has no testing handler');
 const code=[error?.code,error?.error_code,error?.message].filter(v=>typeof v==='string').join(' ').match(/\bERR_NGROK_(8013|105|108)\b/)?.[1];
 const detail={
  '8013':['ngrok requires payment-card verification for free TCP. Check the account verification page.','https://dashboard.ngrok.com/settings#id-verification'],
  '105':['Provide a valid ngrok agent authtoken through the configure credential action; an API key is not an agent authtoken.','https://dashboard.ngrok.com/get-started/your-authtoken'],
  '108':['The account agent/session allowance was reached. Close unused agents and check the account allowance.','https://dashboard.ngrok.com/agents'],
 }[code];
 const result=effectError(detail?'setup_required':'provider_unavailable',detail?.[0]??'The listener could not start. Check the connection, saved credential and account settings, then review setup and retry.');
 if(detail)result.nextAction={id:'check-listener-account',kind:'open-url',label:'Check account setup',href:detail[1],digest:`listener-account-${code}`,disclosure:{revision:'listener-account-1',text:'Open the provider dashboard; Gozar changes no account settings.',links:[]}};
 return result;
}

export function createListenerLifecycle({adapterId,timeoutMs=5000,startupTimeoutMs=30000}={}){
 const records=new Map(),removed=new Set();
 const key=receipt=>JSON.stringify(receipt);
 const bounded=async(action,ms=timeoutMs)=>{let timer;try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('deadline')),Math.max(1,ms));})]);}finally{clearTimeout(timer);}};
 async function clean(record){
  if(record.opening||!record.listener)return debt();
  try{
   await bounded(()=>record.listener.close());
   const id=record.listener.id?.();
   // close() is an RPC acknowledgement. Confirm the exact owned handle is absent.
   const absent=typeof id==='string'&&typeof record.sdk.getListener==='function'
     ? await bounded(()=>record.sdk.getListener(id))===null
     : record.listener.closed===true;
   if(!absent)return debt();
   records.delete(record.receipt.resourceKey);removed.add(key(record.receipt));return {removed:true,debt:null};
  }catch{return debt();}
 }
 return {
  async open(ctx,plan,{sdk,options,normalizeOrigin=value=>new URL(value).origin}={}){
   await ctx.assertGeneration();
   if(records.has(plan.resourceKey)||ctx.signal?.aborted)throw safeListenerError();
   const receipt={schemaVersion:1,adapterId,resourceKey:plan.resourceKey,generation:ctx.generation,
    identity:{runtimeId:randomUUID(),origin:plan.origin??null,...(ctx.attemptId?{attemptId:ctx.attemptId}:{})},origin:plan.origin??null,readback:{...plan.readback}};
   const record={receipt,sdk,opening:true,listener:null,abandoned:false};records.set(plan.resourceKey,record);
   let abort;
   const opening=Promise.resolve().then(()=>{if(ctx.signal?.aborted)throw new Error('cancelled');return (sdk.forward??sdk.default.forward)(options);});
   record.completion=opening.then(async listener=>{record.listener=listener;record.opening=false;if(record.abandoned)await clean(record);return listener;},()=>{record.opening=false;});
   try{
    const listener=await bounded(()=>Promise.race([opening,new Promise((_,reject)=>{abort=()=>reject(new Error('cancelled'));ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();})]),Math.min(startupTimeoutMs,Math.max(1,(ctx.deadlineMs??Date.now()+startupTimeoutMs)-Date.now())));
    await ctx.assertGeneration();if(ctx.signal?.aborted||Date.now()>=(ctx.deadlineMs??Infinity))throw new Error('cancelled');
    const actual=normalizeOrigin(listener.url());
    if(!actual||(plan.origin&&actual!==plan.origin))throw new Error('endpoint mismatch');
    receipt.origin=actual;receipt.identity.origin=actual;receipt.readback.origin=actual;
    return structuredClone(receipt);
   }catch(cause){
    record.abandoned=true;const outcome=await clean(record);
    const error=safeListenerError(cause);
    if(!outcome.removed)error.cleanupReceipt=structuredClone(receipt);
    throw error;
   }finally{ctx.signal?.removeEventListener('abort',abort);}
  },
  async remove(ctx,receipt){
   await ctx.assertGeneration();if(removed.has(key(receipt)))return {removed:true,debt:null};
   const record=records.get(receipt?.resourceKey);if(!record)return debt();if(key(receipt)!==key(record.receipt))throw effectError('provider_unavailable','The listener receipt does not match the owned runtime');
   record.abandoned=true;return clean(record);
  },
  owns(receipt){const record=records.get(receipt?.resourceKey);if(record&&key(receipt)!==key(record.receipt))throw effectError('provider_unavailable','The listener receipt does not match the owned runtime');return Boolean(record);},
  observed(resourceKey){const record=records.get(resourceKey);return {present:record?record.listener!==null:false,resourceKey,identity:record?.receipt.identity??null,revision:null};},
 };
}
