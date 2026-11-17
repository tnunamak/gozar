import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
// A fake session provider opens its transport only through the explicit process-runtime effects it declares, so a host maps
// the transport it will admit; the fake never starts a listener of its own that the host's proof fetch would have to guess at.
test('a fake session provider opens, proves and closes its transport through declared process-runtime effects',async t=>{
 const home=await scratch(t),id='owned-transport',owner='owned-transport-owner';
 const registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});t.after(registry.cleanup);
 const verifier=createServiceVerifier(),app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const ledger=new Map(),fetched=[];
 const forward=(target,url,headers)=>new Promise((resolve,reject)=>{
  const [host,port]=target.split(':');
  http.get({host,port:Number(port),path:url.pathname+url.search,headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));}).once('error',reject);
 });
 const harness=await createTestingGozar({manifest:registry.manifest,root:registry.root,
  identity:{instanceId:randomUUID(),bootId:randomUUID()},hostCapabilities:Object.fromEntries(['runtime.attached','runtime.durable'].map(name=>[name,{known:true,value:true}])),
  effects:[
   {kind:'process-runtime',operation:'open',handle:async input=>{const handle=randomUUID();ledger.set(handle,{origin:input.origin,target:input.target,present:true});return {handle};}},
   {kind:'process-runtime',operation:'read',handle:async({handle})=>({present:ledger.get(handle)?.present===true})},
   {kind:'process-runtime',operation:'close',handle:async({handle})=>{ledger.get(handle).present=false;return {closed:true};}},
   {kind:'network',operation:'fetch',handle:async request=>{
    const url=new URL(request.url),owned=[...ledger.values()].find(row=>row.present&&new URL(row.origin).origin===url.origin);
    assert.ok(owned,'proof may reach only an origin an effect opened: '+url.origin);fetched.push(url.origin);
    return forward(owned.target,url,request.headers);
   }},
  ]});
 t.after(()=>harness.close());
 const api=harness.gozar,target='127.0.0.1:'+app.address().port;
 const q=query({home,owner,target,providerId:id,usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const route=await api.expose({...q,operationId:'owned-transport-session',wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}});
 assert.equal(route.verification.status,'verified');assert.equal(ledger.size,1);assert.ok(fetched.length>=1);
 assert.equal([...ledger.values()][0].present,true);
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 assert.equal([...ledger.values()].every(row=>row.present===false),true,'close confirms the opened transport absent');
});
