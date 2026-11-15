import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {mkdtemp,chmod,lstat,readFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {observeSession} from '../../packages/gozar-node/daemon.mjs';
import {query} from './route-schema-check.mjs';

async function bounded(work,ms=15000){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('owned fixture operation timed out')),ms);})]);}
 finally{clearTimeout(timer);}
}
const alive=child=>child.exitCode===null&&child.signalCode===null;
async function refuses(path){
 await bounded(new Promise((resolve,reject)=>{
  const socket=net.createConnection(path);
  socket.once('connect',()=>{socket.destroy();reject(new Error('owned control listener remains'));});
  socket.once('error',()=>{socket.destroy();resolve();});
 }));
}
test('native authenticated observation preserves current proof and demotes public review',async t=>{
 let home,homeIdentity,app,harness,exposeWork,handle,directory,primary,target,serial=0;
 let exposing=false,settled=false;
 const resources=new Map(),sockets=new Set(),cleanupErrors=[];
 const recordError=async action=>{try{await action();}catch(error){cleanupErrors.push(error);}};
 // Register teardown before any resource allocation/listen/start can fail.
 t.after(async()=>{
  if(exposeWork&&!settled)await recordError(()=>bounded(exposeWork,180000));
  if(exposing&&!settled)cleanupErrors.push(new Error('expose still unresolved; retain owned evidence'));
  if(handle&&!directory)await recordError(async()=>{
   const colon=handle.id.indexOf(':'),segment=handle.id.slice(0,colon);
   assert.ok(colon>0);assert.match(segment,/^port-\d+$/);directory=join(home,segment);
  });
  if(harness&&handle)await recordError(async()=>{
   const closed=await bounded(harness.gozar.closeRoute({home,owner:'observation-owner',handle,mode:'remove'}),130000);
   assert.equal(closed.cleanup.state,'confirmed');
  });
  // Harness cleanup must run even if public close or late-expose accounting failed.
  if(harness)await recordError(()=>bounded(harness.close(),130000));
  if(directory)await recordError(()=>refuses(join(directory,'control.sock')));
  for(const {child,exit} of resources.values()){
   await recordError(async()=>{await bounded(exit,5000);assert.equal(alive(child),false);});
   if(alive(child)){
    // The exact ChildProcess is ours, never a PID reconstructed from a journal.
    child.kill('SIGTERM');
    await recordError(()=>bounded(exit,5000));
   }
  }
  if(app?.listening)await recordError(async()=>{
   const response=await bounded(fetch('http://127.0.0.1:'+app.address().port+'/foreign',{signal:AbortSignal.timeout(3000)}));
   assert.equal(await bounded(response.text()),'foreign-alive');
  });
  if(app)await recordError(async()=>{
   for(const socket of sockets)socket.destroy();
   if(app.listening)await bounded(new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve())),5000);
  });
  if(!primary&&!cleanupErrors.length&&home){
   await recordError(async()=>{
    const current=await lstat(home);
    assert.equal(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===homeIdentity.dev&&current.ino===homeIdentity.ino,true,'owned scratch identity changed');
    await rm(home,{recursive:true,force:false});
   });
  }
  const failures=[...(primary?[primary]:[]),...cleanupErrors];
  if(failures.length)throw new AggregateError(failures,'native observation assertions/cleanup failed; scratch retained');
 });
 try{
  home=await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR??homedir(),'.goi-'));
  await chmod(home,0o700);homeIdentity=await lstat(home);
  app=http.createServer((_req,res)=>res.end('foreign-alive'));
  app.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
  await bounded(new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);}),5000);
  const effects=[
   {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.0',stderr:'',exitCode:0})},
   {kind:'spawn',operation:'run',handle:async input=>{
    if(!input.longRunning)return {stdout:'OpenSSH_9.0',stderr:'',exitCode:0};
    target=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');assert.ok(target);
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    const exit=new Promise(resolve=>child.once('exit',resolve));
    const key='ipc-child-'+(++serial);resources.set(key,{child,exit});
    await bounded(new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);}),5000);
    return {handle:key,pid:child.pid,stdout:'https://fixture.lhr.life\n',stderr:'',exitCode:null};
   }},
   {kind:'spawn',operation:'read',handle:async({handle:key})=>({present:!!resources.get(key)&&alive(resources.get(key).child)})},
   {kind:'spawn',operation:'close',handle:async({handle:key})=>{
    const owned=resources.get(key);if(owned&&alive(owned.child)){owned.child.kill('SIGTERM');await bounded(owned.exit,5000);}
    return {closed:true};
   }},
   {kind:'network',operation:'fetch',handle:async request=>{
    assert.ok(target);const url=new URL(request.url);
    const response=await fetch('http://'+target+url.pathname,{headers:request.headers,signal:AbortSignal.timeout(15000)});
    const chunks=[];let before=Date.now();
    for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
    return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
   }},
  ];
  harness=await createTestingGozar({identity:{instanceId:'ipc-instance',bootId:'ipc-boot'},effects});
  const api=harness.gozar;
  const q=query({home,owner:'observation-owner',target:'127.0.0.1:'+app.address().port,providerId:'localhost-run',operationId:'native-observation',
   usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const candidate=(await bounded(api.catalogRoutes(q))).candidates[0];assert.equal(candidate.eligible,true);
  const approval={kind:'route',...Object.fromEntries(Object.entries(candidate).filter(([name])=>['candidateToken','consentFactsDigest'].includes(name))),disclosureRevision:candidate.disclosure.revision};
  exposing=true;
  // Keep the real promise and capture either success or retained-error handle, even after timeout.
  exposeWork=api.expose({...q,wait:'verified',approval}).then(route=>{handle=route.handle;settled=true;return route;},error=>{handle=error.route?.handle;settled=true;throw error;});
  const route=await bounded(exposeWork,130000);
  assert.equal(route.verification.status,'verified');
  assert.equal(serial,1);
  const colon=handle.id.indexOf(':');assert.ok(colon>0);
  const segment=handle.id.slice(0,colon),sessionId=handle.id.slice(colon+1);assert.match(segment,/^port-\d+$/);
  directory=join(home,segment);
  const controlBefore=await readFile(join(directory,'control.json')),bootstrapBefore=await readFile(join(directory,'bootstrap.json'));
  const owned=[...resources.values()][0],savedPid=owned.child.pid;
  assert.ok(Number.isSafeInteger(savedPid)&&alive(owned.child));
  const ask={sessionId,handleGeneration:handle.generation};
  const start=harness.events.length;
  const first=await bounded(observeSession(directory,ask));
  assert.equal(first.snapshot.sessionId,sessionId);assert.ok(first.snapshot.published);
  assert.ok(first.validation);assert.ok(first.proofSubject);
  const receipt=structuredClone(first.validation),subject=structuredClone(first.proofSubject),expiry=first.expiresAtMs;
  first.proofSubject.target='client-copy-only';first.validation.clientMutation=true;
  const second=await bounded(observeSession(directory,ask));
  assert.deepEqual(second.validation,receipt,'observe changed proof time/expiry; inspect autonomous refresh evidence');
  assert.deepEqual(second.proofSubject,subject);assert.equal(second.expiresAtMs,expiry);
  await assert.rejects(bounded(observeSession(directory,{...ask,sessionId:sessionId+'-other'})),{code:'route_conflict'});
  await assert.rejects(bounded(observeSession(directory,{...ask,handleGeneration:handle.generation+1})),{code:'route_conflict'});
  assert.equal(owned.child.pid,savedPid);assert.equal(alive(owned.child),true);
  assert.equal((await readFile(join(directory,'control.json'))).equals(controlBefore),true,'control authority changed');
  assert.equal((await readFile(join(directory,'bootstrap.json'))).equals(bootstrapBefore),true,'bootstrap authority changed');
  // Ledger is real, but untagged events are NOT attributed to observe over autonomous health.
  const interval=harness.events.slice(start);
  for(const event of interval)assert.equal(event.fixture,true);
  t.diagnostic('native observe interval fixture events='+interval.length+'; no causal zero-effect claim');
  // Public review is explicitly outside the measured interval; no assigned private flags.
  await bounded(api.reviewRouteConsent({home,owner:q.owner,handle}));
  const blocked=await bounded(observeSession(directory,ask));
  assert.equal(blocked.snapshot.published,null);assert.equal(blocked.validation,null);
  assert.equal(owned.child.pid,savedPid);assert.equal(alive(owned.child),true);
  const response=await bounded(fetch('http://127.0.0.1:'+app.address().port+'/foreign',{signal:AbortSignal.timeout(3000)}));
  assert.equal(await bounded(response.text()),'foreign-alive');
 }catch(error){primary=error;}
});
