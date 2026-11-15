import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,lstat,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
// Public enumeration of persisted records; no allocation, provider, proof or socket.
async function scratch(t){
  const parent=join(homedir(),'.tmp0700');
  try{await mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await lstat(parent);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'scratch parent must be a real directory');
  assert.equal(stat.uid,process.getuid(),'scratch parent must be owned by this user');
  assert.equal(stat.mode&0o777,0o700,'do not repair an unrelated parent mode');
  const home=await mkdtemp(join(parent,'dr-'));
  let passed=false;
  t.after(async()=>{if(passed)await rm(home,{recursive:true,force:true});else t.diagnostic('retained failed fixture: '+home);});
  await mkdir(join(home,'routes'),{mode:0o700});
  return {home,pass(){passed=true;}};
}
const record=()=>({
  schemaVersion:1,routeId:'recoverable',generation:1,
  owner:'recovery-test',ownership:'gozar-owned',state:'releasing',
  cleanupDebt:{reason:'adapter-unavailable',port:443},
});
const corruptions=[
  ['wrong schema',{schemaVersion:2}],
  ['missing schema',{schemaVersion:undefined}],
  ['external ownership in durable store',{ownership:'external-owned'}],
  ['missing owner',{owner:null}],
  ['empty owner',{owner:''}],
  ['non-string owner',{owner:7}],
  ['empty route ID',{routeId:''}],
  ['non-string route ID',{routeId:7}],
  ['zero generation',{generation:0}],
  ['negative generation',{generation:-1}],
  ['fractional generation',{generation:1.5}],
  ['unsafe generation',{generation:Number.MAX_SAFE_INTEGER+1}],
  ['string generation',{generation:'1'}],
  ['filename does not bind route ID',{routeId:'another-route'}],
];

test('public durable enumeration refuses malformed record identity without rewriting evidence',async t=>{
  for(const [name,overrides] of corruptions)await t.test(name,async t=>{
    const f=await scratch(t),dir=join(f.home,'routes'),path=join(dir,hash('recoverable')+'.json');
    const api=createRouteApi();
    const valid=JSON.stringify(record());
    await writeFile(path,valid,{mode:0o600});
    // Positive control: an otherwise valid foreign record is filtered normally.
    // An always-reject implementation cannot satisfy this test.
    assert.deepEqual(await api.listRoutes({home:f.home,owner:'other-owner'}),{routes:[]});
    assert.equal(await readFile(path,'utf8'),valid);
    const bytes=JSON.stringify({...record(),...overrides});
    await writeFile(path,bytes,{mode:0o600});
    const names=await readdir(dir),homeNames=await readdir(f.home);
    for(const owner of ['recovery-test','other-owner',undefined]){
      await assert.rejects(api.listRoutes({home:f.home,...(owner===undefined?{}:{owner})}),
        {code:'provider_unavailable'});
      assert.equal(await readFile(path,'utf8'),bytes,'refusal must not repair, remove or replace evidence');
      assert.deepEqual(await readdir(dir),names,'refusal must not add route files');
      assert.deepEqual(await readdir(f.home),homeNames,'listing must not allocate recovery state');
    }
    f.pass();
  });
});
