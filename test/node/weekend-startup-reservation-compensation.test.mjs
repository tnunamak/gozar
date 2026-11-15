import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir,lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {scratch,query} from './route-schema-check.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const approval=c=>({...Object.fromEntries(Object.entries(c).filter(([key])=>['candidateToken','consentFactsDigest'].includes(key))),kind:'route',disclosureRevision:c.disclosure.revision});
async function echo(origin){
 const url=new URL(origin),bytes=randomBytes(63);
 await new Promise((resolve,reject)=>{
  const socket=net.connect(+url.port,url.hostname);let data=Buffer.alloc(0);
  const timer=setTimeout(()=>done(new Error('echo timeout')),2000);
  const done=error=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
  socket.once('error',done);socket.once('connect',()=>socket.write(bytes));
  socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);if(data.length>=bytes.length){try{assert.deepEqual(data,bytes);done();}catch(error){done(error);}}});
 });
}
async function server(t){
 const sockets=new Set(),app=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.pipe(socket);});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>app.close(resolve));});
 return '127.0.0.1:'+app.address().port;
}
async function oracle(api,q,blocked){
 const c=(await api.catalogRoutes(q)).candidates.find(c=>c.providerId===q.providerId);
 const scope={home:q.home,owner:q.owner,providerId:q.providerId};
 const d=await api.beginConfigurationDraft({...scope,expectedConfigurationRevision:c.configuration.revision});
 if(blocked){try{await assert.rejects(api.commitConfigurationDraft({...scope,draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision}),{code:'configuration_in_use'});}
 finally{await api.discardConfigurationDraft({...scope,draftId:d.draftId});}}
 else await api.commitConfigurationDraft({...scope,draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision});
}
async function events(path){try{return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function waitFor(predicate){for(let i=0;i<100;i++){if(await predicate())return;await sleep(25);}assert.fail('bounded startup observation timed out');}
async function socketAbsent(path){
 await new Promise((resolve,reject)=>{const socket=net.connect(path);const timer=setTimeout(()=>{socket.destroy();reject(new Error('socket absence timeout'));},1000);
 socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('owned socket still accepts'));});
 socket.once('error',error=>{clearTimeout(timer);socket.destroy();['ENOENT','ECONNREFUSED'].includes(error.code)?resolve():reject(error);});});
}
for(const fault of ['writeBootstrap','spawnController','recordController','referenceRelease']){
 test('startup compensation owns only acquired resources: '+fault,{timeout:30000},async t=>{
  const home=await scratch(t),target=await server(t),foreignTarget=await server(t),providerId='comp-'+randomUUID();
  const registry=await fakeRegistry({id:providerId,dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[]});
  t.after(registry.cleanup);
  const deps={manifest:registry.manifest,root:registry.root,identity:{instanceId:'comp-instance',bootId:randomUUID()}};
  const normal=createGozar(deps),base=query({home,providerId,target,owner:'owner',usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const foreignQ={...base,target:foreignTarget,operationId:randomUUID()};
  const foreignCandidate=(await normal.catalogRoutes(foreignQ)).candidates[0];
  const foreign=await normal.expose({...foreignQ,wait:'verified',approval:approval(foreignCandidate)});
  t.after(async()=>{assert.equal((await normal.closeRoute({home,handle:foreign.handle,mode:'remove'})).cleanup.state,'confirmed');});
  await echo(foreign.origin);
  const ledger=join(registry.root,'providers',providerId,'events.jsonl'),before=await events(ledger);
  const request={...base,operationId:randomUUID(),wait:'verified'};
  let child,directory,calls=0;
  const startup={
   async [fault==='referenceRelease'?'writeBootstrap':fault](...args){
    calls++;
    if(fault==='writeBootstrap'||fault==='referenceRelease')directory=args[0].slice(0,-'/bootstrap.json'.length);
    if(fault==='recordController'){
     child=args[0];directory=args[1].directory;
     await waitFor(async()=> (await events(ledger)).filter(e=>e.event==='proof').length>before.filter(e=>e.event==='proof').length);
    }
    throw new Error('injected '+fault);
   }
  };
  const initial=(await normal.catalogRoutes(request)).candidates[0];
  const services=createEmbeddingServices({registryId:initial.consent.scope.registryId,identity:deps.identity});
  let releaseFails=fault==='referenceRelease';
  const embeddingServices=new Proxy(services,{get(target,key){
   if(key==='releaseConfigurationUse')return async input=>{if(releaseFails){releaseFails=false;throw new Error('injected metadata failure');}return target.releaseConfigurationUse(input);};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const api=createRouteApi({...deps,embeddingServices,expose:{startup}});
  const current=(await api.catalogRoutes(request)).candidates[0];
  let retained;
  await assert.rejects(api.expose({...request,approval:approval(current)}),error=>{
   assert.ok(error.route);retained=error.route;assert.equal(retained.operationId,request.operationId);return true;
  });
  assert.equal(calls,1);
  if(child){assert.ok(child.exitCode!==null||child.signalCode!==null);await socketAbsent(join(directory,'control.sock'));}
  const listed=(await normal.listRoutes({home,owner:base.owner})).routes.find(row=>row.handle.id===retained.handle.id);assert.ok(listed);
  assert.equal(retained.cleanup.state,fault==='referenceRelease'?'unconfirmed':'confirmed');
  if(fault==='referenceRelease'){assert.ok(retained.cleanup.nextAction);assert.equal(retained.published,null);assert.equal(listed.cleanup.state,'unconfirmed');}
  // The independent second hold must survive compensation.
  await oracle(normal,base,true);await echo(foreign.origin);
  await assert.rejects(normal.closeRoute({home,handle:{...retained.handle,generation:retained.handle.generation+1},mode:'remove'}),{code:'route_conflict'});
  await echo(foreign.origin);
  if(fault==='referenceRelease'){
   await normal.closeRoute({home,handle:foreign.handle,mode:'remove'});
   await oracle(normal,base,true); // The failed startup reference is now the only hold.
  }
  const after=await events(ledger);
  assert.equal(after.filter(e=>e.event==='start').length-before.filter(e=>e.event==='start').length,fault==='recordController'?1:0);
  const repeated=await createGozar(deps).closeRoute({home,handle:retained.handle,mode:'remove'});assert.equal(repeated.cleanup.state,'confirmed');
  assert.deepEqual(await events(ledger),after);
  await normal.closeRoute({home,handle:foreign.handle,mode:'remove'});await oracle(normal,base,false);
  // Broker sockets, not merely bookkeeping, must no longer accept connections.
  async function sockets(dir){const found=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())found.push(...await sockets(path));else if((await lstat(path)).isSocket())found.push(path);}return found;}
  for(const path of await sockets(home))await socketAbsent(path);
 });
}
test('registry change is rejected before operation reservation or effects',{timeout:15000},async t=>{
 const home=await scratch(t),target=await server(t),id='guard-'+randomUUID();
 const registry=await fakeRegistry({id,dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[]});t.after(registry.cleanup);
 const api=createGozar({manifest:registry.manifest,root:registry.root});
 const q=query({home,target,providerId:id,operationId:randomUUID(),usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const c=(await api.catalogRoutes(q)).candidates[0],path=join(registry.root,'providers',id,'definition.json');
 const original=await readFile(path,'utf8'),changed=JSON.parse(original);changed.adapter.label+=' changed';
 await writeFile(path,JSON.stringify(changed));
 await assert.rejects(api.expose({...q,wait:'verified',approval:approval(c)}),{code:'artifact_integrity_failed'});
 assert.deepEqual((await api.listRoutes({home})).routes,[]);
 assert.deepEqual(await events(join(registry.root,'providers',id,'events.jsonl')),[]);
});
