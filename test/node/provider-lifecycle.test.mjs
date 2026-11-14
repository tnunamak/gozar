import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import * as gozar from '@tnunamak/gozar';
import { fakeRegistry } from '@tnunamak/gozar/testing';
import { scratch, query, assertShape } from './route-schema-check.mjs';
import { renderScreen } from '../../examples/remote-access-screen.mjs';

test('a new fixture provider loads through the public factory and crosses setup, process, proof and cleanup boundaries', async t => {
  const home=await scratch(t), root=join(home,'registry');
  const disclosure={revision:'fixture-input',text:'Fixture only',links:[]};
  const fact={id:'fixture-status',label:'Fixture fact',value:'rendered from data',known:true,group:'extension-group',affectsConsent:true,source:'fixture',asOf:null};
  const registry=await fakeRegistry({id:'extension-fixture',label:'Extension fixture',kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',dir:root,facts:[fact],
    setupActions:[{id:'credential',kind:'provide-secret',label:'Fixture credential',digest:'fixture-input',disclosure}]}); t.after(registry.cleanup);
  assert.equal(typeof gozar.createGozar,'function');
  const api=gozar.createGozar({manifest:registry.manifest,root:registry.root});
  const q=query({home,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const [choice]=(await api.catalogRoutes(q)).candidates;
  assert.equal(choice.configuration.inputRequirements[0].secret,true);
  const {handle}=await api.storeSecret({home,owner:q.owner,providerId:choice.providerId,inputId:'credential',scopeId:choice.configuration.scopeId,expectedConfigurationRevision:choice.configuration.revision,bytes:new TextEncoder().encode('private-fixture-input')});
  const action=choice.configuration.actions[0];
  await api.runSetupAction({home,owner:q.owner,providerId:choice.providerId,expectedConfigurationRevision:choice.configuration.revision,actionId:action.id,secretHandle:handle,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
  const catalog=await api.catalogRoutes(q), selected=catalog.candidates[0];
  assert.match(renderScreen(catalog),/Fixture fact: "rendered from data"/);
  assert.match(renderScreen(catalog),/Input requirement: Fixture credential/);
  const route=await api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:selected.candidateToken,disclosureRevision:selected.disclosure.revision,consentFactsDigest:selected.consentFactsDigest}});
  t.after(async()=>{await api.closeRoute({home,handle:route.handle,mode:'remove'}).catch(()=>{});});
  assertShape('RouteView',route); assert.equal(route.routeState,'verified');assert.equal(route.handle.generation,1);
  const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});
  assert.equal(stopped.cleanup.state,'confirmed');assert.equal(stopped.published,null);
  const events=(await readFile(join(root,'providers','extension-fixture','events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line).event);
  for(const event of ['setup','start','proof','stop','cleanup']) assert.ok(events.includes(event),JSON.stringify(events));
  assert.ok(events.indexOf('start')<events.indexOf('proof')); assert.ok(events.indexOf('stop')<events.indexOf('cleanup'));
});

for(const mismatch of ['attempt','endpoint','allocation'])test(`core rejects another ${mismatch} and cleans up the owned fixture`, async t => {
  const home=await scratch(t),root=join(home,'registry'),id=`mismatched-${mismatch}`;
  const registry=await fakeRegistry({id,kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',dir:root});t.after(registry.cleanup);
  const module=join(root,'providers',id,'index.mjs');
  const replacements={attempt:['attemptId:current.id','attemptId:"another-attempt"'],endpoint:['endpoint:origin','endpoint:"tcp://127.0.0.1:1"'],allocation:['generation: ctx.generation ?? 1','generation: 9']};
  const source=await readFile(module,'utf8'),[before,after]=replacements[mismatch];assert.ok(source.includes(before));await writeFile(module,source.replace(before,after));
  const api=gozar.createGozar({manifest:registry.manifest,root});
  const q=query({home,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
  const choice=(await api.catalogRoutes(q)).candidates[0];
  await assert.rejects(api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}}),error=>error.code===(mismatch==='allocation'?'provider_unavailable':'verification_failed'));
  const events=(await readFile(join(root,'providers',id,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line).event);
  assert.ok(events.includes('start'));assert.ok(events.includes('stop'));assert.ok(events.includes('cleanup'));
});
