import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,lstat,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar,createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const listen=server=>new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
});
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const body=url=>new Promise((resolve,reject)=>{
  const request=http.get(url,{agent:false},response=>{
    let result='';response.setEncoding('utf8');response.on('data',part=>result+=part);
    response.once('end',()=>resolve(result));response.once('error',reject);
  });
  request.setTimeout(3000,()=>request.destroy(new Error('local request timeout')));
  request.once('error',reject);
});
async function until(read,predicate,label){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){const value=await read();if(predicate(value))return value;await pause(20);}
  throw new Error('Timed out: '+label);
}
test('caller SIGKILL after allocation retains one recoverable session and Stop fences late proof',
  {timeout:180000},async()=>{
  const parent=join(homedir(),'.tmp');await mkdir(parent,{recursive:true,mode:0o700});
  const info=await lstat(parent);assert.ok(info.isDirectory()&&!info.isSymbolicLink());
  assert.equal(info.mode&0o777,0o700);if(process.getuid)assert.equal(info.uid,process.getuid());
  const root=await mkdtemp(join(parent,'session-caller-crash-')),home=join(root,'home');
  const owner='caller-'+randomUUID(),id='provider-'+randomUUID(),nonce=randomUUID();
  const ledger=join(root,'provider-events.jsonl');
  let app,barrier,caller,api,handle,request,barrierResponse,cleanupConfirmed=false,callerReplied=false;
  const readEvents=async()=>{
    try{return (await readFile(ledger,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  };
  try{
    const verifier=createServiceVerifier();
    app=http.createServer((req,res)=>{if(!verifier(req,res))res.end(nonce);});
    await listen(app);const target='127.0.0.1:'+app.address().port;
    barrier=http.createServer((req,res)=>{barrierResponse=res;});
    await listen(barrier);const barrierUrl='http://127.0.0.1:'+barrier.address().port;
    const registry=await fakeRegistry({id,dir:join(root,'registry'),
      kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});
    const folder=join(registry.root,'providers',id);
    await writeFile(join(folder,'observed.mjs'),[
      "import provider from './index.mjs';",
      "import {appendFileSync} from 'node:fs';",
      "import http from 'node:http';",
      "const mark=row=>appendFileSync("+JSON.stringify(ledger)+",JSON.stringify(row)+'\\n');",
      "export default {...provider,",
      "async create(ctx,plan){const receipt=await provider.create(ctx,plan);",
      "mark({event:'allocated',origin:receipt.origin,operationId:ctx.operationId,deadlineMs:ctx.deadlineMs,generation:receipt.generation});return receipt;},",
      "async verify(ctx,receipt){mark({event:'proof-held'});",
      "await new Promise((resolve,reject)=>{const req=http.get("+JSON.stringify(barrierUrl)+",{agent:false},res=>{res.resume();res.once('end',resolve);res.once('error',reject);});req.once('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('barrier timeout')));});",
      "const result=await provider.verify(ctx,receipt);mark({event:'proof-returned',status:result.status});return result;},",
      "async remove(...args){const result=await provider.remove(...args);mark({event:'removed',removed:result.removed});return result;}",
      "};",
    ].join('\n'));
    const manifest=structuredClone(registry.manifest);manifest.providers[0].module='providers/'+id+'/observed.mjs';
    const options={manifest,root:registry.root,identity:{instanceId:randomUUID(),bootId:randomUUID()}};
    const query={schemaVersion:1,home,owner,providerId:id,target,operationId:randomUUID(),
      usage:{kind:'session',lifetimeMs:120000},
      requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
    api=createGozar(options);
    // Invalid wait is a true pre-reservation control, not a simulated crash.
    const controlCandidate=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===id);
    const control={...query,operationId:randomUUID(),wait:'invalid',approval:{kind:'route',
      candidateToken:controlCandidate.candidateToken,disclosureRevision:controlCandidate.disclosure.revision,
      consentFactsDigest:controlCandidate.consentFactsDigest}};
    await assert.rejects(api.expose(control),{code:'invalid_input'});
    assert.equal((await api.listRoutes({home,owner})).routes.filter(r=>r.operationId===control.operationId).length,0);
    assert.deepEqual(await readEvents(),[]);
    const childFile=join(root,'caller.mjs');
    await writeFile(childFile,[
      "import {createGozar} from '@tnunamak/gozar';",
      "process.once('message',async({options,query})=>{",
      "try{const api=createGozar(options);const c=(await api.catalogRoutes(query)).candidates.find(c=>c.providerId===query.providerId);",
      "const request={...query,intent:'create',wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}};",
      "process.send({type:'request',request});const route=await api.expose(request);process.send({type:'unexpected-reply',handle:route.handle});",
      "}catch(error){process.send({type:'unexpected-error',code:error.code});}});",
    ].join('\n'));
    // Root package imports resolve from the repository, not arbitrary home scratch.
    // NODE_PATH does not resolve ESM; use a repository-local entry via an explicit
    // file URL for the same public package resolved here.
    const publicModule=import.meta.resolve('@tnunamak/gozar');
    const childSource=await readFile(childFile,'utf8');
    await writeFile(childFile,childSource.replace("'@tnunamak/gozar'",JSON.stringify(publicModule)));
    caller=fork(childFile,[],{stdio:['ignore','ignore','ignore','ipc']});
    const unexpected=[];
    caller.on('message',message=>{
      if(message.type==='request')request=message.request;
      else {callerReplied=true;unexpected.push(message.type+':'+(message.code??''));}
    });
    caller.send({options,query});
    await until(async()=>request,Boolean,'caller catalog request');
    const allocated=(await until(readEvents,rows=>rows.some(r=>r.event==='allocated')&&Boolean(barrierResponse),'allocated and held proof')).find(r=>r.event==='allocated');
    assert.equal(allocated.operationId,query.operationId);assert.equal(allocated.generation,1);
    assert.equal(callerReplied,false,unexpected.join(','));
    const exit=new Promise(resolve=>caller.once('exit',(code,signal)=>resolve({code,signal})));
    assert.equal(caller.kill('SIGKILL'),true);const died=await exit;assert.equal(died.signal,'SIGKILL');
    assert.equal(callerReplied,false,'caller never received/saved the handle');
    api=createGozar(options);
    const rows=(await api.listRoutes({home,owner})).routes.filter(r=>r.operationId===query.operationId);
    assert.equal(rows.length,1);handle=rows[0].handle;
    assert.equal(handle.kind,'session');assert.equal(handle.generation,1);
    const recovered=await api.routeStatus({home,handle});
    assert.equal(recovered.expiresAt.known,true);
    const expiry=structuredClone(recovered.expiresAt);
    assert.equal(Date.parse(expiry.value),allocated.deadlineMs,'recover original absolute deadline');
    assert.equal(recovered.published,null);
    const replay=await api.expose(request);assert.deepEqual(replay.handle,handle);
    assert.deepEqual(replay.expiresAt,expiry);
    await assert.rejects(api.expose({...request,target:'127.0.0.1:1'}),{code:'operation_conflict'});
    await assert.rejects(api.expose({...request,origin:'http://127.0.0.1:1'}),{code:'operation_conflict'});
    const stopping=api.closeRoute({home,handle,mode:'remove'});
    // Late proof is released only after Stop has been requested; no fake proof.
    barrierResponse.end('continue');
    let stopped=await stopping;
    if(stopped.cleanup.state!=='confirmed'){
      assert.equal(stopped.cleanup.state,'unconfirmed');assert.equal(stopped.published,null);
      assert.ok(stopped.cleanup.message||stopped.cleanup.nextAction,'retryable debt has an explanation');
      stopped=await api.closeRoute({home,handle,mode:'remove'});
    }
    assert.equal(stopped.cleanup.state,'confirmed');cleanupConfirmed=true;
    assert.equal(stopped.state,'released');assert.deepEqual(stopped.handle,handle);
    await assert.rejects(body(allocated.origin),'removed endpoint must be independently absent');
    const terminal=await api.expose(request);assert.equal(terminal.state,'released');
    assert.deepEqual(terminal.handle,handle);assert.deepEqual(terminal.expiresAt,expiry);
    const finalRows=(await api.listRoutes({home,owner})).routes.filter(r=>r.operationId===query.operationId);
    assert.equal(finalRows.length,1);assert.equal(finalRows[0].cleanup.state,'confirmed');
    const events=await readEvents();
    assert.equal(events.filter(r=>r.event==='allocated').length,1);
    assert.ok(events.some(r=>r.event==='removed'&&r.removed===true));
    assert.equal(await body('http://'+target),nonce,'foreign app remains live');
  }finally{
    if(caller&&caller.exitCode===null&&caller.signalCode===null){const exited=new Promise(resolve=>caller.once('exit',resolve));caller.kill('SIGKILL');await exited;}
    barrierResponse?.end('cleanup');
    try{if(handle&&!cleanupConfirmed){const result=await api.closeRoute({home,handle,mode:'remove'});cleanupConfirmed=result.cleanup.state==='confirmed';}}
    finally{
      if(barrier)await close(barrier);if(app)await close(app);
      // No deletion of unconfirmed lifecycle evidence on a failed crash test.
      if(cleanupConfirmed)await rm(root,{recursive:true,force:true});
    }
  }
});
