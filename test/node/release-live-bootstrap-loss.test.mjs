import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {processIdentity} from '../../packages/gozar-node/journal.mjs';
import {scratch,query} from './route-schema-check.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(check,label){
 const deadline=Date.now()+10000;
 do{if(await check())return;await delay(40);}while(Date.now()<deadline);
 assert.fail(label);
}
function listening(endpoint){
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(endpoint);
  const finish=(error,value)=>{socket.destroy();error?reject(error):resolve(value);};
  socket.once('connect',()=>finish(null,true));
  socket.once('error',error=>{
   if(['ECONNREFUSED','ENOENT'].includes(error.code))finish(null,false);
   else finish(error);
  });
  socket.setTimeout(1000,()=>finish(new Error('fixture socket observation timed out')));
 });
}
function appReply(port){
 return new Promise((resolve,reject)=>{
  const request=http.get({hostname:'127.0.0.1',port,path:'/'},response=>{
   let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);
   response.once('error',reject);response.once('end',()=>resolve(body));
  });
  request.once('error',reject);request.setTimeout(1000,()=>request.destroy(new Error('fixture app timed out')));
 });
}

test('live operation-bound attached route retains cleanup debt and its hold while its owned bootstrap is unavailable', {timeout:60000}, async t=>{
 const home=await scratch(t),owner='live-bootstrap-owner',id='live-bootstrap';
 const app=http.createServer((_request,response)=>response.end('foreign-app-still-alive'));
 await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
 const appPort=app.address().port;
 let registry,api,handle,bootstrapPath,hiddenPath,hidden=false,control,controlPath,providerEndpoint;
 const failures=[];
 try{
  registry=await fakeRegistry({dir:join(home,'registry'),id,kinds:['attached'],reach:'this-device',transport:'http',protocols:[]});
  const options={manifest:registry.manifest,root:registry.root};
  api=createGozar(options);
  const q=query({home,owner,target:'127.0.0.1:'+appPort,usage:{kind:'attached'},
   requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const choice=(await api.catalogRoutes(q)).candidates[0];assert.ok(choice?.candidateToken);
  const opened=await api.expose({...q,operationId:'live-bootstrap-operation',wait:'allocated',
   approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}});
  handle=opened.handle;assert.equal(handle.kind,'attached');assert.match(handle.id,/^att_[0-9a-f]{16}$/);
  assert.equal(opened.operationId,'live-bootstrap-operation');
  assert.notEqual(opened.cleanup.state,'confirmed');
  // Derive the owned directory from the exact public handle, as attached-route does.
  const directory=join(home,'attached',handle.id);
  bootstrapPath=join(directory,'bootstrap.json');hiddenPath=join(directory,'bootstrap.fixture-held.json');
  const original=await readFile(bootstrapPath);
  const bootstrap=JSON.parse(original);
  assert.equal(bootstrap.id,handle.id);assert.equal(bootstrap.owner,owner);
  assert.equal(bootstrap.operationId,'live-bootstrap-operation');assert.equal(bootstrap.adapterId,id);
  controlPath=join(directory,'control.sock');
  control=JSON.parse(await readFile(join(directory,'control.json'),'utf8'));
  assert.equal(await processIdentity(control.pid),control.startIdentity);
  assert.ok(await listening({path:controlPath}));
  const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
  assert.deepEqual(state.handle,handle);assert.ok(state.receipt);
  const origin=new URL(state.receipt.origin);
  assert.equal(origin.hostname,'127.0.0.1');
  providerEndpoint={host:origin.hostname,port:Number(origin.port)};
  assert.ok(providerEndpoint.port>0);assert.ok(await listening(providerEndpoint));
  const eventsPath=join(registry.root,'providers',id,'events.jsonl');
  const events=()=>readFile(eventsPath,'utf8'); // Missing evidence is an error, not absence.
  const before=await events();assert.match(before,/"event":"start"/);
  assert.doesNotMatch(before,/"event":"(?:stop|cleanup)"/);
  const current=(await api.listProviders({home,owner})).providers[0].configuration;
  const draft=await api.beginConfigurationDraft({home,owner,providerId:id,expectedConfigurationRevision:current.revision});
  const commit=currentApi=>currentApi.commitConfigurationDraft({home,owner,providerId:id,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision});
  await assert.rejects(commit(api),{code:'configuration_in_use'});

  await rename(bootstrapPath,hiddenPath);hidden=true;
  let phaseFailure;
  try{
   // Both calls use the exact live handle; the second factory has no in-memory history.
   for(const currentApi of [api,createGozar(options)]){
    await assert.rejects(currentApi.closeRoute({home,owner,handle,mode:'remove'}),error=>{
     assert.equal(error.code,'cleanup_debt');
     if(error.route){assert.deepEqual(error.route.handle,handle);assert.notEqual(error.route.cleanup.state,'confirmed');}
     return true;
    });
    await assert.rejects(commit(currentApi),{code:'configuration_in_use'});
    assert.equal(await processIdentity(control.pid),control.startIdentity);
    assert.ok(await listening({path:controlPath}));
    assert.ok(await listening(providerEndpoint));
    assert.equal(await events(),before,'a missing bootstrap must not authorize provider removal');
    assert.equal(await appReply(appPort),'foreign-app-still-alive');
   }
  }catch(error){phaseFailure=error;}
  finally{
   // Restore actual bytes by rename before any teardown or real close.
   try{
    await rename(hiddenPath,bootstrapPath);hidden=false;
    assert.deepEqual(await readFile(bootstrapPath),original);
   }catch(error){
    if(phaseFailure)throw new AggregateError([phaseFailure,error],'Bootstrap-loss assertion and restoration both failed');
    throw error;
   }
  }
  if(phaseFailure)throw phaseFailure;
  const closed=await api.closeRoute({home,owner,handle,mode:'remove'});
  assert.deepEqual(closed.handle,handle);assert.equal(closed.cleanup.state,'confirmed');
  await eventually(async()=>await processIdentity(control.pid)!==control.startIdentity,'owned controller did not exit');
  await eventually(async()=>!await listening({path:controlPath}),'owned control socket still accepts connections');
  await eventually(async()=>!await listening(providerEndpoint),'owned provider socket still accepts connections');
  const after=await events();assert.match(after,/"event":"stop"/);assert.match(after,/"event":"cleanup"/);
  assert.equal(await appReply(appPort),'foreign-app-still-alive');
  await commit(api);
  // Genuine terminal close remains idempotent after the resource and hold are gone.
  assert.equal((await createGozar(options).closeRoute({home,owner,handle,mode:'remove'})).cleanup.state,'confirmed');
 }catch(error){failures.push(error);}
 finally{
  if(hidden){
   try{await rename(hiddenPath,bootstrapPath);hidden=false;}catch(error){failures.push(error);}
  }
  // No unowned PID is killed. Cleanup uses only the exact public route handle.
  if(api&&handle&&!hidden){
   try{
    const closed=await api.closeRoute({home,owner,handle,mode:'remove'});
    assert.equal(closed.cleanup.state,'confirmed');
    if(control)await eventually(async()=>await processIdentity(control.pid)!==control.startIdentity,'cleanup controller remained live');
    if(controlPath)await eventually(async()=>!await listening({path:controlPath}),'cleanup control socket remained live');
    if(providerEndpoint)await eventually(async()=>!await listening(providerEndpoint),'cleanup provider socket remained live');
   }catch(error){failures.push(error);}
  }
  try{assert.equal(await appReply(appPort),'foreign-app-still-alive');}catch(error){failures.push(error);}
  try{app.closeAllConnections();await new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve()));}catch(error){failures.push(error);}
  if(registry){try{await registry.cleanup();}catch(error){failures.push(error);}}
 }
 if(failures.length)throw new AggregateError(failures,'Live bootstrap-loss regression or cleanup failed');
});
