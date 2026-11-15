import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,chmod,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';

const childMode=process.argv.includes('--reference-debt-child');
const identity=()=>({instanceId:randomUUID(),bootId:randomUUID()});
function approval(candidate){
  assert.equal(typeof candidate.candidateToken,'string','catalog must offer current approval');
  return {...Object.fromEntries(Object.entries(candidate).filter(([key])=>['candidateToken','consentFactsDigest'].includes(key))),
    kind:'route',disclosureRevision:candidate.disclosure.revision};
}
async function candidate(api,query){
  const result=await api.catalogRoutes(query);
  const value=result.candidates.find(row=>row.providerId===query.providerId);
  assert.ok(value,'fixture provider must be offered');return value;
}
async function open(api,query){
  const current=await candidate(api,query);
  const route=await api.expose({...query,approval:approval(current)});
  assert.equal(route.verification.status,'verified');assert.ok(route.origin);
  return route;
}
async function echo(origin){
  const endpoint=origin.includes('://')?new URL(origin):new URL('tcp://'+origin);
  const bytes=randomBytes(97);
  await new Promise((resolve,reject)=>{
    const socket=net.connect(Number(endpoint.port),endpoint.hostname);let received=Buffer.alloc(0);
    const timer=setTimeout(()=>finish(new Error('bounded echo timeout')),3000);
    const finish=error=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
    socket.once('connect',()=>socket.write(bytes));
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length>=bytes.length){
      try{assert.deepEqual(received,bytes);finish();}catch(error){finish(error);}
    }});
    socket.once('error',finish);
  });
}
async function app(){
  const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.pipe(socket);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {target:'127.0.0.1:'+server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function query(home,owner,providerId,target,kind='attached'){
  return {schemaVersion:1,home,owner,providerId,target,operationId:randomUUID(),
    usage:kind==='session'?{kind,lifetimeMs:60000}:{kind},
    requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
}
async function fixture(){
  await mkdir('.tmp',{recursive:true,mode:0o700});
  const root=await mkdtemp(join(resolve('.tmp'),'reference-debt-'));await chmod(root,0o700);
  const home=join(root,'home');await mkdir(home,{mode:0o700});
  const providerId='ref-'+randomUUID(),registry=await fakeRegistry({id:providerId,dir:join(root,'registry'),
    kinds:['attached','session'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[]});
  return {root,home,providerId,registry,close:async()=>{await registry.cleanup();await rm(root,{recursive:true,force:true});}};
}
async function counts(f){
  const rows=(await readFile(join(f.registry.root,'providers',f.providerId,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  return {start:rows.filter(row=>row.event==='start').length,proof:rows.filter(row=>row.event==='proof').length};
}
function debt(view,handle){
  assert.deepEqual(view.handle,handle);assert.equal(view.published,null);assert.equal(view.verification.status,'unverified');
  assert.equal(view.cleanup.state,'unconfirmed');assert.ok(view.cleanup.nextAction);assert.equal(view.routeState,'cleanup-unconfirmed');
}
async function commitOracle(api,q,blocked){
  const current=await candidate(api,q);
  const scope={home:q.home,owner:q.owner,providerId:q.providerId};
  const draft=await api.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.configuration.revision});
  let committed=false;
  try{
    const command={...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision};
    if(blocked)await assert.rejects(api.commitConfigurationDraft(command),{code:'configuration_in_use'});
    else{await api.commitConfigurationDraft(command);committed=true;}
  }finally{if(!committed)await api.discardConfigurationDraft({...scope,draftId:draft.draftId});}
}
if(childMode){
  process.once('message',async ({registry,query,identity})=>{
    try{
      const api=createRouteApi({...registry,identity});
      const route=await open(api,query);await echo(route.origin);
      process.send({route});
    }catch(error){process.send({failure:{code:error.code??'fixture_failure'}});process.disconnect();}
  });
}else{
  test('operation-bound reference debt survives fresh factory, preserves second and foreign holds, and releases without new proof',
    {timeout:30000},async()=>{
    const f=await fixture(),apps=await Promise.all([app(),app(),app()]);
    const deps={manifest:f.registry.manifest,root:f.registry.root,identity:identity()};
    const normal=createRouteApi(deps),q=query(f.home,'owner',f.providerId,apps[0].target);
    const offered=await candidate(normal,q),registryId=offered.consent.scope.registryId;
    const real=createEmbeddingServices({registryId,identity:deps.identity});
    let fail=false;
    const injected=new Proxy(real,{get(target,key){
      if(key==='releaseConfigurationUse')return async request=>{
        if(fail){fail=false;throw new Error('injected metadata release failure');}
        return target.releaseConfigurationUse(request);
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    const api=createRouteApi({...deps,embeddingServices:injected}),routes=[];
    let cleaned=false;
    try{
      const first=await open(api,q);routes.push(first);await echo(first.origin);
      const secondQ=query(f.home,q.owner,f.providerId,apps[1].target),second=await open(normal,secondQ);routes.push(second);
      const foreignQ=query(f.home,'foreign-owner',f.providerId,apps[2].target),foreign=await open(normal,foreignQ);routes.push(foreign);
      await echo(second.origin);await echo(foreign.origin);
      const before=await counts(f);assert.deepEqual(before,{start:3,proof:3});
      fail=true;
      await assert.rejects(api.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'}),error=>{
        assert.equal(error.code,'cleanup_debt');debt(error.route,first.handle);return true;
      });
      const fresh=createRouteApi(deps);
      debt((await fresh.listRoutes({home:f.home,owner:q.owner})).routes.find(row=>row.handle.id===first.handle.id),first.handle);
      await commitOracle(fresh,q,true);
      await assert.rejects(fresh.closeRoute({home:f.home,owner:'foreign-owner',handle:first.handle,mode:'remove'}),{code:'route_conflict'});
      await assert.rejects(fresh.closeRoute({home:f.home,owner:q.owner,handle:{...first.handle,generation:first.handle.generation+1},mode:'remove'}),{code:'route_conflict'});
      await commitOracle(fresh,q,true);
      await echo(second.origin);await echo(foreign.origin);
      assert.equal((await fresh.closeRoute({home:f.home,owner:q.owner,handle:second.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,q,true); // Now only the failed first reference can block this exact scope.
      const released=await fresh.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'});
      assert.equal(released.cleanup.state,'confirmed');assert.deepEqual(released.handle,first.handle);
      assert.equal((await fresh.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,q,false);
      await echo(foreign.origin);assert.deepEqual(await counts(f),before);
      await commitOracle(fresh,foreignQ,true);await echo(foreign.origin);
      assert.equal((await fresh.closeRoute({home:f.home,owner:'foreign-owner',handle:foreign.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,foreignQ,false);cleaned=true;
    }finally{
      const cleanup=cleaned?[]:await Promise.allSettled(routes.map(route=>normal.closeRoute({home:f.home,handle:route.handle,mode:'remove'})));
      for(const server of apps)await server.close();
      const failed=cleanup.filter(row=>row.status==='rejected'||row.value.cleanup.state!=='confirmed');
      assert.equal(failed.length,0,'retain fixture when cleanup is unconfirmed');
      await f.close();
    }
  });
  test('session host loss withdraws readiness and exact operation-bound cleanup releases stored use',
    {timeout:30000},async()=>{
    const f=await fixture(),server=await app(),foreignApp=await app();
    const deps={manifest:f.registry.manifest,root:f.registry.root,identity:identity()},api=createRouteApi(deps);
    const q=query(f.home,'host-owner',f.providerId,server.target,'session');
    let child,route,foreign,exitPromise;
    try{
      foreign=await open(api,query(f.home,'foreign-owner',f.providerId,foreignApp.target));
      child=fork(fileURLToPath(import.meta.url),['--reference-debt-child'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
      exitPromise=once(child,'exit');
      const message=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('bounded child expose timeout')),10000);
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('message',value=>{clearTimeout(timer);resolve(value);});
        child.send({registry:{manifest:f.registry.manifest,root:f.registry.root},query:q,identity:deps.identity});
      });
      assert.equal(message.failure,undefined);route=message.route;await echo(route.origin);
      const before=await counts(f);
      child.kill('SIGKILL');await exitPromise;child=null;
      const fresh=createRouteApi(deps);
      let withdrawn;
      for(let i=0;i<40;i++){
        withdrawn=await fresh.routeStatus({home:f.home,handle:route.handle});
        if(withdrawn.published===null)break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(withdrawn.published,null);assert.notEqual(withdrawn.verification.status,'verified');
      let result;
      try{result=await fresh.closeRoute({home:f.home,owner:q.owner,handle:route.handle,mode:'remove'});}
      catch(error){assert.equal(error.code,'cleanup_debt');debt(error.route,route.handle);
        await commitOracle(fresh,q,true);result=await fresh.closeRoute({home:f.home,owner:q.owner,handle:route.handle,mode:'remove'});}
      assert.equal(result.cleanup.state,'confirmed');await commitOracle(fresh,q,false);
      assert.deepEqual(await counts(f),before);await echo(foreign.origin);await echo(foreignApp.target);
      assert.equal((await fresh.closeRoute({home:f.home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
    }finally{
      if(child){child.kill('SIGKILL');await exitPromise;}
      const cleanup=await Promise.allSettled([route,foreign].filter(Boolean).map(item=>api.closeRoute({home:f.home,handle:item.handle,mode:'remove'})));
      await server.close();await foreignApp.close();
      assert.equal(cleanup.filter(row=>row.status==='rejected'||row.value.cleanup.state!=='confirmed').length,0,'retain fixture when cleanup is unconfirmed');
      await f.close();
    }
  });
}
