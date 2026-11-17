import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { scratch, query } from './route-schema-check.mjs';

test('CLI prompts generically from the approved descriptor and passes a secret handle only', async t => {
  const home=await scratch(t), approval=join(home,'approval.json'), queryFile=join(home,'query.json');
  await writeFile(approval,JSON.stringify({kind:'setup',digest:'input',disclosureRevision:'disc-input',consentFactsDigest:'facts-input'}),{mode:0o600});await writeFile(queryFile,JSON.stringify(query({home})));
  const stdout=new PassThrough(),stderr=new PassThrough();let output='',errors='',seen,prompt;
  stdout.on('data',chunk=>output+=chunk);stderr.on('data',chunk=>errors+=chunk);
  const api={catalogRoutes:async()=>({candidates:[{providerId:'fixture',configuration:{revision:'rev-input',scopeId:'scope-input',inputRequirements:[{id:'new-input',actionId:'new-input',label:'New input',kind:'text',secret:true,required:true,help:'Fixture help',obtainUrl:'https://example.invalid/credential'}],actions:[{id:'new-input',digest:'input',disclosure:{revision:'disc-input',text:'Fixture intake'},consent:{consentFactsDigest:'facts-input',facts:[]}}]}}]}),runSetupAction:async request=>{seen=request;return {schemaVersion:1,state:'complete',nextAction:null,catalogRevision:'fixture'};}};
  const exit=await routeMain(['setup','new-input','--prompt','--query-file',queryFile,'--approval-file',approval,'--provider-id','fixture','--home',home,'--json'],{api,stdout,stderr,prompt:async descriptor=>{prompt=descriptor;return 'secret-cli-canary';},storeSecret:async({bytes})=>{assert.equal(new TextDecoder().decode(bytes),'secret-cli-canary');return {handle:'sec_'+'1'.repeat(32)};}});
  assert.equal(exit,0,errors);assert.equal(prompt.secret,true);assert.equal(seen.secretHandle,'sec_'+'1'.repeat(32));assert.equal(seen.value,undefined);assert.ok(!output.includes('secret-cli-canary'));assert.ok(!errors.includes('secret-cli-canary'));
});

test('configure collects a new provider input without an approval-file or provider-specific branch', async t => {
  const home=await scratch(t), file=join(home,'query.json');await writeFile(file,JSON.stringify(query({home})));
  let saved=false,asked=false,submitted;
  const candidate=()=>({providerId:'fixture',display:{label:'Unknown fixture'},facts:[],setup:{state:saved?'ready':'action-required',actions:[]},configuration:{revision:'rev-configure',scopeId:'scope-configure',inputRequirements:[{id:'credential',actionId:'credential',label:'Unknown credential',kind:'text',secret:true,required:true,help:'Input help',obtainUrl:null}],actions:[{id:'credential',digest:'new',disclosure:{revision:'new',text:'Fixture credential intake'},consent:{consentFactsDigest:'facts-configure',facts:[]}}]}});
  const api={catalogRoutes:async()=>({catalogRevision:'new',candidates:[candidate()]}),runSetupAction:async request=>{submitted=request;saved=true;return {state:'complete'};}};
  const stdout=new PassThrough(),stderr=new PassThrough();let errors='';stderr.on('data',c=>errors+=c);
  const result=await routeMain(['configure','--query-file',file,'--home',home,'--json'],{api,stdout,stderr,prompt:async descriptor=>{asked=true;assert.equal(descriptor.secret,true);return 'configure-secret-canary';},storeSecret:async()=>({handle:'sec_'+'2'.repeat(32)})});
  assert.equal(result,0,errors);assert.equal(asked,true);assert.equal(submitted.secretHandle,'sec_'+'2'.repeat(32));assert.ok(!errors.includes('configure-secret-canary'));
});
