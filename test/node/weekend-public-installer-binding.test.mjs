import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fakeRegistry,createTestingGozar} from '../../packages/gozar-node/testing.mjs';

const bytes=Uint8Array.from([1,2,3]);
const hash=createHash('sha256').update(bytes).digest('hex');
const declarations=()=>[{kind:'artifact',operation:'fetch'},{kind:'artifact',operation:'execute'}];
const capabilities=()=>({'installer.execute':{known:true,value:true},'privilege.elevate':{known:true,value:true}});
const install=()=>({id:'install-fixture',kind:'install-artifact',label:'Install fixture',
  digest:'sha256:'+hash,disclosure:{revision:'fixture-v1',text:'Synthetic approved install',links:[]},
  artifact:{url:'https://example.invalid/fixture',sha256:hash,platform:process.platform,architecture:process.arch},
  effects:{writes:[],networkOrigins:['https://example.invalid'],requiresPrivilege:false,restartRequired:false}});
const inputAction={id:'fixture-value',kind:'provide-value',label:'Fixture value',digest:'fixture-value-v1',
  disclosure:{revision:'fixture-value-v1',text:'Synthetic value',links:[]},valueLabel:'Value',valueFormat:'text'};
async function fixture(t,options={}){
  const id='fixture-'+randomUUID(),home=await mkdtemp(join(tmpdir(),'gozar-install-'));
  const registry=await fakeRegistry({id,kinds:['attached'],reach:'this-device',transport:'tcp',
    proofProtocol:'echo',setupActions:[install(),inputAction],effectOperations:declarations()});
  t.after(async()=>{await registry.cleanup();await rm(home,{recursive:true,force:true});});
  const calls=[];
  const effects=[
    {kind:'artifact',operation:'fetch',handle:async value=>{
      calls.push({operation:'fetch',value});
      if(options.fetchError)throw new Error('synthetic fetch failure');
      return {bytes:Buffer.from(options.badHash?[9,9,9]:bytes).toString('base64')};
    }},
    {kind:'artifact',operation:'execute',handle:async value=>{
      calls.push({operation:'execute',value});
      if(options.executeError)throw new Error('synthetic execute failure');
      return {executed:true,exitCode:options.exitCode??0};
    }}
  ].filter(effect=>effect.operation!==options.omit);
  const harness=await createTestingGozar({...registry,
    hostCapabilities:Object.hasOwn(options,'hostCapabilities')?options.hostCapabilities:capabilities(),effects});
  t.after(()=>harness.close());
  const q={schemaVersion:1,home,owner:'fixture-owner',providerId:id,target:'127.0.0.1:1',
    usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',
      payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};
  const catalog=async()=>{
    const result=await harness.gozar.catalogRoutes(q);
    const candidate=result.candidates.find(row=>row.providerId===id);
    assert.ok(candidate,'unknown fixture provider must be catalogued');return candidate;
  };
  const request=(candidate,actionId='install-fixture')=>{
    const action=candidate.setup.actions.find(row=>row.id===actionId);
    assert.ok(action,'public catalog must offer action '+actionId);
    assert.equal(action.consent.scope.kind,'setup');
    return {home,owner:q.owner,providerId:id,actionId,
      expectedConfigurationRevision:candidate.configuration.revision,
      approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,
        consentFactsDigest:action.consent.consentFactsDigest}};
  };
  return {api:harness.gozar,events:harness.events,calls,catalog,request,registry};
}
test('fakeRegistry snapshots optional open effect declarations and preserves omission',async t=>{
  const ops=declarations(),id='fixture-'+randomUUID();
  const registry=await fakeRegistry({id,kinds:['attached'],reach:'this-device',effectOperations:ops});
  t.after(()=>registry.cleanup());
  ops[0].operation='changed';ops.push({kind:'custom',operation:'later'});
  const definition=JSON.parse(await readFile(join(registry.root,'providers',id,'definition.json'),'utf8'));
  assert.deepEqual(definition.adapter.effectOperations,declarations());
  const legacyId='fixture-'+randomUUID(),legacy=await fakeRegistry({id:legacyId,kinds:['attached'],reach:'this-device'});
  t.after(()=>legacy.cleanup());
  const omitted=JSON.parse(await readFile(join(legacy.root,'providers',legacyId,'definition.json'),'utf8'));
  assert.equal(Object.hasOwn(omitted.adapter,'effectOperations'),false);
});
test('public setup approval executes exact approved bytes once per invocation',async t=>{
  const f=await fixture(t);
  const result=await f.api.runSetupAction(f.request(await f.catalog()));
  assert.equal(result.state,'complete');
  assert.deepEqual(f.calls.map(row=>row.operation),['fetch','execute']);
  assert.deepEqual(Buffer.from(f.calls[1].value.bytes,'base64'),Buffer.from(bytes));
  assert.deepEqual(f.calls[1].value.artifact,install().artifact);
  assert.deepEqual(f.events.map(row=>row.state),['completed','completed']);
  // Re-catalogue and explicitly approve again: not a cross-invocation dedup promise.
  await f.api.runSetupAction(f.request(await f.catalog()));
  assert.deepEqual(f.calls.map(row=>row.operation),['fetch','execute','fetch','execute']);
});
for(const [field,code]of [['digest','candidate_stale'],['disclosureRevision','candidate_stale'],['consentFactsDigest','consent_mismatch']]){
  test('public setup refuses mismatched '+field+' before effects',async t=>{
    const f=await fixture(t),request=f.request(await f.catalog());
    request.approval[field]='wrong-fixture-value';
    await assert.rejects(f.api.runSetupAction(request),{code});
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);
  });
}
test('public setup refuses stale configuration after actual value mutation',async t=>{
  const f=await fixture(t),before=await f.catalog(),stale=f.request(before);
  await f.api.runSetupAction({...f.request(before,'fixture-value'),value:'changed'});
  const after=await f.catalog();
  assert.notEqual(after.configuration.revision,before.configuration.revision);
  assert.equal(after.configuration.values['fixture-value'],'changed');
  await assert.rejects(f.api.runSetupAction(stale),{code:'configuration_stale'});
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);
});
for(const [label,options,code,operations]of [
  ['hash mismatch',{badHash:true},'artifact_integrity_failed',['fetch']],
  ['fetch failure',{fetchError:true},'provider_unavailable',['fetch']],
  ['execute failure',{executeError:true},'provider_unavailable',['fetch','execute']],
  ['nonzero exit',{exitCode:1},'provider_unavailable',['fetch','execute']],
  ['missing fetch mapping',{omit:'fetch'},'unsupported',[]],
  ['missing execute mapping',{omit:'execute'},'unsupported',['fetch']],
]){
  test('public setup '+label+' refuses without automatic retry',async t=>{
    const f=await fixture(t,options);
    await assert.rejects(f.api.runSetupAction(f.request(await f.catalog())),{code});
    assert.deepEqual(f.calls.map(row=>row.operation),operations);
    // Failure is not evidence that an artifact was installed.
    const after=await f.catalog();
    assert.ok(after.setup.actions.some(action=>action.id==='install-fixture'));
  });
}
for(const [label,value]of [['omitted',undefined],['denied',{known:true,value:false}],['unknown',{known:false,reason:'fixture'}],['malformed',{known:true,value:'yes'}]]){
  test('public setup '+label+' installer capability refuses before callbacks',async t=>{
    const hostCapabilities=value===undefined?{}:{'installer.execute':value};
    const f=await fixture(t,{hostCapabilities});
    await assert.rejects(f.api.runSetupAction(f.request(await f.catalog())),{code:'host_policy_denied'});
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.events,[]);
  });
}
