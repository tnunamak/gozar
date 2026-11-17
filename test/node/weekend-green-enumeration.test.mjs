import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

async function listener(){
 const sockets=new Set(),server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  socket.on('error',()=>{});socket.on('data',data=>socket.end(data));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {address:'127.0.0.1:'+server.address().port,async close(){for(const socket of sockets)socket.destroy();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
function exchange(address){
 const url=new URL(address.includes('://')?address:'tcp://'+address);
 return new Promise((resolve,reject)=>{
  const socket=net.connect(Number(url.port),url.hostname);let text='';
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('synthetic socket deadline'));},1000);
  socket.once('connect',()=>socket.write('inventory-probe'));
  socket.on('data',data=>text+=data.toString());
  socket.once('error',error=>{clearTimeout(timer);reject(error);});
  socket.once('end',()=>{clearTimeout(timer);resolve(text);});
 });
}
for(const kind of ['attached','session']){
 test('public cached enumeration preserves '+kind+' observation without effects',{timeout:20000},async t=>{
  const home=await mkdtemp(join(homedir(),'.tmp','green-enumeration-'));
  let api,route,registry,bodyPassed=false;const listeners=[];
  t.after(async()=>{
   const errors=[];
   if(route?.handle)try{
    const closed=await api.closeRoute({home,owner:'inventory-owner',handle:route.handle,mode:'remove'});
    assert.equal(closed.cleanup.state,'confirmed');
   }catch(error){errors.push(error);}
   for(const item of listeners)try{await item.close();}catch(error){errors.push(error);}
   if(errors.length){
    t.diagnostic(`Unconfirmed enumeration cleanup retained at ${home}`);
    throw new AggregateError(errors,'Enumeration fixture cleanup failed');
   }
   if(bodyPassed){await registry?.cleanup();await rm(home,{recursive:true});}
   else t.diagnostic(`Enumeration failure evidence retained at ${home}`);
  });
  listeners.push(await listener());
  listeners.push(await listener());
  const target=listeners[0].address,foreign=listeners[1].address,id='unfamiliar-enumeration-'+kind;
  registry=await fakeRegistry({id,dir:join(home,'registry'),kinds:['attached','session'],
   reach:'this-device',transport:'tcp',proofProtocol:'echo'});
  api=createGozar({manifest:registry.manifest,root:registry.root});
  const q={schemaVersion:1,home,owner:'inventory-owner',operationId:'inventory-'+kind,target,
   usage:kind==='session'?{kind,lifetimeMs:60000}:{kind},
   requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice);
  const authority=Object.fromEntries(Object.entries(choice).filter(([name])=>['candidateToken','consentFactsDigest'].includes(name)));
  const request={...q,wait:'verified',approval:{kind:'route',...authority,disclosureRevision:choice.disclosure.revision}};
  try{route=await api.expose(request);}catch(error){route=error.route;throw error;}
  assert.equal(route.handle.kind,kind);assert.equal(route.handle.generation,1);
  const current=await api.routeStatus({home,owner:q.owner,handle:route.handle});
  assert.equal(current.verification.status,'verified');assert.notEqual(current.published,null);
  if(kind==='session'){
   const bootstrap=JSON.parse(await readFile(join(home,route.handle.id.split(':')[0],'bootstrap.json'),'utf8'));
   assert.equal(bootstrap.execution,'generic-session-v1');assert.deepEqual(bootstrap.handle,route.handle);
  }
  const events=()=>readFile(join(registry.root,'providers',id,'events.jsonl'),'utf8');
  const before=await events();
  for(let n=0;n<2;n++){
   const listed=await api.listRoutes({home,owner:q.owner});assert.equal(listed.routes.length,1);
   const actual=listed.routes[0];
   for(const field of ['handle','published','properties'])assert.deepEqual(actual[field],current[field]);
   for(const field of ['subject','checkedAt','validUntil'])assert.deepEqual(actual.verification[field],current.verification[field]);
   assert.equal(actual.operationId,q.operationId);
  }
  assert.equal((await api.listRoutes({home,owner:'foreign-owner'})).routes.length,0);
  assert.equal(await events(),before,'list must not add any provider event');
  assert.equal(await exchange(current.published),'inventory-probe');
  const closed=await api.closeRoute({home,owner:q.owner,handle:route.handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');
  await assert.rejects(exchange(current.published),{code:'ECONNREFUSED'});
  assert.equal(await exchange(foreign),'inventory-probe','unrelated application survives');
  const terminal=(await api.listRoutes({home,owner:q.owner})).routes[0];
  assert.equal(terminal.state,'released');assert.equal(terminal.published,null);
  assert.equal((await api.expose(request)).state,'released');
  const ledger=await events();assert.equal(ledger.split('"start"').length-1,1);
  bodyPassed=true;
 });
}
