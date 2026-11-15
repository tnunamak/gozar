import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,mkdtemp,chmod,readFile,writeFile,rm} from 'node:fs/promises';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

const freshConsumer = `
import assert from 'node:assert/strict';
import {createGozar} from '@tnunamak/gozar';
const input=JSON.parse(process.argv[1]);
const api=createGozar(input.registry),q=input.q;
let handle;
try {
  const candidate=(await api.catalogRoutes(q)).candidates[0];
  assert.ok(candidate.consent.facts.some(row=>row.id==='changed-reader'&&row.value==='fixture-reader'));
  const approval={kind:'route',candidateToken:candidate.candidateToken,
    disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest};
  const request={...q,wait:'verified',approval};
  const route=await api.expose(request);handle=route.handle;
  assert.equal(route.verification.status,'verified');assert.ok(route.published);
  const response=await fetch(route.published+'/owner-nonce');
  assert.equal(await response.text(),input.nonce);
  const replay=await api.expose(request);
  assert.deepEqual(replay.handle,handle);
  const wrong={...handle,generation:handle.generation+1};
  await assert.rejects(api.closeRoute({home:q.home,handle:wrong,mode:'remove'}));
  const still=await fetch(route.published+'/owner-nonce');
  assert.equal(await still.text(),input.nonce);
  const closed=await api.closeRoute({home:q.home,handle,mode:'remove'});
  assert.equal(closed.cleanup.state,'confirmed');assert.equal(closed.state,'released');
  const repeated=await api.closeRoute({home:q.home,handle,mode:'remove'});
  assert.equal(repeated.cleanup.state,'confirmed');
  const stoppedReplay=await api.expose(request);
  assert.equal(stoppedReplay.state,'released');assert.deepEqual(stoppedReplay.handle,handle);
  process.stdout.write(JSON.stringify({handle,stopped:stoppedReplay.state}));
} catch(error) {
  handle ??= error.route?.handle;
  throw error;
} finally {
  if(handle)await api.closeRoute({home:q.home,handle,mode:'remove'});
}
`;

test('changed registry rejects before reservation; fresh factory proves and stops one exact route',async t=>{
  const scratch=join(homedir(),'.tmp');await mkdir(scratch,{recursive:true,mode:0o700});
  const home=await mkdtemp(join(scratch,'gozar-preallocation-'));await chmod(home,0o700);
  let app,child;
  t.after(async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){
      const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;
    }
    if(app?.listening)await new Promise(resolve=>app.close(resolve));
    // Preserve recovery evidence if the child did not confirm its cleanup path.
    // Never erase uncertain provider/controller debt merely because the test failed.
    if(!child||child.exitCode===0)await rm(home,{recursive:true,force:true});
  });
  const nonce=randomUUID();let ownerRequests=0;
  app=http.createServer((req,res)=>{ownerRequests++;res.end(nonce);});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const id='fixture-'+randomUUID(),registry=await fakeRegistry({dir:join(home,'registry'),id,
    kinds:['attached'],reach:'this-device',transport:'http',protocols:[]});
  const api=createGozar({manifest:registry.manifest,root:registry.root});
  const q={schemaVersion:1,home,owner:'preallocation-owner',providerId:id,
    target:'127.0.0.1:'+app.address().port,operationId:randomUUID(),usage:{kind:'attached'},
    requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',
      address:'any',setup:'allow',protocols:[]}};
  const candidate=(await api.catalogRoutes(q)).candidates[0];assert.ok(candidate.candidateToken);
  const request={...q,wait:'verified',approval:{kind:'route',candidateToken:candidate.candidateToken,
    disclosureRevision:candidate.disclosure.revision,consentFactsDigest:candidate.consentFactsDigest}};
  const folder=join(registry.root,'providers',id),definitionPath=join(folder,'definition.json');
  const definition=JSON.parse(await readFile(definitionPath,'utf8'));
  definition.adapter.facts.push({id:'changed-reader',label:'Reader',value:'fixture-reader',
    known:true,group:'privacy',affectsConsent:true,source:'fixture',asOf:null});
  await writeFile(definitionPath,JSON.stringify(definition,null,2));
  const events=async()=>{
    try{return (await readFile(join(folder,'events.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  };
  await assert.rejects(api.expose(request),{code:'artifact_integrity_failed'});
  assert.equal(ownerRequests,0);assert.deepEqual(await events(),[]);
  const rejected=(await api.listRoutes({home,owner:q.owner})).routes.filter(row=>row.operationId===q.operationId);
  assert.deepEqual(rejected,[],'preflight rejection must not manufacture an uncloseable reservation');
  // Retry remains a rejection, not a replay of a fabricated creating/debt row.
  await assert.rejects(api.expose(request),{code:'artifact_integrity_failed'});
  assert.equal(ownerRequests,0);assert.deepEqual(await events(),[]);

  // A separate ordinary Node process is a genuinely fresh module cache/factory,
  // not private-loader manipulation. All consent is obtained there from public catalog.
  child=spawn(process.execPath,['--input-type=module','-e',freshConsumer,
    JSON.stringify({registry:{manifest:registry.manifest,root:registry.root},q,nonce})],
    {stdio:['ignore','pipe','pipe']});
  let output='',errors='';
  child.stdout.on('data',chunk=>{output+=chunk;});
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,errors);
  const result=JSON.parse(output);assert.equal(result.stopped,'released');
  const logged=await events();
  assert.equal(logged.filter(row=>row.event==='start').length,1,'no duplicate allocation on exact or stopped replay');
  assert.equal(logged.filter(row=>row.event==='cleanup').length,1);
  assert.ok(ownerRequests>0,'owned application nonce traversed the live forwarder');
  const remaining=(await api.listRoutes({home,owner:q.owner})).routes.filter(row=>row.operationId===q.operationId);
  assert.equal(remaining.length,1);assert.deepEqual(remaining[0].handle,result.handle);
  assert.equal(remaining[0].cleanup.state,'confirmed');
  const owner=await fetch('http://'+q.target+'/owner-nonce');
  assert.equal(await owner.text(),nonce,'route cleanup never closes the foreign owner application');
});
