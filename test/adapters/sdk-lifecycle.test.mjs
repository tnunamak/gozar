import test from 'node:test';
import assert from 'node:assert/strict';
import {createListenerLifecycle,safeListenerError} from '../../adapters/providers/_shared/sdk-lifecycle.mjs';
const plan={resourceKey:'owned',origin:'https://owned.invalid',readback:{kind:'attached',target:'127.0.0.1:1'}};
const context={generation:1,assertGeneration:async()=>{},now:Date.now};
test('close acknowledgement without exact absence remains retryable debt',async()=>{
 let present=true;const listener={id:()=> 'one',url:()=>plan.origin,close:async()=>{}};
 const sdk={forward:async()=>listener,getListener:async()=>present?listener:null};
 const lifecycle=createListenerLifecycle({adapterId:'fixture',timeoutMs:30});
 const receipt=await lifecycle.open(context,plan,{sdk,options:{}});
 assert.equal((await lifecycle.remove(context,receipt)).removed,false);present=false;
 assert.equal((await lifecycle.remove(context,receipt)).removed,true);
 assert.equal((await lifecycle.remove(context,receipt)).removed,true);
 assert.equal((await lifecycle.remove(context,{...receipt,identity:{...receipt.identity,runtimeId:'foreign'}})).removed,false);
});
test('late allocation and failed close retain exact receipt for a later retry',async()=>{
 let resolve,present=true;const listener={id:()=> 'late',url:()=>plan.origin,close:async()=>{}};
 const sdk={forward:()=>new Promise(r=>resolve=r),getListener:async()=>present?listener:null};
 const lifecycle=createListenerLifecycle({adapterId:'fixture',timeoutMs:5,startupTimeoutMs:5});
 let failure;try{await lifecycle.open(context,plan,{sdk,options:{}});}catch(e){failure=e;}
 assert.ok(failure.cleanupReceipt);assert.equal((await lifecycle.remove(context,failure.cleanupReceipt)).removed,false);
 resolve(listener);await new Promise(r=>setImmediate(r));
 assert.equal((await lifecycle.remove(context,failure.cleanupReceipt)).removed,false);
 present=false;assert.equal((await lifecycle.remove(context,failure.cleanupReceipt)).removed,true);
});
test('safe errors only disclose allow-listed codes and local syntax never claims valid credentials',()=>{
 for(const [code,pattern]of [['ERR_NGROK_8013',/payment.card/i],['ERR_NGROK_105',/agent authtoken/i],['ERR_NGROK_108',/session|agent/i]]){
  const e=safeListenerError({message:code+' secret-canary'});assert.match(e.message,pattern);assert.doesNotMatch(e.message,/secret-canary/);
 }
 const e=safeListenerError(new Error('secret-canary ERR_NGROK_9999'));assert.doesNotMatch(e.message,/secret-canary|9999/);assert.match(e.message,/account|connection/i);
});
test('an explicit authentication refusal retains a bound negative allocation receipt without an owned listener',async()=>{
 const lifecycle=createListenerLifecycle({adapterId:'fixture'});let failure;
 try{await lifecycle.open(context,plan,{sdk:{forward:async()=>{throw Object.assign(new Error('secret-canary'),{code:'ERR_NGROK_105'});}},options:{}});}catch(error){failure=error;}
 assert.ok(failure.cleanupReceipt);assert.equal((await lifecycle.remove(context,failure.cleanupReceipt)).removed,true);assert.doesNotMatch(JSON.stringify(failure),/secret-canary/);
});
