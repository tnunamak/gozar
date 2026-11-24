import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile,rm,readdir,writeFile} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {attachedCleanupReference} from '../../packages/gozar-node/attached-route.mjs';
import {prepareCleanupReference} from '../../packages/gozar-node/route-operations.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';

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
  return {target:'127.0.0.1:'+server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
function query(home,owner,providerId,target,kind='attached'){
  return {schemaVersion:1,home,owner,providerId,target,
    usage:kind==='session'?{kind,lifetimeMs:60000}:{kind},
    requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
}
async function fixture(own){
  const parent=join(homedir(),'.tmp0700');
  try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await lstat(parent);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'scratch parent must be a real directory');
  assert.equal(info.uid,process.getuid(),'scratch parent must belong to this user');
  assert.equal(info.mode&0o777,0o700,'scratch parent must already be private');
  const root=await mkdtemp(join(parent,'rd-'));
  const rootInfo=await lstat(root);
  let registry;
  const assertOwnedRoot=async()=>{
    const currentParent=await lstat(parent),current=await lstat(root);
    assert.equal(dirname(root),parent,'remove only the exact fixture child');
    assert.match(basename(root),/^rd-[A-Za-z0-9]+$/);
    for(const [currentInfo,original] of [[currentParent,info],[current,rootInfo]]){
      assert.ok(currentInfo.isDirectory()&&!currentInfo.isSymbolicLink(),'fixture path must remain a real directory');
      assert.equal(currentInfo.uid,process.getuid(),'fixture path must remain owned');
      assert.equal(currentInfo.mode&0o777,0o700,'fixture path must remain private');
      assert.equal(currentInfo.dev,original.dev,'fixture device must not change');
      assert.equal(currentInfo.ino,original.ino,'fixture identity must not change');
    }
  };
  // Register retention before setup: a failed setup still has a named root.
  own.evidenceCleanup(root,async()=>{
    await assertOwnedRoot();
    await registry.cleanup();
    await assertOwnedRoot();
    await rm(root,{recursive:true});
  });
  const home=join(root,'home');await mkdir(home,{mode:0o700});
  const providerId='ref-'+randomUUID();registry=await fakeRegistry({id:providerId,dir:join(root,'registry'),
    kinds:['attached','session'],reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[]});
  return {root,home,providerId,registry};
}

async function owned(body){
  const actions=[],attempts=[],beforeRoutes=[],evidenceCleanup=[];
  let primary,bodyFailed=false;
  const own={
    add(cleanup){actions.push(cleanup);},
    evidenceCleanup(root,cleanup){evidenceCleanup.push({root,cleanup});},
    beforeRoutes(cleanup){beforeRoutes.push(cleanup);},
    async open(api,q){
      // Track intent before allocation; even an expose that throws may leave debt.
      const attempt={api,q,handle:null};attempts.push(attempt);
      try{const current=await candidate(api,q);
        const route=await api.expose({...q,wait:'verified',approval:approval(current)});
        attempt.handle=route.handle;
        assert.equal(route.verification.status,'verified');assert.ok(route.origin);return route;}
      catch(error){attempt.handle=error.route?.handle;throw error;}
    },
  };
  try{await body(own);}catch(error){bodyFailed=true;primary=error;}
  const errors=[];
  const attempt=async action=>{try{await action();}catch(error){errors.push(error);}};
  for(const action of beforeRoutes)await attempt(action);
  // Close only exact handles captured before any assertion, including thrown routes.
  for(const {api,q,handle} of attempts)await attempt(async()=>{
    assert.ok(handle,'unbound failed allocation retains fixture for host inspection');
    const closed=await api.closeRoute({home:q.home,owner:q.owner,handle,mode:'remove'});
    assert.equal(closed.cleanup.state,'confirmed','retain home when exact route cleanup is unconfirmed');
  });
  // Reverse acquisition order; every action runs even if another fails.
  for(const action of actions.reverse())await attempt(action);
  // Evidence disposal is last, only after body and every owned resource cleanup.
  if(!bodyFailed&&!errors.length){
    for(const {cleanup} of evidenceCleanup){
      await attempt(cleanup);
      if(errors.length)break;
    }
  }
  if(bodyFailed||errors.length){
    for(const {root} of evidenceCleanup)console.error('reference-debt retained fixture root: '+JSON.stringify(root));
    throw new AggregateError(
      [...(bodyFailed?[primary]:[]),...errors],'reference-debt assertion or owned cleanup failed',
      bodyFailed?{cause:primary}:undefined);
  }
}

async function counts(f){
  const rows=(await readFile(join(f.registry.root,'providers',f.providerId,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  return {start:rows.filter(row=>row.event==='start').length,proof:rows.filter(row=>row.event==='proof').length};
}
function debt(view,handle){
  assert.deepEqual(view.handle,handle);assert.equal(view.published,null);assert.equal(view.verification.status,'unverified');
  assert.equal(view.ingress,null);assert.equal(view.state,'uncertain');
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
for(const kind of ['attached','session']) test(kind+' without operationId retains reference debt across a fresh factory',
    {timeout:30000},async()=>owned(async own=>{
    const f=await fixture(own);
    const apps=[];
    for(let i=0;i<3;i++){const server=await app();own.add(()=>server.close());apps.push(server);}
    const deps={manifest:f.registry.manifest,root:f.registry.root,identity:identity()};
    const normal=createRouteApi(deps),q=query(f.home,'owner',f.providerId,apps[0].target,kind);
    const offered=await candidate(normal,q),registryId=offered.consent.scope.registryId;
    const real=createEmbeddingServices({registryId,identity:deps.identity});
    let fail=false,failedHandle=null,failedReleases=0;
    own.beforeRoutes(()=>{fail=false;});
    const injected=new Proxy(real,{get(target,key){
      if(key==='releaseConfigurationUse')return async request=>{
        if(fail&&request.handle?.kind===failedHandle.kind&&request.handle?.id===failedHandle.id&&
            request.handle?.generation===failedHandle.generation){
          failedReleases++;throw new Error('injected exact metadata release unavailable');
        }
        return target.releaseConfigurationUse(request);
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    const api=createRouteApi({...deps,embeddingServices:injected});
      const first=await own.open(api,q);await echo(first.origin);
      // Owning-helper preparation precedes any removal. This is not a simulated close timeout.
      const statusRequest={home:f.home,owner:q.owner,handle:first.handle};
      const scope=await attachedCleanupReference(statusRequest,{registryId});
      assert.ok(scope,'actual bootstrap must bind the cleanup reference');
      await prepareCleanupReference(scope);
      const cleanupDir=join(scope.home,'reference-cleanup');
      const recordName=(await readdir(cleanupDir)).find(name=>/^[a-f0-9]{64}\.json$/.test(name));
      assert.ok(recordName);
      const recordPath=join(cleanupDir,recordName),recordBytes=await readFile(recordPath);
      const tempPath=recordPath+'.'+randomUUID()+'.tmp',tempBytes=Buffer.from('interrupted atomic output');
      await writeFile(tempPath,tempBytes,{flag:'wx',mode:0o600});
      own.beforeRoutes(()=>rm(tempPath,{force:true}));
      const preparedReader=createRouteApi(deps);
      const observed=await preparedReader.routeStatus(statusRequest);
      assert.deepEqual(observed.handle,first.handle);
      assert.equal(observed.verification.status,'verified');
      assert.equal(observed.published,first.published);
      const listed=(await preparedReader.listRoutes({home:f.home,owner:q.owner})).routes.find(row=>row.handle.id===first.handle.id);
      assert.deepEqual(listed.handle,first.handle);
      assert.equal(listed.verification.status,'verified');
      // Freshness must be witnessed before any sibling startup or reproof.
      assert.deepEqual(await counts(f),{start:1,proof:1});
      assert.deepEqual(await readFile(recordPath),recordBytes);
      assert.deepEqual(await readFile(tempPath),tempBytes);
      const malformedPath=join(cleanupDir,randomBytes(32).toString('hex')+'.json');
      await writeFile(malformedPath,'{}',{flag:'wx',mode:0o600});
      own.beforeRoutes(()=>rm(malformedPath,{force:true}));
      await assert.rejects(preparedReader.routeStatus(statusRequest),{code:'cleanup_debt'});
      await assert.rejects(preparedReader.listRoutes({home:f.home,owner:q.owner}),{code:'cleanup_debt'});
      assert.equal(await readFile(malformedPath,'utf8'),'{}');
      assert.deepEqual(await readFile(recordPath),recordBytes);
      assert.deepEqual(await readFile(tempPath),tempBytes);
      await rm(malformedPath);await rm(tempPath);
      const secondQ=query(f.home,q.owner,f.providerId,apps[1].target),second=await own.open(normal,secondQ);
      const foreignQ=query(f.home,'foreign-owner',f.providerId,apps[2].target),foreign=await own.open(normal,foreignQ);
      await echo(second.origin);await echo(foreign.origin);
      const before=await counts(f);assert.deepEqual(before,{start:3,proof:3});
      await echo(first.origin);await echo(foreign.origin);
      failedHandle=structuredClone(first.handle);fail=true;
      let pending;
      try{pending=await api.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'});}
      catch(error){pending=error.route;assert.equal(error.code,'cleanup_debt');}
      assert.equal(Object.hasOwn(q,'operationId'),false);
      debt(pending,first.handle);assert.ok(failedReleases>0,'exact release failure must be observed');
      await assert.rejects(echo(first.origin),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code),'the removed endpoint must not echo');
      let fresh=createRouteApi({...deps,embeddingServices:injected});
      debt((await fresh.listRoutes({home:f.home,owner:q.owner})).routes.find(row=>row.handle.id===first.handle.id),first.handle);
      debt(await fresh.routeStatus({home:f.home,owner:q.owner,handle:first.handle}),first.handle);
      await commitOracle(fresh,q,true);
      await assert.rejects(fresh.closeRoute({home:f.home,owner:'foreign-owner',handle:first.handle,mode:'remove'}),{code:'route_conflict'});
      await assert.rejects(fresh.closeRoute({home:f.home,owner:q.owner,handle:{...first.handle,generation:first.handle.generation+1},mode:'remove'}),{code:'route_conflict'});
      await commitOracle(fresh,q,true);
      const other=await fixture(own);
      const differentRegistry=createRouteApi({manifest:other.registry.manifest,root:other.registry.root,identity:identity()});
      await assert.rejects(differentRegistry.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'}),{code:'cleanup_debt'});
      await assert.rejects(fresh.closeRoute({home:other.home,owner:q.owner,handle:first.handle,mode:'remove'}),{code:kind==='attached'?'route_not_found':'cleanup_debt'});
      await commitOracle(fresh,q,true);
      await echo(second.origin);await echo(foreign.origin);
      assert.equal((await fresh.closeRoute({home:f.home,owner:q.owner,handle:second.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,q,true); // Now only the failed first reference can block this exact scope.
      debt((await fresh.listRoutes({home:f.home,owner:q.owner})).routes.find(row=>row.handle.id===first.handle.id),first.handle);
      const failuresBeforeRetry=failedReleases;
      let stillPending;
      try{stillPending=await fresh.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'});}
      catch(error){stillPending=error.route;assert.equal(error.code,'cleanup_debt');}
      debt(stillPending,first.handle);
      assert.ok(failedReleases>failuresBeforeRetry,'persistent exact release outage must still block retry');
      await commitOracle(fresh,q,true);
      fail=false;fresh=createRouteApi(deps);
      const released=await fresh.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'});
      assert.equal(released.cleanup.state,'confirmed');assert.deepEqual(released.handle,first.handle);
      assert.equal((await fresh.closeRoute({home:f.home,owner:q.owner,handle:first.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,q,false);
      await echo(foreign.origin);assert.deepEqual(await counts(f),before);
      await commitOracle(fresh,foreignQ,true);await echo(foreign.origin);
      assert.equal((await fresh.closeRoute({home:f.home,owner:'foreign-owner',handle:foreign.handle,mode:'remove'})).cleanup.state,'confirmed');
      await commitOracle(fresh,foreignQ,false);
  }));
