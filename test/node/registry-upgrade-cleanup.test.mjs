import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {attachedCleanupReference} from '../../packages/gozar-node/attached-route.mjs';
import {atomicWrite,Journal} from '../../packages/gozar-node/journal.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';
import {createGozar} from '../../packages/gozar-node/api.mjs';
import {loadCore} from '../../packages/gozar-node/core.mjs';
import {startingRoute} from '../../packages/gozar-node/route-operations.mjs';
import {canonicalDigest} from '../../packages/gozar-node/consent-token.mjs';
import {createHash} from 'node:crypto';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

test('registry-upgrade-cleanup: exact bundled predecessor is admitted for removal',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const directory=join(home,'port-8799');await mkdir(directory,{mode:0o700});
 const handle={kind:'session',id:'port-8799:earlier-session',generation:1};
 await atomicWrite(join(directory,'bootstrap.json'),{targetPort:8799,sessionId:'earlier-session',adapterId:'localhost-run',
  registryId:PUBLISHED_REGISTRY_IDS[1],home,owner:'upgrade-fixture',handle});
 const scope=await attachedCleanupReference({home,owner:'upgrade-fixture',handle,mode:'remove'},
  {registryId:'registry-v1:upgrade-fixture',lineage:bundledLineage()});
 assert.equal(scope.registryId,PUBLISHED_REGISTRY_IDS[1]);
 assert.deepEqual(scope.handle,handle);
});

for(const [label,change]of [
 ['unknown registry',(b,r)=>{b.registryId='registry-v1:'+'f'.repeat(64);}],
 ['no trusted lineage',(b,r,rt)=>{delete rt.lineage;}],
 ['a copied lineage declaration',(b,r,rt)=>{rt.lineage={...bundledLineage()};}],
 ['wrong owner',(b,r)=>{r.owner='foreign';}],
 ['wrong generation',(b,r)=>{r.handle={...r.handle,generation:2};}],
 ['wrong canonical home',(b)=>{b.home+='/foreign';}],
 ['non-removal mode',(b,r)=>{r.mode='hand-back';}],
])test(`registry-upgrade-cleanup: ${label} remains refused`,async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const directory=join(home,'port-8799');await mkdir(directory,{mode:0o700});
 const handle={kind:'session',id:'port-8799:earlier-session',generation:1};
 const bootstrap={targetPort:8799,sessionId:'earlier-session',adapterId:'localhost-run',registryId:PUBLISHED_REGISTRY_IDS[1],home,owner:'upgrade-fixture',handle};
 const request={home,owner:'upgrade-fixture',handle,mode:'remove'},runtime={registryId:'registry-v1:upgrade-fixture',lineage:bundledLineage()};
 change(bootstrap,request,runtime);const path=join(directory,'bootstrap.json');await atomicWrite(path,bootstrap);
 const before=await readFile(path,'utf8');
 await assert.rejects(attachedCleanupReference(request,runtime),error=>['cleanup_debt','route_conflict'].includes(error.code));
 assert.equal(await readFile(path,'utf8'),before);
});

test('registry-upgrade-cleanup: stopped 0.5.0 journal closes and remains terminal after restart',async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const directory=join(home,'port-8799');await mkdir(directory,{mode:0o700});
 const owner='upgrade-fixture',operationId='old-allocation',sessionId='earlier-session';
 const handle={kind:'session',id:`port-8799:${sessionId}`,generation:1};
 const registryId=PUBLISHED_REGISTRY_IDS[1],providerId='localhost-run';
 const earlier=createEmbeddingServices({registryId}),request={home,owner,providerId};
 const config=await earlier.readConfiguration(request);
 await earlier.registerConfigurationUse({...request,revision:config.revision,handle});
 await atomicWrite(join(directory,'bootstrap.json'),{targetPort:8799,sessionId,adapterId:providerId,registryId,home,owner,handle,operationId});
 const step=await loadCore(),initial=step({command:{type:'status',sessionId}});
 const journal=new Journal(directory);
 await journal.save({state:{...initial.state,phase:'stopped'},snapshot:{...initial.snapshot,sessionId,phase:'stopped'},owned:{},intents:{},targetPort:8799});
 const intent={registryId,providerId,owner,scopeId:config.scopeId};
 const view={...startingRoute(handle,'127.0.0.1:8799',operationId),state:'usable'};
 const operations=join(home,'operations');await mkdir(operations,{mode:0o700});
 const operationPath=join(operations,createHash('sha256').update(JSON.stringify([owner,operationId])).digest('hex')+'.json');
 await atomicWrite(operationPath,{schemaVersion:1,owner,operationId,intent,intentDigest:canonicalDigest(intent),phase:'allocated',view});
 for(let attempt=0;attempt<2;attempt++){
  const api=createGozar();
  const closed=await api.closeRoute({home,owner,handle,mode:'remove'});
  assert.equal(closed.state,'released');assert.equal(closed.cleanup.state,'confirmed');
  const inventory=await api.listRoutes({home,owner});
  const retained=inventory.routes.find(route=>route.handle.id===handle.id);
  assert.equal(retained.state,'released');assert.equal(retained.cleanup.state,'confirmed');
 }
 const saved=JSON.parse(await readFile(operationPath,'utf8'));
 assert.equal(saved.phase,'terminal');
 const state=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 assert.deepEqual(state.configs[config.scopeId].uses,[]);
});
