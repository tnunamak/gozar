import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,chmod,lstat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';
import {loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';

// This file uses admitted routes only. No synthetic verified journal, timer override,
// provider credential, or public-root enumeration semantics are introduced.
async function bounded(promise,label,ms=10000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);
 })]);}finally{clearTimeout(timer);}
}
async function probePort(port){
 return bounded(new Promise((resolve,reject)=>{
  const socket=net.connect(port,'127.0.0.1');
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve(false);else reject(error);});
  socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('socket timeout is not absence'));});
 }),'port probe',2000);
}
async function fixture(body){
 const home=await mkdtemp('/tmp/gozar-observe-');await chmod(home,0o700);
 const identity=await lstat(home),errors=[],routes=[],children=new Set();
 let api,harness,registry,original;
 const app=http.createServer((_req,res)=>res.end('foreign application'));
 await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
 const appPort=app.address().port;
 const track=route=>{if(route?.handle)routes.push(route.handle);return route;};
 const expose=async request=>{
  try{return track(await api.expose(request));}
  catch(error){track(error.route);throw error;}
 };
 try{
  await body({home,target:'127.0.0.1:'+appPort,appPort,children,track,expose,
   setApi:value=>{api=value;},setHarness:value=>{harness=value;api=value.gozar;},
   setRegistry:value=>{registry=value;}});
 }catch(error){original=error;}
 // Always attempt every independent owner, including after a failed assertion.
 for(const handle of routes.reverse())try{
  const result=await bounded(api.closeRoute({home,handle,mode:'remove'}),'exact route cleanup');
  assert.equal(result.cleanup.state,'confirmed');
 }catch(error){errors.push(error);}
 try{if(harness)await bounded(harness.close(),'harness cleanup');}catch(error){errors.push(error);}
 for(const child of children)try{
  if(child.exitCode===null&&child.signalCode===null){
   const exit=new Promise(resolve=>child.once('exit',resolve));
   child.kill('SIGTERM');
   try{await bounded(exit,'fixture child reap',2000);}
   catch{child.kill('SIGKILL');await bounded(exit,'fixture child kill/reap',2000);}
  }
 }catch(error){errors.push(error);}
 try{
  app.closeAllConnections();
  await bounded(new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())),'foreign app cleanup');
 }catch(error){errors.push(error);}
 // A failed controller cleanup retains its private journal for diagnosis/recovery.
 if(!errors.length)try{
  if(registry)await registry.cleanup();
  const current=await lstat(home);
  assert.ok(current.isDirectory()&&!current.isSymbolicLink());
  assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);
  await rm(home,{recursive:true});
 }catch(error){errors.push(error);}
 if(original||errors.length)throw new AggregateError([...(original?[original]:[]),...errors],'observation integration/cleanup failed');
}
function request(home,target,owner,providerId,reach,transport){
 return {schemaVersion:1,home,owner,providerId,target,operationId:randomUUID(),
  usage:{kind:'session',lifetimeMs:60000},
  requirements:{reach,transport,payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
}
function approval(candidate){
 // Forward the newly issued public token; never decode or fabricate it.
 return {kind:'route',candidateToken:candidate.candidateToken,
  disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest};
}
function currentParity(listed,status){
 assert.equal(status.state,'usable');assert.equal(status.verification.status,'verified');
 assert.notEqual(status.published,null);
 for(const key of ['handle','published','properties','limits'])assert.deepEqual(listed[key],status[key],key);
 for(const key of ['subject','checkedAt','validUntil'])assert.deepEqual(listed.verification[key],status.verification[key],key);
 assert.equal(status.verification.validUntil.known,true);
 assert.ok(Number.isFinite(Date.parse(status.verification.validUntil.value)));
 assert.equal(listed.state,'usable');assert.equal(listed.verification.status,'verified');
 assert.equal(listed.cleanup.state,'none');
}
async function controls(home,owner,deps,handle){
 assert.equal((await listRecordedRoutes({home,owner:'foreign-owner'},deps)).routes.length,0);
 for(const context of [{},{...deps,registryId:'wrong-registry'}]){
  const listed=(await listRecordedRoutes({home,owner},context)).routes.find(row=>row.handle.id===handle.id);
  assert.ok(listed);assert.equal(listed.published,null);assert.notEqual(listed.verification.status,'verified');
 }
}

test('generic session cached enumeration preserves real admitted proof and closes only its listener',async()=>{
 await fixture(async f=>{
  const id='observation-'+randomUUID();
  const registry=await fakeRegistry({id,dir:join(f.home,'registry'),kinds:['session'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
  f.setRegistry(registry);
  const api=createGozar({manifest:registry.manifest,root:registry.root});f.setApi(api);
  const q=request(f.home,f.target,'generic-owner',id,'this-device','tcp');
  const candidate=(await api.catalogRoutes(q)).candidates.find(row=>row.eligible);
  assert.ok(candidate,'known-valid generic fixture must be eligible');
  const route=await f.expose({...q,wait:'verified',approval:approval(candidate)});
  assert.equal(route.handle.kind,'session');
  const status=await api.routeStatus({home:f.home,handle:route.handle});
  assert.equal(status.verification.status,'verified');
  const deps={adapters:await loadAdapters(registry),registryId:candidate.consent.scope.registryId};
  const events=async()=> (await readFile(join(registry.root,'providers',id,'events.jsonl'),'utf8')).trim().split('\n')
   .filter(Boolean).map(line=>JSON.parse(line).event).filter(event=>event==='start'||event==='proof');
  const before=await events();
  for(let n=0;n<2;n++){
   const rows=(await listRecordedRoutes({home:f.home,owner:q.owner},deps)).routes;
   assert.equal(rows.length,1);currentParity(rows[0],status);
  }
  // Exact observed interval; an autonomous proof event must be investigated, not hidden.
  assert.deepEqual(await events(),before,'owning enumeration interval adds no start/proof');
  await controls(f.home,q.owner,deps,route.handle);
  const endpoint=new URL(status.published);
  assert.equal(await probePort(Number(endpoint.port)),true);
  const closed=await api.closeRoute({home:f.home,handle:route.handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');
  assert.equal(await probePort(Number(endpoint.port)),false,'owned listener must actually refuse');
  assert.equal(await probePort(f.appPort),true,'foreign app remains');
  const terminal=(await listRecordedRoutes({home:f.home,owner:q.owner},deps)).routes[0];
  assert.equal(terminal.state,'released');assert.equal(terminal.published,null);
 });
});

test('native cached enumeration uses declared registry facts and withdraws on consent review without respawn',async()=>{
 await fixture(async f=>{
  let serial=0,gateTarget;
  const resources=new Map();
  const effects=[
   {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.0',stderr:'',exitCode:0})},
   {kind:'spawn',operation:'run',handle:async input=>{
    if(!input.longRunning)return {stdout:'OpenSSH_9.0',stderr:'',exitCode:0};
    gateTarget=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');
    assert.ok(gateTarget);
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    f.children.add(child);
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    const handle='observation-process-'+(++serial);resources.set(handle,child);
    return {handle,pid:child.pid,stdout:'https://fixture.lhr.life\n',stderr:'',exitCode:null};
   }},
   {kind:'spawn',operation:'read',handle:async({handle})=>{
    const child=resources.get(handle);
    return {present:!!child&&child.exitCode===null&&child.signalCode===null};
   }},
   {kind:'spawn',operation:'close',handle:async({handle})=>{
    const child=resources.get(handle);
    if(child&&child.exitCode===null&&child.signalCode===null){
     const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();
     await bounded(exit,'provider child close',2000);
    }
    return {closed:true};
   }},
   {kind:'network',operation:'fetch',handle:async input=>{
    assert.ok(gateTarget);const url=new URL(input.url);
    const response=await fetch('http://'+gateTarget+url.pathname,{headers:input.headers,signal:AbortSignal.timeout(5000)});
    const chunks=[];let before=Date.now();
    for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
    return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
   }},
  ];
  const harness=await createTestingGozar({identity:{instanceId:randomUUID(),bootId:randomUUID()},effects});
  f.setHarness(harness);const api=harness.gozar;
  const q=request(f.home,f.target,'native-owner','localhost-run','internet','https');
  const candidate=(await api.catalogRoutes(q)).candidates.find(row=>row.eligible);
  assert.ok(candidate,'known-valid native fixture must be eligible, not a prerequisite refusal');
  const route=await f.expose({...q,wait:'verified',approval:approval(candidate)});
  assert.equal(route.handle.kind,'session');assert.equal(serial,1);
  const status=await api.routeStatus({home:f.home,handle:route.handle});
  assert.equal(status.verification.status,'verified');
  const deps={adapters:await loadAdapters(),registryId:candidate.consent.scope.registryId};
  const before=harness.events.filter(event=>event.kind==='spawn'&&event.operation==='run'||event.kind==='network').length;
  for(let n=0;n<2;n++){
   const rows=(await listRecordedRoutes({home:f.home,owner:q.owner},deps)).routes;
   assert.equal(rows.length,1);currentParity(rows[0],status);
  }
  assert.equal(harness.events.filter(event=>event.kind==='spawn'&&event.operation==='run'||event.kind==='network').length,before);
  await controls(f.home,q.owner,deps,route.handle);
  await api.reviewRouteConsent({home:f.home,handle:route.handle});
  const held=(await listRecordedRoutes({home:f.home,owner:q.owner},deps)).routes[0];
  assert.equal(held.published,null);assert.notEqual(held.verification.status,'verified');assert.equal(serial,1);
  for(const child of resources.values())assert.ok(child.exitCode===null&&child.signalCode===null);
  assert.equal(await probePort(f.appPort),true);
  const gatePort=Number(gateTarget.split(':')[1]);
  const closed=await api.closeRoute({home:f.home,handle:route.handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');
  for(const child of resources.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(await probePort(gatePort),false,'owned gate actually refuses after exact close');
  assert.equal(await probePort(f.appPort),true,'foreign app remains after native close');
  const terminal=(await listRecordedRoutes({home:f.home,owner:q.owner},deps)).routes[0];
  assert.equal(terminal.state,'released');assert.equal(terminal.published,null);
 });
});
