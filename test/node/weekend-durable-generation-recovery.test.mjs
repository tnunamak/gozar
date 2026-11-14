import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {withRouteOperation, startingRoute} from '../../packages/gozar-node/route-operations.mjs';

// Bounded operation-journal regression, not a public-factory/provider integration test.
// The durable record models a committed restore; no provider or network is invoked.
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-generation-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  await mkdir(join(home, 'routes'), {mode:0o700});
  const request = {home, owner:'generation-test', operationId:'restore',
    providerId:'fixture', target:'127.0.0.1:43210',
    usage:{kind:'durable',routeId:'kept'}, requirements:{}};
  const path = join(home,'routes',hash('kept')+'.json');
  await writeFile(path, JSON.stringify({generation:1,owner:request.owner,operationId:'original'}), {mode:0o600});
  const deps = {registryId:'registry-a',adapters:[],
    embeddingServices:{readConfiguration:async()=>({revision:1,scopeId:'test'})},
    status:async({handle})=>{
      const record=JSON.parse(await readFile(path,'utf8'));
      if(handle.generation!==record.generation)
        throw Object.assign(new Error('stale'),{code:'route_conflict'});
      return startingRoute(handle,request.target,record.operationId);
    }};
  return {home,request,path,deps};
}
test('restore failure returns committed generation and replay never allocates again', async t=>{
  const {request,path,deps}=await fixture(t);
  let writes=0;
  const death=new Error('simulated host death after committed restoration');
  const run=async()=>{
    writes++;
    await writeFile(path,JSON.stringify({generation:2,owner:request.owner,operationId:request.operationId}),{mode:0o600});
    throw death;
  };
  await assert.rejects(withRouteOperation(request,{...deps,run}),error=>{
    assert.equal(error,death);
    assert.equal(error.route.handle.generation,2);
    return true;
  });
  const replay=await withRouteOperation(request,{...deps,run});
  assert.equal(replay.handle.generation,2);
  assert.equal(writes,1);
  await assert.rejects(withRouteOperation(request,{...deps,registryId:'registry-b',run}),{code:'operation_conflict'});
  assert.equal(writes,1);
});
test('foreign operation association cannot redirect the retained handle',async t=>{
  const {request,path,deps}=await fixture(t);
  let writes=0;
  const run=async()=>{
    writes++;
    await writeFile(path,JSON.stringify({generation:2,owner:request.owner,operationId:'foreign'}),{mode:0o600});
    throw new Error('interrupted');
  };
  await assert.rejects(withRouteOperation(request,{...deps,run}),error=>{
    assert.equal(error.route.handle.generation,1);
    return true;
  });
  // Replay may refuse or return uncertain, but must never run allocation again.
  try {
    const view=await withRouteOperation(request,{...deps,run});
    assert.equal(view.handle.generation,1);
    assert.equal(view.state,'uncertain');
  } catch(error) { assert.equal(error.code,'route_conflict'); }
  assert.equal(writes,1);
});
