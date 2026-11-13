import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
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
  const {handle}=await gozar.storeSecret({home,value:'private-fixture-input'});
  const action=choice.configuration.actions[0];
  await api.runSetupAction({home,actionId:action.id,secretHandle:handle,approval:{digest:action.digest,disclosureRevision:action.disclosure.revision}});
  const catalog=await api.catalogRoutes(q), selected=catalog.candidates[0];
  assert.match(renderScreen(catalog),/Fixture fact: "rendered from data"/);
  assert.match(renderScreen(catalog),/Input requirement: Fixture credential/);
  const route=await api.expose({...q,wait:'verified',approval:{candidateToken:selected.candidateToken,disclosureRevision:selected.disclosure.revision}});
  t.after(async()=>{await api.closeRoute({home,handle:route.handle,mode:'remove'}).catch(()=>{});});
  assertShape('RouteView',route); assert.equal(route.routeState,'verified');
  const stopped=await api.closeRoute({home,handle:route.handle,mode:'remove'});
  assert.equal(stopped.cleanup.state,'confirmed');assert.equal(stopped.published,null);
  const events=(await readFile(join(root,'providers','extension-fixture','events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line).event);
  for(const event of ['setup','start','proof','stop','cleanup']) assert.ok(events.includes(event),JSON.stringify(events));
  assert.ok(events.indexOf('start')<events.indexOf('proof')); assert.ok(events.indexOf('stop')<events.indexOf('cleanup'));
});
