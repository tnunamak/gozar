// A public attached allocation must be listable, as creating with a null receipt, from the moment its recovery
// binding is discoverable until the provider answers. In-process fixtures: the owner process is never killed and
// the provider is a fixture ledger, so none of this claims SIGKILL, restart, native or live-provider acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {readFile,writeFile,mkdir,rm,readdir,realpath,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';
import {testingFetch} from '../../packages/gozar-node/testing-network.mjs';
import {verification} from '../../packages/gozar-node/service-state.mjs';
import {listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {runAttachedController} from '../../packages/gozar-node/attached-route.mjs';
import {projectAttached,unknownProperties} from '../../packages/gozar-node/route-view.mjs';
import {attachedScratch,scratch,query,assertShape} from './route-schema-check.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const accepts=port=>new Promise(resolve=>{const s=net.connect({port,host:'127.0.0.1'});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const fetchBody=(port,path)=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},res=>{
 const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks).toString()));}).on('error',reject));

// `holdAt` names the one provider call that stays withheld: 'discovery' is the first effect the controller
// requests after the bootstrap binding is on disk; 'create' is the provider allocation itself.
async function world(t,holdAt,{cut,failRelease=false,failAfterRegister=false,blockDebtWrite=false,identityRecorder}={}){
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
 // The same fixture effect dispatch the testing harness uses, built here so the publication seam and the host's
 // configuration-use calls can be observed from the owner process.
 const handlers=new Map(list.map(e=>[JSON.stringify([e.kind,e.operation]),e.handle])),abort=new AbortController();
 const dispatchEffect=async request=>{const handler=handlers.get(JSON.stringify([request?.kind,request?.operation]));
  if(abort.signal.aborted||!handler)throw Object.assign(new Error('No matching testing effect is declared'),{code:'unsupported'});
  try{return structuredClone(await handler(structuredClone(request.input),{signal:abort.signal,fixture:true}));}
  catch{throw Object.assign(new Error('The testing effect failed'),{code:'provider_unavailable'});}};
 const real=createEmbeddingServices({registryId:await registryIdentity({})});
 const uses={registered:[],released:[],failRelease};
 const embeddingServices={...real,
  registerConfigurationUse:async r=>{
   uses.registered.push(structuredClone(r.handle));await real.registerConfigurationUse(r);
   if(failAfterRegister){
    // The durable registration commits first, then the wrapper fails exactly after it. A refused
    // release or a blocked debt write can then make the first unwind fail deterministically.
    if(blockDebtWrite){
     const entry=(await readdir(join(home,'attached')).catch(()=>[])).find(n=>/^att_/.test(n));
     if(entry)await chmod(join(home,'attached',entry),0o500);
    }
    throw new Error('registration failed after it committed');
   }
  },
  releaseConfigurationUse:async r=>{uses.released.push(structuredClone(r.handle));if(uses.failRelease)throw new Error('release refused');return real.releaseConfigurationUse(r);}};
 api=createRouteApi({embeddingServices,dispatchEffect,verify:request=>verification(request,{fetch:testingFetch(dispatchEffect)}),expose:{...(cut?{publicationCut:cut}:{}),...(identityRecorder?{identityRecorder}:{})}});
 const harness={close:async()=>{
  for(const route of (await api.listRoutes({home,owner}).catch(()=>({routes:[]}))).routes)
   if(route.cleanup.state!=='confirmed')await api.closeRoute({home,handle:route.handle,mode:'remove'}).catch(()=>{});
  abort.abort();}};
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
 return {home,owner,api,uses,early:()=>early,q,request,exposed,enter,gate,snapshots,ledger,effects,counts:()=>({opens,closes,serial}),appPort,foreignPort,services:real,configuration:()=>config};
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

// --- The publication boundary ------------------------------------------------------------------------------------
// `publicationCut(stage)` is awaited in the owner process immediately before each step that builds the recovery pair:
// directory creation, bootstrap write, first state write, publication, controller spawn. The durable host
// registration sits between publication and spawn, so only a spawn-cut failure can owe a released reference.
// A gate at any cut is deterministic.
const CUTS=['directory','bootstrap','state','publish','spawn'];
// Redemption may read the provider before the lock; only allocation and removal are provider effects of the route itself.
const mutations=w=>w.effects.filter(([,operation])=>operation==='open'||operation==='close');
const entries=async home=>{try{return (await readdir(join(home,'attached'))).filter(n=>/^att_/.test(n));}catch{return [];}};
const cutWorld=async(t,stage,behave,options={})=>{
 const ctx={ready:deferred(),entered:deferred(),gate:deferred()};
 const w=await world(t,null,{...options,cut:async s=>{
  if(s!==stage)return;await ctx.ready.promise;
  if(behave==='fail')throw Object.assign(new Error('injected write failure at '+stage),{code:'provider_unavailable'});
  ctx.snapshot={stage,entries:await entries(w.home)};
  try{ctx.listed=(await w.api.listRoutes({home:w.home,owner:w.owner})).routes;}catch(error){ctx.listed=error;}
  ctx.entered.resolve();await ctx.gate.promise;
 }});
 ctx.ready.resolve();Object.assign(ctx,{w});
  t.after(()=>ctx.gate.resolve());
 return ctx;
};

for(const stage of CUTS){
 test(`a listing at the ${stage} cut is never refused and sees only a complete pair, then one allocation completes`,async t=>{
  const c=await cutWorld(t,stage,'gate'),{w}=c;
  await Promise.race([c.entered.promise,w.exposed.then(r=>assert.fail('expose settled before the cut: '+r.error?.message))]);
  assert.ok(Array.isArray(c.listed),'the listing must not throw: '+c.listed?.message);
  if(stage==='spawn'){
   assert.equal(c.snapshot.entries.length,1);
   const directory=join(w.home,'attached',c.snapshot.entries[0]);
   assert.equal((await json(join(directory,'state.json'))).phase,'creating');await json(join(directory,'bootstrap.json'));
   assert.equal(c.listed.length,1);assert.notEqual(c.listed[0].state,'released');assert.equal(c.listed[0].published,null);
  }else{
   // No attached directory is enumerable before the pair is complete, so there is nothing to refuse. The operation's own
   // reservation is the only thing listed: retained history for the reserved handle, never a live or removed route.
   assert.deepEqual(c.snapshot.entries,[]);
   assert.equal(c.listed.length,1);assert.equal(c.listed[0].handle.kind,'attached');assert.equal(c.listed[0].operationId,w.q.operationId);
   assert.equal(c.listed[0].cleanup.state,'unconfirmed');assert.equal(c.listed[0].published,null);assert.notEqual(c.listed[0].state,'released');
  }
  assert.equal(w.counts().serial,0);
  c.gate.resolve();
  const {route,error}=await w.exposed;assert.ifError(error);
  assert.equal(route.state,'usable');assert.equal(w.counts().serial,1);assert.equal(w.uses.registered.length,1);
  assert.deepEqual((await w.api.expose(w.request)).handle,route.handle);assert.equal(w.counts().serial,1);
  const [resource]=[...w.ledger.values()];
  assert.equal(await fetchBody(Number(resource.target.split(':').pop()),'/'),'application-bytes');
  assert.equal((await w.api.closeRoute({home:w.home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
  assert.equal(w.counts().closes,1);assert.equal(await accepts(w.foreignPort),true);
 });

 test(`a write or abort failure at the ${stage} cut releases the host reference once and starts no provider effect`,async t=>{
  const c=await cutWorld(t,stage,'fail'),{w}=c;
  const {error}=await w.exposed;assert.ok(error,'expose must fail');
  // The host registration follows publication, so only a spawn-cut failure can owe a released reference.
  const registered=stage==='spawn'?1:0;
  assert.equal(w.uses.registered.length,registered);assert.equal(w.uses.released.length,registered);
  if(registered)assert.deepEqual(w.uses.released[0],w.uses.registered[0],'the exact registered handle is released');
  assert.deepEqual(mutations(w),[],'no provider effect');assert.deepEqual(w.counts(),{opens:0,closes:0,serial:0});
  assert.equal(error.route?.cleanup.state,'confirmed');assert.equal(error.route.published,null);
  // Only a complete, confirmed record may remain, and only once a controller path was published.
  const kept=await entries(w.home);assert.equal(kept.length,stage==='spawn'?1:0);
  const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
  // The operation's terminal record is the one listed route in every case; it is the confirmed, released view.
  assert.equal(routes.length,1);
  for(const route of routes){assert.equal(route.state,'released');assert.equal(route.cleanup.state,'confirmed');}
  assert.equal(await accepts(w.foreignPort),true);
 });
}

// A refused release after a spawn-cut failure keeps exact debt; the registration boundary keeps the same
// property for a registration that committed and then failed.
for(const stage of ['spawn']){
 test(`a refused release after a ${stage} cut failure is kept as exact debt for a later owner`,async t=>{
  const c=await cutWorld(t,stage,'fail',{failRelease:true}),{w}=c;
  const {error}=await w.exposed;assert.ok(error);
  assert.equal(w.uses.released.length,1);assert.deepEqual(mutations(w),[]);
  assert.equal(error.route?.cleanup.state,'unconfirmed');
  const [id,...extra]=await entries(w.home);assert.ok(id);assert.deepEqual(extra,[]);
  const directory=join(w.home,'attached',id),state=await json(join(directory,'state.json')),bootstrap=await json(join(directory,'bootstrap.json'));
  assert.deepEqual(state.resourceRemoval.handle,{kind:'attached',id,generation:1});
  assert.equal(state.resourceRemoval.owner,w.owner);assert.equal(bootstrap.id,id);assert.equal(state.receipt,null);
  const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
  assert.equal(routes.length,1);assert.equal(routes[0].cleanup.state,'unconfirmed');assert.equal(routes[0].published,null);
  assert.equal(routes[0].operationId,w.q.operationId);
  // A later owner retries release with the exact retained handle once the host accepts it.
  w.uses.failRelease=false;
  const closed=await w.api.closeRoute({home:w.home,handle:routes[0].handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');
  assert.equal(w.uses.released.length,2);assert.deepEqual(mutations(w),[]);
 });
}

// --- The registration, spawn and projection boundaries of the attached custody repair ---------------------------
// In-process fixtures only: the owner process is never killed, so these prove ordering and recovery
// transitions, never SIGKILL, restart or live-provider acceptance.

test('a registration that commits and then fails releases the exact use once',async t=>{
 const neighbor={kind:'attached',id:'att_ffffffffffffffff',generation:1};
 const w=await world(t,null,{failAfterRegister:true});
 // A neighbor use on the same configuration must survive every recovery of the failed route.
 await w.services.registerConfigurationUse({home:w.home,owner:w.owner,providerId:w.q.providerId,revision:w.configuration().revision,handle:neighbor});
 const {error}=await w.exposed;
 assert.ok(error,'expose must fail after the committed registration');
 assert.equal(w.uses.registered.length,1);
 assert.equal(w.uses.released.length,1);
 assert.deepEqual(w.uses.released[0],w.uses.registered[0],'the exact registered handle is released');
 assert.equal(error.route?.cleanup.state,'confirmed');assert.equal(error.route?.state,'released');assert.equal(error.route?.published,null);
 assert.deepEqual(mutations(w),[]);assert.deepEqual(w.counts(),{opens:0,closes:0,serial:0});
 const [id,...extra]=await entries(w.home);assert.ok(id,'the custody pair is published before the registration');assert.deepEqual(extra,[]);
 const state=await json(join(w.home,'attached',id,'state.json'));
 assert.equal(state.receipt,null);assert.equal(state.phase,'released');assert.equal(state.lastView.cleanup.state,'confirmed');
 const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
 assert.equal(routes.length,1);assert.equal(routes[0].state,'released');assert.equal(routes[0].cleanup.state,'confirmed');
 const uses=Object.values((await json(join(w.home,'embedding-state.json'))).configs).flatMap(c=>c.uses);
 assert.ok(!uses.includes(JSON.stringify({kind:'attached',id,generation:1})),'the failed route released its use');
 assert.ok(uses.includes(JSON.stringify(neighbor)),'the neighbor use is untouched');
 assert.equal(await accepts(w.foreignPort),true);
});

test('a refused release after a committed registration failure is kept as exact debt for a later owner',async t=>{
 const w=await world(t,null,{failAfterRegister:true,failRelease:true});
 const {error}=await w.exposed;assert.ok(error);
 assert.equal(w.uses.released.length,1);assert.deepEqual(mutations(w),[]);
 assert.equal(error.route?.cleanup.state,'unconfirmed');
 const [id,...extra]=await entries(w.home);assert.ok(id);assert.deepEqual(extra,[]);
 const directory=join(w.home,'attached',id),state=await json(join(directory,'state.json')),bootstrap=await json(join(directory,'bootstrap.json'));
 assert.deepEqual(state.resourceRemoval.handle,{kind:'attached',id,generation:1});
 assert.equal(state.resourceRemoval.owner,w.owner);assert.equal(bootstrap.id,id);assert.equal(state.receipt,null);
 const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
 assert.equal(routes.length,1);assert.equal(routes[0].cleanup.state,'unconfirmed');assert.equal(routes[0].published,null);
 assert.equal(routes[0].operationId,w.q.operationId);
 // A later owner retries release with the exact retained handle once the host accepts it.
 w.uses.failRelease=false;
 const closed=await w.api.closeRoute({home:w.home,handle:routes[0].handle,mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');
 assert.equal(w.uses.released.length,2);assert.deepEqual(mutations(w),[]);
});

test('an identity failure after the controller saved a receipt retains the receipt and stops the owned child',async t=>{
 const w=await world(t,null,{identityRecorder:async pid=>{
  // The spawned controller is live; wait for its control channel and its receipt to be durable before the
  // lookup fails. The public API envelope cannot carry teardown internals, so the proof below is the child's
  // own process identity after the failure.
  let id=null;
  for(let i=0;i<1000&&!id;i++){id=(await entries(w.home))[0]??null;if(!id)await new Promise(r=>setTimeout(r,10));}
  assert.ok(id,'the recovery binding is published before the identity lookup');
  const directory=join(w.home,'attached',id);
  for(let i=0;i<1000;i++){if(await json(join(directory,'control.json')).catch(()=>null))break;await new Promise(r=>setTimeout(r,10));}
  for(let i=0;i<1000;i++){
   const state=await json(join(directory,'state.json')).catch(()=>null);
   if(state?.receipt)break;
   await new Promise(r=>setTimeout(r,10));
  }
  throw new Error(`identity recording failed after the controller started (${pid})`);
 }});
 const {error}=await w.exposed;
 assert.ok(error,'expose must fail when the identity lookup fails after spawn');
 const [id]=await entries(w.home);assert.ok(id);
 const directory=join(w.home,'attached',id);
 const state=await json(join(directory,'state.json'));
 assert.ok(state.receipt,'the saved receipt is retained, never overwritten with a refusal');
 assert.notEqual(error.route?.cleanup?.state,'confirmed','no removal is confirmed without independent evidence');
 const control=await json(join(directory,'control.json'));
 assert.ok(control?.pid,'the controller published its control identity');
 assert.equal(await processIdentity(control.pid),null,'the exact owned child is proven dead after the failure');
 assert.equal(w.ledger.size,1,'the provider resource is not removed by the teardown');
 assert.equal(w.counts().closes,0);assert.deepEqual(mutations(w).filter(([,operation])=>operation==='close'),[]);
 const {routes}=await w.api.listRoutes({home:w.home,owner:w.owner});
 assert.equal(routes.length,1);assert.notEqual(routes[0].state,'released');
 assert.equal(await accepts(w.foreignPort),true);
});

test('failed release and debt persistence leave the exact pre-controller record; a fresh owner settles it',async t=>{
 const neighbor={kind:'attached',id:'att_ffffffffffffffff',generation:1};
 const w=await world(t,null,{failAfterRegister:true,failRelease:true,blockDebtWrite:true});
 await w.services.registerConfigurationUse({home:w.home,owner:w.owner,providerId:w.q.providerId,revision:w.configuration().revision,handle:neighbor});
 const {error}=await w.exposed;assert.ok(error);
 const [id]=await entries(w.home);assert.ok(id,'the custody pair is published before the host registration');
 const directory=join(w.home,'attached',id),statePath=join(directory,'state.json');
 const state=await json(statePath);
 // The exact after-registration, before-spawn record survives the failed unwind unchanged.
 assert.equal(state.receipt,null);assert.equal(state.resourceRemoval,null);assert.equal(state.phase,'creating');
 assert.equal(state.unstarted,true);assert.equal(state.lastView.cleanup.state,'none');
 assert.deepEqual(mutations(w),[]);assert.equal(w.ledger.size,0);assert.deepEqual(w.counts(),{opens:0,closes:0,serial:0});
 const uses=async()=>Object.values((await json(join(w.home,'embedding-state.json'))).configs).flatMap(c=>c.uses);
 assert.ok((await uses()).includes(JSON.stringify({kind:'attached',id,generation:1})),'the registered use is still the sole custody');
 assert.ok((await uses()).includes(JSON.stringify(neighbor)),'the neighbor use is untouched');
 await chmod(directory,0o700);
 // A corrupt final record is refused, never adopted as settlement evidence.
 const exact=await readFile(statePath,'utf8');
 await writeFile(statePath,JSON.stringify({...state,handle:{...state.handle,generation:2}}),{mode:0o600});
 await assert.rejects(w.api.listRoutes({home:w.home,owner:w.owner}),{code:'provider_unavailable'});
 await writeFile(statePath,exact,{mode:0o600});
 // Restart-shaped fixture: a fresh API instance over the same home recovers the exact debt under the
 // existing locks. This simulates a restarted owner process; it is not a crash or durability proof.
 const freshApi=createRouteApi({embeddingServices:createEmbeddingServices({registryId:await registryIdentity({})})});
 const closed=await freshApi.closeRoute({home:w.home,handle:{kind:'attached',id,generation:1},mode:'remove'});
 assert.equal(closed.cleanup.state,'confirmed');assert.equal(closed.state,'released');
 assert.ok(!(await uses()).includes(JSON.stringify({kind:'attached',id,generation:1})),'the exact use is released');
 assert.ok((await uses()).includes(JSON.stringify(neighbor)),'the neighbor use survives the settlement');
 const settled=await json(statePath);
 assert.equal(settled.phase,'released');assert.equal(settled.lastView.cleanup.state,'confirmed');assert.equal(settled.receipt,null);
 assert.deepEqual(mutations(w),[]);
 const {routes}=await freshApi.listRoutes({home:w.home,owner:w.owner});
 assert.equal(routes.length,1);assert.equal(routes[0].state,'released');assert.equal(routes[0].cleanup.state,'confirmed');
 assert.equal(await accepts(w.foreignPort),true);
});

// --- Creating projections: the live creating exception is attached only ------------------------------------------
// A fake control channel answers observe for each seeded binding; no controller or provider runs.

test('a live creating allocation lists as creating only for attached routes; sessions keep ordinary semantics',async t=>{
 const home=await realpath(await scratch(t));
 const owner='projection-owner',adapterId='projection-adapter';
 const registryId=await registryIdentity({});
 const servers=[];
 t.after(async()=>{for(const server of servers)await new Promise(resolve=>server.close(resolve));});
 const creatingView=handle=>projectAttached({target:'127.0.0.1:9',state:'creating',origin:null,properties:unknownProperties(),ingress:null,identity:null,
  limits:{recommendedPollIntervalMs:5000,idleTimeoutMs:null},checkedAtMs:null,cleanup:{state:'none'}},{handle,now:Date.now()});
 const serve=async(directory,view)=>{
  const startIdentity=await processIdentity(process.pid);
  await writeFile(join(directory,'control.json'),JSON.stringify({pid:process.pid,startIdentity,nonce:'projection-nonce'}),{mode:0o600});
  const server=net.createServer(socket=>{
   socket.on('error',()=>{});
   socket.on('data',()=>socket.end(`${JSON.stringify({view,startupComplete:true,progress:{initialSettled:false,resolverLost:false,refreshable:true}})}\n`));
  });
  servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(join(directory,'control.sock'),resolve);});
 };
 const attach={kind:'attached',id:'att_0123456789abcdef',generation:1};
 const attachDir=join(home,'attached',attach.id);
 await mkdir(join(home,'attached'),{recursive:true,mode:0o700});
 await mkdir(attachDir,{mode:0o700});
 await writeFile(join(attachDir,'bootstrap.json'),JSON.stringify({schemaVersion:1,id:attach.id,home,owner,adapterId,registryId,operationId:'projection-op'}),{mode:0o600});
 await writeFile(join(attachDir,'state.json'),JSON.stringify({schemaVersion:1,adapterId,request:{target:'127.0.0.1:9'},plan:null,receipt:null,handle:attach,phase:'creating',unstarted:true,
  lastView:creatingView(attach),resourceRemoval:null}),{mode:0o600});
 await serve(attachDir,creatingView(attach));
 for(const [id,expiresAtMs] of [['port-8080:s1',Date.now()+600000],['port-8081:s2',Date.now()-1000],['port-8082:s3',undefined]]){
  const handle={kind:'session',id,generation:1},directory=join(home,id.split(':')[0]);
  await mkdir(directory,{mode:0o700});
  const bootstrap={schemaVersion:1,home,owner,adapterId,registryId,operationId:'projection-op',execution:'generic-session-v1',handle};
  if(expiresAtMs!==undefined)bootstrap.expiresAtMs=expiresAtMs;
  await writeFile(join(directory,'bootstrap.json'),JSON.stringify(bootstrap),{mode:0o600});
  await writeFile(join(directory,'state.json'),JSON.stringify({schemaVersion:1,adapterId,request:{target:'127.0.0.1:9'},plan:null,receipt:null,handle,phase:'creating',
   lastView:creatingView(handle),resourceRemoval:null}),{mode:0o600});
  await serve(directory,creatingView(handle));
 }
 const {routes}=await listRecordedRoutes({home,owner},{registryId,adapters:[{id:adapterId}]});
 assert.equal(routes.length,4);
 const byId={};for(const route of routes)byId[route.handle.id]=route;
 // The one intended exception: a live attached allocation lists as creating.
 assert.equal(byId[attach.id].state,'creating');assert.equal(byId[attach.id].cleanup.state,'none');
 // A valid expiry does not admit a creating session; it keeps ordinary session semantics as retained history.
 assert.equal(byId['port-8080:s1'].state,'uncertain');assert.equal(byId['port-8080:s1'].cleanup.state,'unconfirmed');
 // An expired session was never admitted; that is unchanged.
 assert.equal(byId['port-8081:s2'].state,'uncertain');assert.equal(byId['port-8081:s2'].cleanup.state,'unconfirmed');
 // A session without a finite expiry is never admitted either.
 assert.equal(byId['port-8082:s3'].state,'uncertain');assert.equal(byId['port-8082:s3'].cleanup.state,'unconfirmed');
});


// A close can settle the published unstarted record while the spawned controller is
// still waiting for the open lock. Its eventual first act must honor that settlement.
for (const settled of ['released', 'reference-debt']) test(`a settled pending start cannot resume: ${settled}`, async t => {
 const home=await attachedScratch(t),handle={kind:'attached',id:'att_0123456789abcdef',generation:1};
 const directory=join(home,'attached',handle.id);
 await mkdir(directory,{recursive:true,mode:0o700});
 const bootstrap={schemaVersion:1,id:handle.id,home,owner:'fixture-owner',adapterId:'fixture-pending',registryId:await registryIdentity({}),
  request:{home,owner:'fixture-owner',target:'127.0.0.1:9',usage:{kind:'attached'}},plan:{},operationId:'settled-start'};
 const cleanup={state:settled==='released'?'confirmed':'unconfirmed'};
 const lastView=projectAttached({target:bootstrap.request.target,state:settled==='released'?'released':'uncertain',origin:null,
  properties:unknownProperties(),ingress:null,identity:null,limits:{recommendedPollIntervalMs:5000,idleTimeoutMs:null},checkedAtMs:null,cleanup},{handle,now:Date.now()});
 const state={schemaVersion:1,adapterId:bootstrap.adapterId,request:bootstrap.request,plan:{},receipt:null,handle,
  phase:lastView.state,lastView,resourceRemoval:settled==='released'?null:{schemaVersion:1,registryId:bootstrap.registryId,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle}};
 await writeFile(join(directory,'bootstrap.json'),JSON.stringify(bootstrap),{mode:0o600});
 const bytes=JSON.stringify(state);await writeFile(join(directory,'state.json'),bytes,{mode:0o600});
 let adapterReads=0;
 let refusal;
 try { await runAttachedController(directory,{registryId:bootstrap.registryId,get adapters(){adapterReads++;return [];}}); } catch(error) { refusal=error; }
 assert.equal(adapterReads,0,'settlement refuses before loading an adapter or reaching provider effects');
 assert.equal(refusal?.code,'route_conflict');
 assert.equal(await readFile(join(directory,'state.json'),'utf8'),bytes,'settled custody is not overwritten');
});


test('an identity failure after usable proof returns historical recovery, not a published view',async t=>{
 let directory,usableBefore;
 const w=await world(t,null,{identityRecorder:async()=>{
  const [id]=await entries(w.home);assert.ok(id);
  directory=join(w.home,'attached',id);
  for(let i=0;i<1000;i++){
   const state=await json(join(directory,'state.json')).catch(()=>null);
   if(state?.lastView?.state==='usable'&&state.lastView.published){usableBefore=state;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(usableBefore?.lastView?.published,'the controller persisted usable proof before identity failure');
  // Freeze that valid saved snapshot: broker-loss persistence must not be an assumed teardown barrier.
  await chmod(directory,0o500);
  throw new Error('identity recording failed after usable proof');
 }});
 try{
  const {error}=await w.exposed;assert.ok(error);
  assert.ok(usableBefore?.receipt);
  const saved=await json(join(directory,'state.json'));
  assert.equal(saved.lastView.state,'usable','the stale saved proof remains available as historical evidence');
  assert.equal(saved.lastView.published,usableBefore.lastView.published);
  assert.deepEqual(saved.receipt,usableBefore.receipt,'teardown never erases the owned receipt');
  assert.deepEqual(error.route.handle,usableBefore.handle);assert.equal(error.route.operationId,w.q.operationId);
  assert.equal(error.route.state,'uncertain');assert.equal(error.route.published,null);
  assert.equal(error.route.verification.status,'unverified');assert.deepEqual(error.route.verification.checks,[]);
  assert.equal(error.route.cleanup.state,'unconfirmed','process teardown is not provider-removal evidence');
  assert.equal(w.ledger.size,1);assert.equal(w.counts().closes,0);
  const control=await json(join(directory,'control.json'));
  assert.equal(await processIdentity(control.pid),null);
  assert.equal(await accepts(w.foreignPort),true);
 }finally{if(directory)await chmod(directory,0o700);}
});


test('controller death after saved usable proof returns only historical recovery',async t=>{
 let directory,usableBefore,controllerPid;
 const w=await world(t,null,{identityRecorder:async pid=>{
  controllerPid=pid;
  const identity=await processIdentity(pid);assert.ok(identity);
  const [id]=await entries(w.home);assert.ok(id);
  directory=join(w.home,'attached',id);
  for(let i=0;i<1000;i++){
   const state=await json(join(directory,'state.json')).catch(()=>null);
   if(state?.lastView?.state==='usable'&&state.lastView.published){usableBefore=state;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(usableBefore?.receipt,'usable proof and the receipt were saved before controller death');
  assert.equal(await processIdentity(pid),identity,'only this fixture controller may be signalled');
  process.kill(pid,'SIGKILL');
  for(let i=0;i<1000&&await processIdentity(pid)!==null;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(await processIdentity(pid),null,'controller death is observed before the startup status poll');
  return identity;
 }});
 const {error}=await w.exposed;assert.ok(error);
 const saved=await json(join(directory,'state.json'));
 assert.equal(saved.lastView.state,'usable','the dead controller cannot refresh its saved proof');
 assert.deepEqual(saved.receipt,usableBefore.receipt);
 assert.deepEqual(error.route.handle,usableBefore.handle);assert.equal(error.route.operationId,w.q.operationId);
 assert.equal(error.route.state,'uncertain');assert.equal(error.route.published,null);assert.equal(error.route.ingress,null);
 assert.equal(error.route.verification.status,'unverified');assert.deepEqual(error.route.verification.checks,[]);
 assert.equal(error.route.cleanup.state,'unconfirmed');
 const records=await readdir(join(w.home,'operations'));
 const operation=await json(join(w.home,'operations',records.find(name=>name.endsWith('.json'))));
 assert.equal(operation.phase,'recovery');assert.equal(operation.view.published,null);
 assert.equal(operation.view.verification.status,'unverified');assert.deepEqual(operation.view.handle,usableBefore.handle);
 assert.equal(w.ledger.size,1);assert.equal(w.counts().closes,0,'controller death is not provider removal');
 assert.equal(await processIdentity(controllerPid),null);assert.equal(await accepts(w.foreignPort),true);
});


for(const part of ['record','view'])for(const field of ['kind','id','generation'])
 test(`startup refuses ${part} ${field} mismatch instead of transferring cleanup authority`,async t=>{
  let directory,original;
  const w=await world(t,null,{identityRecorder:async()=>{
   const [id]=await entries(w.home);assert.ok(id);
   directory=join(w.home,'attached',id);
   for(let i=0;i<1000;i++){
    const state=await json(join(directory,'state.json')).catch(()=>null);
    if(state?.receipt){original=state;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.ok(original?.receipt);
   const bad=structuredClone(original);
   const handle=part==='record'?bad.handle:bad.lastView.handle;
   handle[field]=field==='kind'?'session':field==='id'?'att_ffffffffffffffff':2;
   // Deliberately inconsistent fixture evidence must never establish resource absence.
   bad.lastView.cleanup={state:'confirmed'};
   await writeFile(join(directory,'state.json'),JSON.stringify(bad),{mode:0o600});
   await chmod(directory,0o500);
   throw new Error('fixture identity lookup failure with mismatched saved evidence');
  }});
  try{
   const {error}=await w.exposed;assert.ok(error);
   assert.equal(error.code,'route_conflict');
   assert.deepEqual(error.route.handle,original.handle,'operation recovery retains only the originally reserved handle');
   assert.equal(error.route.published,null);assert.equal(error.route.cleanup.state,'unconfirmed');
   assert.equal(error.route.verification.status,'unverified');
   assert.equal(w.ledger.size,1);assert.equal(w.counts().closes,0,'mismatched confirmation cannot invent provider removal');
   assert.equal(await accepts(w.foreignPort),true);
  }finally{if(directory)await chmod(directory,0o700);}
 });
