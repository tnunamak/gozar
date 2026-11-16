import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,chmod,lstat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

async function bounded(promise,label,ms=10000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);
 })]);}finally{clearTimeout(timer);}
}
async function listens(port){
 return bounded(new Promise((resolve,reject)=>{
  const socket=net.connect(port,'127.0.0.1');
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',error=>{socket.destroy();error.code==='ECONNREFUSED'?resolve(false):reject(error);});
  socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('timeout is not absence'));});
 }),'listener probe',2000);
}
async function bytes(port){
 return bounded(new Promise((resolve,reject)=>{
  const request=http.get({host:'127.0.0.1',port,path:'/'},response=>{
   let value='';
   response.on('data',chunk=>{value+=chunk;if(value.length>4096)request.destroy(new Error('response too large'));});
   response.once('error',reject);
   response.once('end',()=>resolve({status:response.statusCode,value}));
  });
  request.once('error',reject);
  request.setTimeout(1500,()=>request.destroy(new Error('byte exchange timed out')));
 }),'application bytes',2000);
}
function approval(candidate){
 // Public field binding supplied by the owner; never decode or log the offered grant.
 const granted=Object.fromEntries(Object.entries(candidate).filter(([name])=>
  ['candidateToken','consentFactsDigest'].includes(name)));
 return {kind:'route',...granted,disclosureRevision:candidate.disclosure.revision};
}
function parity(listed,status){
 assert.equal(status.state,'usable');assert.equal(status.verification.status,'verified');
 assert.notEqual(status.published,null);
 for(const key of ['handle','published','properties','limits'])assert.deepEqual(listed[key],status[key],key);
 for(const key of ['status','subject','checkedAt','validUntil'])assert.deepEqual(listed.verification[key],status.verification[key],key);
 assert.equal(status.verification.validUntil.known,true);
 assert.ok(Number.isFinite(Date.parse(status.verification.validUntil.value)));
 assert.equal(listed.state,'usable');assert.equal(listed.cleanup.state,'none');
}
async function fixture(body){
 const parent=join(homedir(),'.tmp');await mkdir(parent,{recursive:true,mode:0o700});
 const home=await mkdtemp(join(parent,'ge-'));await chmod(home,0o700);
 const identity=await lstat(home),apps=[],handles=[],pending=[],errors=[];
 let api,registry,original;
 const app=async value=>{
  const sockets=new Set(),server=http.createServer((_req,res)=>res.end(value));
  const record={server,sockets,value};apps.push(record);
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await bounded(new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}),'app start');
  return {...record,port:server.address().port};
 };
 const track=route=>{if(route?.handle&&!handles.some(h=>JSON.stringify(h)===JSON.stringify(route.handle)))handles.push(route.handle);return route;};
 const expose=async request=>{
  const work=api.expose(request).then(track,error=>{track(error.route);throw error;});
  pending.push(work);work.catch(()=>{});
  return bounded(work,'verified expose',15000);
 };
 try{
  const target=await app('target-'+randomUUID()),foreign=await app('foreign-'+randomUUID());
  await body({home,target,foreign,expose,setApi:value=>{api=value;},setRegistry:value=>{registry=value;}});
 }catch(error){original=error;}
 // Settle every started exposure before walking tracked late handles.
 try{await bounded(Promise.allSettled(pending),'late expose settlement',15000);}catch(error){errors.push(error);}
 for(const handle of handles.reverse())try{
  const result=await bounded(api.closeRoute({home,handle,mode:'remove'}),'exact route cleanup');
  assert.equal(result.cleanup.state,'confirmed');
 }catch(error){errors.push(error);}
 for(const {server,sockets} of apps)try{
  for(const socket of sockets)socket.destroy();
  if(server.listening)await bounded(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),'app cleanup');
 }catch(error){errors.push(error);}
 // Never discard diagnostic journals on body failure or an unconfirmed cleanup.
 if(!original&&!errors.length)try{
  if(registry)await registry.cleanup();
  const current=await lstat(home);
  assert.ok(current.isDirectory()&&!current.isSymbolicLink());
  assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);
  await rm(home,{recursive:true});
 }catch(error){errors.push(error);}
 if(original||errors.length)throw new AggregateError([...(original?[original]:[]),...errors],'root enumeration journey/cleanup failed');
}

for(const kind of ['attached','session']){
 test('public root '+kind+' enumeration preserves admitted proof without effects and stays terminal',async()=>{
  await fixture(async f=>{
   const id='enumeration-'+randomUUID();
   const registry=await fakeRegistry({id,dir:join(f.home,'r'),kinds:['attached','session'],
    reach:'this-device',transport:'tcp',proofProtocol:'echo'});
   f.setRegistry(registry);
   const api=createGozar({manifest:registry.manifest,root:registry.root});f.setApi(api);
   const q={schemaVersion:1,home:f.home,owner:'enumeration-owner',providerId:id,
    target:'127.0.0.1:'+f.target.port,operationId:randomUUID(),
    usage:kind==='session'?{kind:'session',lifetimeMs:60000}:{kind:'attached'},
    requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
   const candidates=(await bounded(api.catalogRoutes(q),'catalog')).candidates;
   assert.equal(candidates.length,1);
   const candidate=candidates[0];
   assert.equal(candidate.providerId,id);assert.equal(candidate.setup.state,'ready');
   assert.equal(candidate.eligible,true);assert.equal(candidate.unmet.length,0);
   const request={...q,wait:'verified',approval:approval(candidate)};
   const route=await f.expose(request); // Tracked before any assertions.
   assert.equal(route.handle.kind,kind);assert.equal(route.handle.generation,1);
   if(kind==='session'){
    assert.match(route.handle.id,/^port-[0-9]+:[A-Za-z0-9_-]+$/);
    const bootstrap=JSON.parse(await readFile(join(f.home,route.handle.id.split(':')[0],'bootstrap.json'),'utf8'));
    assert.equal(bootstrap.execution,'generic-session-v1');
    assert.deepEqual(bootstrap.handle,route.handle);assert.equal(bootstrap.id,route.handle.id);
    assert.equal(bootstrap.adapterId,id);assert.deepEqual(bootstrap.request.usage,q.usage);
   }
   // An explicit fresh status is outside the strictly read-only listing interval.
   const status=await bounded(api.routeStatus({home:f.home,handle:route.handle}),'explicit status');
   assert.deepEqual(status.handle,route.handle);assert.equal(status.verification.status,'verified');
   assert.notEqual(status.published,null);
   const endpoint=new URL(status.published);
   assert.equal(endpoint.hostname,'127.0.0.1');
   assert.deepEqual(await bytes(Number(endpoint.port)),{status:200,value:f.target.value});
   const events=async()=> (await readFile(join(registry.root,'providers',id,'events.jsonl'),'utf8'))
    .trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).event);
   const before=await events();
   assert.ok(before.includes('start'));assert.ok(before.includes('proof'));
   for(let repeat=0;repeat<3;repeat++){
    const result=await bounded(api.listRoutes({home:f.home,owner:q.owner}),'root list');
    assert.equal(result.routes.length,1);parity(result.routes[0],status);
    assert.equal(result.routes[0].operationId,q.operationId);
   }
   assert.equal((await bounded(api.listRoutes({home:f.home,owner:'foreign-owner'}),'foreign owner list')).routes.length,0);
   assert.deepEqual(await events(),before,'list interval must not add setup/start/proof/stop/cleanup');
   const closed=await bounded(api.closeRoute({home:f.home,handle:route.handle,mode:'remove'}),'owned close');
   assert.equal(closed.cleanup.state,'confirmed');
   assert.equal(await listens(Number(endpoint.port)),false,'actual owned listener refuses');
   assert.deepEqual(await bytes(f.foreign.port),{status:200,value:f.foreign.value});
   assert.deepEqual(await bytes(f.target.port),{status:200,value:f.target.value});
   const terminal=(await bounded(api.listRoutes({home:f.home,owner:q.owner}),'terminal list')).routes;
   assert.equal(terminal.length,1);assert.equal(terminal[0].state,'released');
   assert.equal(terminal[0].published,null);assert.deepEqual(terminal[0].handle,route.handle);
   const afterClose=await events();
   const replay=await f.expose(request);
   assert.equal(replay.state,'released');assert.equal(replay.published,null);
   assert.deepEqual(replay.handle,route.handle);
   assert.deepEqual(await events(),afterClose,'terminal replay must not allocate or prove again');
  });
 });
}
