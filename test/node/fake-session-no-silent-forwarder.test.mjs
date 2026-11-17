import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
// createTestingGozar is an explicit mapping: a fake session provider opens its transport only through the process-runtime
// effects the host declared. A missing mapping is a refusal, never a quiet real forwarder in this process.
async function world(t,effects){
 const home=await scratch(t),id='no-silent-forwarder',owner='no-silent-owner';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});t.after(registry.cleanup);
 const verifier=createServiceVerifier(),app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const fetched=[];
 const harness=await createTestingGozar({manifest:registry.manifest,root:registry.root,identity:{instanceId:randomUUID(),bootId:randomUUID()},
  hostCapabilities:Object.fromEntries(['runtime.attached','runtime.durable'].map(name=>[name,{known:true,value:true}])),
  effects:effects({fetched})});
 t.after(()=>harness.close());
 const api=harness.gozar,target='127.0.0.1:'+app.address().port;
 const q=query({home,owner,target,providerId:id,usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];
 return {api,q,choice,fetched};
}
const approvalOf=choice=>({kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest});

test('a mapping that omits the process-runtime open effect refuses and never serves through a real local forwarder',async t=>{
 const {api,q,choice,fetched}=await world(t,({fetched})=>[
  {kind:'network',operation:'fetch',handle:async request=>{fetched.push(request.url);throw new Error('no declared transport owns this origin');}},
 ]);
 const error=await api.expose({...q,operationId:'no-silent-open',wait:'verified',approval:approvalOf(choice)}).then(()=>null,e=>e);
 assert.ok(error,'a host that maps no transport must not get a working route');
 assert.equal(error.code,'unsupported');
 assert.equal(error.route?.cleanup?.state,'confirmed','nothing was opened, so cleanup is confirmed rather than left as debt');
 assert.deepEqual(fetched.filter(url=>/^http:\/\/127\.0\.0\.1:/.test(url)),[],'no real local origin was proven');
});

test('a mapping with an open effect but no network fetch cannot prove, and the opened transport is closed',async t=>{
 const ledger=new Map();
 const {api,q,choice}=await world(t,()=>[
  {kind:'process-runtime',operation:'open',handle:async input=>{const handle=randomUUID();ledger.set(handle,{origin:input.origin,present:true});return {handle};}},
  {kind:'process-runtime',operation:'read',handle:async({handle})=>({present:ledger.get(handle)?.present===true})},
  {kind:'process-runtime',operation:'close',handle:async({handle})=>{ledger.get(handle).present=false;return {closed:true};}},
 ]);
 const error=await api.expose({...q,operationId:'no-silent-fetch',wait:'verified',approval:approvalOf(choice)}).then(()=>null,e=>e);
 assert.ok(error,'proof without a declared fetch effect must fail');
 assert.equal([...ledger.values()].every(item=>item.present===false),true,'nothing the host opened stays open');
});
