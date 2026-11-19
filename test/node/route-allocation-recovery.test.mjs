// A public attached allocation must be listable, as creating with a null receipt, from the moment its recovery
// binding is discoverable until the provider answers. In-process fixtures: the owner process is never killed and
// the provider is a fixture ledger, so none of this claims SIGKILL, restart, native or live-provider acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {readFile,writeFile,mkdir,rm,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';
import {attachedScratch,scratch,query,assertShape} from './route-schema-check.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const accepts=port=>new Promise(resolve=>{const s=net.connect({port,host:'127.0.0.1'});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const fetchBody=(port,path)=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},res=>{
 const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks).toString()));}).on('error',reject));

// `holdAt` names the one provider call that stays withheld: 'discovery' is the first effect the controller
// requests after the bootstrap binding is on disk; 'create' is the provider allocation itself.
async function world(t,holdAt){
 // Registered before the scratch home so it runs first: close the live route, then retire what is left.
 const settle={};
 t.after(async()=>{settle.gate?.resolve();await settle.exposed;await settle.harness?.close();});
 const home=await attachedScratch(t),owner='fixture-owner',ledger=new Map(),effects=[];
 let serial=0,opens=0,closes=0;
 const enter=deferred(),gate=deferred(),snapshots=[];
 const app=http.createServer((req,res)=>res.end('application-bytes'));const appPort=await listen(app);
 const foreign=net.createServer(socket=>{socket.on('error',()=>{});socket.end('foreign');});const foreignPort=await listen(foreign);
 t.after(()=>{app.closeAllConnections();app.close();foreign.close();});
 let held=false,early,api;
 const bootstrapOnDisk=async()=>{
  try{const names=await readdir(join(home,'attached'));return names.find(n=>/^att_/.test(n))??null;}catch{return null;}
 };
 const hold=async(label)=>{
  if(held||holdAt!==label)return;held=true;
  const id=await bootstrapOnDisk(),directory=join(home,'attached',id);
  snapshots.push({label,id,state:await json(join(directory,'state.json')).catch(()=>null),opens,ledger:ledger.size});
  // The controller keeps starting while this provider call is withheld. List once now, whether or not its
  // control channel is up yet, then wait for the channel so the caller can observe the live controller.
  try{early=(await api.listRoutes({home,owner})).routes;}catch(error){early=error;}
  for(let i=0;i<500&&!await json(join(directory,'control.json')).catch(()=>null);i++)await new Promise(r=>setTimeout(r,10));
  enter.resolve();await gate.promise;
 };
 const wrap=(kind,operation,handle)=>({kind,operation,handle:async input=>{
  effects.push([kind,operation]);
  if(holdAt==='discovery'&&await bootstrapOnDisk())await hold('discovery');
  return handle(input);
 }});
 const list=[
  wrap('process-runtime','detect',async()=>({available:true})),
  wrap('recipe','probe',async()=>({ok:false})),
  wrap('sdk-listener','detect',async()=>({available:true})),
  wrap('sdk-listener','open',async({options})=>{
   opens++;await hold('create');
   const handle=`owned-${++serial}`;ledger.set(handle,{url:`https://${options.domain}`,target:options.addr});return {handle,url:`https://${options.domain}`};
  }),
  wrap('sdk-listener','read',async({handle})=>ledger.has(handle)?{present:true,url:ledger.get(handle).url}:{present:false}),
  wrap('sdk-listener','close',async({handle})=>{closes++;ledger.delete(handle);return {closed:true};}),
  wrap('network','fetch',async request=>{
   const parsed=new URL(request.url),resource=[...ledger.values()].find(r=>r.url===parsed.origin);assert.ok(resource);
   const response=await fetch('http://'+resource.target+parsed.pathname+parsed.search,{method:request.method,headers:request.headers});
   const chunks=[];let last=Date.now();for await(const chunk of response.body){const at=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:at-last});last=at;}
   return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }),
 ];
 const harness=await createTestingGozar({effects:list});
 api=harness.gozar;
 const provider=(await api.listProviders({home,owner})).providers.find(p=>p.transport==='https'&&p.availability.attached.state!=='unsupported'&&!p.configuration.inputRequirements.some(i=>i.kind==='https-origin'));
 assert.ok(provider);
 let config=provider.configuration;
 for(const requirement of config.inputRequirements){
  const action=config.actions.find(a=>a.id===requirement.actionId);let input;
  if(requirement.secret){const {handle}=await api.storeSecret({home,owner,providerId:provider.providerId,inputId:requirement.id,scopeId:config.scopeId,expectedConfigurationRevision:config.revision,bytes:new TextEncoder().encode('synthetic-canary')});input={secretHandle:handle};}
  else{const probe=net.createServer();const port=await listen(probe);await new Promise(r=>probe.close(r));input={value:requirement.kind==='text'?String(port):'fixture.example.invalid'};}
  config=(await api.runSetupAction({home,owner,providerId:provider.providerId,expectedConfigurationRevision:config.revision,actionId:action.id,...input,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
 }
 const q=query({home,owner,operationId:'pending-allocation-op',providerId:provider.providerId,usage:{kind:'attached'},target:`127.0.0.1:${appPort}`,
  requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const candidate=(await api.catalogRoutes(q)).candidates[0];assert.equal(candidate.eligible,true);
 const request={...q,wait:'verified',approval:{kind:'route',consentFactsDigest:candidate.consentFactsDigest,candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision}};
 const exposed=api.expose(request).then(route=>({route}),error=>({error}));
 Object.assign(settle,{gate,exposed,harness});
 return {home,owner,api,early:()=>early,q,request,exposed,enter,gate,snapshots,ledger,effects,counts:()=>({opens,closes,serial}),appPort,foreignPort};
}

for(const holdAt of ['discovery','create']){
 test(`listRoutes shows the authenticated creating allocation while ${holdAt} is withheld, then one allocation completes`,async t=>{
  const w=await world(t,holdAt);
  await Promise.race([w.enter.promise,w.exposed.then(r=>assert.fail('expose settled before the withheld call: '+JSON.stringify(r.error?.message)))]);
  try{
   const [snapshot]=w.snapshots;
   assert.ok(snapshot.id,'the recovery binding is discoverable at the withheld call');
   // Before the control channel is necessarily up, the binding is listed as retained history, never refused.
   assert.ok(Array.isArray(w.early()),'early listing must not throw: '+w.early()?.message);
   assert.equal(w.early().length,1);assert.deepEqual(w.early()[0].handle,{kind:'attached',id:snapshot.id,generation:1});
   assert.equal(w.early()[0].published,null);assert.notEqual(w.early()[0].state,'released');
   const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
   assert.equal(routes.length,1);
   const [route]=routes;assertShape('RouteView',route);
   assert.deepEqual(route.handle,{kind:'attached',id:snapshot.id,generation:1});
   assert.equal(route.state,'creating');assert.equal(route.published,null);assert.equal(route.origin,null);
   assert.equal(route.operationId,w.q.operationId);assert.equal(route.ownership,'gozar-owned');
   assert.equal(route.cleanup.state,'none');assert.equal(route.verification.status,'unverified');
   assert.deepEqual((await w.api.listRoutes({home:w.home,owner:'someone-else'})).routes,[]);
   // No provider effect has completed, and the persisted identity (null receipt) existed when it was requested.
   assert.equal(w.counts().serial,0);assert.equal(w.ledger.size,0);
   assert.equal(snapshot.state?.receipt,null);
   assert.equal(snapshot.state?.lastView?.state,'creating');
   w.listed=route;
  }finally{w.gate.resolve();}
  const {route,error}=await w.exposed;assert.ifError(error);
  assert.deepEqual(route.handle,w.listed.handle,'the verified route is the one that was listed as creating');
  assert.equal(route.state,'usable');assert.equal(route.verification.status,'verified');assert.ok(route.published);
  assert.equal(w.counts().serial,1);
  // Replay of the same operation returns the same handle and allocates nothing more.
  assert.deepEqual((await w.api.expose(w.request)).handle,route.handle);assert.equal(w.counts().serial,1);
  // Application bytes arrive through the controller-owned gate the provider forwards to.
  const [resource]=[...w.ledger.values()];
  assert.equal(await fetchBody(Number(resource.target.split(':').pop()),'/'),'application-bytes');
  assert.equal((await w.api.listRoutes({home:w.home,owner:w.owner})).routes[0].state,'usable');
  const closed=await w.api.closeRoute({home:w.home,handle:route.handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');assert.equal(w.counts().closes,1);assert.equal(w.ledger.size,0);
  assert.equal(await accepts(w.foreignPort),true,'an unrelated listener is not touched');
  assert.equal((await w.api.expose(w.request)).state,'released');assert.equal(w.counts().serial,1);
 });
}

test('a pending allocation with no controller is retained as unknown debt, never as a removal',async t=>{
 const w=await world(t,'discovery');
 await Promise.race([w.enter.promise,w.exposed.then(()=>assert.fail('expose settled early'))]);
 const id=w.snapshots[0].id,directory=join(w.home,'attached',id);
 const bootstrap=await json(join(directory,'bootstrap.json')),state=await json(join(directory,'state.json'));
 w.gate.resolve();await w.exposed;
 // A separate home that holds only the binding the parent published before the controller could act.
 const other=await scratch(t);
 const copy=join(other,'attached',id);await mkdir(copy,{recursive:true,mode:0o700});
 const home=await realpath(other);
 await writeFile(join(copy,'bootstrap.json'),JSON.stringify({...bootstrap,home}),{mode:0o600});
 await writeFile(join(copy,'state.json'),JSON.stringify(state),{mode:0o600});
 const {routes}=await listRecordedRoutes({home,owner:bootstrap.owner},{registryId:bootstrap.registryId,adapters:[{id:bootstrap.adapterId}]});
 assert.equal(routes.length,1);
 const [route]=routes;
 assert.deepEqual(route.handle,state.handle);assert.equal(route.published,null);
 assert.equal(route.cleanup.state,'unconfirmed');assert.notEqual(route.state,'released');
 assert.equal(route.operationId,w.q.operationId);
});

test('corrupt, replaced or unowned pending bindings stay refused',async t=>{
 const w=await world(t,'create');
 await Promise.race([w.enter.promise,w.exposed.then(()=>assert.fail('expose settled early'))]);
 const id=w.snapshots[0].id,directory=join(w.home,'attached',id);
 const statePath=join(directory,'state.json'),bootstrapPath=join(directory,'bootstrap.json');
 const stateBytes=await readFile(statePath,'utf8'),bootstrapBytes=await readFile(bootstrapPath,'utf8');
 const state=JSON.parse(stateBytes),bootstrap=JSON.parse(bootstrapBytes);
 const attempts=[
  ['absent state',statePath,null],
  ['generation mismatch',statePath,JSON.stringify({...state,handle:{...state.handle,generation:2}})],
  ['view generation mismatch',statePath,JSON.stringify({...state,lastView:{...state.lastView,handle:{...state.lastView.handle,generation:2}}})],
  ['other handle',statePath,JSON.stringify({...state,handle:{...state.handle,id:'att_ffffffffffffffff'}})],
  ['no view',statePath,JSON.stringify({...state,lastView:undefined})],
  ['no owner',bootstrapPath,JSON.stringify({...bootstrap,owner:undefined}),{home:w.home}],
  ['other home',bootstrapPath,JSON.stringify({...bootstrap,home:bootstrap.home+'-other'})],
 ];
 try{
  for(const [label,path,content,asker] of attempts){
   const original=path===statePath?stateBytes:bootstrapBytes;
   if(content===null)await rm(path);else await writeFile(path,content,{mode:0o600});
   try{await assert.rejects(w.api.listRoutes(asker??{home:w.home,owner:w.owner}),{code:'provider_unavailable'},label);}
   finally{await writeFile(path,original,{mode:0o600});}
  }
  assert.equal((await w.api.listRoutes({home:w.home,owner:w.owner})).routes[0].state,'creating','restored binding lists again');
 }finally{w.gate.resolve();await w.exposed;}
});
