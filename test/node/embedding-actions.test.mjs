import {test} from 'node:test';import assert from 'node:assert/strict';
import {executeArtifact,capabilityPrerequisites} from '../../packages/gozar-node/embedding-prerequisites.mjs';
import {bindingFor,cleanupRecovery} from '../../packages/gozar-node/embedding-projections.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';
import {runEmbeddingSetup} from '../../packages/gozar-node/embedding-setup.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('artifact mismatch and unknown capability never execute',async()=>{let executions=0;const action={artifact:{url:'https://fixture.invalid/a',sha256:'0'.repeat(64),platform:process.platform,architecture:process.arch},effects:{requiresPrivilege:false}};const executor={fetchArtifact:async()=>Buffer.from('wrong'),executeArtifact:async()=>executions++};await assert.rejects(executeArtifact(action,{hostCapabilities:{'installer.execute':{known:true,value:true}},executor}),{code:'artifact_integrity_failed'});await assert.rejects(executeArtifact(action,{executor}),{code:'unsupported'});assert.equal(executions,0);assert.equal(capabilityPrerequisites({requiredCapabilities:['custom']})[0].state,'unknown');});
test('requested target never becomes observed binding; retained close action is explicit',()=>{assert.equal(bindingFor({target:'localhost:3'}).target.known,false);assert.equal(cleanupRecovery({state:'unconfirmed'},{kind:'attached'}).nextAction.id,'retry-close');assert.equal(cleanupRecovery({state:'confirmed'},{}).nextAction,null);});
test('provider and action CAS reject with zero adapter effects',async()=>{
 const home=await mkdtemp(join(tmpdir(),'embed-setup-'));let effects=0;
 const s=createEmbeddingServices({registryId:'test'});const action={id:'same',kind:'gozar-runs',digest:'digest',disclosure:{revision:'v'}};
 const adapter={id:'opaque',definition:{capabilities:{},supportedKinds:['attached'],disclosure:{revision:'v'}},detect:async()=>({state:'ready',facts:{}}),properties:()=>({}),setupActions:()=>[action],setup:async()=>{effects++;return {state:'complete'};}};
 try{const c=await s.readConfiguration({home,providerId:'opaque'});const r={home,providerId:'opaque',actionId:'same',expectedConfigurationRevision:c.revision,approval:{kind:'setup',digest:'digest',disclosureRevision:'v'}};const deps={embeddingServices:s,adapters:[adapter],readContext:{configuration:async()=>null}};
 await assert.rejects(runEmbeddingSetup({...r,approval:{...r.approval,kind:'route'}},deps),{code:'consent_required'});
 await assert.rejects(runEmbeddingSetup({...r,expectedConfigurationRevision:'old'},deps),{code:'configuration_stale'});
 await assert.rejects(runEmbeddingSetup({...r,providerId:'other'},deps),{code:'candidate_stale'});
 await assert.rejects(runEmbeddingSetup({...r,approval:{...r.approval,digest:'old'}},deps),{code:'candidate_stale'});assert.equal(effects,0);
 await runEmbeddingSetup(r,deps);assert.equal(effects,1);
 }finally{await rm(home,{recursive:true,force:true});}
});
