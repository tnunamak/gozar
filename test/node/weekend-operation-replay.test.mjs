// Bounded operation-journal tests. Effects are observed by a separate ledger;
// these do not claim provider integration, real publication or consent testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {withRouteOperation,recordOperationView,startingRoute} from '../../packages/gozar-node/route-operations.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const missing=()=>Object.assign(new Error('Creator unavailable'),{code:'provider_unavailable'});
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'gozar-operation-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
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
