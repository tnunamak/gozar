import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listRecordedRoutes} from '../../packages/gozar-node/route-operations.mjs';

// Disk-journal enumeration boundary only, not public expose/status parity.
// No controller, listener, provider or proof is fabricated by this test.
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'gozar-enumeration-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'operations'),{mode:0o700});
 await mkdir(join(home,'routes'),{mode:0o700});
 const owner='enumeration-owner',routeId='retained-route';
 const handle={kind:'durable',id:routeId,generation:2};
 const view={handle,state:'released',published:null,origin:null,operationId:'close',
   verification:{status:'unverified',checkedAt:null,observedAt:null,checks:[]},
   cleanup:{state:'confirmed'},routeState:'inactive'};
 const operation={schemaVersion:1,owner,operationId:'close',intentDigest:'fixture',
   phase:'terminal',view};
 const route={schemaVersion:1,routeId,generation:2,owner,ownership:'gozar-owned',
   state:'creating',target:'127.0.0.1:12345'};
 const write=async(path,value)=>writeFile(path,JSON.stringify(value),{mode:0o600});
 await write(join(home,'operations',hash(JSON.stringify([owner,'close']))+'.json'),operation);
 await write(join(home,'routes',hash(routeId)+'.json'),route);
 return {home,owner,route,view,write,routePath:join(home,'routes',hash(routeId)+'.json')};
}
test('exact terminal journal dominates a late active durable snapshot',async t=>{
 const f=await fixture(t);
 const listed=await listRecordedRoutes({home:f.home,owner:f.owner});
 assert.equal(listed.routes.length,1);
 assert.equal(listed.routes[0].state,'released');
 assert.equal(listed.routes[0].cleanup.state,'confirmed');
 assert.equal(listed.routes[0].published,null);
 assert.equal(listed.routes[0].verification.observedAt,null);
 assert.deepEqual(await listRecordedRoutes({home:f.home,owner:'other-owner'}),{routes:[]});
});
test('a terminal old generation cannot erase a newer retained generation',async t=>{
 const f=await fixture(t);
 await f.write(f.routePath,{...f.route,generation:3});
 const {routes}=await listRecordedRoutes({home:f.home,owner:f.owner});
 assert.equal(routes.length,1);
 assert.equal(routes[0].handle.generation,3);
 assert.notEqual(routes[0].state,'released');
 assert.equal(routes[0].verification.status,'unverified');
 assert.equal(routes[0].published,null);
});
test('malformed scoped durable state is an error, never an empty list',async t=>{
 const f=await fixture(t);
 await writeFile(f.routePath,'{',{mode:0o600});
 await assert.rejects(()=>listRecordedRoutes({home:f.home,owner:f.owner}));
});
