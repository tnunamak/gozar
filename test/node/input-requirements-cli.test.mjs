import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { scratch, query } from './route-schema-check.mjs';

test('CLI prompts generically from the approved descriptor and passes a secret handle only', async t => {
  const home=await scratch(t), approval=join(home,'approval.json'), queryFile=join(home,'query.json');
  await writeFile(approval,JSON.stringify({digest:'input',disclosureRevision:'disc-input'}),{mode:0o600});await writeFile(queryFile,JSON.stringify(query({home})));
  const stdout=new PassThrough(),stderr=new PassThrough();let output='',errors='',seen,prompt;
  stdout.on('data',chunk=>output+=chunk);stderr.on('data',chunk=>errors+=chunk);
  const api={catalogRoutes:async()=>({candidates:[{configuration:{inputRequirements:[{id:'new-input',label:'New input',kind:'text',secret:true,required:true,help:'Fixture help',obtainUrl:'https://example.invalid/credential'}],actions:[{id:'new-input',digest:'input',disclosure:{revision:'disc-input'}}]}}]}),runSetupAction:async request=>{seen=request;return {schemaVersion:1,state:'complete',nextAction:null,catalogRevision:'fixture'};}};
  const exit=await routeMain(['setup','new-input','--prompt','--query-file',queryFile,'--approval-file',approval,'--home',home,'--json'],{api,stdout,stderr,prompt:async descriptor=>{prompt=descriptor;return 'secret-cli-canary';},storeSecret:async({value})=>{assert.equal(value,'secret-cli-canary');return {handle:'sec_'+'1'.repeat(32)};}});
  assert.equal(exit,0,errors);assert.equal(prompt.secret,true);assert.equal(seen.secretHandle,'sec_'+'1'.repeat(32));assert.equal(seen.value,undefined);assert.ok(!output.includes('secret-cli-canary'));assert.ok(!errors.includes('secret-cli-canary'));
});
