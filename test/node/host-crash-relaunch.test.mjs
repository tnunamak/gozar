import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {fakeRegistry}=await import(pathToFileURL(join(root,'packages/gozar-node/testing.mjs')));
const {processIdentity}=await import(pathToFileURL(join(root,'packages/gozar-node/process-identity.mjs')));
const {stopController}=await import(pathToFileURL(join(root,'packages/gozar-node/controller-start.mjs')));
test('SIGKILL embedding host and lose its controller; fresh host closes retained directory then starts/stops the same port',{timeout:30000,skip:!['linux','darwin'].includes(process.platform)},async t=>{
 await mkdir(join(homedir(),'.tmp'),{recursive:true,mode:0o700});
 const home=await mkdtemp(join(homedir(),'.tmp','app54-'));
 const registry=await fakeRegistry({id:'fresh-host-recovery',dir:join(home,'registry'),kinds:['attached','session'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
 const config={manifest:registry.manifest,root:registry.root},children=[],directory=join(home,'port-18765');
 const q={schemaVersion:1,home,owner:'app-crash-owner',operationId:'before-crash',providerId:'fresh-host-recovery',target:'127.0.0.1:18765',usage:{kind:'session',lifetimeMs:60000},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
 const common=`import {createRouteApi} from ${JSON.stringify(pathToFileURL(join(root,'packages/gozar-node/route-api.mjs')).href)};import {loadAdapters} from ${JSON.stringify(pathToFileURL(join(root,'packages/gozar-node/adapter-runtime.mjs')).href)};import {readFile} from 'node:fs/promises';import {join} from 'node:path';
 const api=createRouteApi({...${JSON.stringify(config)},view:{attachedDeps:{adapters:await loadAdapters(${JSON.stringify(config)})}},acknowledgeOrigin:async r=>({acknowledged:true,origin:r.origin,handle:{id:r.handle.id,generation:r.handle.generation},attemptId:r.attemptId})});
 const q=${JSON.stringify(q)};
 const start=async operationId=>{await api.listProviders({home:q.home,owner:q.owner,refresh:true});const c=(await api.catalogRoutes(q)).candidates.find(c=>c.providerId===q.providerId);return api.expose({...q,operationId,wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}});};
 `;
 const launch=source=>{
  const child=spawn(process.execPath,['--input-type=module','--eval',source],{cwd:root,stdio:['ignore','pipe','pipe']});let stderr='',output='';
  child.stderr.on('data',b=>stderr+=String(b));const exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,stderr})));
  const line=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('fixture host output deadline: '+stderr));},10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.stdout.on('data',b=>{output+=String(b);if(output.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}}});child.once('exit',code=>{clearTimeout(timer);if(!output.includes('\n'))reject(new Error('fixture host exited '+code+': '+stderr));});});
  children.push({child,exited});return {child,exited,line};
 };
 let old;
 try{
  const first=launch(common+`const route=await start('before-crash');process.stdout.write(JSON.stringify(route)+'\\n');setInterval(()=>{},1000);`);
  old=await first.line;assert.equal(old.verification.status,'verified');
  const control=JSON.parse(await readFile(join(directory,'control.json'),'utf8'));
  assert.equal(await processIdentity(control.pid),control.startIdentity);
  first.child.kill('SIGKILL');await first.exited;
  // The customer report reaches relaunch with this controller gone. Drive that
  // exact second crash cut explicitly; never treat elapsed time as proof of exit.
  const stopped=await stopController(control);assert.notEqual(stopped.state,'unconfirmed');
  const before=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
  assert.deepEqual(before.handle,old.handle);assert.notEqual(before.phase,'released');
  const second=launch(common+`
   const old=${JSON.stringify(old.handle)};
   const closed=await api.closeRoute({home:q.home,owner:q.owner,handle:old,mode:'remove'});
   const saved=JSON.parse(await readFile(join(q.home,'port-18765','state.json'),'utf8'));
   if(saved.phase!=="released"||saved.lastView.cleanup.state!=="confirmed")throw new Error(JSON.stringify({closed:closed.cleanup,phase:saved.phase,cleanup:saved.lastView.cleanup,recoveredRemoval:saved.recoveredRemoval,resourceRemoval:saved.resourceRemoval}));
   let controlAbsent=false;try{await readFile(join(q.home,'port-18765','control.json'),'utf8');}catch(e){if(e.code==='ENOENT')controlAbsent=true;else throw e;}
   const next=await start('after-crash');
   const final=await api.closeRoute({home:q.home,owner:q.owner,handle:next.handle,mode:'remove'});
   process.stdout.write(JSON.stringify({closed,saved,controlAbsent,next,final})+'\\n');process.exit(0);`);
  const result=await second.line;
  assert.equal(result.closed.cleanup.state,'confirmed');assert.equal(result.saved.phase,'released');
  assert.equal(result.saved.lastView.cleanup.state,'confirmed');assert.equal(result.controlAbsent,true);
  assert.notEqual(result.next.handle.id,old.handle.id);assert.equal(result.next.verification.status,'verified');
  assert.equal(result.final.cleanup.state,'confirmed');assert.equal((await second.exited).code,0);
 }finally{
  for(const c of children){if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGKILL');await c.exited;}
  const control=JSON.parse(await readFile(join(directory,'control.json'),'utf8').catch(()=>'null'));
  if(control){const stopped=await stopController(control);if(stopped.state==='unconfirmed')t.diagnostic('Retained owned controller evidence at '+home);assert.notEqual(stopped.state,'unconfirmed');}
  await registry.cleanup();await rm(home,{recursive:true,force:true});
 }
});
