import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
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
  const route=await api.expose({...query,wait:'verified',approval:approval(current)});
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
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
  catch(error){server.close();throw error;}
  return {target:'127.0.0.1:'+server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function query(home,owner,providerId,target,kind='attached'){
  return {schemaVersion:1,home,owner,providerId,target,operationId:randomUUID(),
    usage:kind==='session'?{kind,lifetimeMs:60000}:{kind},
    requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
}
async function fixture(){
  const parent=join(homedir(),'.tmp0700');
  try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await lstat(parent);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'scratch parent must be a real directory');
  assert.equal(info.uid,process.getuid(),'scratch parent must belong to this user');
  assert.equal(info.mode&0o777,0o700,'scratch parent must already be private');
  const root=await mkdtemp(join(parent,'rd-'));
  const home=join(root,'home');await mkdir(home,{mode:0o700});
  const providerId='ref-'+randomUUID(),registry=await fakeRegistry({id:providerId,dir:join(root,'registry'),
    kinds:['attached','session'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[]});
  return {root,home,providerId,registry,close:async()=>{await registry.cleanup();}};
}

async function owned(body){
  const actions=[],attempts=[],beforeRoutes=[],evidenceCleanup=[];
  let primary;
  const own={
    add(cleanup){actions.push(cleanup);},
    evidenceCleanup(cleanup){evidenceCleanup.push(cleanup);},
    beforeRoutes(cleanup){beforeRoutes.push(cleanup);},
    track(api,q){attempts.push({api,q});},
    async open(api,q){
      // Track intent before allocation; even an expose that throws may leave debt.
      attempts.push({api,q});
      return open(api,q);
    },
  };
  try{await body(own);}catch(error){primary=error;}
  const errors=[];
  const attempt=async action=>{try{await action();}catch(error){errors.push(error);}};
  for(const action of beforeRoutes)await attempt(action);
  // Close only routes associated with this test's exact operations and owners.
  for(const {api,q} of attempts)await attempt(async()=>{
    const listed=await api.listRoutes({home:q.home,owner:q.owner});
    for(const route of listed.routes.filter(row=>row.operationId===q.operationId)){
      await attempt(async()=>{
        const closed=await api.closeRoute({home:q.home,owner:q.owner,handle:route.handle,mode:'remove'});
        assert.equal(closed.cleanup.state,'confirmed','retain home when exact route cleanup is unconfirmed');
      });
    }
  });
  // Reverse acquisition order; every action runs even if another fails.
  for(const action of actions.reverse())await attempt(action);
  // Failed observations keep provider events and homes for diagnosis.
  if(!primary&&!errors.length)for(const action of evidenceCleanup)await attempt(action);
  if(primary||errors.length)throw new AggregateError(
    [...(primary?[primary]:[]),...errors],'reference-debt assertion or owned cleanup failed',
    primary?{cause:primary}:undefined);
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
      const route=await open(api,query);
      process.send({route});
    }catch(error){process.send({failure:{code:error.code??'fixture_failure',message:error.message,stack:error.stack}});process.disconnect();}
  });
}else{
  test('operation-bound reference debt survives fresh factory, preserves second and foreign holds, and releases without new proof',
    {timeout:30000},async()=>owned(async own=>{
    const f=await fixture();own.evidenceCleanup(()=>f.close());
    const apps=[];
    for(let i=0;i<3;i++){const server=await app();own.add(()=>server.close());apps.push(server);}
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
    const api=createRouteApi({...deps,embeddingServices:injected});
      const first=await own.open(api,q);await echo(first.origin);
      const secondQ=query(f.home,q.owner,f.providerId,apps[1].target),second=await own.open(normal,secondQ);
      const foreignQ=query(f.home,'foreign-owner',f.providerId,apps[2].target),foreign=await own.open(normal,foreignQ);
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
      await commitOracle(fresh,foreignQ,false);
  }));
  test('session host loss withdraws readiness and exact operation-bound cleanup releases stored use',
    {timeout:30000},async()=>owned(async own=>{
    const f=await fixture();own.evidenceCleanup(()=>f.close());
    const server=await app();own.add(()=>server.close());
    const foreignApp=await app();own.add(()=>foreignApp.close());
    const deps={manifest:f.registry.manifest,root:f.registry.root,identity:identity()},api=createRouteApi(deps);
    const q=query(f.home,'host-owner',f.providerId,server.target,'session');
    let child,route,foreign,exitPromise;
    foreign=await own.open(api,query(f.home,'foreign-owner',f.providerId,foreignApp.target));
      own.track(api,q);
      child=fork(fileURLToPath(import.meta.url),['--reference-debt-child'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
      exitPromise=once(child,'exit');exitPromise.catch(()=>{});
      own.beforeRoutes(async()=>{if(child){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exitPromise;}});
      const message=await new Promise((resolve,reject)=>{
        const finish=(error,value)=>{
          clearTimeout(timer);child.off('error',onError);child.off('message',onMessage);child.off('exit',onExit);
          error?reject(error):resolve(value);
        };
        const onError=error=>finish(error),onMessage=value=>finish(null,value);
        const onExit=()=>finish(new Error('child exited before returning its route'));
        const timer=setTimeout(()=>finish(new Error('bounded child expose timeout')),10000);
        child.once('error',onError);child.once('message',onMessage);child.once('exit',onExit);
        try{child.send({registry:{manifest:f.registry.manifest,root:f.registry.root},query:q,identity:deps.identity},
          error=>{if(error)finish(error);});}catch(error){finish(error);}
      });
      route=message.route;
      assert.equal(message.failure,undefined);await echo(route.origin);
      const before=await counts(f);
      child.kill('SIGKILL');await exitPromise;child=null;
      const fresh=createRouteApi({...deps,identity:{instanceId:deps.identity.instanceId,bootId:randomUUID()}});
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
  }));
}
