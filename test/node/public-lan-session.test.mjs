import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';

// The real LAN adapter through the public API only. The host declares what the shipped adapter observes (an
// interface inventory through recipe/probe) and the transport it admits (process-runtime effects). The selected
// interface is data the user gave through the adapter's own declared inputs, never a provider-specific host field.
const SYNTHETIC='192.0.2.10';
const inventory=(...rows)=>({interfaces:{eth0:rows,lo:[{address:'127.0.0.1',family:'IPv4',internal:true}]}});
const row=address=>({address,family:'IPv4',internal:false,netmask:'255.255.255.0',mac:'02:00:00:00:00:01',cidr:address+'/24'});

async function world(t,{interfaces=inventory(row(SYNTHETIC))}={}){
 const home=await scratch(t),owner='lan-owner',ledger=new Map(),opens=[],fetched=[];let current=interfaces;
 const verifier=createServiceVerifier(),app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{app.closeAllConnections();app.close(resolve);}));
 const forward=(target,url,headers)=>new Promise((resolve,reject)=>{const [host,port]=target.split(':');
  http.get({host,port:Number(port),path:url.pathname+url.search,headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));}).once('error',reject);});
 const harness=await createTestingGozar({identity:{instanceId:randomUUID(),bootId:randomUUID()},hostCapabilities:{},effects:[
  {kind:'recipe',operation:'probe',handle:async({recipe})=>{
   assert.equal(recipe.kind,'interfaces','this host declares only the interface inventory observation');
   return {stdout:JSON.stringify({interfaces:current.interfaces}),stderr:'',exitCode:0};}},
  {kind:'process-runtime',operation:'open',handle:async input=>{const handle=randomUUID();opens.push(structuredClone(input));ledger.set(handle,{origin:input.origin,target:input.target,present:true});return {handle};}},
  {kind:'process-runtime',operation:'read',handle:async({handle})=>({present:ledger.get(handle)?.present===true})},
  {kind:'process-runtime',operation:'close',handle:async({handle})=>{ledger.get(handle).present=false;return {closed:true};}},
  {kind:'network',operation:'fetch',handle:async request=>{
   const url=new URL(request.url),owned=[...ledger.values()].find(item=>item.present&&new URL(item.origin).origin===url.origin);
   assert.ok(owned,'proof may reach only an origin an effect opened: '+url.origin);fetched.push(url.origin);return forward(owned.target,url,request.headers);}},
 ]});
 t.after(()=>harness.close());
 const api=harness.gozar,target='127.0.0.1:'+app.address().port;
 const q=()=>query({home,owner,target,providerId:'lan',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'lan',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const provider=async()=>(await api.listProviders({home,owner})).providers.find(p=>p.providerId==='lan');
 const provide=async(inputId,value)=>{
  const config=(await provider()).configuration,action=config.actions.find(a=>a.id===inputId&&a.kind==='provide-value');assert.ok(action,'the adapter offers a provide-value action for '+inputId);
  return api.runSetupAction({home,owner,providerId:'lan',expectedConfigurationRevision:config.revision,actionId:action.id,value,
   approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 };
 const candidate=async()=>(await api.catalogRoutes(q())).candidates[0];
 const expose=async c=>api.expose({...q(),operationId:randomUUID(),wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}});
 return {api,home,owner,ledger,opens,fetched,provider,provide,candidate,expose,q,observe:value=>{current=value;}};
}

test('the LAN adapter declares its interface and firewall choices as generic inputs and offers the observed interfaces',async t=>{
 const w=await world(t);
 const lan=await w.provider();
 assert.deepEqual(lan.configuration.inputRequirements.map(i=>i.id),['interface','firewall']);
 assert.ok(lan.configuration.inputRequirements.every(i=>i.required===true&&i.secret===false));
 const first=await w.candidate();
 assert.equal(first.candidateToken,null,'an unchosen interface is not executable');
 assert.equal(first.setup.state,'action-required');
 const interfaceAction=first.setup.actions.find(a=>a.id==='interface');assert.ok(interfaceAction,'the missing interface choice is an offered action, not an unknown');
 assert.equal(interfaceAction.kind,'provide-value');
 assert.match(interfaceAction.help??'',new RegExp(SYNTHETIC.replaceAll('.','\\.')),'the action says which interface addresses were observed');
 assert.equal(w.ledger.size,0);
});

test('a chosen interface and exact firewall confirmation reach the real owned transport and clean up',async t=>{
 const w=await world(t);
 await w.provide('interface',SYNTHETIC);
 const afterInterface=await w.candidate();
 assert.equal(afterInterface.candidateToken,null);assert.ok(afterInterface.setup.actions.some(a=>a.id==='firewall'),'the firewall decision is still an explicit step');
 await w.provide('firewall',SYNTHETIC);
 const ready=await w.candidate();assert.equal(ready.eligible,true);assert.ok(ready.candidateToken);
 const route=await w.expose(ready);
 assert.equal(route.verification.status,'verified');assert.equal(route.published,route.origin);
 assert.equal(w.opens.length,1);
 const origin=new URL(route.origin);
 assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,SYNTHETIC,'the origin is the exact selected interface, never loopback or a wildcard');
 assert.notEqual(origin.port,'');assert.notEqual(origin.port,'0');
 assert.equal(new URL(w.opens[0].origin).origin,route.origin);
 assert.ok(!['0.0.0.0','127.0.0.1','::'].includes(origin.hostname));
 assert.ok(w.fetched.every(item=>item===route.origin));
 const closed=await w.api.closeRoute({home:w.home,handle:route.handle,mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');
 assert.equal([...w.ledger.values()].every(item=>item.present===false),true);
});

test('a changed choice after approval refuses with the old token and creates nothing',async t=>{
 const w=await world(t,{interfaces:inventory(row(SYNTHETIC),row('192.0.2.11'))});
 await w.provide('interface',SYNTHETIC);await w.provide('firewall',SYNTHETIC);
 const approved=await w.candidate();assert.ok(approved.candidateToken);
 await w.provide('interface','192.0.2.11');
 await assert.rejects(w.expose(approved),error=>['consent_mismatch','candidate_stale','setup_required'].includes(error.code));
 assert.equal(w.opens.length,0);
 const after=await w.candidate();
 assert.equal(after.candidateToken,null,'a firewall confirmation for another interface is not a confirmation of this one');
 assert.ok(after.setup.actions.some(a=>a.id==='firewall'),'the mismatch names the step that fixes it');
});

test('an interface that vanished before start is refused with an actionable step and no resource',async t=>{
 const w=await world(t);
 await w.provide('interface',SYNTHETIC);await w.provide('firewall',SYNTHETIC);
 const approved=await w.candidate();assert.ok(approved.candidateToken);
 w.observe(inventory(row('198.51.100.7')));
 const error=await w.expose(approved).then(()=>null,e=>e);
 assert.ok(error,'start must refuse');assert.ok(['setup_required','candidate_stale','consent_mismatch'].includes(error.code),error.code);
 assert.equal(w.opens.length,0);assert.equal(w.ledger.size,0);
 const after=await w.candidate();
 assert.equal(after.candidateToken,null);assert.notEqual(after.setup.state,'unknown');
 assert.ok(after.setup.actions.some(a=>a.id==='interface'),'the missing interface offers the choice again');
});

test('loopback, wildcard and unobserved addresses are never accepted as the LAN interface',async t=>{
 const w=await world(t);
 for(const bad of ['127.0.0.1','0.0.0.0','::','::1','224.0.0.1','not-an-address','192.0.2.99']){
  await w.provide('interface',bad).catch(()=>{});await w.provide('firewall',bad).catch(()=>{});
  const c=await w.candidate();
  assert.equal(c.candidateToken,null,bad+' must not produce an executable candidate');
  assert.ok(c.setup.actions.some(a=>a.id==='interface'),bad+' must offer the interface choice again');
 }
 assert.equal(w.opens.length,0);
});
