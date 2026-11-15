// Owning pre-publication lifecycle only: this controller proves only its own process/socket exit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {openSessionRoute} from '../../packages/gozar-node/attached-route.mjs';
import {control,launch} from '../../packages/gozar-node/daemon.mjs';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {query,stubAdapter,tokenStubs} from './route-schema-check.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const live=child=>child.exitCode===null&&child.signalCode===null;
const journalUrl=new URL('../../packages/gozar-node/journal.mjs',import.meta.url).href;
const controllerSource=`import net from 'node:net';
import {readFile,chmod,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite,processIdentity} from ${JSON.stringify(journalUrl)};
const directory=process.argv[2],config=JSON.parse(await readFile(join(directory,'bootstrap.json'),'utf8'));
const nonce='owned-lifecycle-fixture',path=join(directory,'control.sock');
let stopping=false;
const shutdown=()=>{if(stopping)return;stopping=true;server.close(async()=>{await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});});};
const server=net.createServer(socket=>{
 let input='';socket.on('error',()=>{});
 socket.on('data',chunk=>{
  input+=chunk;if(!input.includes('\\n'))return;
  const {nonce:provided,command}=JSON.parse(input.split('\\n')[0]);
  if(provided!==nonce){socket.destroy();return;}
  const stop=command.type==='stop';
  // No provider resources are allocated; actual owned PID/socket exit is asserted independently.
  socket.end(JSON.stringify({snapshot:{sessionId:config.sessionId,adapterId:config.adapterId,phase:stop?'stopped':'starting',...(stop?{resources:[]}:{})},...(stop?{localCleanupFailures:[]}:{})})+'\\n',()=>{if(stop)shutdown();});
 });
});
process.on('SIGTERM',shutdown);
await new Promise(resolve=>server.listen(path,resolve));await chmod(path,0o600);
await atomicWrite(join(directory,'control.json'),{pid:process.pid,startIdentity:await processIdentity(process.pid),nonce});
`;
async function gone(child,directory){
 for(let end=Date.now()+5000;Date.now()<end;await sleep(20)){
  if(!live(child)){
   assert.equal(await processIdentity(child.pid),null,'owned PID must be absent');
   await assert.rejects(lstat(join(directory,'control.sock')),e=>e.code==='ENOENT','owned socket must be absent');
   return;
  }
 }
 assert.fail('owned fixture child did not exit');
}
async function world(t){
 let home,original;const children=[];
 t.after(async()=>{
  const failures=[];
  for(const {child,directory} of children){
   try{if(live(child))child.kill('SIGTERM');await gone(child,directory);}catch(e){failures.push(e);}
  }
  if(home&&failures.length===0){
   const current=await lstat(home);assert.equal(current.dev,original.dev);assert.equal(current.ino,original.ino);
   assert.ok(current.isDirectory()&&!current.isSymbolicLink());await rm(home,{recursive:true});
  }
  if(failures.length)throw new AggregateError(failures,'owned controller cleanup failed; directory retained');
 });
 const parent=join(homedir(),'.tmp0700');
 try{await mkdir(parent,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const p=await lstat(parent);assert.ok(p.isDirectory()&&!p.isSymbolicLink());
 assert.equal(p.uid,process.getuid());assert.equal(p.mode&0o777,0o700);
 home=await mkdtemp(join(parent,'sc-'));original=await lstat(home);
 const script=join(home,'controller.mjs');await writeFile(script,controllerSource,{mode:0o600});
 const start=async(directory,config)=>{
  await mkdir(directory,{mode:0o700});await writeFile(join(directory,'bootstrap.json'),JSON.stringify(config),{mode:0o600});
  const child=spawn(process.execPath,[script,directory],{detached:true,stdio:'ignore'});
  children.push({child,directory});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  for(let end=Date.now()+5000;Date.now()<end;await sleep(20)){
   assert.ok(live(child),'fixture startup child exited');
   try{const reply=await control(directory,{type:'status'},200);assert.equal(reply.snapshot.sessionId,config.sessionId);return child;}
   catch(e){if(e.code!=='ENOENT'&&e.code!=='ECONNREFUSED')throw e;}
  }
  assert.fail('fixture control readiness timed out');
 };
 const port=8799,directory=join(home,'port-'+port),tokens=tokenStubs();
 const q=query({home,target:'127.0.0.1:'+port,usage:{kind:'session',lifetimeMs:60000}});
 const open=async deps=>{
  const {token}=await tokens.issue({home,binding:tokens.consentBinding(q,home,'disc-stub-b'),
   grant:{adapterId:'stub-b',planDigest:'plan-stub-b-'+q.target,observedResource:'res-stub-b'}});
  return openSessionRoute({...q,approval:{candidateToken:token,disclosureRevision:'disc-stub-b'},wait:'allocated'},
   {adapters:[stubAdapter('stub-b')],redeem:tokens.redeem,consentBinding:tokens.consentBinding,platform:'linux',
    readContext:{now:()=>Date.now(),configuration:async()=>null,probe:async()=>assert.fail('no probe at failed launch boundary'),verifyChallenge:async()=>assert.fail('no fabricated proof')},...deps});
 };
 return {home,directory,port,q,start,open};
}
test('failed launch leaves different controller in the SAME session directory untouched',{timeout:20000},async t=>{
 const w=await world(t),foreignId='foreign-'+randomUUID();
 const child=await w.start(w.directory,{sessionId:foreignId,targetPort:w.port,adapterId:'stub-b',owner:w.q.owner});
 const before=await Promise.all(['bootstrap.json','control.json'].map(n=>readFile(join(w.directory,n))));
 const refusal=Object.assign(new Error('occupied session directory'),{code:'route_conflict'});
 let stops=0,expected;
 const error=await w.open({startSession:async options=>{expected=options.sessionId;assert.notEqual(expected,foreignId);throw refusal;},
  stopSession:async()=>{stops++;return control(w.directory,{type:'stop'},1000);}}).then(()=>assert.fail('launch must refuse'),e=>e);
 assert.equal(error.code,'route_conflict');assert.equal(error.message,refusal.message);
 assert.equal(stops,0,'foreign stop callback must never run');
 assert.ok(live(child));assert.equal((await control(w.directory,{type:'status'},1000)).snapshot.sessionId,foreignId);
 const after=await Promise.all(['bootstrap.json','control.json'].map(n=>readFile(join(w.directory,n))));
 assert.deepEqual(after,before,'foreign bootstrap and control bytes are immutable on refusal');
});
test('matching owned failed allocation is stopped while independent foreign child survives',{timeout:20000},async t=>{
 const w=await world(t),other=join(w.home,'other'),foreignId='foreign-'+randomUUID();
 const foreign=await w.start(other,{sessionId:foreignId,targetPort:8800,adapterId:'stub-b'});
 const before=await Promise.all(['bootstrap.json','control.json'].map(n=>readFile(join(other,n))));
 const refusal=Object.assign(new Error('owned allocation refused before publication'),{code:'provider_unavailable'});
 let owned,expected,stops=0;
 const error=await w.open({startSession:async options=>{
  expected=options.sessionId;
  owned=await w.start(options.directory,{sessionId:expected,targetPort:options.port,adapterId:options.adapterId,owner:options.owner,operationId:options.operationId??null});
  throw refusal;
 },stopSession:async()=>{stops++;return control(w.directory,{type:'stop'},1000);}}).then(()=>assert.fail('launch must refuse'),e=>e);
 assert.equal(error.code,'provider_unavailable');assert.equal(stops,1);
 assert.equal(error.route.handle.id,'port-'+w.port+':'+expected);
 assert.equal(error.route.cleanup.state,'confirmed');
 await gone(owned,w.directory);
 assert.ok(live(foreign));assert.equal((await control(other,{type:'status'},1000)).snapshot.sessionId,foreignId);
 assert.deepEqual(await Promise.all(['bootstrap.json','control.json'].map(n=>readFile(join(other,n)))),before);
});

for(const supplied of ['different','missing'])test('live launch refuses '+supplied+' expected incarnation without touching foreign controller',{timeout:20000},async t=>{
 const w=await world(t),sessionId='foreign-'+randomUUID();
 const config={targetPort:w.port,adapterId:'stub-b',...(supplied==='missing'?{}:{sessionId})};
 const child=await w.start(w.directory,config);
 const before=await Promise.all(['bootstrap.json','control.json'].map(name=>readFile(join(w.directory,name))));
 const marker=join(w.home,'unexpected-launch'),executable=join(w.home,'unexpected.mjs');
 await writeFile(executable,"import {writeFile} from 'node:fs/promises'; await writeFile("+JSON.stringify(marker)+",'spawned');");
 let kills=0;
 await assert.rejects(launch(w.directory,{targetPort:w.port,sessionId:'reserved-'+randomUUID()},executable,{
  startupTimeoutMs:500,kill:()=>{kills++;assert.fail('foreign controller must not be signalled');},
 }),{code:'route_conflict'});
 assert.equal(kills,0);assert.ok(live(child));
 assert.deepEqual((await control(w.directory,{type:'status'},1000)).snapshot,
  {adapterId:'stub-b',phase:'starting',...(supplied==='missing'?{}:{sessionId})});
 assert.deepEqual(await Promise.all(['bootstrap.json','control.json'].map(name=>readFile(join(w.directory,name)))),before);
 for(const path of [marker,join(w.directory,'launch.json')])
  await assert.rejects(lstat(path),error=>error.code==='ENOENT');
});

test('live launch matching expected incarnation and omitted legacy identity reuse exact status',{timeout:20000},async t=>{
 const w=await world(t),sessionId='owned-'+randomUUID();
 const child=await w.start(w.directory,{sessionId,targetPort:w.port,adapterId:'stub-b'});
 const before=await Promise.all(['bootstrap.json','control.json'].map(name=>readFile(join(w.directory,name))));
 const expected=await control(w.directory,{type:'status'},1000);
 for(const configuration of [{sessionId,targetPort:w.port},{targetPort:w.port}]){
  const reply=await launch(w.directory,configuration,join(w.home,'must-not-start.mjs'),{
   kill:()=>assert.fail('reused controller must not be signalled'),
  });
  assert.deepEqual(reply,expected);assert.ok(live(child));
  assert.deepEqual(await control(w.directory,{type:'status'},1000),expected);
  assert.deepEqual(await Promise.all(['bootstrap.json','control.json'].map(name=>readFile(join(w.directory,name)))),before);
  await assert.rejects(lstat(join(w.directory,'launch.json')),error=>error.code==='ENOENT');
 }
});
