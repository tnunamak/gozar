import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';

for(const cancelled of [false,true])test(`configuration-migration-retirement: resource-free ${cancelled?'cancelled':'completed'} earlier setup permits adoption`,async t=>{
 const home=await mkdtemp(join(homedir(),'.tmp','g-upgrade-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const request={home,owner:'upgrade-fixture',providerId:'localhost-run',operationId:'terminal-setup'};
 const earlier=createEmbeddingServices({registryId:PUBLISHED_REGISTRY_IDS[1]});
 const configuration=await earlier.readConfiguration(request);
 await earlier.setupTransaction(request,async storage=>storage.reserve({scopeId:configuration.scopeId,draftId:null,
  configurationRevision:configuration.revision,revision:1,startedAt:'2026-11-18T12:39:25.959Z',cancelled,
  management:{},replays:{},resources:[],offerKey:null}));
 const current=createEmbeddingServices({registryId:'registry-v1:upgrade-fixture',lineage:bundledLineage(),currentInputKinds:async()=>({})});
 const adopted=await current.readConfiguration(request);
 assert.notEqual(adopted.scopeId,configuration.scopeId);
 const saved=JSON.parse(await readFile(join(home,'embedding-state.json'),'utf8'));
 assert.equal(saved.configs[configuration.scopeId].migratedTo,adopted.scopeId);
 assert.equal(Object.values(saved.setupOperations??{}).filter(op=>op.scopeId===configuration.scopeId).length,0);
});
