// Bounded operation-journal tests. Effects are observed by a separate ledger;
// these do not claim provider integration, real publication or consent testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,mkdir,lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withRouteOperation,recordOperationView,startingRoute,recordPendingReferenceCleanup,retryRecordedReferenceCleanup,listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const missing=()=>Object.assign(new Error('Creator unavailable'),{code:'provider_unavailable'});
async function fixture(t){
 const parent=join(homedir(),'.tmp0700');
 try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const parentInfo=await lstat(parent);
 assert.ok(parentInfo.isDirectory()&&!parentInfo.isSymbolicLink());
 assert.equal(parentInfo.uid,process.getuid());assert.equal(parentInfo.mode&0o777,0o700);
 const home=await mkdtemp(join(parent,'op-')),original=await lstat(home);
 t.after(async()=>{
  const current=await lstat(home);
  assert.ok(current.isDirectory()&&!current.isSymbolicLink());
  assert.equal(current.uid,original.uid);assert.equal(current.mode&0o777,0o700);
  assert.equal(current.dev,original.dev);assert.equal(current.ino,original.ino);
  await rm(home,{recursive:true});
 });
 const request={home,owner:'operation-test-owner',operationId:randomUUID(),providerId:'ledger-fixture',
  target:'127.0.0.1:41237',usage:{kind:'attached'},requirements:{reach:'internet',transport:'https',protocols:['http']},approval:{}};
 const configuration={revision:1,scopeId:'fixture-scope'};
 const ledger=new Map(),allocations=[],removals=[],publications=[];
 const options={registryId:'fixture-registry',embeddingServices:{readConfiguration:async()=>({...configuration})}};
 const published=handle=>({...startingRoute(handle,request.target,request.operationId),state:'usable',routeState:'usable',
  origin:'https://operation.invalid',published:'https://operation.invalid',verification:{status:'verified',checkedAt:'2026-11-14T00:00:00.000Z',vantage:'fixture',checks:[]},cleanup:{state:'none'}});
 async function allocate(handle){
  // Observe the journal at the effect boundary, not merely the returned view.
  const entries=(await readdir(join(home,'operations'))).filter(n=>n.endsWith('.json'));
  assert.equal(entries.length,1);
  const durable=JSON.parse(await readFile(join(home,'operations',entries[0]),'utf8'));
  assert.deepEqual(durable.view.handle,handle);assert.equal(durable.phase,'starting');
  assert.equal(ledger.has(handle.id),false);allocations.push(structuredClone(handle));
  const view=published(handle);ledger.set(handle.id,view);publications.push(handle.id);return structuredClone(view);
 }
 const status=async({handle})=>{if(!ledger.has(handle.id))throw missing();return structuredClone(ledger.get(handle.id));};
 const invoke=(changes={},overrides={})=>withRouteOperation({...request,...changes},{...options,run:allocate,status,...overrides});
 async function stop(handle){
  assert.equal(ledger.has(handle.id),true);const old=ledger.get(handle.id);
  ledger.delete(handle.id);removals.push(handle.id);
  const view={...old,state:'released',routeState:'released',published:null,ingress:null,cleanup:{state:'confirmed'}};
  return recordOperationView({home,view,reference:{owner:request.owner,operationId:request.operationId}});
 }
 return {home,request,configuration,ledger,allocations,removals,publications,options,invoke,allocate,status,stop};
}

test('same canonical operation replays original handle; conflicting scope never allocates',async t=>{
 const f=await fixture(t),first=await f.invoke();
 const replay=await f.invoke({requirements:{protocols:['http'],transport:'https',reach:'internet'}});
 assert.deepEqual(replay.handle,first.handle);assert.equal(f.allocations.length,1);
 for(const changes of [
  {target:'127.0.0.1:41238'},{origin:'https://different.invalid'},
  {usage:{kind:'session',lifetimeMs:60000}},{requirements:{reach:'internet',transport:'https',protocols:['http','sse']}}
 ])await assert.rejects(f.invoke(changes),{code:'operation_conflict'});
 f.configuration.revision=2;
 await assert.rejects(f.invoke(),{code:'operation_conflict'});
 f.configuration.revision=1;f.configuration.scopeId='other-scope';
 await assert.rejects(f.invoke(),{code:'operation_conflict'});
 assert.equal(f.allocations.length,1);assert.equal(f.publications.length,1);
 assert.equal(f.removals.length,0);assert.equal(f.ledger.size,1);
});

test('overlapping opens and a fresh caller after allocation never allocate twice',async t=>{
 const f=await fixture(t),entered=deferred(),finish=deferred();
 const first=f.invoke({}, {run:async handle=>{const view=await f.allocate(handle);entered.resolve(view);await finish.promise;return view;}});
 const allocated=await Promise.race([entered.promise,first.then(()=>assert.fail('allocation barrier was not reached'))]);
 try{
  const overlaps=await Promise.all(Array.from({length:8},()=>f.invoke()));
  for(const replay of overlaps)assert.deepEqual(replay.handle,allocated.handle);
  // New dependency closures over the same durable home model a restarted caller.
  const replay=await withRouteOperation({...f.request},{...f.options,
   run:async()=>{assert.fail('restart must not allocate');},status:async()=>{throw missing();}});
  assert.deepEqual(replay.handle,allocated.handle);assert.equal(replay.state,'uncertain');
  assert.equal(replay.published,null);assert.equal(replay.cleanup.state,'unconfirmed');
  assert.equal(f.allocations.length,1);assert.equal(f.ledger.size,1);assert.equal(f.removals.length,0);
 }finally{finish.resolve();await first;}
});

test('completed allocation with missing creator retains uncertainty, not historical publication',async t=>{
 const f=await fixture(t),first=await f.invoke();
 const replay=await f.invoke({}, {status:async()=>{throw missing();}});
 assert.deepEqual(replay.handle,first.handle);assert.equal(replay.published,null);
 assert.equal(replay.state,'uncertain');assert.equal(replay.verification.status,'unverified');
 assert.equal(replay.cleanup.state,'unconfirmed');assert.equal(f.ledger.size,1);
 assert.equal(f.allocations.length,1);assert.equal(f.publications.length,1);assert.equal(f.removals.length,0);
});

test('terminal stop survives late allocating result and replay without consulting dead creator',async t=>{
 const f=await fixture(t),entered=deferred(),finish=deferred();
 const pending=f.invoke({}, {run:async handle=>{const view=await f.allocate(handle);entered.resolve(view);await finish.promise;return view;}});
 const allocated=await Promise.race([entered.promise,pending.then(()=>assert.fail('allocation barrier was not reached'))]);
 let terminal;
 try{terminal=await f.stop(allocated.handle);}finally{finish.resolve();}
 const late=await pending;
 assert.equal(late.state,'released');assert.equal(late.cleanup.state,'confirmed');assert.equal(late.published,null);
 const replay=await f.invoke({}, {status:async()=>assert.fail('terminal operation must not probe creator')});
 assert.deepEqual(replay,terminal);assert.equal(f.ledger.size,0);
 assert.equal(f.allocations.length,1);assert.equal(f.publications.length,1);
 assert.deepEqual(f.removals,[allocated.handle.id]);
});

test('error after allocation retains the original recovery handle and cannot be retried into a second effect',async t=>{
 const f=await fixture(t);let handle;
 await assert.rejects(f.invoke({}, {run:async reserved=>{handle=reserved;await f.allocate(reserved);throw missing();},status:async()=>{throw missing();}}),
  error=>error.code==='provider_unavailable'&&error.route.handle.id===handle.id&&error.route.cleanup.state==='unconfirmed');
 const replay=await f.invoke({}, {status:async()=>{throw missing();}});
 assert.deepEqual(replay.handle,handle);assert.equal(replay.published,null);
 assert.equal(replay.cleanup.state,'unconfirmed');assert.equal(f.allocations.length,1);
 assert.equal(f.publications.length,1);assert.equal(f.ledger.size,1);assert.equal(f.removals.length,0);
});

test('confirmed stop survives an error from the allocating caller',async t=>{
 const f=await fixture(t),entered=deferred(),finish=deferred();
 const pending=f.invoke({}, {run:async handle=>{
  const view=await f.allocate(handle);entered.resolve(view);await finish.promise;throw missing();
 }});
 // Attach a rejection observer before releasing the controlled error.
 const result=pending.then(view=>({view}),error=>({error}));
 const allocated=await entered.promise;
 let terminal;
 try{terminal=await f.stop(allocated.handle);}finally{finish.resolve();}
 const {error}=await result;
 assert.equal(error.code,'provider_unavailable');
 assert.deepEqual(error.route,terminal);
 const replay=await f.invoke({}, {status:async()=>assert.fail('confirmed Stop needs no creator')});
 assert.deepEqual(replay,terminal);
 assert.equal(f.allocations.length,1);assert.equal(f.ledger.size,0);
});

test('supplied wrong reference handle cannot mutate an exact same-generation operation',async t=>{
 const f=await fixture(t),first=await f.invoke();
 const entry=(await readdir(join(f.home,'operations'))).find(name=>name.endsWith('.json'));
 const path=join(f.home,'operations',entry),before=await readFile(path,'utf8');
 const terminal={...first,state:'released',routeState:'released',published:null,ingress:null,cleanup:{state:'confirmed'}};
 for(const handle of [
  {...first.handle,id:first.handle.id+'-other'},
  {...first.handle,generation:first.handle.generation+1},
  {...first.handle,kind:'session'},
 ]){
  await recordOperationView({home:f.home,view:terminal,
   reference:{owner:f.request.owner,operationId:f.request.operationId,handle}});
  assert.equal(await readFile(path,'utf8'),before,'mismatching supplied handle must leave journal unchanged');
 }
 assert.equal(f.ledger.size,1);assert.equal(f.removals.length,0);
 const stopped=await f.stop(first.handle);
 assert.equal(stopped.cleanup.state,'confirmed');
 const replay=await f.invoke({}, {status:async()=>assert.fail('terminal replay must not probe creator')});
 assert.deepEqual(replay,stopped);assert.equal(f.allocations.length,1);
});

for(const lateFailure of [false,true])test('pending reference debt dominates ordinary writes and late allocation '+(lateFailure?'error':'result'),{timeout:10000},async t=>{
 const f=await fixture(t),entered=deferred(),finish=deferred();
 const pending=f.invoke({}, {run:async handle=>{
  const view=await f.allocate(handle);entered.resolve(view);await finish.promise;
  if(lateFailure)throw missing();return view;
 }});
 const settled=pending.then(view=>({view}),error=>({error}));
 const replayEntered=deferred(),replayFinish=deferred();let replaySettled;
 try{
 const allocated=await Promise.race([entered.promise,settled.then(()=>assert.fail('allocation barrier not reached'))]);
 const replay=f.invoke({}, {status:async()=>{
  replayEntered.resolve();await replayFinish.promise;return allocated;
 }});
 replaySettled=replay.then(view=>({view}),error=>({error}));
 await Promise.race([replayEntered.promise,replaySettled.then(()=>assert.fail('replay barrier not reached'))]);
 // This fixture ledger owns the removal observation; no real-provider claim.
 assert.equal(f.ledger.delete(allocated.handle.id),true);f.removals.push(allocated.handle.id);
 const removed={...allocated,state:'released',routeState:'released',published:null,ingress:null,cleanup:{state:'confirmed'}};
 const reference={owner:f.request.owner,operationId:f.request.operationId,handle:allocated.handle};
 const debt=await recordPendingReferenceCleanup({home:f.home,view:removed,reference});
 const assertDebt=view=>{
  assert.deepEqual(view.handle,allocated.handle);assert.equal(view.operationId,f.request.operationId);
  assert.equal(view.published,null);assert.equal(view.verification.status,'unverified');
  assert.equal(view.cleanup.state,'unconfirmed');assert.equal(view.cleanup.nextAction.kind,'instructions');
  assert.equal(view.cleanup.nextAction.id,'retry-reference-release');assert.equal(view.state,'uncertain');
 };
 assertDebt(debt);
 const entry=(await readdir(join(f.home,'operations'))).find(name=>name.endsWith('.json'));
 const journal=async()=>JSON.parse(await readFile(join(f.home,'operations',entry),'utf8'));
 const milestone=(await journal()).referenceCleanup;assert.ok(milestone);
 for(const supplied of [reference,{owner:reference.owner,operationId:reference.operationId}]){
  assertDebt(await recordOperationView({home:f.home,view:removed,reference:supplied}));
  assert.deepEqual((await journal()).referenceCleanup,milestone);
  assert.equal((await journal()).phase,'recovery');
 }
 assertDebt(await f.invoke({}, {status:async()=>allocated}));
 replayFinish.resolve();
 const replayResult=await replaySettled;assert.equal(replayResult.error,undefined);
 assertDebt(replayResult.view);
 finish.resolve();
 const result=await settled;
 if(lateFailure){assert.equal(result.error.code,'provider_unavailable');assertDebt(result.error.route);}
 else assertDebt(result.view);
 assert.deepEqual((await journal()).referenceCleanup,milestone);
 assertDebt((await listRecordedRoutes({home:f.home,owner:f.request.owner})).routes[0]);
 let fail=true,releases=0;
 const runtime={registryId:f.options.registryId,embeddingServices:{releaseConfigurationUse:async scope=>{
  assert.deepEqual(scope,{home:f.home,owner:f.request.owner,providerId:f.request.providerId,handle:allocated.handle});
  releases++;if(fail)throw new Error('controlled metadata outage');
 }}};
 await assert.rejects(retryRecordedReferenceCleanup({home:f.home,handle:allocated.handle},runtime),error=>{
  assert.equal(error.code,'cleanup_debt');assertDebt(error.route);return true;
 });
 assert.deepEqual((await journal()).referenceCleanup,milestone);
 fail=false;
 const stopped=await retryRecordedReferenceCleanup({home:f.home,handle:allocated.handle},runtime);
 assert.equal(stopped.cleanup.state,'confirmed');assert.equal(stopped.state,'released');
 assert.equal(Object.hasOwn(await journal(),'referenceCleanup'),false);
 assert.equal((await journal()).phase,'terminal');assert.equal(releases,2);
 assert.deepEqual(await f.invoke({}, {status:async()=>assert.fail('terminal replay must not probe')}),stopped);
 assert.equal(f.allocations.length,1);assert.equal(f.publications.length,1);
 assert.equal(f.ledger.size,0);assert.deepEqual(f.removals,[allocated.handle.id]);
 }finally{replayFinish.resolve();finish.resolve();await settled;if(replaySettled)await replaySettled;}
});
