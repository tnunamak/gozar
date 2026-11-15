// Synthetic shipped-provider admission regression. Authoring only; host executes.
// No SSH/vendor/account is contacted. Installed registry/module/data remain unmodified by this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,lstat,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {loadAdapters,sessionRecipeFor} from '../../packages/gozar-node/adapter-runtime.mjs';
import {createTestingGozar} from '../../packages/gozar-node/testing.mjs';
const HOST_LIFETIME_MS=20000,OPERATION_MS=25000,CLEANUP_MS=7000;
async function bounded(label,operation,ms=CLEANUP_MS) {
  let timer;
  try {return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(label+' timed out; outcome unconfirmed')),ms);
  })]);} finally {clearTimeout(timer);}
}
const exited=child=>child.exitCode!==null||child.signalCode!==null;
async function waitReaped(child,label) {
  if(!exited(child))await bounded(label,()=>once(child,'exit'),3000);
  assert.ok(exited(child),label+': child exit not observed');
}
async function endpointUnavailable(port) {
  assert.ok(Number.isInteger(port)&&port>0,'allocated gate port required');
  await new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:'/'},res=>{
      res.resume();reject(new Error('gate still answers after public cleanup'));
    });
    req.setTimeout(1500,()=>req.destroy(new Error('gate absence unconfirmed: timeout')));
    req.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
  });
}
async function resolverUnavailable(path) {
  await new Promise((resolve,reject)=>{
    const socket=net.createConnection(path);
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('resolver absence unconfirmed: timeout'));},1500);
    socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('resolver still listening after cleanup'));});
    socket.once('error',error=>{clearTimeout(timer);socket.destroy();['ENOENT','ECONNREFUSED'].includes(error.code)?resolve():reject(error);});
  });
}
async function fixture(t) {
  const temporary=join(homedir(),'.tmp');
  await mkdir(temporary,{recursive:true,mode:0o700});
  const stat=await lstat(temporary);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  assert.equal(stat.mode&0o777,0o700,'fixture parent must already be trusted');
  const root=await mkdtemp(join(temporary,'gr-'));
  const cleanups=[];let retainEvidence=false;
  // Node reports this hook's errors alongside any original body failure.
  t.after(async()=>{const errors=[];
    for(const [index,cleanup] of [...cleanups].reverse().entries())
      try{await bounded('owned cleanup '+index,cleanup);}catch(error){errors.push(error);}
    // Do not erase ownership evidence while any cleanup outcome is uncertain.
    if(!errors.length&&!retainEvidence)try{await bounded('fixture outputs removal',()=>rm(root,{recursive:true,force:true}));}
      catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Owned fixture cleanup incomplete; evidence retained');
  });
  const id='tunnl-gg';
  const home=join(root,'h');await mkdir(home,{mode:0o700});
  const installedRoot=fileURLToPath(new URL('../../adapters/',import.meta.url));
  const installedManifest=join(installedRoot,'manifest.json');
  const [adapter]= (await loadAdapters({root:installedRoot,manifest:installedManifest})).filter(row=>row.id===id);
  assert.ok(adapter,'shipped provider must be registered');
  const recipe=sessionRecipeFor(adapter);
  assert.equal(recipe.definition.idleTimeoutMs,121000);
  assert.equal(recipe.definition.originPolicy,'immutable');
  assert.equal(recipe.definition.durableLifetime,null);
  assert.equal(adapter.definition.availability.durable.state,'unsupported');
  assert.equal(adapter.definition.availability.session.state,'available','red before shipped admission change');
  return {id,root:installedRoot,manifest:installedManifest,home,cleanups,retainEvidence:()=>{retainEvidence=true;}};
}
// Public candidate contract: bind only this fresh candidate, never log/decode/fabricate its token.
const approvalFor = candidate => {
  if (!candidate || typeof candidate.candidateToken !== 'string' || !candidate.candidateToken ||
      typeof candidate.consentFactsDigest !== 'string' || !candidate.consentFactsDigest ||
      typeof candidate.disclosure?.revision !== 'string' || !candidate.disclosure.revision)
    throw new Error('Current executable candidate required');
  const bindings=Object.fromEntries(Object.entries(candidate).filter(([field]) =>
    ['candidateToken','consentFactsDigest'].includes(field)));
  return {...bindings,kind:'route',disclosureRevision:candidate.disclosure.revision};
};
const query=(f,port)=>({schemaVersion:1,owner:'tunnl-shipped-fixture',home:f.home,target:'127.0.0.1:'+port,
  providerId:f.id,usage:{kind:'session',lifetimeMs:HOST_LIFETIME_MS},
  requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'none',protocols:[]}});
async function stopChild(child) {
  if(exited(child))return;
  // Only ChildProcess handles saved at allocation are signalled.
  child.kill('SIGTERM');
  try{await waitReaped(child,'owned SIGTERM');}
  catch(first){
    if(!exited(child))child.kill('SIGKILL');
    try{await waitReaped(child,'owned SIGKILL');}
    catch(second){throw new AggregateError([first,second],'Owned child not reaped');}
    // Escalation succeeded, but retain the original timeout as a test failure.
    throw first;
  }
}
async function transport(t,f,mode) {
  const children=new Map(),upstreams=new Set(),resolvers=new Set();let creates=0,closes=0,gatePort,nonceResponses=0,requests=0,closing=false;
  f.cleanups.push(async()=>{for(const req of upstreams)req.destroy(new Error('fixture teardown'));});
  const origin='https://'+f.id+'.tunnl.gg';
  const foreign=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env:{}});
  f.cleanups.push(()=>stopChild(foreign));
  await bounded('foreign fixture spawn',()=>once(foreign,'spawn'));
  const app=http.createServer((_req,res)=>{res.setHeader('content-type','text/plain');res.end('fixture app');});
  const sockets=new Set();
  app.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  f.cleanups.push(async()=>{
    const closing=new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve()));
    for(const socket of sockets)socket.destroy();
    await bounded('app server close',()=>closing);
  });
  await bounded('app server listen',()=>new Promise((resolve,reject)=>{
    app.once('error',reject);app.listen(0,'127.0.0.1',resolve);
  }));
  f.cleanups.push(async()=>{
    const outcomes=await Promise.allSettled([...children.values()].map(child=>stopChild(child)));
    const errors=outcomes.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(errors.length)throw new AggregateError(errors,'Owned child cleanup failures');
  });
  const probe=args=>{assert.deepEqual(args,['-V']);return {stdout:'',stderr:'OpenSSH_9.9p1\n',exitCode:0};};
  const effects=[
    {kind:'recipe',operation:'probe',handle:async({recipe})=>probe(recipe.args)},
    {kind:'spawn',operation:'run',handle:async({args,longRunning})=>{
      if(closing)throw new Error('Fixture allocation after teardown began');
      if(!longRunning)return probe(args);
      assert.ok(args.includes('output=json'));
      gatePort=Number(args[args.indexOf('-R')+1].split(':').at(-1));assert.ok(gatePort>0);
      const entries=await readdir(f.home,{withFileTypes:true});
      for(const entry of entries.filter(e=>/^resolver-[a-f0-9]{12}\.sock$/.test(e.name))){
        assert.ok(entry.isSocket(),'resolver entry must be a socket');resolvers.add(join(f.home,entry.name));
      }
      assert.ok(resolvers.size,'capture actual resolver before allocation');
      const emitted=JSON.stringify({event:'tunnel',url:mode==='invalid'?'https://fixture.lhr.life':origin})+'\n';
      const child=spawn(process.execPath,['-e','process.stdout.write(process.argv[1]);setInterval(()=>{},1000)',emitted],
        {stdio:['ignore','pipe','ignore'],env:{}});
      const handle=randomUUID();children.set(handle,child);creates++;
      const output=new Promise((resolve,reject)=>{
        let text='';
        child.once('error',reject);
        child.stdout.on('data',chunk=>{
          text+=chunk.toString();
          if(Buffer.byteLength(text)>4096)return reject(new Error('bounded child output exceeded'));
          if(text.endsWith('\n'))resolve(text);
        });
        child.once('exit',()=>reject(new Error('fixture child exited before admission')));
      });
      const stdout=await bounded('owned fixture emitted origin',()=>output);
      assert.equal(stdout,emitted);
      return {stdout,stderr:'',exitCode:null,pid:child.pid,handle};
    }},
    {kind:'spawn',operation:'read',handle:async({handle})=>{
      const child=children.get(handle);assert.ok(child);
      return {present:child.exitCode===null&&child.signalCode===null,...(child.exitCode===null?{}:{exitCode:child.exitCode})};
    }},
    {kind:'spawn',operation:'close',handle:async({handle})=>{
      const child=children.get(handle);assert.ok(child);await stopChild(child);closes++;return {closed:true};
    }},
    {kind:'network',operation:'fetch',handle:async({url,method,headers},{signal})=>{
      const requested=new URL(url);assert.equal(requested.origin,origin);assert.ok(gatePort);
      requests++;
      if(mode==='late-failure')throw new Error('Synthetic transport failure after owned allocation');
      return new Promise((resolve,reject)=>{        const upstream=http.request({host:'127.0.0.1',port:gatePort,path:requested.pathname+requested.search,
          method,headers:{...headers,host:headers?.host??headers?.Host??requested.host},signal},reply=>{
          const chunks=[];let bytes=0,last=performance.now();
          reply.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024){upstream.destroy(new Error('bounded response'));return;}
            const now=performance.now();chunks.push({data:chunk.toString('base64'),delayMs:now-last});last=now;});
          reply.once('error',reject);
          reply.once('end',()=>{if(reply.statusCode===200&&bytes>0)nonceResponses++;
            resolve({status:reply.statusCode,headers:Object.fromEntries(Object.entries(reply.headers).filter(([,v])=>v!==undefined)
              .map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v])),chunks});});
        });
        upstreams.add(upstream);
        const deadline=setTimeout(()=>upstream.destroy(new Error('fixture HTTP deadline; proof incomplete')),HOST_LIFETIME_MS);
        upstream.once('close',()=>{clearTimeout(deadline);upstreams.delete(upstream);});
        upstream.once('error',reject);upstream.end();
      });
    }},
  ];
  const testing=await createTestingGozar({...f,effects,identity:{instanceId:'recipe-fixture-'+f.id,bootId:randomUUID()}});
  f.cleanups.push(()=>{closing=true;return testing.close();});
  return {...testing,origin,port:app.address().port,foreign,
    confirmRemoved:async()=>{
      assert.equal(children.size,1,'exactly one saved owned child');
      for(const child of children.values())await waitReaped(child,'public cleanup owned PID');
      assert.ok([...children.values()].every(exited),'no live saved owned child');
      await endpointUnavailable(gatePort);
      try {
        assert.ok((await lstat(f.home)).isDirectory(),'home must exist before absence checks');
        for(const path of resolvers)await bounded('resolver connection refusal',()=>resolverUnavailable(path));
        assert.deepEqual((await readdir(f.home)).filter(name=>/^resolver-[a-f0-9]{12}\.sock$/.test(name)),[]);
      } catch(error){f.retainEvidence();throw error;}
    },
    facts:()=>({creates,closes,nonceResponses,requests,ownedPids:[...children.values()].map(c=>c.pid),live:[...children.values()].filter(c=>c.exitCode===null&&c.signalCode===null).length})};
}
for(const mode of ['positive','invalid','late-failure'])test('shipped tunnl-gg synthetic daemon/gate admission: '+mode,{timeout:90000},async t=>{
  const f=await fixture(t),effect=await transport(t,f,mode),request=query(f,effect.port);
  t.after(()=>t.diagnostic(JSON.stringify({mode,...effect.facts()})));
  const catalog=await bounded('public route catalog',()=>effect.gozar.catalogRoutes(request),OPERATION_MS),candidate=catalog.candidates.find(c=>c.providerId===f.id);
  assert.equal(candidate?.eligible,true);assert.equal(candidate.setup.state,'ready');assert.ok(candidate.candidateToken);
  const start=effect.gozar.expose({...request,approval:approvalFor(candidate),wait:'verified'});
  if(mode==='positive') {
    const route=await bounded('verified expose',()=>start,OPERATION_MS);
    assert.equal(route.state,'usable');assert.equal(route.origin,effect.origin);
    assert.equal(route.verification.status,'verified');assert.ok(route.verification.checks.includes('nonce'));assert.ok(route.verification.checks.includes('sse'));
    assert.equal(route.verification.subject.origin,effect.origin);
    assert.equal(route.verification.subject.handleGeneration,route.handle.generation);
    assert.ok(route.handle.generation>=1);
    assert.equal(route.expiresAt.known,true);assert.ok(Number.isFinite(Date.parse(route.expiresAt.value)));assert.ok(Date.parse(route.expiresAt.value)>Date.now());assert.ok(Date.parse(route.expiresAt.value)<=Date.now()+HOST_LIFETIME_MS);
    assert.equal(effect.facts().creates,1);assert.ok(effect.facts().nonceResponses>0);
    const status=await bounded('public route status',()=>effect.gozar.routeStatus({home:f.home,handle:route.handle}));
    assert.equal(status.handle.id,route.handle.id);assert.equal(status.state,'usable');
    const scope={home:f.home,owner:request.owner,providerId:f.id};
    const current=(await bounded('live configuration',()=>effect.gozar.catalogRoutes(request),OPERATION_MS)).candidates.find(c=>c.providerId===f.id).configuration;
    const liveDraft=await bounded('live draft',()=>effect.gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.revision}));
    await assert.rejects(bounded('live commit must remain in use',()=>effect.gozar.commitConfigurationDraft({...scope,draftId:liveDraft.draftId,expectedConfigurationRevision:liveDraft.configuration.revision})),{code:'configuration_in_use'});
    await bounded('discard live draft',()=>effect.gozar.discardConfigurationDraft({...scope,draftId:liveDraft.draftId}));
    const stopped=await bounded('public route removal',()=>effect.gozar.closeRoute({home:f.home,handle:route.handle,mode:'remove'}));
    t.diagnostic(JSON.stringify({mode,publicCleanup:stopped.cleanup?.state,...effect.facts()}));
    assert.equal(stopped.cleanup.state,'confirmed');
  } else {
    await assert.rejects(bounded('negative expose '+mode,()=>start,OPERATION_MS),error=>['provider_unavailable','verification_failed','requirements_unsatisfied'].includes(error.code));
    assert.equal(effect.facts().creates,1,'negative must exercise the real allocated recipe, not an earlier refusal');
    if(mode==='invalid')assert.equal(effect.facts().nonceResponses,0);
    else assert.ok(effect.facts().requests>0);
  }
  await effect.confirmRemoved();
  const current=(await bounded('current applied configuration',()=>effect.gozar.catalogRoutes(request),OPERATION_MS)).candidates.find(c=>c.providerId===f.id).configuration;
  const scope={home:f.home,owner:request.owner,providerId:f.id};
  const draft=await bounded('unchanged draft',()=>effect.gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.revision}));
  const committed=await bounded('commit after exact reference release',()=>effect.gozar.commitConfigurationDraft({...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision}));
  assert.ok(committed.revision);
  assert.equal(effect.facts().live,0,'every owned fixture process stopped');
  const appResponse=await bounded('independent app survives',()=>fetch('http://127.0.0.1:'+effect.port));
  assert.equal(await bounded('independent app body',()=>appResponse.text()),'fixture app');
  assert.equal(effect.foreign.exitCode,null);assert.equal(effect.foreign.signalCode,null);
});
