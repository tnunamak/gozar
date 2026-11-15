// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, lstat, readFile, writeFile, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar, createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';

const listen = server => new Promise((resolve,reject) => {
  server.once('error',reject); server.listen(0,'127.0.0.1',resolve);
});
const body = url => new Promise((resolve,reject) => {
  const request=http.get(url,{agent:false},response=>{
    let value='';response.setEncoding('utf8');response.on('data',chunk=>value+=chunk);
    response.on('end',()=>resolve(value));response.on('error',reject);
  });
  request.setTimeout(5000,()=>request.destroy(new Error('fixture request timed out')));
  request.on('error',reject);
});
const close = server => new Promise(resolve=>{
  server.closeAllConnections(); server.close(resolve);
});

// Both cases use the same advertised attached+session provider, including the
// first-kind-attached ordering that previously concealed the missing transport.
for (const kind of ['attached','session']) test(
  'generic HTTP fixture forwards an actual '+kind+' route',
  {timeout:180000}, async () => {
    const parent=join(homedir(),'.tmp');
    await mkdir(parent,{recursive:true,mode:0o700});
    const info=await lstat(parent);
    assert.ok(info.isDirectory()&&!info.isSymbolicLink());
    assert.equal(info.mode&0o777,0o700);
    if(process.getuid) assert.equal(info.uid,process.getuid());
    const root=await mkdtemp(join(parent,'gozar-session-origin-'));
    const home=join(root,'home'), owner='consumer-'+randomUUID();
    const nonce=randomBytes(32).toString('hex'), verify=createServiceVerifier();
    let app,registry,gozar,route;
    const ledger=join(root,'allocations.jsonl'), observation=join(root,'observation.json');
    try {
      app=http.createServer((request,response)=>{
        if(!verify(request,response))response.end(nonce);
      });
      await listen(app);
      const target='127.0.0.1:'+app.address().port;
      assert.equal(await body('http://'+target),nonce);
      const id='consumer-'+randomUUID();
      registry=await fakeRegistry({id,dir:join(root,'registry'),
        kinds:['attached','session'],reach:'this-device',transport:'http',protocols:[]});
      // Instrument the public fixture provider, not Gozar's private controller
      // state. Keep the generic plan/create/remove unchanged.
      const folder=join(registry.root,'providers',id);
      await writeFile(observation,JSON.stringify({costKind:'free'}));
      await writeFile(join(folder,'observed.mjs'),`
import provider from './index.mjs';
import {appendFileSync,readFileSync} from 'node:fs';
const cost=()=>JSON.parse(readFileSync(${JSON.stringify(observation)},'utf8')).costKind;
const mark=event=>appendFileSync(${JSON.stringify(ledger)},JSON.stringify(event)+'\\n');
export default {...provider,
  async detect(ctx) {const result=await provider.detect(ctx);return {...result,facts:{...result.facts,fixtureCostKind:cost()}};},
  properties(facts) {const p=provider.properties(facts);return {...p,cost:{...p.cost,kind:facts.fixtureCostKind}};},
  async runtimeFacts(...args) {const r=await provider.runtimeFacts(...args);return {...r,properties:{...r.properties,cost:{...r.properties.cost,kind:cost()}}};},
  async create(ctx,plan) {
    mark({event:'create',kind:plan.readback.kind,operationId:ctx.operationId});
    return provider.create(ctx,plan);
  },
  async remove(...args) {
    const result=await provider.remove(...args);
    mark({event:'remove',removed:result.removed}); return result;
  }
};
`);
      const manifest=structuredClone(registry.manifest);
      manifest.providers[0].module='providers/'+id+'/observed.mjs';
      gozar=createGozar({manifest,root:registry.root,
        identity:{instanceId:randomUUID(),bootId:randomUUID()}});
      const query={schemaVersion:1,home,owner,providerId:id,target,
        usage:kind==='session'?{kind,lifetimeMs:120000}:{kind},
        requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',
          address:'any',setup:'allow',protocols:[]}};
      const candidate=(await gozar.catalogRoutes(query)).candidates.find(c=>c.providerId===id);
      assert.ok(candidate?.candidateToken,'admitted candidate must offer approval');
      const operationId=randomUUID();
      const exposeRequest={...query,operationId,intent:'create',wait:'verified',
          approval:{kind:'route',candidateToken:candidate.candidateToken,
            disclosureRevision:candidate.disclosure.revision,
            consentFactsDigest:candidate.consentFactsDigest}};
      const started=Date.now();
      try { route=await gozar.expose(exposeRequest);
      } catch(error) {route=error.route;throw error;}
      assert.equal(route.handle.kind,kind);
      assert.equal(route.handle.generation,1);
      assert.equal(route.verification.status,'verified');
      assert.equal(route.published,route.origin);
      assert.equal(new URL(route.origin).hostname,'127.0.0.1');
      assert.equal(await body(route.origin),nonce);
      const before=(await readFile(ledger,'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(before.filter(e=>e.event==='create'),
        [{event:'create',kind,operationId}]);
      const handle=structuredClone(route.handle);
      const expiry=structuredClone(route.expiresAt);
      if(kind==='session'){
        assert.equal(expiry.known,true);
        assert.ok(Date.parse(expiry.value)>=started+120000);
        assert.ok(Date.parse(expiry.value)<=Date.now()+120000);
      }
      const replay=await gozar.expose(exposeRequest);
      assert.deepEqual(replay.handle,handle);
      assert.deepEqual(replay.expiresAt,expiry,'replay must not extend absolute expiry');
      await assert.rejects(gozar.expose({...exposeRequest,target:'127.0.0.1:1'}),{code:'operation_conflict'});
      await assert.rejects(gozar.expose({...exposeRequest,origin:'http://127.0.0.1:1'}),{code:'operation_conflict'});
      assert.equal((await readFile(ledger,'utf8')).trim().split('\n').map(JSON.parse).filter(e=>e.event==='create').length,1);
      await writeFile(observation,JSON.stringify({costKind:'paid'}));
      const withdrawn=await gozar.routeStatus({home,handle});
      assert.equal(withdrawn.verification.status,'unverified');
      assert.equal(withdrawn.published,null);
      assert.deepEqual(withdrawn.handle,handle);
      assert.deepEqual(withdrawn.expiresAt,expiry,'status must not extend absolute expiry');
      const review=await gozar.reviewRouteConsent({home,handle});
      assert.equal(review.disclosures.cost.kind,'paid');
      const restored=await gozar.approveRouteConsent({home,handle,
        approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest});
      assert.equal(restored.verification.status,'verified');
      assert.deepEqual(restored.handle,handle);
      assert.deepEqual(restored.expiresAt,expiry);
      assert.equal(await body(restored.origin),nonce);
      await assert.rejects(gozar.approveRouteConsent({home,handle,
        approvalToken:review.approvalToken,consentFactsDigest:review.consentFactsDigest}));
      const released=await gozar.closeRoute({home,handle:route.handle,mode:'remove'});
      assert.equal(released.cleanup.state,'confirmed');
      const terminal=await gozar.expose(exposeRequest);
      assert.deepEqual(terminal.handle,handle);
      assert.equal(terminal.cleanup.state,'confirmed');
      await assert.rejects(body(route.origin),'removed forwarding must no longer serve the app');
      route=null;
      const after=(await readFile(ledger,'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(after.filter(e=>e.event==='create').length,1);
      assert.deepEqual(after.filter(e=>e.event==='remove'),[{event:'remove',removed:true}]);
      assert.equal(await body('http://'+target),nonce,'foreign application survives');
    } finally {
      try {
        if(route?.handle) {
          const released=await gozar.closeRoute({home,handle:route.handle,mode:'remove'});
          assert.equal(released.cleanup.state,'confirmed');
        }
      } finally {
        try {if(app)await close(app);}
        finally {try{await registry?.cleanup();}finally{await rm(root,{recursive:true,force:true});}}
      }
    }
  });
