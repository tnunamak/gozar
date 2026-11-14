import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar,createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

// Public runtime fields only. No fixture bearer values are reconstructed or persisted.
const pickFields=(object,names)=>Object.fromEntries(Object.entries(object).filter(([name])=>names.includes(name)));
const approval=candidate=>({...pickFields(candidate,['candidateToken','consentFactsDigest']),kind:'route',disclosureRevision:candidate.disclosure.revision});
const get=url=>new Promise((resolve,reject)=>{
 const req=http.get(url,{agent:false},res=>{let value='';res.setEncoding('utf8');res.on('data',c=>value+=c);res.on('end',()=>resolve(value));res.on('error',reject)});
 req.setTimeout(5000,()=>req.destroy(new Error('fixture timeout')));req.on('error',reject);
});
const events=async path=>{try{return (await readFile(path,'utf8')).split(/\\n|\n/).filter(Boolean).map(JSON.parse)}catch(e){if(e.code==='ENOENT')return [];throw e}};
async function fresh(input){
 const {manifest,root,query,ledger,nonce,oldDigest}=input;
 const api=createGozar({manifest,root,identity:{instanceId:randomUUID(),bootId:randomUUID()}});
 let route,clean=false;
 try{
  const c=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===query.providerId);
  assert.ok(c.facts.some(f=>f.id==='changed-fixture-fact'&&f.value==='new'));
  assert.notEqual(c.consentFactsDigest,oldDigest);
  const request={...query,operationId:randomUUID(),wait:'verified',intent:'create',approval:approval(c)};
  const started=Date.now();
  try{route=await api.expose(request)}catch(e){route=e.route;throw e}
  assert.equal(route.handle.kind,query.usage.kind);assert.equal(route.handle.generation,1);
  assert.equal(route.verification.status,'verified');assert.equal(route.published,route.origin);
  assert.ok(route.verification.subject);assert.equal(await get(route.origin),nonce);
  assert.equal((await events(ledger)).filter(e=>e.event==='start').length,1);
  const handle=structuredClone(route.handle),expiry=structuredClone(route.expiresAt);
  if(query.usage.kind==='session'){assert.equal(expiry.known,true);assert.ok(Date.parse(expiry.value)>=started+120000);assert.ok(Date.parse(expiry.value)<=Date.now()+120000)}
  const replay=await api.expose(request);assert.deepEqual(replay.handle,handle);assert.deepEqual(replay.expiresAt,expiry);
  await assert.rejects(api.expose({...request,target:'127.0.0.1:1'}),{code:'operation_conflict'});
  assert.equal((await events(ledger)).filter(e=>e.event==='start').length,1);
  assert.deepEqual((await api.routeStatus({home:query.home,handle})).expiresAt,expiry);
  const closed=await api.closeRoute({home:query.home,handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');
  const stopped=await api.expose(request);assert.deepEqual(stopped.handle,handle);assert.equal(stopped.cleanup.state,'confirmed');
  await assert.rejects(get(route.origin));
  const after=await events(ledger);assert.equal(after.filter(e=>e.event==='start').length,1);assert.equal(after.filter(e=>e.event==='cleanup').length,1);
  assert.equal(await get('http://'+query.target),nonce);clean=true;
 }finally{
  if(!clean&&route?.handle){
   const released=await api.closeRoute({home:query.home,handle:route.handle,mode:'remove'});
   assert.equal(released.cleanup.state,'confirmed','retain fixture on uncertain cleanup');
  }
 }
}
if(process.argv[2]==='fresh-factory'){
 process.once('message',async input=>{try{await fresh(input);process.send({ok:true},()=>process.disconnect())}
 catch(error){process.send({ok:false,code:error.code??null,message:'Fresh public lifecycle assertion failed; retain owned fixture for cleanup investigation'},()=>process.disconnect());process.exitCode=1}});
}else{
 for(const kind of ['attached','session'])test('registry preflight plus fresh public '+kind+' nonce lifecycle',{timeout:180000},async()=>{
  const parent=join(homedir(),'.tmp');await mkdir(parent,{recursive:true,mode:0o700});
  const info=await lstat(parent);assert.ok(info.isDirectory()&&!info.isSymbolicLink());assert.equal(info.mode&0o777,0o700);if(process.getuid)assert.equal(info.uid,process.getuid());
  const owned=await mkdtemp(join(parent,'gozar-preflight-')),home=join(owned,'home'),owner='fixture-'+randomUUID(),id='fixture-'+randomUUID(),nonce=randomUUID();
  let registry,app,child,confirmed=false,requests=0;
  try{
   const verify=createServiceVerifier();app=http.createServer((req,res)=>{requests++;if(!verify(req,res))res.end(nonce)});
   await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)});
   const target='127.0.0.1:'+app.address().port;
   registry=await fakeRegistry({id,dir:join(owned,'registry'),kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});
   const api=createGozar({manifest:registry.manifest,root:registry.root,identity:{instanceId:randomUUID(),bootId:randomUUID()}});
   const query={schemaVersion:1,home,owner,providerId:id,target,usage:kind==='session'?{kind,lifetimeMs:120000}:{kind},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
   const c=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===id);
   const request={...query,operationId:randomUUID(),wait:'verified',intent:'create',approval:approval(c)};
   const ledger=join(registry.root,'providers',id,'events.jsonl');
   const definitionPath=join(registry.root,registry.manifest.providers[0].definition);
   const definition=JSON.parse(await readFile(definitionPath,'utf8'));
   definition.adapter.facts??=[];definition.adapter.facts.push({id:'changed-fixture-fact',label:'Changed fixture boundary',value:'new',known:true,affectsConsent:true,group:'fixture',source:'test-owned definition',asOf:null});
   await writeFile(definitionPath,JSON.stringify(definition));
   const before=requests;
   for(let i=0;i<2;i++)await assert.rejects(api.expose(request),{code:'artifact_integrity_failed'});
   assert.equal(requests,before);assert.equal((await events(ledger)).filter(e=>e.event==='start').length,0);
   assert.equal((await api.listRoutes({home,owner})).routes.filter(r=>r.operationId===request.operationId).length,0);
   // Separate process avoids module cache and does not inherit the old factory authority.
   child=fork(fileURLToPath(import.meta.url),['fresh-factory'],{stdio:['ignore','ignore','ignore','ipc']});
   const result=await new Promise((resolve,reject)=>{
    let reply;const timer=setTimeout(()=>{child.kill();reject(new Error('child timeout; retain fixture'))},150000);
    child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('message',m=>{reply=m});
    child.once('exit',code=>{clearTimeout(timer);if(code===0&&reply?.ok)resolve(reply);else reject(new Error('child failed; retain fixture for cleanup'))});
    child.send({manifest:registry.manifest,root:registry.root,query,ledger,nonce,oldDigest:c.consentFactsDigest});
   });
   assert.equal(result.ok,true);assert.equal(await get('http://'+target),nonce);confirmed=true;
  }finally{
   if(child&&child.exitCode===null)child.kill();
   if(app)await new Promise(resolve=>{app.closeAllConnections();app.close(resolve)});
   if(confirmed){await registry?.cleanup();await rm(owned,{recursive:true,force:true})}
   // Failed/uncertain runs intentionally retain their exact owned fixture and route history.
  }
 });
}
