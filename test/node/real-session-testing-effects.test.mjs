import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createTestingGozar} from '@tnunamak/gozar/testing';
import {query} from './route-schema-check.mjs';
import net from 'node:net';
import {mkdir,mkdtemp,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

async function refused(target){
 const [host,port]=target.split(':');
 await new Promise((resolve,reject)=>{
  const socket=net.connect(Number(port),host);
  const timer=setTimeout(()=>finish(new Error('listener absence was not established')),3000);
  const finish=error=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
  socket.once('connect',()=>finish(new Error('owned listener remains reachable')));
  socket.once('error',error=>finish(error.code==='ECONNREFUSED'?null:error));
 });
}
async function commitOracle(api,q,blocked){
 const current=(await api.catalogRoutes(q)).candidates.find(row=>row.providerId===q.providerId);
 assert.ok(current);
 const scope={home:q.home,owner:q.owner,providerId:q.providerId};
 const draft=await api.beginConfigurationDraft({...scope,expectedConfigurationRevision:current.configuration.revision});
 let committed=false;
 try{
  const command={...scope,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision};
  if(blocked)await assert.rejects(api.commitConfigurationDraft(command),{code:'configuration_in_use'});
  else{await api.commitConfigurationDraft(command);committed=true;}
 }finally{if(!committed)await api.discardConfigurationDraft({...scope,draftId:draft.draftId});}
}

test('public process effects preserve the session parser, witnessed proof and exact PID cleanup',async t=>{
 let harness,root,rootInfo,parentInfo,primary;const resources=new Map(),children=[];
 let serial=0,target,proofFetches=0;
 const parent=join(homedir(),'.tmp0700');
 const exited=child=>child.exitCode!==null||child.signalCode!==null;
 async function waitClosed(record){
  let timer;
  try{await Promise.race([record.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('owned child did not close within bound')),3000);})]);}
  finally{clearTimeout(timer);}
 }
 async function startChild(){
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const record={child,closed:new Promise(resolve=>child.once('close',resolve))};children.push(record);
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  return record;
 }
 t.after(async()=>{
  const errors=[],attempt=async action=>{try{await action();}catch(error){errors.push(error);}};
  await attempt(()=>harness?.close());
  for(const record of children)await attempt(async()=>{if(!exited(record.child))record.child.kill();await waitClosed(record);});
  if(target)await attempt(()=>refused(target));
  if(root&&!primary&&!errors.length)await attempt(async()=>{
   for(const [path,original]of [[parent,parentInfo],[root,rootInfo]]){
    const current=await lstat(path);assert.ok(current.isDirectory()&&!current.isSymbolicLink());
    assert.equal(current.uid,process.getuid());assert.equal(current.mode&0o777,0o700);
    assert.equal(current.dev,original.dev);assert.equal(current.ino,original.ino);
   }
   await rm(root,{recursive:true});
  });
  if(root&&(primary||errors.length))console.error('retained process fixture root: '+JSON.stringify(root));
  if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'owned fixture cleanup failed',primary?{cause:primary}:undefined);
 });
 try{
 try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 parentInfo=await lstat(parent);assert.ok(parentInfo.isDirectory()&&!parentInfo.isSymbolicLink());
 assert.equal(parentInfo.uid,process.getuid());assert.equal(parentInfo.mode&0o777,0o700);
 root=await mkdtemp(join(parent,'process-effects-'));rootInfo=await lstat(root);
 const home=join(root,'home');await mkdir(home,{mode:0o700});
 const owner='process-effects-owner',foreign=await startChild();
 const effects=[
  {kind:'recipe',operation:'probe',handle:async()=>({stdout:'OpenSSH_9.0',stderr:'',exitCode:0})},
  {kind:'spawn',operation:'run',handle:async input=>{
   if(!input.longRunning)return {stdout:'OpenSSH_9.0',stderr:'',exitCode:0};
   target=input.args.find(arg=>/^80:127\.0\.0\.1:\d+$/.test(arg))?.replace(/^80:/,'');assert.ok(target);
   const record=await startChild(),{child}=record;
   const handle=`fixture-process-${++serial}`;resources.set(handle,record);return {handle,pid:child.pid,stdout:'https://fixture.lhr.life\n',stderr:'',exitCode:null};
  }},
  {kind:'spawn',operation:'read',handle:async({handle})=>({present:resources.get(handle)?.child.exitCode===null&&resources.get(handle)?.child.signalCode===null})},
  {kind:'spawn',operation:'close',handle:async({handle})=>{resources.get(handle)?.child.kill();return {closed:true};}},
  {kind:'network',operation:'fetch',handle:async request=>{
   proofFetches++;assert.ok(target);const url=new URL(request.url);const response=await fetch(`http://${target}${url.pathname}`,{headers:request.headers});
   const chunks=[];let before=Date.now();for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-before});before=now;}
   return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
  }},
 ];
 harness=await createTestingGozar({effects});
 // Bind every setup/catalog/route call to the same explicit owner without altering consent expressions.
 const api=Object.fromEntries(['catalogRoutes','expose','reviewRouteConsent','routeStatus','approveRouteConsent','closeRoute','beginConfigurationDraft','commitConfigurationDraft','discardConfigurationDraft']
  .map(method=>[method,request=>harness.gozar[method]({...request,owner})]));
 const q={...query({home,providerId:'localhost-run',operationId:'session-before-call',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'internet',transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}}),owner};
 const candidate=(await api.catalogRoutes(q)).candidates[0];assert.equal(candidate.eligible,true);
 const request={...q,wait:'verified',approval:{kind:'route',candidateToken:candidate.candidateToken,disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest}};
 const route=await api.expose(request);assert.equal(route.verification.status,'verified');assert.equal(route.verification.subject.target,q.target);assert.ok(route.verification.subject.bootId);assert.equal(route.operationId,q.operationId);
 assert.deepEqual((await api.expose(request)).handle,route.handle);assert.equal(serial,1);
 const review=await api.reviewRouteConsent({home,handle:route.handle});assert.equal(review.scope.reviewHandle,route.handle.id);assert.deepEqual(review.subject,route.verification.subject);
 assert.equal((await api.routeStatus({home,handle:route.handle})).published,null);
 const refreshed=await api.approveRouteConsent({home,handle:route.handle,approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});assert.equal(refreshed.verification.status,'verified');assert.deepEqual(refreshed.handle,route.handle);assert.equal(serial,1);
 await commitOracle(api,q,true);
 const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});assert.equal(stopped.cleanup.state,'confirmed');
 assert.deepEqual(stopped.handle,route.handle);
 for(const record of resources.values()){await waitClosed(record);assert.ok(exited(record.child));}
 assert.equal(exited(foreign.child),false,'foreign child must survive route close');assert.equal(foreign.child.kill(0),true);
 await refused(target);
 await commitOracle(api,q,false);
 const beforeRepeat={spawn:serial,proof:proofFetches};
 const repeated=await api.closeRoute({home,handle:route.handle,mode:'remove'});
 assert.deepEqual(repeated.handle,route.handle);assert.equal(repeated.cleanup.state,'confirmed');assert.equal(repeated.state,stopped.state);
 assert.equal((await api.expose(request)).state,'released');
 assert.deepEqual({spawn:serial,proof:proofFetches},beforeRepeat);
 assert.equal(serial,1);assert.equal(exited(foreign.child),false);assert.equal(foreign.child.kill(0),true);
 }catch(error){primary=error;throw error;}
});
