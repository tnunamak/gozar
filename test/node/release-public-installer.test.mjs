import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestingGozar,fakeRegistry} from '@tnunamak/gozar/testing';

const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};

async function fixture() {
  const home=await mkdtemp(join(tmpdir(),'gozar-public-installer-'));
  let registry,harness;
  const bytes=Buffer.from('PUBLIC_ARTIFACT_BODY_CANARY_1117');
  const calls={fetch:[],execute:[]},errors=[];
  const entered=deferred(),released=deferred();
  let wrong=false,hold=false;
  const capabilities={'installer.execute':{known:true,value:true},'privilege.elevate':{known:true,value:true}};
  const action={id:'install',kind:'install-artifact',label:'Install fixture artifact',digest:'artifact-1',required:false,
    artifact:{url:'https://fixture.invalid/artifact',sha256:createHash('sha256').update(bytes).digest('hex'),platform:process.platform,architecture:process.arch},
    effects:{writes:['fixture-installation'],networkOrigins:['https://fixture.invalid'],requiresPrivilege:true,restartRequired:false},
    disclosure:{revision:'artifact-1',text:'Fixture artifact effects',links:[]}};
  try {
    registry=await fakeRegistry({dir:join(home,'registry'),id:'release-artifact-fixture',kinds:['attached'],
      reach:'this-device',transport:'http',protocols:[],setupActions:[action]});
    const path=join(registry.root,'providers','release-artifact-fixture','definition.json');
    const definition=JSON.parse(await readFile(path,'utf8'));
    definition.adapter.requiredCapabilities=['installer.execute','privilege.elevate'];
    definition.adapter.effectOperations=[{kind:'artifact',operation:'fetch'},{kind:'artifact',operation:'execute'}];
    await writeFile(path,JSON.stringify(definition));
    harness=await createTestingGozar({...registry,hostCapabilities:capabilities,effects:[
      {kind:'artifact',operation:'fetch',handle:async input=>{
        calls.fetch.push(structuredClone(input));entered.resolve();
        if(hold)await released.promise;
        return {bytes:(wrong?Buffer.from('WRONG_ARTIFACT_BODY_CANARY_1117'):bytes).toString('base64')};
      }},
      {kind:'artifact',operation:'execute',handle:async input=>{
        calls.execute.push(structuredClone(input));return {executed:true,exitCode:0};
      }},
    ]});
    const provider=(await harness.gozar.listProviders({home})).providers[0];
    const offered=provider.prerequisites.find(item=>item.remedy?.id===action.id)?.remedy;
    assert.ok(offered,'public inventory offers the real setup action');
    assert.deepEqual(offered.consent.disclosures.action.artifact,action.artifact);
    assert.deepEqual(offered.consent.disclosures.action.effects,action.effects);
    const consent=structuredClone(offered.consent);
    const request={home,providerId:'release-artifact-fixture',actionId:offered.id,
      expectedConfigurationRevision:provider.configuration.revision,
      approval:{kind:'setup',digest:offered.digest,disclosureRevision:offered.disclosure.revision,
        consentFactsDigest:consent.consentFactsDigest}};
    const invoke=async()=>{
      try{return await harness.gozar.runSetupAction(request);}
      catch(error){errors.push({code:error.code,message:error.message,nextAction:error.nextAction,serialized:JSON.stringify(error)});throw error;}
    };
    return {harness,bytes,calls,errors,capabilities,action,consent,request,invoke,entered,
      wrong:()=>{wrong=true;},hold:()=>{hold=true;},release:()=>released.resolve(),
      close:async()=>{
        released.resolve();
        try{await harness.close();}finally{try{await registry.cleanup();}finally{await rm(home,{recursive:true,force:true});}}
      }};
  } catch(error) {
    released.resolve();
    try{await harness?.close();}finally{try{await registry?.cleanup();}finally{await rm(home,{recursive:true,force:true});}}
    throw error;
  }
}
function privateBodiesStayPrivate(f) {
  const visible=JSON.stringify({events:f.harness.events,errors:f.errors});
  for(const body of [f.bytes,Buffer.from('WRONG_ARTIFACT_BODY_CANARY_1117')]){
    assert.equal(visible.includes(body.toString()),false);
    assert.equal(visible.includes(body.toString('base64')),false);
  }
}

const refusalCode={denied:'host_policy_denied',undeclared:'unsupported'};

function assertInstallerRefusal(state,error) {
  assert.equal(error?.code,refusalCode[state],`correct refusal for ${state}`);
  return true;
}

test('installer refusal oracle does not accept another nonempty error code',()=>{
  for(const state of Object.keys(refusalCode)) {
    assert.throws(()=>assertInstallerRefusal(state,{code:'fixture_unrelated_error'}),{code:'ERR_ASSERTION'});
    assert.equal(assertInstallerRefusal(state,{code:refusalCode[state]}),true);
  }
});

for(const capability of ['installer.execute','privilege.elevate']) for(const state of ['denied','undeclared'])
test('public installer rejects '+state+' '+capability+' without fetching or executing',{timeout:10000},async()=>{
  let f;
  try {
    f=await fixture();
    if(state==='denied')f.capabilities[capability]={known:true,value:false};
    else delete f.capabilities[capability];
    await assert.rejects(f.invoke(),error=>assertInstallerRefusal(state,error));
    assert.equal(f.calls.fetch.length,0);assert.equal(f.calls.execute.length,0);
    privateBodiesStayPrivate(f);
  } finally {await f?.close();}
});

test('public installer rejects wrong bytes then executes the exact approved snapshot once',{timeout:10000},async()=>{
  let bad,good;
  try {
    bad=await fixture();bad.wrong();
    await assert.rejects(bad.invoke(),{code:'artifact_integrity_failed'});
    assert.equal(bad.calls.fetch.length,1);assert.equal(bad.calls.execute.length,0);
    privateBodiesStayPrivate(bad);
    good=await fixture();
    const before=structuredClone(good.request);
    const result=await good.invoke();
    assert.equal(result.state,'complete');
    assert.equal(result.configurationRevision,before.expectedConfigurationRevision);
    assert.equal(good.calls.fetch.length,1);assert.equal(good.calls.execute.length,1);
    assert.deepEqual(good.calls.fetch[0],{artifact:good.action.artifact});
    assert.deepEqual(good.calls.execute[0],{artifact:good.action.artifact,effects:good.action.effects,bytes:good.bytes.toString('base64')});
    assert.deepEqual(good.request,before);
    assert.deepEqual(good.consent.disclosures.action.artifact,good.calls.execute[0].artifact);
    assert.deepEqual(good.consent.disclosures.action.effects,good.calls.execute[0].effects);
    privateBodiesStayPrivate(good);
  } finally {try{await bad?.close();}finally{await good?.close();}}
});

test('public installer rejects a changed consent digest before effects',{timeout:10000},async()=>{
  let f;
  try {
    f=await fixture();
    f.request.approval.consentFactsDigest='not-the-reviewed-consent';
    await assert.rejects(f.invoke(),{code:'consent_mismatch'});
    assert.equal(f.calls.fetch.length,0);assert.equal(f.calls.execute.length,0);
    privateBodiesStayPrivate(f);
  } finally {await f?.close();}
});

test('public installer rechecks privilege after asynchronous fetch, before execute',{timeout:10000},async()=>{
  let f,pending;
  try {
    f=await fixture();f.hold();
    // Attach rejection handling before releasing either asynchronous boundary.
    pending=f.invoke().then(value=>({value}),error=>({error}));
    await Promise.race([f.entered.promise,pending.then(()=>assert.fail('setup settled before artifact fetch'))]);
    assert.equal(f.calls.fetch.length,1);assert.equal(f.calls.execute.length,0);
    f.capabilities['privilege.elevate']={known:true,value:false};
    f.release();
    const result=await pending;
    assert.ok(result.error,'revoked authority cannot complete installation');
    assert.equal(result.error.code,'host_policy_denied');
    assert.equal(f.calls.fetch.length,1);assert.equal(f.calls.execute.length,0);
    privateBodiesStayPrivate(f);
  } finally {f?.release();if(pending)await pending;await f?.close();}
});
