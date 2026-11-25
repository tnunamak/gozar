import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {access,mkdir,mkdtemp,lstat,readFile,rename,rm,readdir,writeFile} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {createGozar} from '../../packages/gozar-node/api.mjs';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {observeAttachedRoute,controlAttached,attachedCleanupReference} from '../../packages/gozar-node/attached-route.mjs';
import {projectControllerObservation} from '../../packages/gozar-node/route-view.mjs';
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
    await registry?.cleanup();
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

const unpublished=view=>{assert.equal(view.published,null);assert.equal(view.verification.status,'unverified');};
for(const kind of ['attached','session'])test(kind+' private observation preserves real proof without refreshing',
  {timeout:30000},()=>owned(async own=>{
    const f=await fixture(own),server=await app();own.add(()=>server.close());
    const deps={manifest:f.registry.manifest,root:f.registry.root,identity:identity()};
    const api=createRouteApi(deps),q=query(f.home,'owner',f.providerId,server.target,kind);
    const first=await own.open(api,q);await echo(first.origin);
    const request={home:f.home,owner:q.owner,handle:first.handle};
    const before=await counts(f);
    const observed=await observeAttachedRoute(request),again=await observeAttachedRoute(request);
    for(const view of [observed,again]){
      assert.deepEqual(view.handle,first.handle);assert.equal(view.published,first.published);
      assert.deepEqual(view.verification,first.verification);
      assert.deepEqual(view.expiresAt,first.expiresAt);
      assert.deepEqual(view.consentFactsDigest,first.consentFactsDigest);
      assert.deepEqual(view.limits,first.limits);
    }
    assert.deepEqual(await counts(f),before,'no extra create/proof through observation');
    await echo(first.origin);
    await assert.rejects(observeAttachedRoute({...request,owner:'foreign-owner'}),{code:'route_conflict'});
    await assert.rejects(observeAttachedRoute({...request,handle:{...first.handle,generation:first.handle.generation+1}}),{code:'route_conflict'});
    const directory=join(f.home,kind==='attached'?'attached':'',kind==='attached'?first.handle.id:first.handle.id.split(':')[0]);
    await assert.rejects(controlAttached(directory,{type:'observe',handleId:first.handle.id,handleKind:kind==='attached'?'session':'attached',generation:first.handle.generation}),{code:'route_conflict'});
    await assert.rejects(controlAttached(directory,{type:'observe',handleId:first.handle.id+'-wrong',handleKind:kind,generation:first.handle.generation}),{code:'route_conflict'});
    await assert.rejects(controlAttached(directory,{type:'observe'}),{code:'route_conflict'});
    assert.deepEqual(await counts(f),before);

    // Owning pure boundary: use genuine live proof, not a fabricated verified result.
    // Controlled time/state here is unit evidence, not evidence that IPC expired a route.
    const now=Date.parse(first.verification.checkedAt);
    const current={now,lastBeat:now,expiryMs:20000,heartbeat:kind==='attached',
      expiresAtMs:kind==='session'?Date.parse(first.expiresAt.value):null,
      initialSettled:true,identity:deps.identity};
    const original=structuredClone(first);
    assert.deepEqual(projectControllerObservation(first,current),first);
    for(const state of [
      {...current,initialSettled:false},{...current,failure:{code:'verification_failed'}},
      {...current,releasing:true},{...current,resolverLost:true},{...current,resourceRemoval:{}},
      {...current,identity:{instanceId:'other',bootId:'other'}},
      {...current,heartbeat:true,lastBeat:now-20001},
      {...current,expiresAtMs:now},
      {...current,now:Date.parse(first.verification.validUntil.value)}
    ]){
      const projected=projectControllerObservation(first,state);unpublished(projected);
      assert.deepEqual(projected.handle,first.handle);
      assert.equal(projected.verification.checkedAt,first.verification.checkedAt);
      assert.deepEqual(projected.verification.subject,first.verification.subject);
      assert.deepEqual(projected.verification.validUntil,first.verification.validUntil);
      assert.deepEqual(projected.expiresAt,first.expiresAt);
      assert.notEqual(projected.cleanup.state,'confirmed','projection cannot manufacture removal');
    }
    assert.deepEqual(first,original,'projection does not mutate original evidence');
    await echo(first.origin);assert.deepEqual(await counts(f),before);
    // Real close shuts down this exact controller, without killing unrelated processes.
    const closed=await api.closeRoute({...request,mode:'remove'});
    assert.equal(closed.cleanup.state,'confirmed');
    // Socket disappearance cannot itself mint physical-cleanup evidence.
    const deadline=Date.now()+3000;
    let dead;
    do {
      dead=await observeAttachedRoute(request);
      if(dead.cleanup.state==='unconfirmed')break;
      await new Promise(resolve=>setTimeout(resolve,50));
    } while(Date.now()<deadline);
    unpublished(dead);
    assert.equal(dead.cleanup.state,'unconfirmed');
  }));

async function waitForFixture(check, label, timeout=10000){
  const until=Date.now()+timeout;
  do {
    const value=await check();
    if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,25));
  } while(Date.now()<until);
  throw new Error('Timed out waiting for '+label);
}
const fileExists=path=>access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});

test('lost generic session caller leaves one public handle and Stop fences a held proof',
  {timeout:45000},()=>owned(async own=>{
    const f=await fixture(own),server=await app();own.add(()=>server.close());
    const provider=join(f.registry.root,'providers',f.providerId);
    await rename(join(provider,'index.mjs'),join(provider,'fixture-original.mjs'));
    const ready=join(f.root,'proof-held'),release=join(f.root,'release-proof');
    const returned=join(f.root,'proof-returned'),aborted=join(f.root,'proof-aborted');
    const stopGate=()=>writeFile(release,'release');
    await writeFile(join(provider,'index.mjs'),`
import original from './fixture-original.mjs';
import {access,writeFile} from 'node:fs/promises';
export default {...original, async prepareProof(ctx, request, attempt){
  const proof=await original.prepareProof(ctx,request,attempt);
  return {...proof, async verify(input){
    const verified=await proof.verify(input);
    if(verified.status!=='verified')throw new Error('owned echo did not verify');
    const recordAbort=()=>writeFile(${JSON.stringify(aborted)},'aborted');
    const onAbort=()=>{void recordAbort().catch(()=>{});};
    if(attempt.signal.aborted)await recordAbort();
    else attempt.signal.addEventListener('abort',onAbort,{once:true});
    try{
      await writeFile(${JSON.stringify(ready)},'held');
      const until=Date.now()+15000;
      do {
        if(await access(${JSON.stringify(release)}).then(()=>true,()=>false)){
          await writeFile(${JSON.stringify(returned)},'returned');
          return verified;
        }
        await new Promise(resolve=>setTimeout(resolve,25));
      } while(Date.now()<until);
      throw new Error('fixture proof was not released');
    } finally {attempt.signal.removeEventListener('abort',onAbort);}
  }};
}};
`);
    const q={...query(f.home,'owner',f.providerId,server.target,'session'),operationId:randomUUID()};
    const deps={manifest:f.registry.manifest,root:f.registry.root};
    const api=createGozar(deps);
    const retained=async()=>(await api.listRoutes({home:q.home,owner:q.owner})).routes
      .filter(route=>route.operationId===q.operationId);
    let closePromise;
    // Always unblock the fixture, then recover and close only its own exact handle.
    own.beforeRoutes(async()=>{
      await stopGate();
      if(closePromise)await closePromise.catch(()=>{});
      const rows=await retained();
      assert.ok(rows.length<=1,'never clean up unrelated or ambiguous routes');
      if(rows[0]&&rows[0].cleanup.state!=='confirmed'){
        const closed=await api.closeRoute({home:q.home,handle:rows[0].handle,mode:'remove'});
        assert.equal(closed.cleanup.state,'confirmed');
      }
    });

    const childFile=join(f.root,'caller.mjs');
    const moduleUrl=new URL('../../packages/gozar-node/api.mjs',import.meta.url).href;
    await writeFile(childFile,`
import {createGozar} from ${JSON.stringify(moduleUrl)};
const deps=${JSON.stringify(deps)},query=${JSON.stringify(q)};
const api=createGozar({...deps,async acknowledgeOrigin({origin,handle,attemptId}){
  if(new URL(origin).hostname!=='127.0.0.1')throw new Error('nonfixture origin');
  return {acknowledged:true,origin,handle:{id:handle.id,generation:handle.generation},attemptId};
}});
const selected=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===query.providerId);
if(!selected?.candidateToken)throw new Error('fixture candidate unavailable');
await api.expose({...query,wait:'verified',approval:{kind:'route',candidateToken:selected.candidateToken,
  consentFactsDigest:selected.consentFactsDigest,disclosureRevision:selected.disclosure.revision}});
`);
    const child=spawn(process.execPath,[childFile],{stdio:'ignore'});
    const exited=new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
    });
    void exited.catch(()=>{});
    const callerPid=child.pid;
    const killOwnedCaller=()=>{
      if(child.exitCode===null&&child.signalCode===null&&Number.isSafeInteger(callerPid)&&callerPid>1){
        assert.equal(child.pid,callerPid,'only the saved child PID may be signalled');
        child.kill('SIGKILL');
      }
    };
    own.beforeRoutes(async()=>{killOwnedCaller();await exited;});
    await waitForFixture(()=>fileExists(ready),'held genuine echo proof');
    assert.equal(child.exitCode,null,'caller must still be waiting');
    assert.ok(Number.isSafeInteger(callerPid)&&callerPid>1);
    killOwnedCaller();
    assert.equal((await exited).signal,'SIGKILL');

    const rows=await waitForFixture(async()=>{const current=await retained();return current.length?current:null;},'retained operation');
    assert.equal(rows.length,1);assert.equal(rows[0].handle.kind,'session');
    const {handle}=rows[0];unpublished(rows[0]);
    assert.equal(await fileExists(returned),false,'proof must not complete before Stop');
    closePromise=api.closeRoute({home:q.home,handle,mode:'remove'});
    void closePromise.catch(()=>{});
    await waitForFixture(()=>fileExists(aborted),'proof authority abortion');
    await stopGate();
    await waitForFixture(()=>fileExists(returned),'late proof return');
    const closed=await closePromise;
    assert.deepEqual(closed.handle,handle);unpublished(closed);
    assert.equal(closed.cleanup.state,'confirmed');
    const after=await retained();
    assert.ok(after.length<=1);
    if(after[0]){assert.deepEqual(after[0].handle,handle);unpublished(after[0]);}
    assert.equal((await counts(f)).start,1,'recovery and Stop must not start another operation');
  }));
