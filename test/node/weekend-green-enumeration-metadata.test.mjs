import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdir, mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import * as attached from '../../packages/gozar-node/attached-route.mjs';
import {cleanupReferenceRecord} from '../../packages/gozar-node/route-operations.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clocks=v=>structuredClone({subject:v.verification.subject,checkedAt:v.verification.checkedAt,validUntil:v.verification.validUntil});
async function digests(root){
  const rows=[];
  async function walk(dir){for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const p=join(dir,e.name);if(e.isDirectory())await walk(p);
    else if(e.isFile())rows.push([p,createHash('sha256').update(await readFile(p)).digest('hex')]);
  }}
  await walk(root);return rows;
}
function echo(url){
  const u=new URL(url);
  return new Promise((resolve,reject)=>{
    const s=net.createConnection({host:u.hostname,port:Number(u.port)});let bytes='';
    const finish=(error)=>{s.destroy();error?reject(error):resolve();};
    s.setTimeout(3000,()=>finish(new Error('owned echo timed out')));
    s.once('error',finish);s.once('connect',()=>s.write('owned-witness'));
    s.on('data',chunk=>{bytes+=chunk;if(bytes==='owned-witness')finish();});
    s.once('end',()=>{if(bytes!=='owned-witness')finish(new Error('incomplete owned echo'));});
  });
}

async function bounded(work,label,ms=5000){
  let timer;
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]);}
  finally{clearTimeout(timer);}
}
function referenceDebt(view){
  assert.equal(view.cleanup?.state,'unconfirmed');
  const action=view.cleanup.nextAction;
  assert.equal(action?.id,'retry-reference-release');
  assert.equal(action.kind,'instructions');
  assert.ok(typeof action.instructions==='string'&&action.instructions.trim().length>0);
  assert.match(action.instructions,/closeRoute/);assert.match(action.instructions,/handle/);assert.match(action.instructions,/remove/);
  assert.match(action.digest,/^sha256:[a-f0-9]{64}$/);
}
async function cleanupFixture(f,{gate,sockets,app,timeoutMs=5000}){
  const errors=[];f.hold=false;gate.resolve();f.fault=false;
  let safe=!f.uncertain;
  const attempt=async(label,work)=>{try{return await bounded(Promise.resolve().then(work),label,timeoutMs);}
    catch(error){errors.push(error);return undefined;}};
  if(f.pending){
    try{const outcome=await bounded(f.pending,'pending close',timeoutMs);
      if(outcome?.error&&outcome.error.code!=='cleanup_debt')errors.push(outcome.error);
    }catch(error){safe=false;errors.push(error);}
  }
  if(safe)for(const route of f.routes){
    try{
      const v=await bounded(f.api.closeRoute({home:f.home,owner:f.owner,handle:route.handle,mode:'remove'}),'teardown close',timeoutMs);
      assert.equal(v.cleanup.state,'confirmed');
    }catch(error){errors.push(error);safe=false;break;}
  }
  // These resources are independent of an unsettled owned-route close.
  if(f.foreign)await attempt('foreign hold release',()=>f.real.releaseConfigurationUse(f.foreign));
  for(const socket of sockets)try{socket.destroy();}catch(error){errors.push(error);}
  if(app.listening)await attempt('owned server close',()=>new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())));
  if(f.uncertain)errors.push(new Error('An expose failed without settled allocation recovery'));
  if(safe&&!errors.length){
    await attempt('registry cleanup',()=>f.registry?.cleanup());
    if(!errors.length)await attempt('recovery home removal',()=>rm(f.home,{recursive:true}));
  }
  if(errors.length)throw new AggregateError(errors,'Cleanup uncertain; retained recovery home '+f.home);
}

async function fixture(t){
  await mkdir(join(homedir(),'.tmp'),{recursive:true});
  const home=await mkdtemp(join(homedir(),'.tmp','gm-'));
  const f={home,owner:'metadata-owner',providerId:'unknown-metadata-provider',routes:[],fault:false,releases:0,hold:false};
  const sockets=new Set(),gate=deferred(),entered=deferred();Object.assign(f,{gate,entered});
  const app=net.createServer(s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>{});s.pipe(s);});
  t.after(()=>cleanupFixture(f,{gate,sockets,app}));
  await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
  f.target='127.0.0.1:'+app.address().port;
  f.registry=await fakeRegistry({id:f.providerId,dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
  f.query={schemaVersion:1,home,owner:f.owner,providerId:f.providerId,target:f.target,usage:{kind:'attached'},
    requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const initial=createRouteApi({...f.registry});
  const catalog=await initial.catalogRoutes(f.query),candidate=catalog.candidates.find(c=>c.providerId===f.providerId);
  assert.ok(candidate);f.registryId=candidate.consent.scope.registryId;
  f.real=createEmbeddingServices({registryId:f.registryId});
  const service=new Proxy(f.real,{get(target,key){
    if(key==='releaseConfigurationUse')return async r=>{
      f.releases++;
      if(f.fault&&r.home===home&&r.owner===f.owner&&r.providerId===f.providerId&&same(r.handle,f.exact))
        throw Object.assign(new Error('owned release fault'),{code:'secret_backend_unavailable'});
      return target.releaseConfigurationUse(r);
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const wrapper=async(request,deps)=>{
    if(f.hold&&request.home===home&&request.owner===f.owner&&same(request.handle,f.exact)){f.hold=false;entered.resolve();await gate.promise;}
    return attached.closeAttachedRoute(request,deps);
  };
  f.factory=()=>createRouteApi({...f.registry,embeddingServices:service,view:{attached:{...attached,closeAttachedRoute:wrapper}}});
  f.api=f.factory();
  f.startClose=(request,api=f.api)=>(f.pending=api.closeRoute(request).then(value=>({value}),error=>({error})));
  f.close=async(request,api=f.api)=>{
    const outcome=await bounded(f.startClose(request,api),'route close');
    if(outcome.error)throw outcome.error;return outcome.value;
  };
  f.open=async(operationId)=>{
    const query={...f.query,...(operationId===undefined?{}:{operationId})};
    const c=(await f.api.catalogRoutes(query)).candidates.find(c=>c.providerId===f.providerId);assert.ok(c);
    const authority=Object.fromEntries(Object.entries(c).filter(([name])=>['candidateToken','consentFactsDigest'].includes(name)));
    assert.ok(typeof authority['candidateToken']==='string'&&authority['candidateToken'].length>0);
    try{const v=await bounded(f.api.expose({...query,wait:'verified',approval:{...authority,kind:'route',
      disclosureRevision:c.disclosure.revision}}),'fixture expose');f.routes.push(v);return v;}
    catch(e){if(e.route?.handle)f.routes.push(e.route);else f.uncertain=true;throw e;}
  };
  f.events=async()=>Buffer.from(await readFile(join(f.registry.root,'providers',f.providerId,'events.jsonl')));
  f.counts=async()=>{const rows=(await f.events()).toString('utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
    return Object.fromEntries(['start','proof','stop','cleanup'].map(event=>[event,rows.filter(r=>r.event===event).length]));};
  f.list=async(api,route,inspect)=>{
    const before=await digests(home),events=await f.events(),releases=f.releases;
    const rows=(await bounded(api.listRoutes({home,owner:f.owner}),'retained enumeration')).routes;
    const found=rows.filter(v=>same(v.handle,route.handle));assert.equal(found.length,1);inspect(found[0]);
    assert.deepEqual(await digests(home),before);assert.deepEqual(await f.events(),events);assert.equal(f.releases,releases);
  };
  f.draft=async(owner)=>{
    const scope={home,owner,providerId:f.providerId},c=await f.real.readConfiguration(scope);
    const d=await f.real.beginConfigurationDraft({...scope,expectedConfigurationRevision:c.revision});
    return {...scope,draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision};
  };
  return f;
}
function liveEvidence(route,f){
  assert.equal(route.verification.status,'verified');assert.equal(typeof route.published,'string');assert.ok(route.published);
  assert.ok(route.verification.subject);const s=route.verification.subject;
  assert.equal(s.origin,route.origin);assert.equal(s.target,f.target);assert.equal(s.handleGeneration,route.handle.generation);
  for(const key of ['instanceId','bootId'])assert.ok(typeof s[key]==='string'&&s[key]);
  assert.ok(Number.isFinite(Date.parse(route.verification.checkedAt)));
  assert.equal(route.verification.validUntil.known,true);assert.ok(Number.isFinite(Date.parse(route.verification.validUntil.value)));
  return clocks(route);
}

test('reference debt oracle rejects confirmed cleanup and missing retry independently',()=>{
  const debt={cleanup:{state:'unconfirmed',nextAction:{id:'retry-reference-release',kind:'instructions',
    instructions:'Call closeRoute with the exact retained handle and mode remove.',digest:'sha256:'+'a'.repeat(64)}}};
  referenceDebt(debt);
  const confirmed=structuredClone(debt);confirmed.cleanup.state='confirmed';
  assert.throws(()=>referenceDebt(confirmed),assert.AssertionError);
  const missing=structuredClone(debt);delete missing.cleanup.nextAction;
  assert.throws(()=>referenceDebt(missing),assert.AssertionError);
});

test('unsettled close cannot block independent teardown or erase recovery evidence',async()=>{
  const calls=[],gate=deferred(),f={home:'/retained-fixture',hold:true,fault:true,pending:new Promise(()=>{}),
    routes:[{handle:{}}],api:{closeRoute:()=>{calls.push('unsafe-close');}},
    foreign:{},real:{releaseConfigurationUse:async()=>{calls.push('foreign');}},
    registry:{cleanup:async()=>{calls.push('unsafe-registry');}}};
  const sockets=new Set([{destroy:()=>calls.push('socket')}]);
  const app={listening:true,close:callback=>{calls.push('server');callback();}};
  await assert.rejects(bounded(cleanupFixture(f,{gate,sockets,app,timeoutMs:10}),'teardown oracle',1000),
    error=>error instanceof AggregateError&&error.errors.some(e=>/pending close/.test(e.message)));
  await bounded(gate.promise,'released fixture gate',100);
  assert.deepEqual(calls,['foreign','socket','server']);
});


test('enumeration is inert across prepared, resource-removed and terminal metadata',async t=>{
  const f=await fixture(t),route=await f.open(),proof=liveEvidence(route,f);
  assert.equal(route.operationId,null);f.exact=route.handle;
  const request={home:f.home,owner:f.owner,handle:route.handle,mode:'remove'};
  const record=()=>cleanupReferenceRecord(request,{registryId:f.registryId});
  await echo(route.origin);
  const draft=await f.draft(f.owner),foreignOwner='other-owner',foreign=await f.real.readConfiguration({home:f.home,owner:foreignOwner,providerId:f.providerId});
  f.foreign={home:f.home,owner:foreignOwner,providerId:f.providerId,revision:foreign.revision,handle:{kind:'attached',id:'owned-foreign-reservation',generation:1}};
  await f.real.registerConfigurationUse(f.foreign);
  const foreignDraft=await f.draft(foreignOwner);
  const initialEvents=await f.events();assert.deepEqual(await f.counts(),{start:1,proof:1,stop:0,cleanup:0});
  f.fault=true;f.hold=true;
  f.startClose(request);
  try{
  await bounded(Promise.race([f.entered.promise,f.pending.then(()=>{throw new Error('close ended before preparation barrier');})]),'preparation barrier');
  const prepared=await bounded(record(),'prepared record');assert.equal(prepared.phase,'prepared');assert.deepEqual(await f.events(),initialEvents);
  assert.deepEqual(prepared.scope,{home:f.home,owner:f.owner,providerId:f.providerId,registryId:f.registryId,handle:route.handle});
  for(let i=0;i<2;i++)await f.list(f.api,route,v=>{
    assert.equal(v.operationId,null);assert.equal(v.origin,route.origin);assert.deepEqual(clocks(v),proof);
    if(Date.now()<Date.parse(proof.validUntil.value)){assert.equal(v.verification.status,'verified');assert.equal(v.published,route.published);}
  });
  assert.equal((await bounded(record(),'prepared record')).phase,'prepared');await echo(route.origin);
  }finally{f.gate.resolve();}
  const outcome=await bounded(f.pending,'failed reference close');assert.equal(outcome.error?.code,'cleanup_debt');
  assert.deepEqual(outcome.error.route.handle,route.handle);assert.equal(outcome.error.route.operationId,null);
  assert.equal((await record()).phase,'resource-removed');
  await assert.rejects(echo(route.origin),{code:'ECONNREFUSED'});await echo('tcp://'+f.target);
  const removed=await f.counts();assert.deepEqual(removed,{start:1,proof:1,stop:1,cleanup:1});
  const removedEvidence=v=>{assert.equal(v.operationId,null);assert.equal(v.verification.status,'unverified');assert.equal(v.published,null);assert.deepEqual(clocks(v),proof);};
  const debt=v=>{removedEvidence(v);referenceDebt(v);};
  debt(outcome.error.route);
  for(const api of [f.api,f.factory()])for(let i=0;i<2;i++)await f.list(api,route,debt);
  await assert.rejects(f.real.commitConfigurationDraft(draft),{code:'configuration_in_use'});
  await assert.rejects(f.real.commitConfigurationDraft(foreignDraft),{code:'configuration_in_use'});
  f.fault=false;const terminal=await f.close(request);assert.equal(terminal.cleanup.state,'confirmed');
  await f.real.commitConfigurationDraft(draft);assert.equal((await record()).phase,'terminal');
  for(const api of [f.api,f.factory()])await f.list(api,route,v=>{removedEvidence(v);assert.equal(v.cleanup.state,'confirmed');});
  assert.deepEqual(await f.counts(),removed);
  await assert.rejects(f.real.commitConfigurationDraft(foreignDraft),{code:'configuration_in_use'});
  await echo('tcp://'+f.target);
});

test('operation-bound enumeration and recovery preserve operation identity without a second removal',async t=>{
  const f=await fixture(t),operationId='owned-metadata-operation',route=await f.open(operationId);
  liveEvidence(route,f);f.exact=route.handle;assert.equal(route.operationId,operationId);await echo(route.origin);
  const request={home:f.home,owner:f.owner,handle:route.handle,mode:'remove'};
  for(const api of [f.api,f.factory()])await f.list(api,route,v=>assert.equal(v.operationId,operationId));
  const closed=await f.close(request);assert.deepEqual(closed.handle,route.handle);
  assert.equal(closed.operationId,operationId);assert.equal(closed.cleanup.state,'confirmed');
  assert.equal(await cleanupReferenceRecord(request,{registryId:f.registryId}),null);
  const counts=await f.counts();assert.deepEqual(counts,{start:1,proof:1,stop:1,cleanup:1});
  for(const api of [f.api,f.factory()])await f.list(api,route,v=>{
    assert.equal(v.operationId,operationId);assert.equal(v.cleanup.state,'confirmed');assert.equal(v.published,null);
  });
  const retried=await f.close(request,f.factory());assert.deepEqual(retried.handle,route.handle);
  assert.equal(retried.operationId,operationId);assert.equal(retried.cleanup.state,'confirmed');
  assert.deepEqual(await f.counts(),counts);await echo('tcp://'+f.target);
});
