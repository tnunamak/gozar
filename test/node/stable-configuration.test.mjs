// Stable configuration identity and the one-time carry-forward of state written under a registry-hashed scope.
// The old state comes from the historical 0.4.0 writer (fixtures/legacy-040, provenance in its README) and from the
// golden bytes that the published tarball wrote. Everything here uses synthetic values and private temp homes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,copyFile,mkdir,realpath,cp,symlink,rm,stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';
import {setupConsentReview} from '../../packages/gozar-node/consent-facts.mjs';
import {createGozar} from '../../packages/gozar-node/api.mjs';
import {loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {inputKindsOf} from '../../packages/gozar-node/embedding-state.mjs';
import {fakeRegistry,createTestingGozar} from '../../packages/gozar-node/testing.mjs';
import {createEmbeddingServices as create040} from './fixtures/legacy-040/embedding-services.040.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const [R040,R050,R051]=PUBLISHED_REGISTRY_IDS;
const OWNER='pdpp-reference-server',TOKEN='synthetic-token-040';
const sha=value=>createHash('sha256').update(value).digest('hex');
const oldScope=(registryId,home,owner,providerId)=>sha(JSON.stringify([registryId,home,owner??null,providerId]));
const code=wanted=>error=>{assert.equal(error.code,wanted);return true;};
const identity={instanceId:'fixture-instance',bootId:'fixture-boot'};
const home=async()=>mkdtemp(join(tmpdir(),'stbl-'));
const stateBytes=h=>readFile(join(h,'embedding-state.json'),'utf8');
// The current input contract of a bundled provider is read from the executable adapter, never from a stored table.
const bundledAdapters=loadAdapters();
const bundledKinds=async providerId=>inputKindsOf((await bundledAdapters).find(adapter=>adapter.id===providerId));
const candidate=(registryId,extra={})=>createEmbeddingServices({registryId,lineage:bundledLineage(),identity,currentInputKinds:bundledKinds,...extra});

// What a real 0.4.0 host did: an owner-scoped text value and an owner-scoped secret. `registryId` is the writing registry.
async function write040(h,{registryId=R040,owner=OWNER,secretBackend,text=true,secret=true,uses=false}={}){
 const s=create040({registryId,identity,...(secretBackend?{secretBackend}:{})}),out={};
 if(text){const c=await s.readConfiguration({home:h,owner,providerId:'own-address'});
  await s.mutateConfiguration({home:h,owner,providerId:'own-address',expectedConfigurationRevision:c.revision},async tx=>tx.bindText('origin','https://fixture.invalid'));}
 if(secret){const c=await s.readConfiguration({home:h,owner,providerId:'cloudflare-named'});
  const stored=await s.storeSecret({home:h,owner,providerId:'cloudflare-named',inputId:'token',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from(TOKEN)});
  await s.mutateConfiguration({home:h,owner,providerId:'cloudflare-named',expectedConfigurationRevision:c.revision},async tx=>tx.bindSecret('token',stored.handle));out.handle=stored.handle;
  if(uses){const now=await s.readConfiguration({home:h,owner,providerId:'cloudflare-named'});await s.registerConfigurationUse({home:h,owner,providerId:'cloudflare-named',revision:now.revision,handle:'live-route'});}}
 return out;
}
const read=(s,h,providerId,owner=OWNER)=>s.readConfiguration({home:h,owner,providerId});
const reason=wanted=>error=>{assert.equal(error.code,'configuration_migration_required');assert.equal(error.reason,wanted);return true;};
// A keyed backend like a keychain adapter. Every call records whether a durable claim (a tombstoned earlier record) was on disk at that moment.
function spyBackend(h){
 const store=new Map(),log=[];let n=0;
 const claimed=()=>{try{return Object.values(JSON.parse(readFileSync(join(h,'embedding-state.json'),'utf8')).configs).some(c=>c.migratedTo);}catch{return false;}};
 const note=(op,{scopeId,handle})=>log.push({op,scopeId,handle,claimed:claimed()});
 return {store,log,
  put:async({scopeId,bytes})=>{const handle=`item-${++n}`;store.set(`${scopeId}/${handle}`,Buffer.from(bytes));return {handle};},
  withSecret:async(key,use)=>{note('withSecret',key);const v=store.get(`${key.scopeId}/${key.handle}`);if(!v)throw {code:'setup_required'};return use(new Uint8Array(v));},
  presence:async key=>{note('presence',key);return {known:true,value:store.has(`${key.scopeId}/${key.handle}`)};},
  delete:async({scopeId,handle})=>{store.delete(`${scopeId}/${handle}`);return {deleted:true};},
 };
}
// What a 0.4.0 host did for one provider: a secret `token` and a text `origin`, both bound in one configuration.
async function write040Mixed(h,{providerId,backend,registryId}){
 const s=create040({registryId,identity,secretBackend:backend});
 const c=await s.readConfiguration({home:h,owner:OWNER,providerId});
 const stored=await s.storeSecret({home:h,owner:OWNER,providerId,inputId:'token',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from(TOKEN)});
 await s.mutateConfiguration({home:h,owner:OWNER,providerId,expectedConfigurationRevision:c.revision},async tx=>{await tx.bindSecret('token',stored.handle);tx.bindText('origin','https://fixture.invalid');});
 return stored.handle;
}
const R_OLD='registry-v1:'+'a'.repeat(64);
const hostKinds=async()=>({token:'secret',origin:'text'});
const hostSuccessor=(id,backend,extra={})=>createEmbeddingServices({registryId:`registry-v1:${id}`,identity,secretBackend:backend,lineage:{id,replaces:[R_OLD]},currentInputKinds:hostKinds,...extra});

test('golden bytes written by the published 0.4.0 tarball use the scope formula that the carry-forward recomputes',async()=>{
 const golden=JSON.parse(await readFile(join(here,'fixtures/legacy-040/golden-embedding-state.json'),'utf8'));
 const goldenHome='/home/tnunamak/.tmp/stable-052/fx-golden/home';
 assert.deepEqual(Object.keys(golden.configs).sort(),[oldScope(R040,goldenHome,OWNER,'own-address'),oldScope(R040,goldenHome,OWNER,'cloudflare-named')].sort());
 assert.equal(golden.configs[oldScope(R040,goldenHome,OWNER,'own-address')].values.origin,'https://fixture.invalid');
 const ref=Object.values(golden.secrets)[0];
 assert.equal(ref.registryId,R040);assert.equal(ref.inputId,'token');assert.equal(ref.scopeId,oldScope(R040,goldenHome,OWNER,'cloudflare-named'));
 const original=(await readFile(join(here,'fixtures/legacy-040/embedding-services.040.mjs'),'utf8')).replaceAll('../../../../packages/gozar-node/','./');
 assert.equal(sha(original),'7cd626fd107a628110a713bc4b995831227ceef0f74946ca940e8c1920169c31');
});

test('0.4.0 values and the synthetic secret survive a compatible candidate read and resolution at the same home',async()=>{
 const h=await home(),{handle}=await write040(h);
 const before=JSON.parse(await stateBytes(h));
 const s=candidate('registry-v1:candidate-a');
 const origin=await read(s,h,'own-address');
 assert.equal(origin.values.origin,'https://fixture.invalid');
 assert.equal(origin.scopeId,sha(JSON.stringify(['gozar-bundled',await realpath(h),OWNER,'own-address'])));
 const cloud=await read(s,h,'cloudflare-named');
 assert.deepEqual(cloud.credentials.token,{known:true,value:true});
 assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const after=JSON.parse(await stateBytes(h));
 assert.equal(after.configs[origin.scopeId].migratedFrom?.[0],oldScope(R040,await realpath(h),OWNER,'own-address'));
 // The old records stay as tombstones that point at their successor; no secret file moved or changed.
 for(const [key,old] of Object.entries(before.configs))assert.equal(after.configs[key].migratedTo,[origin.scopeId,cloud.scopeId].find(id=>after.configs[id].migratedFrom.includes(key)));
 assert.equal(after.secrets[handle].registryId,'gozar-bundled');assert.equal(after.secrets[handle].scopeId,cloud.scopeId);
 assert.deepEqual(await readdir(join(h,'secrets')),[handle]);
 assert.equal(JSON.stringify(after).includes(TOKEN),false);
});

test('a later registry revision does not churn the storage scope or the saved state',async()=>{
 const h=await home();await write040(h);
 const a=await read(candidate('registry-v1:release-a'),h,'own-address');
 const b=await read(candidate('registry-v1:release-b'),h,'own-address');
 const c=await read(candidate('registry-v1:release-c'),h,'own-address');
 assert.equal(a.scopeId,b.scopeId);assert.equal(b.scopeId,c.scopeId);
 assert.equal(c.values.origin,'https://fixture.invalid');assert.equal(b.revision,a.revision);
 const secret=await candidate('registry-v1:release-c').resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'});
 assert.equal(secret.token,TOKEN);
});

test('changed registry content changes what a user approved even though storage is stable',()=>{
 const configuration={scopeId:'stable-scope',revision:'rev-1'};
 const action={id:'token',digest:'d',disclosure:{revision:'x'}};
 const review=registryId=>setupConsentReview({registryId,providerId:'cloudflare-named',configuration,action,facts:[]});
 assert.equal(review('registry-v1:release-a').consentFactsDigest,review('registry-v1:release-a').consentFactsDigest);
 assert.notEqual(review('registry-v1:release-a').consentFactsDigest,review('registry-v1:release-b').consentFactsDigest);
});

test('incompatible persisted shape refuses and leaves every byte in place',async()=>{
 for(const [providerId,damage] of [
  ['cloudflare-named',state=>{const c=Object.values(state.configs).find(x=>Object.keys(x.bindings).length);c.bindings.unknown_input=c.bindings.token;delete c.bindings.token;}],
  ['own-address',state=>{const c=Object.values(state.configs).find(x=>x.values.origin);c.values.token=c.values.origin;delete c.values.origin;}],
  ['cloudflare-named',state=>{for(const ref of Object.values(state.secrets))ref.inputId='different';}],
  ['cloudflare-named',state=>{const c=Object.values(state.configs).find(x=>Object.keys(x.bindings).length);c.bindings.origin=c.bindings.token;delete c.bindings.token;for(const ref of Object.values(state.secrets))ref.inputId='origin';}],
  ['own-address',state=>{const c=Object.values(state.configs).find(x=>x.values.origin);c.values.origin={object:true};}],
 ]){
  const h=await home();await write040(h);
  const state=JSON.parse(await stateBytes(h));damage(state);await writeFile(join(h,'embedding-state.json'),JSON.stringify(state));
  const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a');
  await assert.rejects(read(s,h,providerId),code('configuration_migration_required'));
  await assert.rejects(s.resolveConfiguration({home:h,owner:OWNER,providerId}),code('configuration_migration_required'));
  assert.equal(await stateBytes(h),snapshot);
 }
});

test('open drafts, setup operations and operation-held credentials block the carry-forward until they are closed',async()=>{
 const h=await home();await write040(h);
 const s040=create040({registryId:R040,identity}),c=await read(s040,h,'cloudflare-named');
 const draft=await s040.beginConfigurationDraft({home:h,owner:OWNER,providerId:'cloudflare-named',expectedConfigurationRevision:c.revision});
 const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a');
 await assert.rejects(read(s,h,'cloudflare-named'),code('configuration_migration_required'));
 assert.equal(await stateBytes(h),snapshot);
 await s040.discardConfigurationDraft({home:h,owner:OWNER,providerId:'cloudflare-named',draftId:draft.draftId});
 assert.equal((await read(s,h,'cloudflare-named')).credentials.token.value,true);
 const g=await home();await write040(g);
 const state=JSON.parse(await stateBytes(g));
 state.setupOperations={k:{scopeId:Object.keys(state.configs)[0]}};await writeFile(join(g,'embedding-state.json'),JSON.stringify(state));
 await assert.rejects(read(candidate('registry-v1:candidate-a'),g,'own-address').then(()=>read(candidate('registry-v1:candidate-a'),g,'cloudflare-named')),code('configuration_migration_required'));
});

test('another owner, home, provider or custom registry cannot read the carried credential',async()=>{
 const h=await home(),other=await home();await write040(h);
 const s=candidate('registry-v1:candidate-a');
 assert.equal((await read(s,h,'cloudflare-named')).credentials.token.value,true);
 assert.equal(await s.resolveConfiguration({home:h,owner:'other-owner',providerId:'cloudflare-named'}),null);
 assert.equal(await s.resolveConfiguration({home:h,owner:OWNER,providerId:'ngrok-https-edge'}),null);
 assert.equal(await s.resolveConfiguration({home:h,providerId:'cloudflare-named'}),null);
 await copyFile(join(h,'embedding-state.json'),join(other,'embedding-state.json'));await mkdir(join(other,'secrets'),{mode:0o700});
 for(const f of await readdir(join(h,'secrets')))await copyFile(join(h,'secrets',f),join(other,'secrets',f));
 assert.equal(await s.resolveConfiguration({home:other,owner:OWNER,providerId:'cloudflare-named'}),null);
 // A registry without a declared lineage keeps content-bound storage: it computes a different scope.
 const custom=createEmbeddingServices({registryId:'registry-v1:custom-code',identity});
 assert.equal(await custom.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'}),null);
 assert.equal((await read(custom,h,'cloudflare-named')).credentials.token,undefined);
 // A host registry may not claim the bundled name, a published registry id, or forge the bundled lineage object.
 const mine={id:'host-registry',replaces:[]};
 assert.throws(()=>createEmbeddingServices({registryId:'registry-v1:custom-code',identity,lineage:{...mine,id:'gozar-bundled'}}),code('invalid_input'));
 assert.throws(()=>createEmbeddingServices({registryId:'registry-v1:custom-code',identity,lineage:{...bundledLineage()}}),code('invalid_input'));
 for(const published of PUBLISHED_REGISTRY_IDS)assert.throws(()=>createEmbeddingServices({registryId:'registry-v1:custom-code',identity,lineage:{...mine,replaces:[published]}}),code('invalid_input'));
 assert.throws(()=>createEmbeddingServices({registryId:'registry-v1:custom-code',identity,lineage:{id:'host-registry',replaces:['not-a-registry-id']}}),code('invalid_input'));
});

test('non-secret-only legacy configuration carries over without any secret metadata',async()=>{
 const h=await home();await write040(h,{secret:false});
 const before=JSON.parse(await stateBytes(h));assert.deepEqual(before.secrets,{});
 const c=await read(candidate('registry-v1:candidate-a'),h,'own-address');
 assert.equal(c.values.origin,'https://fixture.invalid');
 assert.deepEqual(c.credentials,{});
});

test('two candidate scopes refuse until the host names one, and the choice carries only that scope',async()=>{
 const h=await home();await write040(h,{registryId:R040});
 const s051=create040({registryId:R051,identity});
 const c=await read(s051,h,'own-address');
 await s051.mutateConfiguration({home:h,owner:OWNER,providerId:'own-address',expectedConfigurationRevision:c.revision},async tx=>tx.bindText('origin','https://second.invalid'));
 const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a');
 await assert.rejects(read(s,h,'own-address'),code('configuration_migration_required'));
 assert.equal(await stateBytes(h),snapshot);
 assert.equal((await read(s,h,'cloudflare-named')).credentials.token.value,true);// one candidate only: unambiguous
 const adopted=await s.adoptConfiguration({home:h,owner:OWNER,providerId:'own-address',fromRegistryId:R051});
 assert.equal(adopted.values.origin,'https://second.invalid');
 assert.equal((await read(candidate('registry-v1:release-b'),h,'own-address')).values.origin,'https://second.invalid');
 // The host cannot adopt a second time or from a scope that does not exist.
 await assert.rejects(s.adoptConfiguration({home:h,owner:OWNER,providerId:'own-address',fromRegistryId:R040}),code('configuration_migration_required'));
 await assert.rejects(s.adoptConfiguration({home:h,owner:OWNER,providerId:'lan',fromRegistryId:R040}),code('configuration_migration_required'));
});

test('migration is idempotent across restarts and never overwrites later changes',async()=>{
 const h=await home();await write040(h);
 const first=await read(candidate('registry-v1:release-a'),h,'own-address');
 const once=await stateBytes(h);
 const again=await read(candidate('registry-v1:release-a'),h,'own-address');
 assert.equal(await stateBytes(h),once);assert.equal(again.revision,first.revision);
 await candidate('registry-v1:release-a').mutateConfiguration({home:h,owner:OWNER,providerId:'own-address',expectedConfigurationRevision:first.revision},async tx=>tx.bindText('origin','https://changed.invalid'));
 const later=await read(candidate('registry-v1:release-b'),h,'own-address');
 assert.equal(later.values.origin,'https://changed.invalid');
});

test('a resolve that migrates commits the claim before it releases bytes, and an already-stable resolve writes nothing',async()=>{
 const h=await home(),backend=spyBackend(h);await write040(h,{secretBackend:backend,text:false});backend.log.length=0;
 const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a',{secretBackend:backend});
 assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 assert.notEqual(await stateBytes(h),snapshot,'the claim is durable after the resolve');
 assert.ok(backend.log.some(entry=>entry.op==='withSecret'));
 assert.ok(backend.log.every(entry=>entry.claimed),'no backend call happened before the durable claim');
 // The old release still reads its own state: the tombstone keeps the bindings.
 assert.equal((await create040({registryId:R040,identity,secretBackend:backend}).resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const before=await stat(join(h,'embedding-state.json'));
 for(let i=0;i<3;i++)assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const after=await stat(join(h,'embedding-state.json'));
 assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);
});

test('a process killed after the new state is written but before it is renamed loses nothing and migration completes later',async()=>{
 const h=await home();await write040(h);const snapshot=await stateBytes(h);
 const preload=join(await mkdtemp(join(tmpdir(),'stbl-hook-')),'kill-before-rename.mjs');
 await writeFile(preload,`import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const rename=fsp.rename;fsp.rename=async(from,to)=>{if(String(to).endsWith('embedding-state.json'))process.kill(process.pid,'SIGKILL');return rename(from,to);};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,'--input-type=module','-e',`
 import {createEmbeddingServices} from ${JSON.stringify(new URL('../../packages/gozar-node/embedding-services.mjs',import.meta.url).href)};
 import {bundledLineage} from ${JSON.stringify(new URL('../../packages/gozar-node/registry-lineage.mjs',import.meta.url).href)};
 const s=createEmbeddingServices({registryId:'registry-v1:candidate-a',lineage:bundledLineage(),identity:{instanceId:'i',bootId:'b'},currentInputKinds:async()=>({token:'secret'})});
 await s.readConfiguration({home:${JSON.stringify(h)},owner:${JSON.stringify(OWNER)},providerId:'cloudflare-named'});`],{stdio:'ignore'});
 const status=await new Promise(resolve=>child.on('exit',(c,signal)=>resolve(signal??c)));
 assert.equal(status,'SIGKILL');
 assert.equal(await stateBytes(h),snapshot);
 assert.ok((await readdir(h)).some(name=>name.endsWith('.tmp')),'the interrupted write left only a temp file');
 assert.equal((await create040({registryId:R040,identity}).resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const s=candidate('registry-v1:candidate-a');
 assert.equal((await read(s,h,'cloudflare-named')).credentials.token.value,true);
 assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
});

test('a keyed secret backend keeps resolving the old binding after the scope moves, and a backend failure changes nothing',async()=>{
 const h=await home(),store=new Map();let failing=false,n=0;
 // Like a keychain adapter: the item is addressed by scope and handle, so a scope change would orphan it.
 const backend={
  put:async({scopeId,bytes})=>{const handle=`item-${++n}`;store.set(`${scopeId}/${handle}`,Buffer.from(bytes));return {handle};},
  withSecret:async({scopeId,handle},use)=>{if(failing)throw {code:'secret_backend_unavailable'};const v=store.get(`${scopeId}/${handle}`);if(!v)throw {code:'setup_required'};return use(new Uint8Array(v));},
  presence:async({scopeId,handle})=>{if(failing)throw {code:'secret_backend_unavailable'};return {known:true,value:store.has(`${scopeId}/${handle}`)};},
  delete:async({scopeId,handle})=>{store.delete(`${scopeId}/${handle}`);return {deleted:true};},
 };
 await write040(h,{secretBackend:backend,text:false});
 const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a',{secretBackend:backend});
 failing=true;
 await assert.rejects(s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'}),code('secret_backend_unavailable'));
 // The failed resolve committed only the claim (no bytes were read); the binding keeps its backend scope and stays recoverable.
 const claimed=JSON.parse(await stateBytes(h)),[claimedScope]=Object.entries(claimed.configs).filter(([,c])=>c.migratedFrom).map(([key])=>key);
 assert.ok(claimedScope);assert.equal(Object.values(claimed.secrets)[0].backendScopeId,oldScope(R040,await realpath(h),OWNER,'cloudflare-named'));
 assert.notEqual(JSON.stringify(claimed),snapshot);
 // The redacted read reports an unknown credential; the binding stays recoverable.
 assert.equal((await read(s,h,'cloudflare-named')).credentials.token.known,false);
 failing=false;
 assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 assert.equal((await create040({registryId:R040,identity,secretBackend:backend}).resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 assert.deepEqual([...store.keys()].map(k=>k.split('/')[1]),['item-1']);
 // A secret stored after the migration is addressed by the stable scope.
 const c=await read(s,h,'cloudflare-named');
 const added=await s.storeSecret({home:h,owner:OWNER,providerId:'cloudflare-named',inputId:'auth',scopeId:c.scopeId,expectedConfigurationRevision:c.revision,bytes:Buffer.from('synthetic-auth')});
 assert.ok(store.has(`${c.scopeId}/${added.handle}`));
});

const usesOf=async(h,key)=>JSON.parse(await stateBytes(h)).configs[key]?.uses;
const useArgs={owner:OWNER,providerId:'cloudflare-named'};

test('a legacy route reservation blocks the carry-forward, the original 0.4.0 service releases it, and the retry migrates exactly',async()=>{
 const h=await home(),backend=spyBackend(h),{handle}=await write040(h,{secretBackend:backend,uses:true});
 const oldKey=oldScope(R040,await realpath(h),OWNER,'cloudflare-named');
 const old=create040({registryId:R040,identity,secretBackend:backend});
 await old.registerConfigurationUse({home:h,...useArgs,revision:(await old.readConfiguration({home:h,...useArgs})).revision,handle:'second-route'});
 backend.log.length=0;
 const snapshot=await stateBytes(h),s=candidate('registry-v1:candidate-a',{secretBackend:backend});
 await assert.rejects(read(s,h,'cloudflare-named'),reason('in_use'));
 await assert.rejects(s.resolveConfiguration({home:h,...useArgs}),reason('in_use'));
 assert.equal(await s.discardSecret({home:h,handle}).then(r=>r.discarded),false,'another custodian cannot discard the earlier handle');
 assert.equal(await stateBytes(h),snapshot);assert.equal(backend.log.some(entry=>entry.op==='withSecret'),false);
 // The original service releases through its own scope. One reservation left: still refused.
 await old.releaseConfigurationUse({home:h,...useArgs,handle:'live-route'});
 assert.deepEqual(await usesOf(h,oldKey),['"second-route"']);
 await assert.rejects(read(s,h,'cloudflare-named'),reason('in_use'));
 await old.releaseConfigurationUse({home:h,...useArgs,handle:'second-route'});
 const c=await read(s,h,'cloudflare-named'),state=JSON.parse(await stateBytes(h));
 assert.deepEqual(state.configs[c.scopeId].uses,[]);assert.deepEqual(state.configs[oldKey].uses,[]);assert.equal(state.configs[oldKey].migratedTo,c.scopeId);
 assert.equal(state.secrets[handle].scopeId,c.scopeId);
 assert.equal((await s.resolveConfiguration({home:h,...useArgs})).token,TOKEN);
 // A release that arrives after the move cannot strand or revive anything in the stable scope.
 await old.releaseConfigurationUse({home:h,...useArgs,handle:'live-route'});
 assert.deepEqual(await usesOf(h,c.scopeId),[]);
});

test('the new service releases exactly one named legacy reservation, so an upgraded host is not stranded, and then the retry migrates',async()=>{
 const h=await home(),{handle}=await write040(h,{uses:true});
 const oldKey=oldScope(R040,await realpath(h),OWNER,'cloudflare-named');
 const old=create040({registryId:R040,identity});
 await old.registerConfigurationUse({home:h,...useArgs,revision:(await old.readConfiguration({home:h,...useArgs})).revision,handle:'second-route'});
 const s=candidate('registry-v1:candidate-a');
 await assert.rejects(read(s,h,'cloudflare-named'),reason('in_use'));
 const snapshot=await stateBytes(h);
 // Nothing that is not the exact handle for the exact home, owner and provider can drop a reservation.
 for(const wrong of [{...useArgs,handle:'unknown-route'},{...useArgs,handle:'live-route '},{...useArgs,owner:'other-owner',handle:'live-route'},{...useArgs,providerId:'own-address',handle:'live-route'},{...useArgs,handle:{kind:'external',id:'live-route'}}])
  await s.releaseConfigurationUse({home:h,...wrong});
 assert.equal(await stateBytes(h),snapshot);
 // An unrelated lineage forwards nothing.
 await createEmbeddingServices({registryId:'registry-v1:custom-code',identity}).releaseConfigurationUse({home:h,...useArgs,handle:'live-route'});
 assert.equal(await stateBytes(h),snapshot);
 await s.releaseConfigurationUse({home:h,...useArgs,handle:'live-route'});
 assert.deepEqual(await usesOf(h,oldKey),['"second-route"']);
 // The configuration itself is untouched: no removal is inferred from a release.
 assert.equal(JSON.parse(await stateBytes(h)).configs[oldKey].bindings.token,handle);
 await assert.rejects(read(s,h,'cloudflare-named'),reason('in_use'));
 await s.releaseConfigurationUse({home:h,...useArgs,handle:'second-route'});
 const c=await read(s,h,'cloudflare-named'),state=JSON.parse(await stateBytes(h));
 assert.deepEqual(state.configs[c.scopeId].uses,[]);assert.deepEqual(state.configs[oldKey].uses,[]);
 assert.equal((await s.resolveConfiguration({home:h,...useArgs})).token,TOKEN);
});

test('a host registry with its own stable id carries its own old scope once, and a rival cannot take it',async()=>{
 const h=await home();
 await write040(h,{registryId:R_OLD});
 const host=createEmbeddingServices({registryId:'registry-v1:host-v2',identity,lineage:{id:'host-registry',replaces:[R_OLD]},currentInputKinds:hostKinds});
 assert.equal((await read(host,h,'own-address')).values.origin,'https://fixture.invalid');
 await read(host,h,'cloudflare-named');
 assert.equal((await host.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const host3=createEmbeddingServices({registryId:'registry-v1:host-v3',identity,lineage:{id:'host-registry',replaces:[R_OLD]},currentInputKinds:hostKinds});
 assert.equal((await host3.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const rival=createEmbeddingServices({registryId:'registry-v1:rival',identity,lineage:{id:'rival-host',replaces:[R_OLD]},currentInputKinds:hostKinds});
 await assert.rejects(read(rival,h,'own-address'),code('configuration_migration_required'));
 assert.equal(await rival.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'}).catch(()=>'refused'),'refused');
});

test('public API: bundled registry reads 0.4.0 state at the same home and lineage-declared custom registries keep storage across code changes',async()=>{
 const h=await home();await write040(h);
 const api=createGozar({identity,hostCapabilities:{}});
 const list=await api.listProviders({home:h,owner:OWNER});
 const own=list.providers.find(p=>p.providerId==='own-address').configuration,cloud=list.providers.find(p=>p.providerId==='cloudflare-named').configuration;
 assert.equal(own.values.origin,'https://fixture.invalid');
 assert.deepEqual(cloud.credentials.token,{known:true,value:true});
 const again=await createGozar({identity,hostCapabilities:{}}).listProviders({home:h,owner:OWNER});
 assert.equal(again.providers.find(p=>p.providerId==='own-address').configuration.scopeId,own.scopeId);
});

test('public API: a host registry with a declared lineage keeps its saved value across a code change, one without it does not',async()=>{
 const h=await home(),lineage={id:'host-registry',replaces:[]};
 const registries=await Promise.all([1,2].map(n=>fakeRegistry({id:'host-provider',kinds:['session'],reach:'internet',label:`Revision ${n}`,dir:join(h,`registry-${n}`)})));
 const seed=createEmbeddingServices({registryId:'registry-v1:'+'b'.repeat(64),identity,lineage});
 const c=await seed.readConfiguration({home:h,owner:OWNER,providerId:'host-provider'});
 await seed.mutateConfiguration({home:h,owner:OWNER,providerId:'host-provider',expectedConfigurationRevision:c.revision},async tx=>tx.bindText('origin','https://fixture.invalid'));
 const view=async(registry,registryLineage)=>(await createGozar({manifest:registry.manifest,root:registry.root,identity,hostCapabilities:{},...(registryLineage?{registryLineage}:{})}).listProviders({home:h,owner:OWNER})).providers.find(p=>p.providerId==='host-provider').configuration;
 const [one,two]=[await view(registries[0],lineage),await view(registries[1],lineage)];
 assert.equal(one.values.origin,'https://fixture.invalid');assert.equal(two.values.origin,'https://fixture.invalid');assert.equal(one.scopeId,two.scopeId);
 assert.equal((await view(registries[1])).values.origin,undefined);
});

test('cleanup of a carried secret uses its retained backend scope and a failed delete keeps the reference',async()=>{
 const h=await home(),store=new Map();let failDelete=true;
 const backend={
  put:async({scopeId,bytes})=>{store.set(`${scopeId}/item`,Buffer.from(bytes));return {handle:'item'};},
  withSecret:async({scopeId,handle},use)=>use(new Uint8Array(store.get(`${scopeId}/${handle}`))),
  presence:async({scopeId,handle})=>({known:true,value:store.has(`${scopeId}/${handle}`)}),
  delete:async({scopeId,handle})=>{if(failDelete)throw {code:'secret_backend_unavailable'};store.delete(`${scopeId}/${handle}`);return {deleted:true};},
 };
 const {handle}=await write040(h,{secretBackend:backend,text:false});
 const s=candidate('registry-v1:candidate-a',{secretBackend:backend}),c=await read(s,h,'cloudflare-named');
 await s.mutateConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named',expectedConfigurationRevision:c.revision},async tx=>tx.unbindSecret(handle));
 await assert.rejects(s.discardSecret({home:h,handle}),code('secret_backend_unavailable'));
 assert.equal(store.size,1);assert.ok(JSON.parse(await stateBytes(h)).secrets[handle]);
 failDelete=false;
 assert.deepEqual(await s.discardSecret({home:h,handle}),{discarded:true});
 assert.equal(store.size,0);assert.equal(JSON.parse(await stateBytes(h)).secrets[handle],undefined);
});

test('a custom root alone cannot inherit bundled configuration authority',async t=>{
 const h=await home();t.after(()=>rm(h,{recursive:true,force:true}));await write040(h);
 const registry=join(h,'custom-registry'),root=join(registry,'adapters');
 await cp(new URL('../../adapters/',import.meta.url),root,{recursive:true});
 await symlink(fileURLToPath(new URL('../../packages/',import.meta.url)),join(registry,'packages'),'dir');
 const entry=join(root,'providers','own-address','index.mjs');
 await writeFile(entry,(await readFile(entry,'utf8'))+'\n// A different host-controlled registry implementation.\n');
 const list=await createGozar({root,identity,hostCapabilities:{}}).listProviders({home:h,owner:OWNER});
 assert.equal(list.providers.find(p=>p.providerId==='own-address').configuration.values.origin,undefined);
 assert.deepEqual(list.providers.find(p=>p.providerId==='cloudflare-named').configuration.credentials.token,{known:true,value:false});
 assert.equal((await create040({registryId:R040,identity}).resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
});

test('the testing factory preserves a trusted host registry lineage',async t=>{
 const h=await home();t.after(()=>rm(h,{recursive:true,force:true}));
 const lineage={id:'testing-host',replaces:[]};
 const registry=await fakeRegistry({id:'host-provider',kinds:['session'],reach:'internet',dir:join(h,'registry')});
 const seed=createEmbeddingServices({registryId:'registry-v1:'+'c'.repeat(64),identity,lineage});
 const c=await seed.readConfiguration({home:h,owner:OWNER,providerId:'host-provider'});
 await seed.mutateConfiguration({home:h,owner:OWNER,providerId:'host-provider',expectedConfigurationRevision:c.revision},async tx=>tx.bindText('origin','https://fixture.invalid'));
 const harness=await createTestingGozar({manifest:registry.manifest,root:registry.root,registryLineage:lineage,identity,effects:[]});
 try{
  const list=await harness.gozar.listProviders({home:h,owner:OWNER});
  assert.equal(list.providers.find(p=>p.providerId==='host-provider').configuration.values.origin,'https://fixture.invalid');
 }finally{await harness.close();}
});

// ---- A. The current executable declaration decides what an earlier saved input may become.
test('public API: a saved input carries forward only when the provider currently declares that id with the same role, proved through real credential consumption',async t=>{
 const action=(kind,id)=>({id,kind,label:id,digest:`${id}-1`,disclosure:{revision:`${id}-1`,text:'Fixture',links:[]},...(kind==='provide-secret'?{secretLabel:id}:{valueFormat:'text'})});
 const cases=[
  {name:'same id and role',actions:[action('provide-secret','token'),action('provide-value','origin')],carried:true},
  {name:'the provider no longer declares the secret',actions:[action('provide-value','origin')],carried:false},
  {name:'the provider no longer declares the value',actions:[action('provide-secret','token')],carried:false},
  {name:'the secret became a plain value',actions:[action('provide-value','token'),action('provide-value','origin')],carried:false},
  {name:'the value became a secret',actions:[action('provide-secret','token'),action('provide-secret','origin')],carried:false},
  {name:'the provider declares nothing',actions:[],carried:false},
 ];
 for(const {name,actions,carried} of cases){
  const h=await home(),backend=spyBackend(h);t.after(()=>rm(h,{recursive:true,force:true}));
  const handle=await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
  const snapshot=await stateBytes(h);
  const registry=await fakeRegistry({id:'host-provider',kinds:['attached'],reach:'this-device',dir:join(h,'registry'),setupActions:actions});
  const api=createGozar({manifest:registry.manifest,root:registry.root,identity,hostCapabilities:{},secretBackend:backend,registryLineage:{id:'host-registry',replaces:[R_OLD]}});
  // An explicit refresh runs the provider's detect, which reads the configuration through resolveConfiguration: real credential consumption.
  const outcome=await api.listProviders({home:h,owner:OWNER,refresh:true}).then(list=>list,error=>error);
  const consumed=backend.log.filter(entry=>entry.op==='withSecret');
  if(carried){
   assert.ok(consumed.length>0,`${name}: the matching role consumes the credential`);
   assert.ok(consumed.every(entry=>entry.claimed),`${name}: only after the durable claim`);
   const row=outcome.providers.find(p=>p.providerId==='host-provider').configuration;
   assert.equal(row.values.origin,'https://fixture.invalid');assert.deepEqual(row.credentials.token,{known:true,value:true});
  }else{
   assert.equal(consumed.length,0,`${name}: no credential bytes may be released`);
   assert.equal(backend.log.length,0,`${name}: the backend is not even asked`);
   assert.equal(await stateBytes(h),snapshot,`${name}: every earlier byte stays in place`);
   // The earlier writer still reads its own bytes, so refusal lost nothing.
   assert.equal((await create040({registryId:R_OLD,identity,secretBackend:backend}).resolveConfiguration({home:h,owner:OWNER,providerId:'host-provider'})).token,TOKEN);
  }
  void handle;
 }
});

test('a host without a current input declaration, and an explicit adoption of a mismatched provider, both fail closed and keep the earlier bytes',async()=>{
 const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
 const snapshot=await stateBytes(h);
 const none=hostSuccessor('host-a',backend,{currentInputKinds:undefined}),unknown=hostSuccessor('host-a',backend,{currentInputKinds:async()=>undefined}),wrong=hostSuccessor('host-a',backend,{currentInputKinds:async()=>({token:'text',origin:'text'})});
 for(const s of [none,unknown,wrong]){
  await assert.rejects(s.resolveConfiguration({home:h,owner:OWNER,providerId:'host-provider'}),reason('incompatible'));
  await assert.rejects(s.adoptConfiguration({home:h,owner:OWNER,providerId:'host-provider',fromRegistryId:R_OLD}),reason('incompatible'));
 }
 assert.equal(await stateBytes(h),snapshot);assert.equal(backend.log.length,0);
});

// ---- C. A durable claim comes before any credential read.
test('two successor lineages declare the same predecessor: the first durable claim reads bytes and the loser receives none',async()=>{
 for(const order of [['host-a','host-b'],['host-b','host-a']]){
  const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
  const [first,second]=order.map(id=>hostSuccessor(id,backend));
  const args={home:h,owner:OWNER,providerId:'host-provider'};
  assert.equal((await first.resolveConfiguration(args)).token,TOKEN);
  const used=backend.log.length;assert.ok(used>0);assert.ok(backend.log.every(entry=>entry.claimed));
  await assert.rejects(second.resolveConfiguration(args),reason('taken'));
  await assert.rejects(second.readConfiguration(args),reason('taken'));
  await assert.rejects(second.adoptConfiguration({...args,fromRegistryId:R_OLD}),reason('taken'));
  assert.equal(backend.log.length,used,'the loser made no backend call');
  assert.equal((await first.resolveConfiguration(args)).token,TOKEN);
 }
 // Concurrent first reads from both lineages: exactly one wins, and no byte is read before the claim.
 const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
 const args={home:h,owner:OWNER,providerId:'host-provider'};
 const results=await Promise.allSettled(['host-a','host-b'].map(id=>hostSuccessor(id,backend).resolveConfiguration(args)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.reason,'taken');
 assert.equal(backend.log.filter(entry=>entry.op==='withSecret').length,1);assert.ok(backend.log.every(entry=>entry.claimed));
});

test('a fault before the claim is renamed releases no bytes, keeps the earlier state, and lets either lineage claim later',async()=>{
 const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
 const snapshot=await stateBytes(h),args={home:h,owner:OWNER,providerId:'host-provider'};
 const rename=fsp.rename;let armed=true;
 fsp.rename=async(from,to)=>{if(armed&&String(to).endsWith('embedding-state.json')){armed=false;throw Object.assign(new Error('fault before rename'),{code:'EIO'});}return rename(from,to);};syncBuiltinESMExports();
 try{await assert.rejects(hostSuccessor('host-a',backend).resolveConfiguration(args));}
 finally{fsp.rename=rename;syncBuiltinESMExports();}
 assert.equal(backend.log.length,0,'no backend call before a committed claim');assert.equal(await stateBytes(h),snapshot);
 assert.equal((await hostSuccessor('host-b',backend).resolveConfiguration(args)).token,TOKEN);
 await assert.rejects(hostSuccessor('host-a',backend).resolveConfiguration(args),reason('taken'));
 assert.ok(backend.log.every(entry=>entry.claimed));
});

test('a process killed at the claim write releases no bytes; after restart another lineage may claim and the first becomes the loser',async()=>{
 const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
 const snapshot=await stateBytes(h),args={home:h,owner:OWNER,providerId:'host-provider'};
 const dir=await mkdtemp(join(tmpdir(),'stbl-hook-')),marker=join(dir,'backend-calls.log'),preload=join(dir,'kill-before-rename.mjs');
 await writeFile(preload,`import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const rename=fsp.rename;fsp.rename=async(from,to)=>{if(String(to).endsWith('embedding-state.json'))process.kill(process.pid,'SIGKILL');return rename(from,to);};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,'--input-type=module','-e',`
 import {appendFileSync} from 'node:fs';
 import {createEmbeddingServices} from ${JSON.stringify(new URL('../../packages/gozar-node/embedding-services.mjs',import.meta.url).href)};
 const note=op=>appendFileSync(${JSON.stringify(marker)},op+'\\n');
 const secretBackend={put:async()=>{note('put');return {handle:'x'};},withSecret:async()=>{note('withSecret');throw {code:'setup_required'};},presence:async()=>{note('presence');return {known:true,value:true};},delete:async()=>{note('delete');return {deleted:true};}};
 const s=createEmbeddingServices({registryId:'registry-v1:host-a',identity:{instanceId:'i',bootId:'b'},secretBackend,lineage:{id:'host-a',replaces:[${JSON.stringify(R_OLD)}]},currentInputKinds:async()=>({token:'secret',origin:'text'})});
 await s.resolveConfiguration(${JSON.stringify(args)});`],{stdio:'ignore'});
 assert.equal(await new Promise(resolve=>child.on('exit',(c,signal)=>resolve(signal??c))),'SIGKILL');
 await assert.rejects(readFile(marker,'utf8'),{code:'ENOENT'},'the killed process called the backend before its claim was durable');
 assert.equal(await stateBytes(h),snapshot);
 assert.equal((await hostSuccessor('host-b',backend).resolveConfiguration(args)).token,TOKEN);
 await assert.rejects(hostSuccessor('host-a',backend).resolveConfiguration(args),reason('taken'));
 assert.ok(backend.log.every(entry=>entry.claimed));
});

test('an explicit adoption commits its claim before it observes the backend, and a refused adoption changes nothing',async()=>{
 const h=await home(),backend=spyBackend(h);await write040Mixed(h,{providerId:'host-provider',backend,registryId:R_OLD});backend.log.length=0;
 const args={home:h,owner:OWNER,providerId:'host-provider'},s=hostSuccessor('host-a',backend,{lineage:{id:'host-a',replaces:[]}});
 const adopted=await s.adoptConfiguration({...args,fromRegistryId:R_OLD});
 assert.deepEqual(adopted.credentials.token,{known:true,value:true});
 assert.ok(backend.log.length>0&&backend.log.every(entry=>entry.claimed));
});
