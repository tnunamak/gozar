// A real host process allocates a route with wait:'verified' and is SIGKILLed. A new incarnation replays the same
// operationId. Public API only; the fixture provider ledger proves no second allocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {readFile,mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGozar,createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry,createTestingGozar} from '@tnunamak/gozar/testing';
import {query} from './route-schema-check.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const SETTLE_MS=20_000;
const proxyEffect=port=>`{kind:'network',operation:'fetch',handle:request=>new Promise((resolve,reject)=>{const url=new URL(request.url);import('node:http').then(({default:http})=>{http.get('http://127.0.0.1:'+${port}+url.pathname+url.search,{headers:request.headers},response=>{const chunks=[];let before=Date.now();response.on('data',c=>{const n=Date.now();chunks.push({data:c.toString('base64'),delayMs:n-before});before=n;});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks}));}).on('error',reject);});})}`;
const proxy=port=>({kind:'network',operation:'fetch',handle:request=>new Promise((resolve,reject)=>{
 const url=new URL(request.url);
 http.get(`http://127.0.0.1:${port}${url.pathname}${url.search}`,{headers:request.headers},response=>{
  const chunks=[];let before=Date.now();
  response.on('data',c=>{const n=Date.now();chunks.push({data:c.toString('base64'),delayMs:n-before});before=n;});
  response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,chunks}));
 }).on('error',reject);
})});

async function scenario(t,usage){
 const durable=usage==='durable';
 const base=process.env.GOZAR_TEST_TMPDIR??join(homedir(),'.tmp','gozar-route-tests');
 await mkdir(base,{recursive:true,mode:0o700});await chmod(base,0o700);
 const home=await mkdtemp(join(base,'loss-')),owner='creator-loss-host',operationId='creator-loss-op';
 const verifier=createServiceVerifier(),app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('app');});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const port=app.address().port,registry=await fakeRegistry({id:'creator-loss',dir:join(home,'registry'),kinds:['attached',usage],
  reach:durable?'internet':'this-device',transport:durable?'https':'tcp',proofProtocol:durable?'http':'echo'});
 const q=query({home,owner,operationId,target:`127.0.0.1:${port}`,usage:durable?{kind:'durable',routeId:'creator-loss-route'}:{kind:'session',lifetimeMs:120_000},
  requirements:{reach:durable?'internet':'this-device',transport:durable?'https':'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const registryOptions={manifest:registry.manifest,root:registry.root};
 const source=`import {createGozar} from '@tnunamak/gozar';import {createTestingGozar} from '@tnunamak/gozar/testing';
const q=${JSON.stringify(q)},o=${JSON.stringify(registryOptions)},identity={instanceId:'creator-loss-instance',bootId:'creator-boot'};
const api=${durable}?(await createTestingGozar({...o,identity,effects:[${proxyEffect(port)}]})).gozar:createGozar({...o,identity});
const choice=(await api.catalogRoutes(q)).candidates[0];
const route=await api.${durable?'ensureRoute':'expose'}({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}});
console.log(JSON.stringify({published:route.published,status:route.verification.status}));setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','--eval',source],{cwd:root,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=new Promise(resolve=>child.once('close',resolve));
 const owned={child,handles:[],harnesses:[]};
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  const errors=[];
  try{
   const api=createGozar({...registryOptions,identity:{instanceId:'creator-loss-instance',bootId:'cleanup-boot'}});
   for(const route of (await api.listRoutes({home,owner})).routes){
    const closed=await api.closeRoute({home,handle:route.handle,mode:'remove'});
    if(closed.cleanup.state!=='confirmed')errors.push(new Error('cleanup unconfirmed for '+route.handle.id));
   }
  }catch(error){errors.push(error);}
  for(const harness of owned.harnesses)await harness.close().catch(error=>errors.push(error));
  await new Promise(resolve=>app.close(resolve));
  if(!errors.length){await registry.cleanup();await rm(home,{recursive:true,force:true});}
  else throw new AggregateError(errors,'cleanup retained evidence at '+home);
 });
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('creator never allocated '+stderr)),15_000);
  child.stdout.once('data',data=>{clearTimeout(timer);assert.equal(JSON.parse(String(data)).status,'verified');resolve();});
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('creator exited early '+stderr));});
 });
 child.kill('SIGKILL');await exited;
 const requestFor=async api=>{
  const choice=(await api.catalogRoutes(q)).candidates[0];
  return {...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}};
 };
 const replayer=async({effects})=>{
  const identity={instanceId:'creator-loss-instance',bootId:'replay-boot'};
  if(effects){const harness=await createTestingGozar({...registryOptions,identity,effects:[proxy(port)]});owned.harnesses.push(harness);return harness.gozar;}
  return createGozar({...registryOptions,identity});
 };
 const starts=async()=>{
  const path=join(registry.root,'providers','creator-loss',durable?'store.json':'events.jsonl');
  const text=await readFile(path,'utf8');
  return durable?Object.keys(JSON.parse(text).entries).length:text.split('\n').filter(Boolean).filter(line=>JSON.parse(line).event==='start').length;
 };
 const replay=async(api,request)=>{
  let timer;
  try{
   return await Promise.race([api[durable?'ensureRoute':'expose'](request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('replay did not settle in '+SETTLE_MS+'ms')),SETTLE_MS);})]);
  }finally{clearTimeout(timer);}
 };
 return {home,owner,replayer,requestFor,replay,starts,durable};
}

for(const usage of ['session','durable'])test(`${usage}: a replay after a killed creator settles with the retained recovery view, one allocation, exact close`,{timeout:60_000},async t=>{
 const s=await scenario(t,usage),api=await s.replayer({effects:false});
 const listed=(await api.listRoutes({home:s.home,owner:s.owner})).routes;assert.equal(listed.length,1);
 const before=await s.starts(),started=Date.now();
 const replayed=await s.replay(api,await s.requestFor(api));
 assert.ok(Date.now()-started<SETTLE_MS);
 assert.deepEqual(replayed.handle,listed[0].handle,'same handle');assert.equal(replayed.operationId,'creator-loss-op');
 assert.equal(replayed.published,null,'a recovery view is never published');assert.equal(replayed.ingress,null);
 assert.notEqual(replayed.verification.status,'verified');assert.equal(replayed.cleanup.state,'unconfirmed');
 assert.equal(replayed.cleanup.nextAction.id,'retry-close');
 assert.equal(await s.starts(),before,'no second allocation');
 assert.equal((await api.listRoutes({home:s.home,owner:s.owner})).routes.length,1);
 const closed=await api.closeRoute({home:s.home,handle:replayed.handle,mode:'remove'});assert.equal(closed.cleanup.state,'confirmed');
 // A stopped operation key stays terminal and never restarts forwarding.
 const stopped=await s.replay(api,await s.requestFor(api));
 assert.deepEqual(stopped.handle,replayed.handle);assert.equal(stopped.published,null);assert.equal(stopped.cleanup.state,'confirmed');
 assert.equal(await s.starts(),s.durable?0:before,'the removed durable rule is not written again');
});

test('durable: a replay whose own host can re-prove the route returns it verified, not a recovery view',{timeout:60_000},async t=>{
 const s=await scenario(t,'durable'),api=await s.replayer({effects:true}),before=await s.starts();
 const replayed=await s.replay(api,await s.requestFor(api));
 assert.equal(replayed.verification.status,'verified');assert.equal(replayed.state,'usable');
 assert.equal(typeof replayed.published,'string');assert.equal(replayed.verification.subject.bootId,'replay-boot','the old boot cannot authorize publication');
 assert.equal(replayed.cleanup.state,'none');assert.equal(await s.starts(),before);
 assert.equal((await api.closeRoute({home:s.home,handle:replayed.handle,mode:'remove'})).cleanup.state,'confirmed');
});
