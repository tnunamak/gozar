import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createTestingGozar,fakeRegistry} from '../../packages/gozar-node/testing.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';
import {query} from './route-schema-check.mjs';

test('attached approval rejects changed wrapped recipe bytes before reserving or creating', {timeout:30000}, async ()=>{
  const providerId='recipe-identity-fixture',owner='fixture-owner';
  const scratch=join(homedir(),'.tmp');await mkdir(scratch,{recursive:true,mode:0o700});
  const home=await mkdtemp(join(scratch,'g-rec-'));
  const fixtures=[];
  const app=http.createServer((_q,res)=>res.end('owned fixture'));
  let registry;
  try{
    // The supported echo seam proves a real TCP nonce and then forwards to this HTTP app.
    // The wrapped document exists because this fixture also declares durable usage.
    registry=await fakeRegistry({id:providerId,kinds:['attached','durable'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});
    const options={manifest:registry.manifest,root:registry.root};
    const folder=join(registry.root,'providers',providerId);
    const wrapped=join(folder,'wrapped.definition.json');
    const before=await readFile(wrapped);
    const module=await readFile(join(folder,'index.mjs'));
    const adapterDefinition=await readFile(join(folder,'definition.json'));
    const events=async()=>readFile(join(folder,'events.jsonl'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
    assert.equal(JSON.parse(adapterDefinition).wraps,'./wrapped.definition.json');
    const originalIdentity=await registryIdentity(options);
    await new Promise((res,rej)=>{app.once('error',rej);app.listen(0,'127.0.0.1',res);});
    const target='127.0.0.1:'+app.address().port;
    const start=async()=>{const f=await createTestingGozar({...options,effects:[]});fixtures.unshift(f);return f.gozar;};
    const intent=query({home,owner,providerId,operationId:'wrapped-identity',target,usage:{kind:'attached'},
      requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
    const approve=async gozar=>{
      const candidate=(await gozar.catalogRoutes(intent)).candidates[0];assert.equal(candidate.eligible,true);
      return {...intent,wait:'verified',approval:{kind:'route',candidateToken:candidate.candidateToken,
        consentFactsDigest:candidate.consentFactsDigest,disclosureRevision:candidate.disclosure.revision}};
    };
    const original=await start(),stale=await approve(original);
    const entries=async()=> (await readdir(home,{recursive:true})).filter(x=>/(?:operation|att_)/.test(x)).sort();
    const reservedBefore=await entries(),eventsBefore=await events();
    await writeFile(wrapped,Buffer.concat([before,Buffer.from('\n')]));
    assert.deepEqual(JSON.parse(await readFile(wrapped)),JSON.parse(before));
    assert.deepEqual(await readFile(join(folder,'index.mjs')),module);
    assert.deepEqual(await readFile(join(folder,'definition.json')),adapterDefinition);
    assert.notEqual(await registryIdentity(options),originalIdentity);
    await assert.rejects(original.expose(stale),{code:'artifact_integrity_failed'});
    assert.equal(await events(),eventsBefore,'stale approval performs no provider operation');
    assert.deepEqual(await entries(),reservedBefore);
    assert.deepEqual((await original.listRoutes({home,owner})).routes,[]);
    // Reusing the operation ID proves that refusal did not consume it.
    const current=await start(),route=await current.expose(await approve(current));
    assert.equal(route.state,'usable');assert.equal(route.verification.status,'verified');
    const endpoint=new URL(route.origin);
    const response=await fetch('http://'+endpoint.host,{headers:{connection:'close'},signal:AbortSignal.timeout(2000)});
    assert.equal(await response.text(),'owned fixture');
    assert.equal((await current.closeRoute({home,owner,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
    const ledger=(await events()).trim().split('\n').filter(Boolean).map(JSON.parse);
    for(const event of ['start','stop','cleanup'])assert.equal(ledger.filter(row=>row.event===event).length,1,event);
  }finally{
    try{
      const settled=await Promise.allSettled(fixtures.map(f=>f.close()));
      const errors=settled.filter(r=>r.status==='rejected').map(r=>r.reason);
      if(errors.length)throw new AggregateError(errors,'Fixture cleanup remains unconfirmed');
      await registry?.cleanup();
      await rm(home,{recursive:true,force:true});
    }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
  }
});
