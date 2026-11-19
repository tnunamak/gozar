// Stable configuration identity and the one-time carry-forward of state written under a registry-hashed scope.
// The old state comes from the historical 0.4.0 writer (fixtures/legacy-040, provenance in its README) and from the
// golden bytes that the published tarball wrote. Everything here uses synthetic values and private temp homes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,copyFile,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';
import {setupConsentReview} from '../../packages/gozar-node/consent-facts.mjs';
import {createGozar} from '../../packages/gozar-node/api.mjs';
import {fakeRegistry} from '../../packages/gozar-node/testing.mjs';
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
const candidate=(registryId,extra={})=>createEmbeddingServices({registryId,lineage:bundledLineage(),identity,...extra});

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

test('a read-only resolve carries the value in memory and writes nothing',async()=>{
 const h=await home();await write040(h);const snapshot=await stateBytes(h);
 const s=candidate('registry-v1:candidate-a');
 assert.equal((await s.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 assert.equal(await stateBytes(h),snapshot);
 // The old release still reads its own state: nothing was taken.
 assert.equal((await create040({registryId:R040,identity}).resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
});

test('a process killed after the new state is written but before it is renamed loses nothing and migration completes later',async()=>{
 const h=await home();await write040(h);const snapshot=await stateBytes(h);
 const preload=join(await mkdtemp(join(tmpdir(),'stbl-hook-')),'kill-before-rename.mjs');
 await writeFile(preload,`import fsp from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
const rename=fsp.rename;fsp.rename=async(from,to)=>{if(String(to).endsWith('embedding-state.json'))process.kill(process.pid,'SIGKILL');return rename(from,to);};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,'--input-type=module','-e',`
 import {createEmbeddingServices} from ${JSON.stringify(new URL('../../packages/gozar-node/embedding-services.mjs',import.meta.url).href)};
 import {bundledLineage} from ${JSON.stringify(new URL('../../packages/gozar-node/registry-lineage.mjs',import.meta.url).href)};
 const s=createEmbeddingServices({registryId:'registry-v1:candidate-a',lineage:bundledLineage(),identity:{instanceId:'i',bootId:'b'}});
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
 assert.equal(await stateBytes(h),snapshot);
 // The redacted read reports an unknown credential and persists the move; the binding stays recoverable.
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

test('a live route reservation moves with the configuration and the old record cannot be removed or taken',async()=>{
 const h=await home(),{handle}=await write040(h,{uses:true});
 const s=candidate('registry-v1:candidate-a');
 const c=await read(s,h,'cloudflare-named');
 const state=JSON.parse(await stateBytes(h));
 assert.deepEqual(state.configs[c.scopeId].uses,['"live-route"']);
 const old=state.configs[oldScope(R040,await realpath(h),OWNER,'cloudflare-named')];
 assert.equal(old.migratedTo,c.scopeId);assert.equal(old.bindings.token,handle);
 await assert.rejects(s.discardSecret({home:h,handle}),code('secret_in_use'));
 await assert.rejects(s.beginConfigurationDraft({home:h,owner:OWNER,providerId:'cloudflare-named',expectedConfigurationRevision:c.revision}).then(async d=>s.commitConfigurationDraft({home:h,owner:OWNER,providerId:'cloudflare-named',draftId:d.draftId,expectedConfigurationRevision:d.configuration.revision})),code('configuration_in_use'));
 await s.releaseConfigurationUse({home:h,owner:OWNER,providerId:'cloudflare-named',handle:'live-route'});
 assert.deepEqual(JSON.parse(await stateBytes(h)).configs[c.scopeId].uses,[]);
});

test('a host registry with its own stable id carries its own old scope once, and a rival cannot take it',async()=>{
 const h=await home(),R_OLD='registry-v1:'+'a'.repeat(64);
 await write040(h,{registryId:R_OLD});
 const host=createEmbeddingServices({registryId:'registry-v1:host-v2',identity,lineage:{id:'host-registry',replaces:[R_OLD],inputKinds:{token:'secret',origin:'text'}}});
 assert.equal((await read(host,h,'own-address')).values.origin,'https://fixture.invalid');
 await read(host,h,'cloudflare-named');
 assert.equal((await host.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const host3=createEmbeddingServices({registryId:'registry-v1:host-v3',identity,lineage:{id:'host-registry',replaces:[R_OLD]}});
 assert.equal((await host3.resolveConfiguration({home:h,owner:OWNER,providerId:'cloudflare-named'})).token,TOKEN);
 const rival=createEmbeddingServices({registryId:'registry-v1:rival',identity,lineage:{id:'rival-host',replaces:[R_OLD]}});
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
