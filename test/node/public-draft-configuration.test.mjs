import test from 'node:test';
import assert from 'node:assert/strict';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch} from './route-schema-check.mjs';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function assertSnapshot(snapshot){const facts=snapshot.facts.map(({asOf,...row})=>row);const json=JSON.stringify(canonical({version:'consent-v1',scope:snapshot.scope,typedDisclosures:snapshot.disclosures,facts}));assert.equal(snapshot.consentFactsDigest,'consent-v1:'+createHash('sha256').update(json).digest('hex'));}
test('public draft read and setup results carry fresh offered consent after reload',async t=>{
 const home=await scratch(t), registry=await fakeRegistry({dir:home+'/registry',id:'draft-public',kinds:['attached'],reach:'this-device',setupActions:[{id:'value',kind:'provide-value',valueFormat:'text',label:'Input',digest:'value-1',disclosure:{revision:'value-1',text:'Fixture',links:[]}}]});t.after(registry.cleanup);
 const opts={manifest:registry.manifest,root:registry.root}, api=createGozar(opts),providerId='draft-public';
 const initial=(await api.listProviders({home})).providers[0].configuration;
 const draft=await api.beginConfigurationDraft({home,providerId,expectedConfigurationRevision:initial.revision});
 const action=draft.configuration.actions.find(a=>a.kind==='provide-value');assert.equal(action.consent.scope.draftId,draft.draftId);
 assertSnapshot(action.consent);assert.equal(action.consent.disclosures.action.digest,action.digest);
 const result=await api.runSetupAction({home,providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:action.id,value:'hello',approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
 assert.equal(result.configuration.revision,result.configurationRevision);assert.notEqual(result.configurationRevision,draft.configuration.revision);
 const restored=await createGozar(opts).readConfigurationDraft({home,providerId,draftId:draft.draftId});assert.deepEqual(restored.configuration,result.configuration);
 for(const offered of restored.configuration.actions)assertSnapshot(offered.consent);
 const clear=restored.configuration.actions.find(a=>a.kind==='clear-input');assert.ok(clear.consent);
 const cleared=await api.clearConfigurationInput({home,providerId,draftId:draft.draftId,inputId:clear.inputId,expectedConfigurationRevision:restored.configuration.revision,approval:{kind:'setup',digest:clear.digest,disclosureRevision:clear.disclosure.revision,consentFactsDigest:clear.consent.consentFactsDigest}});
 assert.equal(cleared.values.value,undefined);
 await assert.rejects(api.readConfigurationDraft({home,providerId:'foreign',draftId:draft.draftId}));
});
