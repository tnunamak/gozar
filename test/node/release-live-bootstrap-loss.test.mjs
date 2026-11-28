import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServiceVerifier} from '@tnunamak/gozar';
import {mkdir,mkdtemp,readFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createTestingGozar} from '../../packages/gozar-node/testing.mjs';
import {processIdentity} from '../../packages/gozar-node/process-identity.mjs';
import {query} from './route-schema-check.mjs';

const listen = server => new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
});
const stop = server => new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const localBody = async address => (await fetch('http://'+address,{signal:AbortSignal.timeout(2000)})).text();
const readJSON = async file => JSON.parse(await readFile(file,'utf8'));

test('live attached route with missing bootstrap retains exact cleanup custody', {timeout:30000}, async ()=>{
  const scratch=join(homedir(),'.tmp');await mkdir(scratch,{recursive:true,mode:0o700});
  const home=await mkdtemp(join(scratch,'g-loss-')),owner='bootstrap-loss-fixture';
  const verifier=createServiceVerifier();
  const app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('owned-application');});
  const foreign=http.createServer((_q,res)=>res.end('foreign-application'));
  const ledger=new Map();let serial=0,providerCloses=0;
  const rule=(kind,operation,handle)=>({kind,operation,handle});
  const fixture=await createTestingGozar({effects:[
    rule('process-runtime','detect',async()=>({available:true})),
    rule('recipe','probe',async()=>({ok:false})),
    rule('sdk-listener','detect',async()=>({available:true})),
    rule('sdk-listener','open',async({options})=>{
      const handle='owned-'+(++serial),url='https://'+options.domain;
      ledger.set(handle,{url,target:options.addr});return {handle,url};
    }),
    rule('sdk-listener','read',async({handle})=>ledger.has(handle)?{present:true,url:ledger.get(handle).url}:{present:false}),
    rule('sdk-listener','close',async({handle})=>{providerCloses++;ledger.delete(handle);return {closed:true};}),
    rule('network','fetch',async request=>{
      const parsed=new URL(request.url),resource=[...ledger.values()].find(value=>value.url===parsed.origin);
      assert.ok(resource,'destinations are confined to the owned loopback fixture');
      const response=await fetch('http://'+resource.target+parsed.pathname+parsed.search,{method:request.method,headers:request.headers});
      const chunks=[];let last=Date.now();
      for await(const chunk of response.body){const now=Date.now();chunks.push({data:Buffer.from(chunk).toString('base64'),delayMs:now-last});last=now;}
      return {status:response.status,headers:Object.fromEntries(response.headers),chunks};
    }),
  ]});
  const {gozar}=fixture;
  let handle,hidden,original,cleanupConfirmed=false;
  try{
    const appPort=await listen(app),foreignPort=await listen(foreign);
    const base={home,owner};
    const provider=(await gozar.listProviders(base)).providers.find(row=>row.transport==='https'&&row.availability.attached.state!=='unsupported'&&!row.configuration.inputRequirements.some(i=>i.kind==='https-origin'));
    assert.ok(provider);
    const scope={...base,providerId:provider.providerId};
    let configuration=provider.configuration;
    for(const requirement of configuration.inputRequirements){
      const action=configuration.actions.find(a=>a.id===requirement.actionId);let input;
      if(requirement.secret){
        const {handle:secretHandle}=await gozar.storeSecret({...scope,inputId:requirement.id,scopeId:configuration.scopeId,
          expectedConfigurationRevision:configuration.revision,bytes:new TextEncoder().encode('fixture-only')});
        input={secretHandle};
      }else if(requirement.kind==='text'){
        const probe=http.createServer();const port=await listen(probe);await stop(probe);
        input={value:String(port)};
      }else input={value:'fixture.example.invalid'};
      configuration=(await gozar.runSetupAction({...scope,expectedConfigurationRevision:configuration.revision,actionId:action.id,...input,
        approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}})).configuration;
    }
    const intent=query({...scope,operationId:'bootstrap-loss-fixture',usage:{kind:'attached'},target:'127.0.0.1:'+appPort,
      requirements:{reach:provider.reach,transport:'https',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
    const candidate=(await gozar.catalogRoutes(intent)).candidates[0];assert.equal(candidate.eligible,true);
    const route=await gozar.expose({...intent,wait:'verified',approval:{kind:'route',candidateToken:candidate.candidateToken,
      consentFactsDigest:candidate.consentFactsDigest,disclosureRevision:candidate.disclosure.revision}});
    assert.equal(route.state,'usable');handle=route.handle;assert.equal(handle.kind,'attached');
    const reference={...base,handle,mode:'remove'};
    const directory=join(home,'attached',handle.id), control=await readJSON(join(directory,'control.json'));
    assert.ok(control.runtimeSocket && typeof control.runtimeSocket==='object');
    assert.deepEqual(await processIdentity(control.pid),control.startIdentity);
    const [transport]=ledger.values();assert.ok(transport);
    assert.equal(await localBody(transport.target),'owned-application');
    const {draftId,configuration:draft}=await gozar.beginConfigurationDraft({...scope,expectedConfigurationRevision:configuration.revision});
    original=join(directory,'bootstrap.json');const moved=join(directory,'bootstrap.saved');
    const bytes=await readFile(original);
    await rename(original,moved);hidden=moved;
    try{
      await assert.rejects(gozar.closeRoute(reference),{code:'cleanup_debt'});
      await assert.rejects(gozar.commitConfigurationDraft({...scope,draftId,scopeId:draft.scopeId,expectedConfigurationRevision:draft.revision}),{code:'configuration_in_use'});
      assert.equal(providerCloses,0);assert.equal(ledger.size,1);
      assert.deepEqual(await processIdentity(control.pid),control.startIdentity);
      assert.equal(await localBody(transport.target),'owned-application');
      assert.equal(await localBody('127.0.0.1:'+foreignPort),'foreign-application');
    }finally{await rename(hidden,original);hidden=undefined;}
    assert.deepEqual(await readFile(original),bytes,'restore the identical owned bootstrap');
    const closed=await gozar.closeRoute(reference);
    assert.equal(closed.cleanup.state,'confirmed');assert.equal(providerCloses,1);assert.equal(ledger.size,0);
    const repeated=await gozar.closeRoute(reference);
    assert.equal(repeated.cleanup.state,'confirmed');assert.equal(providerCloses,1);
    assert.equal(await localBody('127.0.0.1:'+foreignPort),'foreign-application');
    cleanupConfirmed=true;
  }finally{
    try{
      if(hidden)await rename(hidden,original);
      await fixture.close();
      cleanupConfirmed=true;
    }finally{
      await Promise.all([stop(app),stop(foreign)]);
      if(cleanupConfirmed)await rm(home,{recursive:true,force:true});
    }
  }
});
