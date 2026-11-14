import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {retainedOperationView,startingRoute} from '../../packages/gozar-node/route-operations.mjs';
import {releasedView} from '../../packages/gozar-node/route-view.mjs';

// Operation recovery boundary only; not a public provider PUT/POST crash fixture.
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'gozar-terminal-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'operations'),{mode:0o700});
 const handle={kind:'durable',id:'kept',generation:2},owner='synthetic-owner',operationId='restore';
 const name=createHash('sha256').update(JSON.stringify([owner,operationId])).digest('hex')+'.json';
 const path=join(home,'operations',name);
 const view=startingRoute(handle,'127.0.0.1:43210',operationId);
 const record={schemaVersion:1,owner,operationId,intentDigest:'synthetic-digest',phase:'recovery',view};
 const save=()=>writeFile(path,JSON.stringify(record),{mode:0o600});
 return {home,handle,owner,path,record,save};
}
test('only exact terminal operation evidence supports idempotent close',async t=>{
 const f=await fixture(t);
 f.record.phase='terminal';f.record.view=releasedView(f.record.view,f.handle);await f.save();
 for(let n=0;n<2;n++)assert.equal((await retainedOperationView(f)).cleanup.state,'confirmed');
 assert.equal(await retainedOperationView({...f,handle:{...f.handle,generation:1}}),null);
 assert.equal(await retainedOperationView({...f,handle:{...f.handle,kind:'attached'}}),null);
 assert.equal(await retainedOperationView({...f,owner:'other-owner'}),null);
});
test('missing file proves nothing; retained nonterminal view remains recoverable debt',async t=>{
 const f=await fixture(t);assert.equal(await retainedOperationView(f),null);
 await f.save();const view=await retainedOperationView(f);
 assert.equal(view.cleanup.state,'unconfirmed');assert.equal(view.published,null);
 assert.deepEqual(view.handle,f.handle);
 f.record.view=releasedView(f.record.view,f.handle);await f.save();
 assert.equal((await retainedOperationView(f)).cleanup.state,'unconfirmed');
});
test('corrupt retained operation state stays an explicit error',async t=>{
 const f=await fixture(t);await writeFile(f.path,'{broken',{mode:0o600});
 await assert.rejects(retainedOperationView(f));
});
