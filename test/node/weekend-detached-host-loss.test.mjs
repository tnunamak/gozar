import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readdir,readFile,rm,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const approval=candidate=>({...Object.fromEntries(Object.entries(candidate).filter(([key])=>
  ['candidateToken','consentFactsDigest'].includes(key))),kind:'route',disclosureRevision:candidate.disclosure.revision});
const wire=message=>new Promise((resolve,reject)=>process.send(message,error=>error?reject(error):resolve()));
const safeError=error=>({code:error?.code??'fixture_error',message:String(error?.message??'fixture failed')});

// The child is this in-package file, not an externally generated module.
async function hostChild() {
  const pending=new Map();
  let initialize;
  const initialized=new Promise(resolve=>{initialize=resolve;});
  process.on('message',message=>{
    if(message.type==='initialize')initialize(message);
    if(message.type==='backend-result'){
      const waiter=pending.get(message.id);if(!waiter)return;
      pending.delete(message.id);message.error?waiter.reject(Object.assign(new Error(message.error.message),message.error)):waiter.resolve(message.value);
    }
  });
  const rpc=(method,request)=>new Promise((resolve,reject)=>{
    const id=randomUUID();pending.set(id,{resolve,reject});
    process.send({type:'backend',id,method,request},error=>{if(error){pending.delete(id);reject(error);}});
  });
  const backend={
    put:request=>rpc('put',request),
    presence:request=>rpc('presence',request),
    delete:request=>rpc('delete',request),
    withSecret:async(request,use)=>use(new Uint8Array(await rpc('read',request))),
  };
  const input=await initialized;
  const api=createGozar({...input.registry,secretBackend:backend,identity:input.identity});
  const query=input.queries[0];
  const candidate=(await api.catalogRoutes(query)).candidates[0];
  const configuration=candidate.configuration, requirement=configuration.inputRequirements[0];
  assert.ok(requirement,'fixture declares a credential requirement');
  const stored=await api.storeSecret({home:query.home,owner:query.owner,providerId:query.providerId,
    inputId:requirement.id,scopeId:configuration.scopeId,expectedConfigurationRevision:configuration.revision,
    bytes:new Uint8Array(input.canary)});
  const current=(await api.catalogRoutes(query)).candidates[0].configuration;
  const action=current.actions.find(value=>value.id===requirement.actionId)??current.actions[0];
  assert.ok(action,'current setup action exists');
  await api.runSetupAction({home:query.home,owner:query.owner,providerId:query.providerId,actionId:action.id,
    expectedConfigurationRevision:current.revision,secretHandle:stored.handle,
    approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,
      consentFactsDigest:action.consent.consentFactsDigest}});
  const routes=[];
  for(const item of input.queries){
    const ready=(await api.catalogRoutes(item)).candidates[0];
    routes.push(await api.expose({...item,approval:approval(ready),wait:'verified'}));
  }
  await assertHeld(api,query);
  const applied=(await api.catalogRoutes({...query,owner:query.owner,providerId:query.providerId})).candidates[0].configuration;
  assert.equal(applied.credentials[requirement.id]?.known,true,'applied input presence is known');
  assert.equal(applied.credentials[requirement.id]?.value,true,'applied input is configured');
  await wire({type:'ready',routes,credentialInputId:requirement.id,appliedScopeId:applied.scopeId});
  // Keep the real broker host alive until the parent kills this exact process.
}

async function assertHeld(api,query) {
  const configuration=(await api.catalogRoutes(query)).candidates[0].configuration;
  let draft;
  try {
    draft=await api.beginConfigurationDraft({home:query.home,owner:query.owner,providerId:query.providerId,
      expectedConfigurationRevision:configuration.revision});
    assert.notEqual(draft.configuration.revision,draft.baseRevision);
    await assert.rejects(()=>api.commitConfigurationDraft({home:query.home,owner:query.owner,providerId:query.providerId,
      expectedConfigurationRevision:draft.baseRevision,draftId:draft.draftId}),{code:'configuration_stale'});
    await assert.rejects(()=>api.commitConfigurationDraft({home:query.home,owner:query.owner,providerId:query.providerId,
      expectedConfigurationRevision:draft.configuration.revision,draftId:draft.draftId}),{code:'configuration_in_use'});
  } finally {
    if(draft)await api.discardConfigurationDraft({home:query.home,owner:query.owner,providerId:query.providerId,draftId:draft.draftId});
  }
}

function exchange(origin,bytes) {
  return new Promise((resolve,reject)=>{
    const url=new URL(origin),socket=net.connect(Number(url.port),url.hostname);
    let received=Buffer.alloc(0);
    socket.setTimeout(3000,()=>socket.destroy(new Error('fixture exchange timed out')));
    socket.once('error',reject);socket.once('connect',()=>socket.end(bytes));
    socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length>bytes.length)socket.destroy(new Error('unexpected response'));});
    socket.once('end',()=>resolve(received));
  });
}
async function echoApp() {
  const sockets=new Set();
  const server=net.createServer({allowHalfOpen:true},socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.pipe(socket);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {target:'127.0.0.1:'+server.address().port,close:async()=>{
    for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
  }};
}
async function scanOwnTree(root,canary,home) {
  const canonical=await realpath(root),ownerHome=await realpath(home);
  let sockets=0;
  async function walk(path) {
    const info=await lstat(path);
    assert.equal(info.isSymbolicLink(),false,'owned scratch has no symlink escape');
    if(info.isDirectory()){
      for(const name of await readdir(path))await walk(join(path,name));
    }else if(info.isFile()){
      assert.equal((await readFile(path)).includes(canary),false,'canary never persisted');
    }else if(info.isSocket()){
      sockets++;
      const rel=relative(ownerHome,path);
      assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'control sockets stay inside canonical owner home');
      assert.equal(info.mode&0o077,0,'control socket private to owner');
    }
  }
  await walk(canonical);return sockets;
}
async function ledgerEvents(registry,providerId) {
  // Explicitly test-owned provider ledger, never a Gozar journal.
  const text=await readFile(join(registry.root,'providers',providerId,'events.jsonl'),'utf8');
  return text.trim().split('\n').filter(Boolean).map(JSON.parse);
}
async function absent(origin) {
  const until=Date.now()+5000;
  for(;;){
    try {await exchange(origin,randomBytes(16));}
    catch(error){if(error.code==='ECONNREFUSED')return;throw error;}
    if(Date.now()>=until)assert.fail('owned forwarding listener still reachable');
    await pause(50);
  }
}

if(process.argv.includes('--fixture-host-child')){
  await hostChild().catch(async error=>{await wire({type:'failure',error:safeError(error)});process.exitCode=1;process.disconnect();});
}else{
  test('host socket loss withdraws real attached routes and independently reconciles configuration holds',{timeout:240000},async t=>{
    const parent=join(homedir(),'.tmp');
    await mkdir(parent,{recursive:true,mode:0o700});
    const trusted=await lstat(parent);
    assert.ok(trusted.isDirectory()&&!trusted.isSymbolicLink());
    assert.equal(trusted.mode&0o777,0o700);
    if(process.getuid)assert.equal(trusted.uid,process.getuid());
    const root=await mkdtemp(join(parent,'gozar-detached-host-loss-')),home=join(root,'home');
    const canary=Buffer.from(randomBytes(48).toString('hex'));
    const identity={instanceId:randomUUID(),bootId:randomUUID()};
    const providerId='loss-'+randomUUID(),owner='detached-owner';
    const store=new Map(),backendCalls={read:0,delete:0};
    const backend={
      async put(request){const handle=randomUUID();store.set(handle,{scopeId:request.scopeId,bytes:Buffer.from(request.bytes)});return {handle};},
      async presence({handle,scopeId}){return {known:true,value:store.get(handle)?.scopeId===scopeId};},
      async delete({handle,scopeId}){backendCalls.delete++;const row=store.get(handle);return {deleted:row?.scopeId===scopeId?store.delete(handle):false};},
      async withSecret({handle,scopeId},use){const row=store.get(handle);assert.ok(row&&row.scopeId===scopeId);backendCalls.read++;return use(new Uint8Array(row.bytes));},
    };
    let registry,child,api,routes=[],queries=[],apps=[],exit,credentialInputId,appliedScopeId;
    const projections=[],errors=[];
    t.after(async()=>{
      try {
        if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}
        if(api)for(const route of routes)try{
          const result=await api.closeRoute({home,handle:route.handle,mode:'remove'});
          if(result.cleanup.state!=='confirmed')t.diagnostic('Public cleanup retains reference debt; no confirmed cleanup inferred.');
        }catch(error){t.diagnostic('Cleanup retry code: '+(error.code??'unknown'));}
      }finally{
        for(const app of apps)await app.close();
        await registry?.cleanup();await rm(root,{recursive:true,force:true});
      }
    });
    apps=[await echoApp(),await echoApp()];
    registry=await fakeRegistry({id:providerId,dir:join(root,'registry'),kinds:['attached'],
      reach:'this-device',transport:'tcp',proofProtocol:'echo',setupActions:[{
        id:'credential',kind:'provide-secret',label:'Credential',digest:'credential-v1',
        disclosure:{revision:'fixture-v1',text:'Fixture custody',links:[]},
      }]});
    queries=apps.map(app=>({schemaVersion:1,home,owner,target:app.target,providerId,operationId:randomUUID(),
      usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',
        address:'any',setup:'allow',protocols:[]}}));
    child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture-host-child'],{
      cwd:root,stdio:['ignore','ignore','pipe','ipc'],serialization:'advanced',
    });
    exit=once(child,'exit');
    let stderr=Buffer.alloc(0);child.stderr.on('data',chunk=>{stderr=Buffer.concat([stderr,chunk]);assert.equal(stderr.includes(canary),false);});
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('host initialization timed out')),150000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('host exited before ready'));});
      child.on('message',async message=>{
        if(message.type==='ready'){clearTimeout(timer);credentialInputId=message.credentialInputId;appliedScopeId=message.appliedScopeId;resolve(message.routes);}
        else if(message.type==='failure'){clearTimeout(timer);errors.push(message.error);reject(Object.assign(new Error(message.error.message),message.error));}
        else if(message.type==='backend'){
          try{
            const value=message.method==='read'
              ?await backend.withSecret(message.request,bytes=>new Uint8Array(bytes))
              :await backend[message.method](message.request);
            if(child.connected)child.send({type:'backend-result',id:message.id,value});
          }catch(error){if(child.connected)child.send({type:'backend-result',id:message.id,error:safeError(error)});}
        }
      });
    });
    child.send({type:'initialize',registry:{manifest:registry.manifest,root:registry.root},identity,queries,canary:new Uint8Array(canary)});
    routes=await ready;assert.equal(routes.length,2);
    projections.push(...routes);
    for(let i=0;i<routes.length;i++){
      const route=routes[i],nonce=randomBytes(32);
      assert.equal(route.verification.status,'verified');assert.equal(route.published,route.origin);
      assert.equal(route.handle.generation,1);
      assert.equal(route.verification.subject.instanceId,identity.instanceId);
      assert.equal(route.verification.subject.bootId,identity.bootId);
      assert.deepEqual(await exchange(route.origin,nonce),nonce,'route reaches independent app');
    }
    assert.ok(store.size>0,'parent keychain remains independent of host lifetime');
    assert.ok(typeof credentialInputId==='string'&&credentialInputId.length>0,'applied input is identified');
    // Snapshot only this fixture's host backend, never Gozar's private storage.
    const savedCredentials=[...store].map(([handle,row])=>({handle,scopeId:row.scopeId,bytes:Buffer.from(row.bytes)}));
    const deletesBefore=backendCalls.delete;
    for(const saved of savedCredentials){
      assert.ok(saved.scopeId===appliedScopeId,'saved applied scope matches public setup');
      assert.ok(saved.bytes.equals(canary),'initial saved bytes match the synthetic canary');
    }
    const assertSavedCredentials=async()=>{
      assert.equal(backendCalls.delete,deletesBefore,'route lifecycle never requests credential deletion');
      for(const saved of savedCredentials){
        const retained=store.get(saved.handle);
        // Boolean checks avoid including opaque handles/scopes/bytes in failure output.
        assert.ok(retained!==undefined,'each saved applied record remains');
        assert.ok(retained.scopeId===saved.scopeId,'saved applied scope remains identical');
        assert.ok(retained.bytes.equals(saved.bytes)&&retained.bytes.equals(canary),'saved applied bytes remain identical');
      }
      const configuration=(await api.catalogRoutes({...queries[0],home,owner,providerId})).candidates[0].configuration;
      assert.ok(configuration.scopeId===appliedScopeId,'public catalog retains the applied scope');
      assert.equal(configuration.credentials[credentialInputId]?.known,true,'saved input presence remains known');
      assert.equal(configuration.credentials[credentialInputId]?.value,true,'saved input remains configured');
    };
    assert.ok(await scanOwnTree(root,canary,home)>0,'live private control sockets exist');
    const before=await ledgerEvents(registry,providerId);
    assert.equal(before.filter(row=>row.event==='start').length,2);
    const proofsBefore=before.filter(row=>row.event==='proof').length;
    const readsBefore=backendCalls.read;
    assert.equal(child.kill('SIGKILL'),true);
    const [,signal]=await exit;assert.equal(signal,'SIGKILL');
    const recoveryIdentity={instanceId:identity.instanceId,bootId:randomUUID()};
    api=createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,
      identity:recoveryIdentity});
    for(const route of routes){
      let status;
      const deadline=Date.now()+5000;
      do {status=await api.routeStatus({home,handle:route.handle});if(status.published===null)break;await pause(50);}while(Date.now()<deadline);
      projections.push(status);
      assert.equal(status.published,null);assert.equal(status.verification.status,'unverified');
      assert.deepEqual(status.handle,route.handle);
      // Historical identity is evidence, not permission to mint a replacement.
      if(status.verification.subject)assert.deepEqual(status.verification.subject,route.verification.subject);
    }
    const listed=await api.listRoutes({home,owner});projections.push(listed);
    for(const route of routes){
      const row=listed.routes.find(item=>item.handle.id===route.handle.id);
      assert.ok(row);assert.equal(row.published,null);
      assert.equal(row.verification.status,'unverified');
    }
    assert.equal(backendCalls.read,readsBefore,'historical reads do not revive the dead broker');
    // Replaying retained intent is historical access, not a new approved operation.
    for(const invalidIdentity of [undefined,identity,{instanceId:randomUUID(),bootId:randomUUID()}]){
      const facade=createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,
        ...(invalidIdentity?{identity:invalidIdentity}:{})});
      await assert.rejects(facade.reviewRouteConsent({home,handle:routes[0].handle}));
      const replayQuery={...queries[0]};
      const current=(await facade.catalogRoutes(replayQuery)).candidates[0];
      const replayReadsBefore=backendCalls.read;
      const replay=await facade.expose({...replayQuery,approval:approval(current),wait:'verified'});
      assert.equal(backendCalls.read,replayReadsBefore,'replay itself performs no credential read');
      projections.push(replay);
      assert.deepEqual(replay.handle,routes[0].handle);
      assert.equal(replay.operationId,queries[0].operationId);
      assert.equal(replay.published,null);
      assert.equal(replay.verification.status,'unverified');
      if(replay.verification.subject)assert.deepEqual(replay.verification.subject,routes[0].verification.subject);
      const effects=await ledgerEvents(registry,providerId);
      assert.equal(effects.filter(row=>row.event==='start').length,2,'replay never allocates a replacement');
      assert.equal(effects.filter(row=>row.event==='proof').length,proofsBefore,'replay never re-proves old authority');
    }
    await assertHeld(api,queries[0]);
    const closed=[];
    for(let i=0;i<routes.length;i++){
      const route=routes[i];
      const result=await api.closeRoute({home,handle:route.handle,mode:'remove'});
      projections.push(result);closed.push(result);
      await absent(route.origin);
      const nonce=randomBytes(32);assert.deepEqual(await exchange('tcp://'+apps[i].target,nonce),nonce);
      if(i===0)await assertHeld(api,queries[0]); // The independent second hold is still protected.
      const retried=await api.closeRoute({home,handle:route.handle,mode:'remove'});projections.push(retried);
      assert.deepEqual(retried.handle,route.handle);
      if(result.cleanup.state==='confirmed')assert.equal(retried.cleanup.state,'confirmed');
    }
    if(closed.every(route=>route.cleanup.state==='confirmed')){
      const configuration=(await api.catalogRoutes(queries[0])).candidates[0].configuration;
      const draft=await api.beginConfigurationDraft({home,owner,providerId,expectedConfigurationRevision:configuration.revision});
      const committed=await api.commitConfigurationDraft({home,owner,providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
      assert.ok(committed.revision,'reference release independently permits configuration commit');
    }else{
      assert.ok(closed.some(route=>route.cleanup.state==='unconfirmed'));
      await assertHeld(api,queries[0]);
      t.diagnostic('Listener absence established, but reference cleanup is explicitly unconfirmed.');
    }
    const after=await ledgerEvents(registry,providerId);
    assert.equal(after.filter(row=>row.event==='start').length,2,'no replacement allocation');
    assert.equal(after.filter(row=>row.event==='proof').length,proofsBefore,'no replacement proof');
    // Outside the historical no-effect interval, including honest cleanup debt.
    await assertSavedCredentials();
    // A fresh trusted boot may start a separately approved NEW operation.
    const recoveryQuery={...queries[0],operationId:randomUUID()};
    const recoveryCandidate=(await api.catalogRoutes(recoveryQuery)).candidates[0];
    assert.ok(recoveryCandidate,'fresh recovery catalog candidate exists');
    const beforeRecovery=await ledgerEvents(registry,providerId);
    assert.equal(beforeRecovery.filter(row=>row.event==='start').length,2);
    assert.equal(beforeRecovery.filter(row=>row.event==='proof').length,proofsBefore);
    let recovered;
    try{
      recovered=await api.expose({...recoveryQuery,approval:approval(recoveryCandidate),wait:'verified'});
    }catch(error){
      if(error.route?.handle){
        routes.push(error.route);
        t.diagnostic('Failed recovery exact handle: '+JSON.stringify(error.route.handle));
      }
      throw error; // Retain exact-owned cleanup without accepting a product failure.
    }
    routes.push(recovered); // t.after owns this exact handle before any assertion can fail.
    t.diagnostic('Recovery route exact handle: '+JSON.stringify(recovered.handle));
    projections.push(recovered);
    assert.equal(recovered.operationId,recoveryQuery.operationId);
    assert.equal(recovered.handle.generation,1);
    for(const old of routes.slice(0,2))assert.notDeepEqual(recovered.handle,old.handle);
    assert.equal(recovered.verification.status,'verified');
    assert.equal(recovered.published,recovered.origin);
    assert.equal(recovered.verification.subject.instanceId,recoveryIdentity.instanceId);
    assert.equal(recovered.verification.subject.bootId,recoveryIdentity.bootId);
    const recoveryNonce=randomBytes(32);
    assert.deepEqual(await exchange(recovered.origin,recoveryNonce),recoveryNonce,'new route reaches independent app');
    const recoveryEffects=await ledgerEvents(registry,providerId);
    assert.equal(recoveryEffects.filter(row=>row.event==='start').length,3,'one deliberate new allocation');
    assert.equal(recoveryEffects.filter(row=>row.event==='proof').length,proofsBefore+1,'one deliberate new proof');
    const replayCandidate=(await api.catalogRoutes(recoveryQuery)).candidates[0];
    // A live replay reads public status, which may resolve current configuration.
    // Unlike dead-authority replay above, its contract is no allocation/reproof,
    // not zero credential reads by the deliberately authorized recovery boot.
    const recoveryReplay=await api.expose({...recoveryQuery,approval:approval(replayCandidate),wait:'verified'});
    projections.push(recoveryReplay);
    assert.deepEqual(recoveryReplay.handle,recovered.handle);
    assert.equal(recoveryReplay.operationId,recoveryQuery.operationId);
    assert.equal(recoveryReplay.published,recovered.origin);
    assert.equal(recoveryReplay.verification.status,'verified');
    const replayEffects=await ledgerEvents(registry,providerId);
    assert.equal(replayEffects.filter(row=>row.event==='start').length,3,'new-operation replay does not allocate');
    assert.equal(replayEffects.filter(row=>row.event==='proof').length,proofsBefore+1,'new-operation replay does not reprove');
    const recoveryClosed=await api.closeRoute({home,handle:recovered.handle,mode:'remove'});
    projections.push(recoveryClosed);
    assert.deepEqual(recoveryClosed.handle,recovered.handle);
    assert.equal(recoveryClosed.cleanup.state,'confirmed','live recovery authority must release its own route');
    await absent(recovered.origin);
    for(const app of apps){
      const nonce=randomBytes(32);
      assert.deepEqual(await exchange('tcp://'+app.target,nonce),nonce,'independent apps survive recovery cleanup');
    }
    assert.ok(store.size>0,'saved credentials remain after route cleanup');
    const finalEffects=await ledgerEvents(registry,providerId);
    assert.equal(finalEffects.filter(row=>row.event==='start').length,3);
    assert.equal(finalEffects.filter(row=>row.event==='proof').length,proofsBefore+1);
    await assertSavedCredentials(); // Deliberate presence reads are outside replay/effect measurements.
    assert.equal(Buffer.from(JSON.stringify({projections,errors,after,finalEffects})).includes(canary),false);
    assert.equal(stderr.includes(canary),false);
    await scanOwnTree(root,canary,home); // Bytes only: no private journal fields parsed.
  });
}
