import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createServiceVerifier} from '@tnunamak/gozar';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';

// Public behavior controls. These do not qualify all runtime drift/lifecycle paths.
const approvalFor = candidate => ({
  kind:'route', candidateToken:candidate.candidateToken,
  disclosureRevision:candidate.disclosure.revision,
  consentFactsDigest:candidate.consentFactsDigest,
});
function assertSnapshot(review,candidate,route) {
  assert.equal(review.scope.kind,'route');
  assert.equal(review.scope.reviewHandle,route.handle.id);
  assert.equal(review.scope.handleGeneration,route.handle.generation);
  assert.deepEqual(review.subject,route.verification.subject);
  assert.match(review.consentFactsDigest,/^consent-v1:/);
  assert.deepEqual(review.disclosures,candidate.consent.disclosures);
  const rows=review.facts;
  assert.ok(Array.isArray(rows));
  assert.deepEqual(review.disclosures.cost,candidate.properties.cost);
  assert.equal(review.disclosures.ownership,candidate.ownership);
  assert.equal(route.ownership,candidate.ownership);
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'no duplicate fact IDs');
  assert.ok(rows.every(row=>!row.id.startsWith('gozar.route-cost.')));
  const expectedRows=candidate.consent.facts;
  assert.equal(new Set(expectedRows.map(row=>row.id)).size,expectedRows.length);
  // Compare the complete canonical set, including providers with no extra rows.
  const byId=facts=>[...facts].sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(byId(rows),byId(expectedRows),'no missing or unexpected canonical facts');
}
async function localApp(t) {
  const verifier=createServiceVerifier();
  const app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('foreign-app');});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  return {app,target:'127.0.0.1:'+app.address().port};
}
async function forward(url,headers) {
  return new Promise((resolve,reject)=>{
    const pending=http.get(url,{headers},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.once('error',reject);
      response.once('end',()=>resolve({status:response.statusCode,headers:response.headers,
        chunks:[{data:Buffer.concat(chunks).toString('base64'),delayMs:0}]}));
    });
    pending.once('error',reject);
  });
}
async function reviewAndRestore(api,home,route,candidate,counters) {
  const original=structuredClone(candidate.consent.facts);
  const allocated=counters.allocations();
  const review=await api.reviewRouteConsent({home,handle:route.handle});
  assertSnapshot(review,candidate,route);
  assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
  assert.equal(counters.allocations(),allocated);
  const beforeProof=counters.proofs();
  const restored=await api.approveRouteConsent({home,handle:route.handle,
    approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});
  assert.equal(restored.verification.status,'verified');
  assert.deepEqual(restored.handle,route.handle);
  assert.equal(counters.allocations(),allocated,'approval must not allocate/write another provider resource');
  assert.ok(counters.proofs()>beforeProof,'approval must witness fresh nonce bytes');
  assert.ok(Date.parse(restored.verification.observedAt)>=Date.parse(route.verification.observedAt));
  assert.deepEqual(candidate.consent.facts,original,'provider/canonical input snapshot must not mutate');
  await assert.rejects(api.approveRouteConsent({home,handle:route.handle,
    approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest}));
  assert.equal(counters.allocations(),allocated,'replayed approval must not allocate');
  return restored;
}
test('public external runtime review preserves canonical and provider rows and re-proves without allocation',async t=>{
  const home=await scratch(t),owner='weekend-external', {target}=await localApp(t);
  let proofs=0;
  const harness=await createTestingGozar({effects:[{kind:'network',operation:'fetch',handle:async request=>{
    const url=new URL(request.url);proofs++;
    return forward('http://'+target+url.pathname+url.search,request.headers);
  }}]});
  const api=harness.gozar;
  const q=query({home,owner,target,origin:'https://owner.fixture.invalid',providerId:'own-address',
    operationId:'weekend-external',usage:{kind:'durable',routeId:'weekend-external'},
    requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'stable',setup:'allow',protocols:[]}});
  const candidate=(await api.catalogRoutes(q)).candidates[0];assert.ok(candidate.candidateToken);
  let retained;
  t.after(async()=>{try{if(retained)await api.closeRoute({home,handle:retained,mode:'remove'});}finally{await harness.close();}});
  const route=await api.ensureRoute({...q,approval:approvalFor(candidate)});retained=route.handle;
  assert.equal(route.verification.status,'verified');assert.equal(route.ownership,'external-owned');
  await reviewAndRestore(api,home,route,candidate,{allocations:()=>0,proofs:()=>proofs});
  assert.equal((await api.closeRoute({home,handle:retained,mode:'remove'})).cleanup.state,'confirmed');retained=null;
  assert.equal(await (await fetch('http://'+target)).text(),'foreign-app','tracking cleanup leaves the foreign app alive');
  assert.ok(harness.events.every(event=>event.kind==='network'),'external tracking must never request provider allocation');
});
test('public durable runtime review preserves all rows and refreshes proof without rewriting owned or foreign rules',async t=>{
  const home=await scratch(t),owner='weekend-durable',{target}=await localApp(t);
  const foreign={TCP:{'9000':{TCPForward:'127.0.0.1:9001'}}};
  let config=structuredClone(foreign),version=1,writes=0,proofs=0;
  const node={BackendState:'Running',Self:{DNSName:'fixture.node.invalid.',ID:'fixture-node',
    CapMap:{https:[],funnel:[],'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000':[]}},
    CurrentTailnet:{MagicDNSEnabled:true,MagicDNSSuffix:'node.invalid'},CertDomains:['fixture.node.invalid']};
  const effects=[
    {kind:'recipe',operation:'probe',handle:async({recipe})=>({stdout:JSON.stringify(recipe.args[0]==='serve'?config:node),stderr:'',exitCode:0})},
    {kind:'local-api',operation:'request',handle:async request=>{
      if(request.path.includes('status?'))return {status:200,headers:{},body:JSON.stringify(node)};
      assert.equal(request.path,'/localapi/v0/serve-config');
      if(request.method==='GET')return {status:200,headers:{etag:'"'+version+'"'},body:JSON.stringify(config)};
      assert.equal(request.method,'POST');
      if(request.headers['If-Match']!=='"'+version+'"')return {status:412,headers:{},body:''};
      config=structuredClone(request.body);version++;writes++;
      return {status:200,headers:{},body:''};
    }},
    {kind:'network',operation:'fetch',handle:async request=>{
      const url=new URL(request.url),port=url.port||'443';
      const proxy=url.protocol==='http:'?'http://'+url.host:config.Web?.[url.hostname+':'+port]?.Handlers?.['/']?.Proxy;
      assert.ok(proxy,'proof traverses the independently stored provider forwarding rule');proofs++;
      return forward(proxy+url.pathname+url.search,request.headers);
    }},
  ];
  const harness=await createTestingGozar({effects});const api=harness.gozar;
  const providers=(await api.listProviders({home,owner})).providers.filter(p=>p.availability.durable.state==='available');
  assert.ok(providers.length);
  let retained;t.after(async()=>{try{if(retained)await api.closeRoute({home,handle:retained,mode:'remove'});}finally{await harness.close();}});
  for(const [index,provider]of providers.entries()){
    const q=query({home,owner,target,providerId:provider.providerId,operationId:'weekend-durable-'+index,
      usage:{kind:'durable',routeId:'weekend-durable-'+index},
      requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'stable',setup:'allow',protocols:[]}});
    const candidate=(await api.catalogRoutes(q)).candidates[0];assert.ok(candidate.candidateToken);
    const route=await api.ensureRoute({...q,approval:approvalFor(candidate)});retained=route.handle;
    assert.equal(route.verification.status,'verified');
    const allocatedRules=structuredClone(config);
    await reviewAndRestore(api,home,route,candidate,{allocations:()=>writes,proofs:()=>proofs});
    assert.deepEqual(config,allocatedRules,'review/reapproval changes no provider rule');
    assert.equal((await api.closeRoute({home,handle:retained,mode:'remove'})).cleanup.state,'confirmed');retained=null;
    assert.deepEqual(config,foreign);
  }
  assert.equal(await (await fetch('http://'+target)).text(),'foreign-app');
});

test('public session review preserves disclosures with one process and actual gate proof',async t=>{
  const home=await scratch(t),owner='weekend-session',resources=new Map();
  let target,serial=0,proofs=0,harness,retained;
  t.after(async()=>{
    try{if(retained)await harness.gozar.closeRoute({home,handle:retained,mode:'remove'});}
    finally{try{await harness?.close();}finally{for(const {child}of resources.values())child.kill();}}
  });
  harness=await createTestingGozar({effects:[
    {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.0',stderr:'',exitCode:0})},
    {kind:'spawn',operation:'run',handle:async input=>{
      if(!input.longRunning)return {stdout:'OpenSSH_9.0',stderr:'',exitCode:0};
      target=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');assert.ok(target);
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      const handle='weekend-process-'+(++serial);resources.set(handle,{child});
      return {handle,pid:child.pid,stdout:'https://fixture.lhr.life\n',stderr:'',exitCode:null};
    }},
    {kind:'spawn',operation:'read',handle:async({handle})=>({present:resources.get(handle)?.child.exitCode===null&&resources.get(handle)?.child.signalCode===null})},
    {kind:'spawn',operation:'close',handle:async({handle})=>{resources.get(handle)?.child.kill();return {closed:true};}},
    {kind:'network',operation:'fetch',handle:async request=>{
      assert.ok(target);proofs++;const url=new URL(request.url);
      const response=await fetch('http://'+target+url.pathname+url.search,{headers:request.headers});
      const chunks=[];let before=Date.now();
      for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
      return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
    }},
  ]});
  const api=harness.gozar;
  const q=query({home,owner,providerId:'localhost-run',operationId:'weekend-session',
    usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const candidate=(await api.catalogRoutes(q)).candidates[0];assert.ok(candidate.candidateToken);
  const route=await api.expose({...q,wait:'verified',approval:approvalFor(candidate)});retained=route.handle;
  assert.equal(route.verification.status,'verified');
  await reviewAndRestore(api,home,route,candidate,{allocations:()=>serial,proofs:()=>proofs});
  assert.equal((await api.closeRoute({home,handle:retained,mode:'remove'})).cleanup.state,'confirmed');retained=null;
  for(const {child}of resources.values())assert.ok(child.exitCode!==null||child.signalCode!==null);
});
test('public attached review preserves disclosures without another SDK allocation',async t=>{
  const home=await scratch(t),owner='weekend-attached',resources=new Map();
  let serial=0,proofs=0,harness,retained;
  t.after(async()=>{try{if(retained)await harness.gozar.closeRoute({home,handle:retained,mode:'remove'});}finally{await harness?.close();}});
  harness=await createTestingGozar({effects:[
    {kind:'recipe',operation:'probe',handle:async()=>({ok:false})},
    {kind:'sdk-listener',operation:'detect',handle:async()=>({available:true})},
    {kind:'sdk-listener',operation:'open',handle:async({options})=>{
      const handle='weekend-sdk-'+(++serial),url='https://'+options.domain;
      resources.set(handle,{url,target:options.addr});return {handle,url};
    }},
    {kind:'sdk-listener',operation:'read',handle:async({handle})=>resources.has(handle)?{present:true,url:resources.get(handle).url}:{present:false}},
    {kind:'sdk-listener',operation:'close',handle:async({handle})=>{resources.delete(handle);return {closed:true};}},
    {kind:'network',operation:'fetch',handle:async request=>{
      const url=new URL(request.url),resource=[...resources.values()].find(row=>row.url===url.origin);assert.ok(resource);proofs++;
      const response=await fetch('http://'+resource.target+url.pathname+url.search,{method:request.method,headers:request.headers});
      const chunks=[];let before=Date.now();
      for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
      return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
    }},
  ]});
  const api=harness.gozar;
  const provider=(await api.listProviders({home,owner})).providers.find(p=>p.transport==='https'&&p.availability.attached.state!=='unsupported'&&!p.configuration.inputRequirements.some(i=>i.kind==='https-origin'));
  assert.ok(provider);let config=provider.configuration;
  for(const requirement of config.inputRequirements){
    const action=config.actions.find(a=>a.id===requirement.actionId);assert.ok(action);let input;
    if(requirement.secret){
      const stored=await api.storeSecret({home,owner,providerId:provider.providerId,inputId:requirement.id,
        scopeId:config.scopeId,expectedConfigurationRevision:config.revision,bytes:new TextEncoder().encode('weekend-synthetic-canary')});
      input={secretHandle:stored.handle};
    }else if(requirement.kind==='text'){
      const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
      const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));input={value:String(port)};
    }else input={value:'fixture.example.invalid'};
    config=(await api.runSetupAction({home,owner,providerId:provider.providerId,expectedConfigurationRevision:config.revision,
      actionId:action.id,...input,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,
        consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
  }
  const q=query({home,owner,providerId:provider.providerId,operationId:'weekend-attached',target:'127.0.0.1:1',
    usage:{kind:'attached'},requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const candidate=(await api.catalogRoutes(q)).candidates[0];assert.ok(candidate.candidateToken);
  const route=await api.expose({...q,wait:'verified',approval:approvalFor(candidate)});retained=route.handle;
  assert.equal(route.verification.status,'verified');
  await reviewAndRestore(api,home,route,candidate,{allocations:()=>serial,proofs:()=>proofs});
  assert.equal((await api.closeRoute({home,handle:retained,mode:'remove'})).cleanup.state,'confirmed');retained=null;
  assert.equal(resources.size,0);assert.doesNotMatch(JSON.stringify(harness.events),/weekend-synthetic-canary/);
});
