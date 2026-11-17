import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
// An owner-kept route (definition.ownership 'external-owned') is validated, never allocated, so a session over it
// returns the same external handle a durable one does and close only withdraws Gozar's record.
test('a session over an owner-kept origin is proved, returns the external handle and closes without touching the owner app',async t=>{
 let harness,app;t.after(async()=>{await harness?.close();if(app)await new Promise(resolve=>app.close(resolve));});
 const home=await scratch(t);const verifier=createServiceVerifier();app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('owner app');});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 let fetches=0;const target=`127.0.0.1:${app.address().port}`,origin='https://owner.fixture.invalid';
 harness=await createTestingGozar({effects:[{kind:'network',operation:'fetch',handle:async request=>{
  fetches++;const url=new URL(request.url);return new Promise((resolve,reject)=>{const pending=http.get(`http://${target}${url.pathname}${url.search}`,{headers:request.headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));});pending.once('error',reject);});
 }}]});const api=harness.gozar;
 const q=query({home,target,origin,providerId:'own-address',operationId:'owner-session',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice.candidateToken);
 const request={...q,approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}};
 const route=await api.expose({...request,wait:'verified'});
 assert.equal(route.ownership,'external-owned');assert.equal(route.handle.kind,'external');assert.equal(route.handle.id,origin);
 assert.equal(route.verification.status,'verified');assert.equal(route.operationId,q.operationId);assert.ok(fetches>=2);
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 assert.equal(await (await fetch(`http://${target}`)).text(),'owner app');
});
