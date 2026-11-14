import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {addService,removeService,withServiceContext} from '../../packages/gozar-node/service.mjs';
import {projectExternal} from '../../packages/gozar-node/route-view.mjs';
import {listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';

test('fresh tracking is generation one, repeats once, and removes metadata only',async t=>{
 const home=await mkdtemp(join(tmpdir(),'gozar-external-generation-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 let checks=0;
 const runtime={verify:async()=>{checks++;return {status:'unverified',checkedAt:null};}};
 const request={home,origin:'https://generation.invalid',target:'127.0.0.1:12345'};
 await withServiceContext(runtime,async()=>{
  const {route}=await addService(request);
  assert.equal(route.generation,1);
  await addService(request);
  assert.equal((await readdir(join(home,'services'))).filter(n=>n.endsWith('.json')).length,1);
  const before=checks;
  await assert.rejects(()=>addService({...request,target:'127.0.0.1:12346'}),{code:'route_conflict'});
  assert.equal(checks,before);
  const {routes}=await listRecordedRoutes({home});
  assert.equal(routes[0].handle.generation,1);
  const file=(await readdir(join(home,'services'))).find(n=>n.endsWith('.json'));
  assert.equal(JSON.parse(await readFile(join(home,'services',file),'utf8')).generation,1);
  await assert.rejects(()=>removeService({home,origin:request.origin,expectedGeneration:0}),{code:'route_conflict'});
  assert.equal((await removeService({home,origin:request.origin,expectedGeneration:1})).removed,true);
 });
});
// Pure projection controls; no actual proof or external application is asserted.
test('consumer rejects mismatched generation rather than silently relabeling it',()=>{
 const origin='https://generation.invalid';
 const record={origin,generation:1,target:'127.0.0.1:12345'};
 assert.throws(()=>projectExternal(record,{handle:{kind:'external',id:origin,generation:0}}),{code:'route_conflict'});
});
test('legacy zero remains unverified history',()=>{
 const origin='https://legacy.invalid';
 const view=projectExternal({origin,target:'127.0.0.1:12345'},
  {handle:{kind:'external',id:origin,generation:0}});
 assert.equal(view.handle.generation,0);
 assert.equal(view.published,null);
 assert.equal(view.verification.status,'unverified');
});
