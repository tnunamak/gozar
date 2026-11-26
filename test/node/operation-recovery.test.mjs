import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,readdir,writeFile,mkdtemp,mkdir,chmod,rm,stat} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {inspect} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {query} from './route-schema-check.mjs';
import {loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {listRecordedRoutes,operationReferenceForRoute} from '../../packages/gozar-node/route-operations.mjs';
import {projectControllerObservation} from '../../packages/gozar-node/route-view.mjs';

 // One ownership boundary replaces competing after hooks and scratch's eager deletion.
async function withRecoveryCleanup(t, body, base=process.env.GOZAR_TEST_TMPDIR ?? join(homedir(),'.tmp','gozar-route-tests')) {
 await mkdir(base,{recursive:true,mode:0o700});
 const home=await mkdtemp(join(base,'op-')),owned=new Map(),confirmed=new Set(),children=[];
 let registry,api,recover,primary,failed=false;
 const diagnostic=(label,error)=>t.diagnostic(label+' '+inspect({
  stack:error?.stack??error,actual:error?.actual,expected:error?.expected,operator:error?.operator
 },{depth:8}));
 const own=route=>{
  const key=route?.handle&&JSON.stringify(route.handle);
  if(key&&route.cleanup?.state!=='confirmed'&&!(confirmed.has(key)&&route.state==='released'))owned.set(key,route.handle);
  return route;
 };
 const capture=async promise=>{try{return own(await promise);}catch(error){own(error?.route);throw error;}};
 const close=async handle=>{
  const result=await api.closeRoute({home,handle,mode:'remove'});
  if(result.cleanup.state==='confirmed'){const key=JSON.stringify(handle);owned.delete(key);confirmed.add(key);}
  return result;
 };
 try {
  await chmod(home,0o700);
  await body({home,own,capture,close,diagnostic,
   registry:value=>(registry=value),api:value=>(api=value),recover:value=>(recover=value),
   child:value=>{
    // Observe both errors and close immediately, including spawn failure.
    const closed=new Promise(resolve=>{value.once('error',error=>{diagnostic('child error',error);});value.once('close',resolve);});
    children.push({value,closed});return closed;
   }});
 } catch(error){failed=true;primary=error;diagnostic('primary failure',error);}
 const cleanupErrors=[];
 // Kill/await only exact children owned by this test, before any registry deletion.
 for(const {value,closed} of children)try{
  if(value.exitCode===null&&value.signalCode===null&&!value.kill('SIGKILL'))
   throw new Error('Could not signal owned fixture child; evidence retained at '+home);
  await closed;
 }catch(error){cleanupErrors.push(error);diagnostic('child cleanup failure',error);}
 if(recover)try{(await recover()).routes.forEach(own);}catch(error){own(error?.route);cleanupErrors.push(error);diagnostic('recovery enumeration failure',error);}
 for(const handle of [...owned.values()])try{
  const result=await close(handle);
  assert.equal(result.cleanup.state,'confirmed','owned route cleanup must be confirmed');
 }catch(error){cleanupErrors.push(error);diagnostic('route cleanup failure',error);}
 if(!cleanupErrors.length)try{await registry?.cleanup();await rm(home,{recursive:true,force:true});}
 catch(error){cleanupErrors.push(error);diagnostic('directory cleanup failure',error);}
 if(cleanupErrors.length){
  t.diagnostic('Retaining recovery evidence at '+home);
  if(failed)throw new AggregateError([primary,...cleanupErrors],'Primary failure and recovery cleanup failure',{cause:primary});
  throw new AggregateError(cleanupErrors,'Recovery cleanup failure');
 }
 if(failed)throw primary;
}

test('recovery cleanup preserves caller scratch parent mode and contents', async t=>{
 const parent=await mkdtemp(join(tmpdir(),'gozar-shared-recovery-'));
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const marker=join(parent,'caller-marker');
 await chmod(parent,0o750);
 await writeFile(marker,'keep');
 await withRecoveryCleanup(t,async ({home})=>{
  assert.equal((await stat(home)).mode&0o777,0o700);
 },parent);
 assert.equal((await stat(parent)).mode&0o777,0o750);
 assert.deepEqual(await readdir(parent),['caller-marker']);
 assert.equal(await readFile(marker,'utf8'),'keep');
});

test('host crash before saving its handle recovers by operation enumeration and exact close',async t=>withRecoveryCleanup(t,async owned=>{
 const {home}=owned,owner='crashed-host',operationId='saved-before-call';
 const registry=owned.registry(await fakeRegistry({id:'crash-recovery',dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo'}));
 const api=owned.api(createGozar({manifest:registry.manifest,root:registry.root}));
 owned.recover(()=>api.listRoutes({home,owner}));
 const q=query({home,owner,operationId,usage:{kind:'attached'},target:'127.0.0.1:1',requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const source=`import {createGozar} from '@tnunamak/gozar';\nconst api=createGozar(${JSON.stringify({manifest:registry.manifest,root:registry.root})});const q=${JSON.stringify(q)};const choice=(await api.catalogRoutes(q)).candidates[0];await api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}});process.stdout.write('allocated\\n');setInterval(()=>{},1000);\n`;
 const child=spawn(process.execPath,['--input-type=module','--eval',source],{cwd:fileURLToPath(new URL('../../',import.meta.url)),stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=owned.child(child);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture host deadline '+stderr)),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture host exited '+stderr));});});
 child.kill('SIGKILL');await exited;
 const recovered=await api.listRoutes({home,owner});recovered.routes.forEach(owned.own);assert.equal(recovered.routes.length,1);const route=recovered.routes[0];assert.equal(route.operationId,operationId);
 assert.equal((await api.listRoutes({home,owner:'other'})).routes.length,0);
 assert.equal((await owned.close(route.handle)).cleanup.state,'confirmed');
 const events=(await readFile(join(registry.root,'providers','crash-recovery','events.jsonl'),'utf8')).trim().split('\n').map(v=>JSON.parse(v).event);
 assert.equal(events.filter(v=>v==='start').length,1);assert.ok(events.includes('cleanup'));
 await assert.rejects(api.listRoutes({home:join(home,'missing')}));
}));
test('concurrent operation replay allocates once, conflicts before effects and stays terminal after close',async t=>withRecoveryCleanup(t,async owned=>{
 const {home}=owned,registry=owned.registry(await fakeRegistry({id:'operation-replay',dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo'}));
 const api=createGozar({manifest:registry.manifest,root:registry.root}),q=query({home,owner:'operation-host',operationId:'journalled-intent',usage:{kind:'attached'},target:'127.0.0.1:1',requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0],request={...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}};
 owned.api(api);
 let firstFailure,hasFailure=false;
 const expose=async()=>{try{return await owned.capture(api.expose(request));}catch(error){
  if(!hasFailure){hasFailure=true;firstFailure=error;}
  owned.own(error?.route);
  owned.diagnostic('expose failure before sibling settles',error);throw error;
 }};
 const settled=await Promise.allSettled([expose(),expose()]);
 if(hasFailure)throw firstFailure;
 const [first,second]=settled.map(result=>result.value);
 assert.deepEqual(first.handle,second.handle);assert.equal(first.handle.generation,1);
 const deps={adapters:await loadAdapters(registry),registryId:choice.consent.scope.registryId};
 const eventPath=join(registry.root,'providers','operation-replay','events.jsonl');
 const effects=async()=> (await readFile(eventPath,'utf8')).trim().split('\n').map(line=>JSON.parse(line).event).filter(event=>event==='start'||event==='proof');
 const before=await effects(),current=await listRecordedRoutes({home,owner:q.owner},deps);
 assert.equal(current.routes.length,1);assert.notEqual(first.published,null);
 const live=current.routes[0];
 for(const key of ['handle','published','properties','limits'])assert.deepEqual(live[key],first[key]);
 for(const key of ['subject','checkedAt','validUntil'])assert.deepEqual(live.verification[key],first.verification[key]);
 assert.deepEqual(await effects(),before,'enumeration must not start or refresh proof');
 assert.equal((await listRecordedRoutes({home,owner:'foreign'},deps)).routes.length,0);
 assert.equal((await listRecordedRoutes({home,owner:q.owner})).routes[0].published,null);
 assert.equal((await listRecordedRoutes({home,owner:q.owner},{...deps,registryId:'different-registry'})).routes[0].published,null);
 // Deterministic expiry at the actual pure projector using genuine admitted proof.
 const expired=projectControllerObservation(first,{now:Date.parse(first.verification.validUntil.value),
  heartbeat:false,initialSettled:true,identity:first.verification.subject});
 assert.equal(expired.published,null);assert.equal(expired.verification.status,'unverified');
 assert.deepEqual(expired.verification.subject,first.verification.subject);
 assert.equal(expired.verification.checkedAt,first.verification.checkedAt);
 // Public facade now preserves the authenticated cached observation without fresh effects.
 await assert.rejects(owned.capture(api.expose({...request,target:'127.0.0.1:2'})),{code:'operation_conflict'});
 const listed=await api.listRoutes({home,owner:q.owner});assert.equal(listed.routes.length,1);assert.equal(listed.routes[0].published,first.published);assert.equal(listed.routes[0].operationId,q.operationId);
 assert.equal((await owned.close(first.handle)).cleanup.state,'confirmed');
 const terminal=(await listRecordedRoutes({home,owner:q.owner},deps)).routes[0];
 assert.equal(terminal.state,'released');assert.equal(terminal.published,null);
 assert.equal((await owned.capture(api.expose(request))).state,'released');
 const events=await readFile(join(registry.root,'providers','operation-replay','events.jsonl'),'utf8');assert.equal(events.split('"start"').length-1,1);
 const files=await readdir(join(home,'operations'));const record=files.find(name=>name.endsWith('.json'));await writeFile(join(home,'operations',record),'{unreadable');
 await assert.rejects(api.listRoutes({home,owner:q.owner}),error=>typeof error.code==='string');
}));

test('operation bootstrap association requires the exact session and attached handle',async t=>withRecoveryCleanup(t,async ({home})=>{
 const sessionDir=join(home,'port-12345'),attachedId='att_0000000000000001';
 const session={kind:'session',id:'port-12345:dummy-session',generation:1};
 const attached={kind:'attached',id:attachedId,generation:1};
 const attachedDir=join(home,'attached',attachedId);
 await mkdir(sessionDir,{recursive:true,mode:0o700});
 await mkdir(attachedDir,{recursive:true,mode:0o700});
 const fixture={owner:'fixture-owner',operationId:'fixture-operation'};
 const bootstrap=(path,record)=>writeFile(join(path,'bootstrap.json'),JSON.stringify({...fixture,...record}),{mode:0o600});
 await bootstrap(sessionDir,{execution:'generic-session-v1',id:session.id,handle:session});
 await bootstrap(attachedDir,{id:attached.id});
 assert.deepEqual(await operationReferenceForRoute({home,handle:session}),{...fixture,handle:session});
 assert.deepEqual(await operationReferenceForRoute({home,handle:attached}),{...fixture,handle:attached});
 assert.equal(await operationReferenceForRoute({home,handle:{...session,id:'port-12345:another'}}),null);
 assert.equal(await operationReferenceForRoute({home,handle:{...session,generation:2}}),null);
 assert.equal(await operationReferenceForRoute({home,handle:{...attached,generation:2}}),null);
 await bootstrap(attachedDir,{id:'att_0000000000000002'});
 assert.equal(await operationReferenceForRoute({home,handle:attached}),null);
}));
