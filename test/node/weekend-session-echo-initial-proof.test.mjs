// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomUUID, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, lstat, readFile, writeFile, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

async function exchange(origin, bytes) {
  const endpoint=new URL(origin);
  return new Promise((resolve,reject)=>{
    const socket=net.connect(Number(endpoint.port),endpoint.hostname);
    const chunks=[];
    const timer=setTimeout(()=>socket.destroy(new Error('fixture exchange timeout')),3000);
    socket.once('connect',()=>socket.end(bytes));
    socket.on('data',chunk=>chunks.push(chunk));
    socket.once('error',error=>{clearTimeout(timer);reject(error);});
    socket.once('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks));});
  });
}
const events = async path => {
  try {return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
};

async function fixture(kind, fault, action) {
  const parent=join(homedir(),'.tmp');
  await mkdir(parent,{recursive:true,mode:0o700});
  const info=await lstat(parent);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink());
  assert.equal(info.mode&0o777,0o700);
  if(process.getuid)assert.equal(info.uid,process.getuid());
  const root=await mkdtemp(join(parent,'gozar-echo-initial-'));
  const home=join(root,'home'),owner='consumer-'+randomUUID();
  const ledger=join(root,'effects.jsonl'),observation=join(root,'observation.json');
  const identity={instanceId:randomUUID(),bootId:randomUUID()};
  let app,registry,api,route,clean=true;
  const sockets=new Set();
  try {
    app=net.createServer({allowHalfOpen:true},socket=>{
      sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
      socket.on('error',()=>{});socket.pipe(socket);
    });
    await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
    const target='127.0.0.1:'+app.address().port;
    const appOrigin='tcp://'+target;
    const payload=Buffer.concat([Buffer.from([0,255,128,13,10]),randomBytes(80)]);
    assert.deepEqual(await exchange(appOrigin,payload),payload);
    const id='echo-'+randomUUID();
    registry=await fakeRegistry({id,dir:join(root,'registry'),kinds:['attached','session'],
      reach:'this-device',transport:'tcp',protocols:[],proofProtocol:'echo'});
    const folder=join(registry.root,'providers',id);
    await writeFile(observation,JSON.stringify({costKind:'free'}));
    // This wrapper is the owned provider fixture, not controller state.
    // A wrong nonce is sent through the real verifier; receipt mutations are
    // adversarial provider responses and must never create usable publication.
    await writeFile(join(folder,'observed.mjs'),`
import provider from './index.mjs';
import {appendFileSync,readFileSync} from 'node:fs';
const cost=()=>JSON.parse(readFileSync(${JSON.stringify(observation)},'utf8')).costKind;
const mark=value=>appendFileSync(${JSON.stringify(ledger)},JSON.stringify(value)+'\\n');
const fault=${JSON.stringify(fault)};
export default {...provider,
 async detect(ctx){const r=await provider.detect(ctx);return {...r,facts:{...r.facts,fixtureCostKind:cost()}};},
 properties(facts){const p=provider.properties(facts);return {...p,cost:{...p.cost,kind:facts.fixtureCostKind}};},
 async runtimeFacts(...args){const r=await provider.runtimeFacts(...args);return {...r,properties:{...r.properties,cost:{...r.properties.cost,kind:cost()}}};},
 async prepareProof(ctx,request,attempt){
   const proof=await provider.prepareProof(ctx,request,attempt);
   mark({event:'prepare',refresh:typeof proof.refresh});
   return {...proof,async verify(input){
     const changed=fault==='wrong-nonce'?{...input,attempt:{...input.attempt,nonce:input.attempt.nonce[0]==='0'?'1'+input.attempt.nonce.slice(1):'0'+input.attempt.nonce.slice(1)}}:input;
     const checked=await proof.verify(changed);
     const result=fault==='wrong-endpoint'?{...checked,endpoint:'tcp://127.0.0.1:1'}:
       fault==='stale-attempt'?{...checked,attemptId:'previous-'+checked.attemptId}:checked;
     mark({event:'proof',status:checked.status,attemptMatches:result.attemptId===input.attempt.id,
       endpointMatches:result.endpoint===input.origin,checkedAt:checked.checkedAt});
     return result;
   }};
 },
 async create(ctx,plan){mark({event:'create',kind:plan.readback.kind,operationId:ctx.operationId});return provider.create(ctx,plan);},
 async remove(...args){const result=await provider.remove(...args);mark({event:'remove',removed:result.removed});return result;}
};
`);
    const manifest=structuredClone(registry.manifest);
    manifest.providers[0].module='providers/'+id+'/observed.mjs';
    api=createGozar({manifest,root:registry.root,identity});
    const query={schemaVersion:1,home,owner,providerId:id,target,
      usage:kind==='session'?{kind,lifetimeMs:120000}:{kind},
      requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',
        address:'any',setup:'allow',protocols:[]}};
    const candidate=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===id);
    assert.ok(candidate?.candidateToken,'real catalog must issue approval');
    const request={...query,operationId:randomUUID(),intent:'create',wait:'verified',
      approval:{kind:'route',candidateToken:candidate.candidateToken,
        disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest}};
    let failure;
    const started=Date.now();
    clean=false;
    try{route=await api.expose(request);}catch(error){failure=error;route=error.route;}
    const alreadyClosed=await action({api,home,route,failure,request,target,appOrigin,payload,identity,started,
      ledger,observation});
    if(alreadyClosed){route=null;clean=true;}
    if(route?.handle){
      const released=await api.closeRoute({home,handle:route.handle,mode:'remove'});
      assert.equal(released.cleanup.state,'confirmed');
      route=null;clean=true;
    }
    assert.deepEqual(await exchange(appOrigin,payload),payload,'foreign app survives cleanup');
  } finally {
    try {
      if(route?.handle){
        clean=false;
        const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});
        assert.equal(stopped.cleanup.state,'confirmed');clean=true;
      }
    } finally {
      for(const socket of sockets)socket.destroy();
      if(app)await new Promise(resolve=>app.close(resolve));
      // Preserve the isolated recovery directory if public cleanup was uncertain.
      if(clean){await registry?.cleanup();await rm(root,{recursive:true,force:true});}
    }
  }
}

for(const kind of ['attached','session']){
  test('initial-only echo forwards real '+kind+' bytes without reproof on drift',
    {timeout:180000},()=>fixture(kind,null,async f=>{
      assert.ifError(f.failure);
      const {api,home,route,request}=f;
      assert.equal(route.handle.kind,kind);assert.equal(route.handle.generation,1);
      assert.equal(route.verification.status,'verified');
      assert.equal(route.published,route.origin);
      assert.deepEqual(route.verification.subject,{
        origin:route.origin,target:f.target,...f.identity,handleGeneration:1,
      });
      assert.deepEqual(await exchange(route.origin,f.payload),f.payload);
      const handle=structuredClone(route.handle),expiry=structuredClone(route.expiresAt);
      if(kind==='session'){
        assert.equal(expiry.known,true);
        assert.ok(Date.parse(expiry.value)>=f.started+120000);
        assert.ok(Date.parse(expiry.value)<=Date.now()+120000);
      }
      const first=await events(f.ledger);
      assert.deepEqual(first.filter(e=>e.event==='create'),
        [{event:'create',kind,operationId:request.operationId}]);
      assert.deepEqual(first.filter(e=>e.event==='prepare'),[{event:'prepare',refresh:'undefined'}]);
      const proof=first.filter(e=>e.event==='proof');
      assert.equal(proof.length,1);
      assert.equal(proof[0].status,'verified');assert.equal(proof[0].attemptMatches,true);
      assert.equal(proof[0].endpointMatches,true);
      const replay=await api.expose(request);
      assert.deepEqual(replay.handle,handle);assert.deepEqual(replay.expiresAt,expiry);
      await assert.rejects(api.expose({...request,target:'127.0.0.1:1'}),{code:'operation_conflict'});
      await writeFile(f.observation,JSON.stringify({costKind:'paid'}));
      const withdrawn=await api.routeStatus({home,handle});
      assert.equal(withdrawn.published,null);assert.equal(withdrawn.verification.status,'unverified');
      assert.deepEqual(withdrawn.handle,handle);assert.deepEqual(withdrawn.expiresAt,expiry);
      await assert.rejects(api.reviewRouteConsent({home,handle}),{code:'proof_refresh_unsupported'});
      const still=await api.routeStatus({home,handle});
      assert.equal(still.published,null);assert.equal(still.verification.status,'unverified');
      assert.deepEqual(still.expiresAt,expiry);
      assert.deepEqual((await events(f.ledger)).filter(e=>e.event==='proof'),proof,'no refreshed or restamped proof');
      assert.deepEqual(await exchange(route.origin,f.payload),f.payload,'withdrawal does not retarget live stream');
      const stopped=await api.closeRoute({home,handle,mode:'remove'});
      assert.equal(stopped.cleanup.state,'confirmed');
      const terminal=await api.expose(request);
      assert.deepEqual(terminal.handle,handle);assert.equal(terminal.cleanup.state,'confirmed');
      await assert.rejects(exchange(route.origin,f.payload));
      const after=await events(f.ledger);
      assert.equal(after.filter(e=>e.event==='create').length,1);
      assert.deepEqual(after.filter(e=>e.event==='remove'),[{event:'remove',removed:true}]);
      return true;
    }));

  for(const fault of ['wrong-nonce','wrong-endpoint','stale-attempt'])
    test(kind+' rejects '+fault+' initial proof without publication',
      {timeout:180000},()=>fixture(kind,fault,async f=>{
        assert.ok(f.failure,'bad proof must reject expose');
        assert.ok(f.route?.handle,'failure must retain exact cleanup handle');
        assert.equal(f.route.handle.kind,kind);assert.equal(f.route.handle.generation,1);
        assert.equal(f.route.published,null);
        assert.notEqual(f.route.verification.status,'verified');
        const rows=await events(f.ledger),proof=rows.filter(e=>e.event==='proof');
        assert.equal(rows.filter(e=>e.event==='create').length,1);
        assert.equal(proof.length,1);
        if(fault==='wrong-nonce')assert.equal(proof[0].status,'unverified');
        if(fault==='wrong-endpoint')assert.equal(proof[0].endpointMatches,false);
        if(fault==='stale-attempt')assert.equal(proof[0].attemptMatches,false);
      }));
}
