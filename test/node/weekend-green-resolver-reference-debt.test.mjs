import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {fork} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';
import {controlAttached} from '../../packages/gozar-node/attached-route.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

const owner='fixture-owner';
const identity={instanceId:'test-instance',bootId:'test-creator'};
const key=h=>JSON.stringify([h.kind,h.id,h.generation]);
const json=async p=>JSON.parse(await readFile(p,'utf8'));
async function until(read,accept,deadline){
  for(;;){const value=await read();if(accept(value))return value;
    assert.ok(Date.now()<deadline,'positive observation did not arrive before bounded deadline');
    await delay(20);
  }
}
async function boundedExit(promise){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('owned creator did not exit')),5000);})]);}finally{clearTimeout(timer);}
}
async function creator(){
  const {readFile,appendFile}=await import('node:fs/promises');
  const input=JSON.parse(await readFile(process.argv[2],'utf8'));
  const {createRouteApi}=await import(input.apiUrl);
  const {createEmbeddingServices}=await import(input.servicesUrl);
  const {controlAttached}=await import(input.attachedUrl);
  const services=createEmbeddingServices({registryId:input.registryId,identity:input.identity});
  let owned;
  const equal=h=>h&&owned&&h.kind===owned.kind&&h.id===owned.id&&h.generation===owned.generation;
  const wrapped=new Proxy(services,{get(target,name){
    if(name==='registerConfigurationUse')return async r=>{
      await target[name](r);
      if(r.home===input.home&&r.owner===input.owner&&r.providerId===input.id)owned=structuredClone(r.handle);
    };
    if(name==='releaseConfigurationUse')return async r=>{
      if(r.home===input.home&&r.owner===input.owner&&r.providerId===input.id&&equal(r.handle)){
        await appendFile(input.counter,'attempt\n');
        throw Object.assign(new Error('fixture release refusal'),{code:'secret_backend_unavailable'});
      }
      return target[name](r);
    };
    return typeof target[name]==='function'?target[name].bind(target):target[name];
  }});
  const api=createRouteApi({...input.registry,embeddingServices:wrapped,identity:input.identity});
  const q={schemaVersion:1,home:input.home,owner:input.owner,providerId:input.id,
    ...(input.operationId?{operationId:input.operationId}:{}),target:input.target,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',
    payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const catalog=await api.catalogRoutes(q);
  const candidate=catalog.candidates.find(c=>c.providerId===input.id);
  if(!candidate)throw new Error('fixture candidate missing');
  const approval={kind:'route',...Object.fromEntries(Object.entries(candidate).filter(([name])=>
    ['candidateToken','consentFactsDigest'].includes(name))),disclosureRevision:candidate.disclosure.revision};
  let route;
  try{route=await api.expose({...q,approval,wait:'verified'});}
  catch(error){if(error.route)process.send({type:'handle',handle:error.route.handle});throw error;}
  process.send({type:'handle',handle:route.handle});
  let closed;
  try{
    // Leave operation debt unjournaled: fresh public recovery must consume genuine
    // controller removal evidence, not merely retry a milestone created by this host.
    if(input.operationId)closed=(await controlAttached(input.home+'/attached/'+route.handle.id,
      {type:'close',handleId:route.handle.id,generation:route.handle.generation})).view;
    else closed=await api.closeRoute({home:input.home,owner:input.owner,handle:route.handle,mode:'remove'});
  }
  catch(error){closed=error.route;if(!closed)throw error;}
  process.send({type:'debt',handle:route.handle,cleanup:closed.cleanup.state});
  process.on('message',()=>{}); // parent owns termination, and records the ChildProcess before waiting
}
for(const operationBound of [false,true])for(const retry of ['direct','lease-expiry']){
test('registered reference survives creator loss: '+retry+' operation='+operationBound,{timeout:120000},async()=>{
  await mkdir(join(homedir(),'.tmp'),{recursive:true,mode:0o700});
  const root=await realpath(await mkdtemp(join(homedir(),'.tmp','gz-debt-')));
  const home=join(root,'h'),registryDir=join(root,'r');
  await mkdir(home,{mode:0o700});await mkdir(registryDir,{mode:0o700});
  const id='fake-'+randomUUID(),foreignId='foreign-'+randomUUID();
  const registry=await fakeRegistry({id,dir:registryDir,kinds:['attached'],reach:'this-device',
    transport:'tcp',proofProtocol:'echo',setupActions:[]});
  const registryId=await registryIdentity(registry);
  const services=createEmbeddingServices({registryId,identity});
  let successes=0;
  const trustedServices=new Proxy(services,{get(target,name){
    if(name==='releaseConfigurationUse')return async r=>{await target[name](r);
      if(r.home===home&&r.owner===owner&&r.providerId===id&&handle&&key(r.handle)===key(handle))successes++;};
    return typeof target[name]==='function'?target[name].bind(target):target[name];
  }});
  const trusted=createRouteApi({...registry,embeddingServices:trustedServices,identity});
  const app=net.createServer(socket=>socket.pipe(socket));
  const foreignApp=net.createServer(socket=>socket.end('foreign'));
  let child,handle,exited,primary,cleanupErrors=[];
  const sockets=new Set();app.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  const scope={home,owner,providerId:id};
  const foreignScope={home,owner:'foreign-owner',providerId:foreignId};
  const foreignHandle={kind:'attached',id:'foreign-'+randomUUID(),generation:1};
  let foreignRegistered=false;
  const counter=join(root,'counter');
  const counts=async()=>{const text=await readFile(join(registry.root,'providers',id,'events.jsonl'),'utf8');
    assert.ok(text.length<65536,'fixture event ledger unexpectedly large');
    const rows=text.trim().split('\n').filter(Boolean).map(JSON.parse);
    return Object.fromEntries(['start','proof','stop','cleanup'].map(event=>[event,rows.filter(row=>row.event===event).length]));};
  const draft=async s=>{const c=await services.readConfiguration(s);return services.beginConfigurationDraft({...s,expectedConfigurationRevision:c.revision});};
  const commit=(s,d)=>services.commitConfigurationDraft({...s,draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision});
  try{
    await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
    await new Promise((resolve,reject)=>{foreignApp.once('error',reject);foreignApp.listen(0,'127.0.0.1',resolve);});
    const fc=await services.readConfiguration(foreignScope);
    await services.registerConfigurationUse({...foreignScope,revision:fc.revision,handle:foreignHandle});foreignRegistered=true;
    const fd=await draft(foreignScope);
    await writeFile(counter,'');
    const childPath=join(root,'creator.mjs'),inputPath=join(root,'input.json');
    await writeFile(childPath,'('+creator.toString()+')().catch(error=>{process.send?.({type:"error",code:error.code??"fixture_failed"});process.exitCode=1;});');
    await writeFile(inputPath,JSON.stringify({home,owner,id,registry,registryId,identity,counter,
      ...(operationBound?{operationId:randomUUID()}:{}),
      target:'127.0.0.1:'+app.address().port,
      attachedUrl:new URL('../../packages/gozar-node/attached-route.mjs',import.meta.url).href,
      apiUrl:new URL('../../packages/gozar-node/route-api.mjs',import.meta.url).href,
      servicesUrl:new URL('../../packages/gozar-node/embedding-services.mjs',import.meta.url).href}));
    child=fork(childPath,[inputPath],{stdio:['ignore','ignore','ignore','ipc']});
    exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('creator fixture deadline')),45000);
      child.on('message',m=>{if(m.handle)handle=m.handle;if(m.type==='debt'){clearTimeout(timer);resolve(m);}
        if(m.type==='error'){clearTimeout(timer);reject(new Error(m.code));}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('creator exited before debt'));});
    });
    const debt=await ready;assert.equal(debt.cleanup,'unconfirmed');assert.ok(handle);
    const directory=join(home,'attached',handle.id),statePath=join(directory,'state.json');
    const before=await json(statePath);
    // The controller is a separate process that outlives its creator; its identity is recorded before any recovery.
    const controller=await json(join(directory,'control.json'));
    const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
    assert.ok(Number.isInteger(controller.pid)&&alive(controller.pid),'the controller is alive while reference debt is retained');
    assert.equal(key(before.handle),key(handle));assert.equal(key(before.resourceRemoval.handle),key(handle));
    assert.equal(before.resourceRemoval.providerId,id);
    const ledger=await counts();assert.equal(ledger.stop,1);assert.equal(ledger.cleanup,1);assert.equal(ledger.start,1);assert.ok(ledger.proof>0);
    assert.ok((await readFile(counter,'utf8')).includes('attempt\n'));
    const d=await draft(scope);
    await assert.rejects(commit(scope,d),{code:'configuration_in_use'});
    const lostAt=Date.now();
    child.kill('SIGTERM');await boundedExit(exited);
    const leaseExpiryMs=(await json(join(directory,'bootstrap.json'))).leaseExpiryMs;
    // An actual broker EOF changes the prior uncertain phase to unverified. No synthetic loss command.
    const lost=await until(()=>json(statePath),s=>s.phase==='unverified',lostAt+leaseExpiryMs);
    assert.equal(lost.lastView.published,null);assert.notEqual(lost.lastView.verification.status,'verified');
    assert.equal(lost.lastView.cleanup.state,'unconfirmed');
    if(retry==='lease-expiry'){
      // Owner loss is final: the controller stops forwarding and exits instead of waiting on the reference, and its journal keeps the debt.
      await until(async()=>alive(controller.pid),gone=>gone===false,
        lostAt+leaseExpiryMs+Math.max(20,Math.min(1000,Math.floor(leaseExpiryMs/4)))+5000);
      const parked=await json(statePath);
      assert.equal(parked.lastView.cleanup.state,'unconfirmed');assert.notEqual(parked.phase,'released');
      assert.equal(key(parked.resourceRemoval.handle),key(handle));assert.equal(key(parked.handle),key(handle));
      await assert.rejects(controlAttached(directory,{type:'close',handleId:handle.id,generation:handle.generation}),error=>error.gone===true);
    }else{
      const retried=await controlAttached(directory,{type:'close',handleId:handle.id,generation:handle.generation});
      assert.equal(key(retried.view.handle),key(handle));
      assert.equal(retried.view.cleanup.state,'unconfirmed');
      assert.equal(retried.view.published,null);assert.notEqual(retried.view.verification.status,'verified');
    }
    await assert.rejects(commit(scope,d),{code:'configuration_in_use'});
    assert.deepEqual(await counts(),ledger);
    assert.equal(successes,0);
    await assert.rejects(trusted.closeRoute({home,owner:'foreign-owner',handle,mode:'remove'}),{code:'route_conflict'});
    await assert.rejects(trusted.closeRoute({home,owner,handle:{...handle,generation:handle.generation+1},mode:'remove'}),{code:'route_conflict'});
    await assert.rejects(commit(scope,d),{code:'configuration_in_use'});
    assert.equal(successes,0);assert.deepEqual(await counts(),ledger);
    const released=await trusted.closeRoute({home,owner,handle,mode:'remove'});
    assert.equal(released.cleanup.state,'confirmed');assert.ok(successes>0);
    await commit(scope,d);
    // Recorded removal plus exact reference release finalize the controller: no lingering process, socket or route record.
    await until(async()=>alive(controller.pid),gone=>gone===false,Date.now()+10000);
    await assert.rejects(lstat(join(directory,'control.sock')),{code:'ENOENT'});
    const again=await trusted.closeRoute({home,owner,handle,mode:'remove'});
    assert.equal(again.cleanup.state,'confirmed');assert.deepEqual(await counts(),ledger);
    await assert.rejects(commit(foreignScope,fd),{code:'configuration_in_use'});
    assert.equal(app.listening,true);assert.equal(foreignApp.listening,true);assert.deepEqual(await counts(),ledger);
  }catch(error){primary=error;}
  finally{
    if(child&&child.exitCode===null&&child.signalCode===null)try{child.kill('SIGTERM');await boundedExit(exited);}catch(error){cleanupErrors.push(error);}
    if(child&&!handle)cleanupErrors.push(new Error('creator allocation outcome unknown; retained owned fixture directory: '+root));
    if(handle)try{const v=await trusted.closeRoute({home,owner,handle,mode:'remove'});
      assert.equal(v.cleanup.state,'confirmed');}catch(error){cleanupErrors.push(error);}
    if(foreignRegistered)try{await services.releaseConfigurationUse({...foreignScope,handle:foreignHandle});}catch(error){cleanupErrors.push(error);}
    for(const socket of sockets)socket.destroy();
    if(app.listening)await new Promise(resolve=>app.close(resolve));
    if(foreignApp.listening)await new Promise(resolve=>foreignApp.close(resolve));
    // Retain owned evidence on uncertain route cleanup; never manufacture a removal receipt.
    if(!cleanupErrors.length)await rm(root,{recursive:true,force:true});
  }
  if(primary||cleanupErrors.length)throw new AggregateError([primary,...cleanupErrors].filter(Boolean),'reference-debt fixture failed');
});
}
