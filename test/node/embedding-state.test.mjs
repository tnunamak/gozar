import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRouteApi, fakeRegistry, fakeReadContext, fakeRouteScenarios } from '@tnunamak/gozar/testing';
import { storeSecret } from '@tnunamak/gozar';
import { renderScreen } from '../../examples/remote-access-screen.mjs';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { assertShape, scratch, query } from './route-schema-check.mjs';

test('every adapter fills availability and extensible facts without provider mutations', async t => {
  const home = await scratch(t), adapters = await loadAdapters();
  const api = createRouteApi({ adapters, readContext: fakeReadContext({ home }), profileHome: join(home, 'profile') });
  for (const usage of [{kind:'session',lifetimeMs:60000},{kind:'attached'},{kind:'durable',routeId:'screen'}]) {
    const catalog = await api.catalogRoutes(query({home,usage}));
    assertShape('Catalog',catalog);
    for (const candidate of catalog.candidates) {
      assert.equal(Object.keys(candidate.availability).length,3);
      for (const fact of candidate.facts) if (!fact.known) assert.ok(fact.reason);
      if (candidate.availability[usage.kind].state === 'detect-only') {
        assert.equal(candidate.setup.state,'detect-only'); assert.equal(candidate.eligible,false); assert.equal(candidate.candidateToken,null);
      }
      assert.equal(candidate.facts.find(f=>f.id==='entitlement').reason,'needs-provider-call');
    }
  }
});

test('new fact row renders by group without an app or schema change', async t => {
  const home=await scratch(t);
  const fact={id:'new-property',label:'A newly discovered property',value:'visible without app changes',known:true,group:'new-group',affectsConsent:true,source:'test',asOf:null};
  const registry=await fakeRegistry({id:'new-row',kinds:['session'],reach:'internet',dir:join(home,'registry'),facts:[fact]}); t.after(registry.cleanup);
  const api=createRouteApi({manifest:registry.manifest,root:registry.root,readContext:fakeReadContext({home}),profileHome:join(home,'profile')});
  const catalog=await api.catalogRoutes(query({home,usage:{kind:'session',lifetimeMs:60000}})); assertShape('Catalog',catalog);
  const screen=renderScreen(catalog); assert.match(screen,/new-group/); assert.match(screen,/visible without app changes/); assert.match(screen,/show before approval/);
});

test('fake states cover every admitted kind with expiry, checks and cleanup as data', () => {
  const routes=fakeRouteScenarios(); assert.equal(routes.length,12);
  for(const route of routes) {
    assertShape('RouteView',route);
    if(route.routeState==='verified') {assert.ok(route.verification.checkedAt);assert.equal(route.verification.validUntil.known,true);assert.ok(route.verification.results.every(r=>r.status==='passed'));}
    if(route.routeState==='expired') {assert.equal(route.published,null);assert.equal(route.verification.status,'unverified');}
    if(route.routeState==='cleanup-unconfirmed') assert.equal(route.cleanup.state,'unconfirmed');
  }
  const screen=renderScreen({candidates:[]},routes);
  for(const kind of ['session','attached','durable']) for(const state of ['detected','verified','expired','cleanup-unconfirmed']) assert.ok(screen.includes(`Route: ${kind} ${state}`));
});

test('secret intake, read-back, edit and rotation never return a secret', async t => {
  const home=await scratch(t), disclosure={revision:'test',text:'Test setup',links:[]};
  const actions=[{id:'auth',kind:'provide-secret',label:'Credential',digest:'auth',disclosure}, {id:'domain',kind:'provide-value',label:'Domain',valueFormat:'domain',digest:'domain',disclosure}];
  const registry=await fakeRegistry({id:'config-test',kinds:['session'],reach:'internet',dir:join(home,'registry'),setupActions:actions});t.after(registry.cleanup);
  const api=createRouteApi({manifest:registry.manifest,root:registry.root,readContext:fakeReadContext({home}),profileHome:join(home,'profile')});
  const q=query({home,usage:{kind:'session',lifetimeMs:60000}});
  const read=async()=> (await api.catalogRoutes(q)).candidates[0];
  assert.equal((await read()).configuration.credentials.auth.value,false);
  for(const secret of ['first-private-test-value','replacement-private-test-value']) {
    const stored=await storeSecret({home,value:secret});assert.deepEqual(Object.keys(stored),['handle']);
    await api.runSetupAction({home,actionId:'auth',secretHandle:stored.handle,approval:{digest:'auth',disclosureRevision:'test'}});
    const candidate=await read();assert.equal(candidate.configuration.credentials.auth.value,true);assert.equal(candidate.setup.state,'ready');
    assert.ok(candidate.configuration.actions.some(a=>a.id==='auth')); assert.ok(!JSON.stringify(candidate).includes(secret)); assert.ok(!JSON.stringify(candidate).includes(stored.handle));
  }
  await api.runSetupAction({home,actionId:'domain',value:'example.invalid',approval:{digest:'domain',disclosureRevision:'test'}});
  assert.equal((await read()).configuration.values.domain,'example.invalid');
});

test('example contains no provider ids or provider display names', async () => {
  const source=await readFile(new URL('../../examples/remote-access-screen.mjs',import.meta.url),'utf8');
  const manifest=JSON.parse(await readFile(new URL('../../adapters/manifest.json',import.meta.url),'utf8'));
  for(const entry of manifest.providers) {
    const {adapter}=JSON.parse(await readFile(new URL(`../../adapters/${entry.definition}`,import.meta.url),'utf8'));
    for(const name of [entry.id,adapter.label]) assert.ok(!source.toLowerCase().includes(name.toLowerCase()),name);
  }
  assert.doesNotMatch(source,/tailscale|funnel|ngrok|cloudflare|cloudflared|localhost\.run|tunnl/i);
});
