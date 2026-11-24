import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {attachedCleanupReference} from '../../packages/gozar-node/attached-route.mjs';
import {atomicWrite} from '../../packages/gozar-node/journal.mjs';
import {bundledLineage,PUBLISHED_REGISTRY_IDS} from '../../packages/gozar-node/registry-lineage.mjs';

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
