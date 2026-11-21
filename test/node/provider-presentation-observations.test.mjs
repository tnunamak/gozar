import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRouteApi,fakeReadContext,fakeRegistry} from '@tnunamak/gozar/testing';

const known=value=>({known:true,value});
const missing={known:false,reason:'not-declared'};
const unseen={known:false,reason:'not-observed'};
const cap='runtime.attached';
const sentinel='fixture-private-probe-note';

// Load through the same manifest and module validation as the public factory.
async function provider(root,{id,display,account,idle,stability,kinds}){
 const reg=await fakeRegistry({id,label:'Declared '+id,kinds,reach:'internet',dir:root});
 const [entry]=reg.manifest.providers;
 const file=join(root,entry.definition);
 const published=JSON.parse(await readFile(file,'utf8'));
 published.adapter.requiredCapabilities=[cap];
 await writeFile(file,JSON.stringify(published));
 const module=join(root,entry.module);
 await rename(module,join(root,'providers',id,'original.mjs'));
 const observed=structuredClone(published.adapter.capabilities);
 if(account===undefined)delete observed.needsAccount;else observed.needsAccount=account;
 observed.address.stability=stability;
 const operationalDefinition=display===undefined?{}:{
  displayName:display,idleTimeoutMs:idle,copy:{human:{name:display,summary:'Declared summary',address:'Declared address',setup:'Declared setup'}},
 };
 await writeFile(module,`import original from './original.mjs';
 export default {...original,definition:${JSON.stringify(published.adapter)},
 operationalDefinition:${JSON.stringify(operationalDefinition)},
 properties:()=>structuredClone(${JSON.stringify(observed)}),
 detect:async ctx=>({...await original.detect(ctx),rawProbe:${JSON.stringify(sentinel)}})};`);
 return entry;
}

test('provider inventory retains known false, null, zero and an unknown observation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gozar-presentation-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const placements=[
  {id:'fixture-kestrel',display:'Fixture Kestrel',account:false,idle:0,stability:'ephemeral',kinds:['session']},
  {id:'fixture-river',display:'Fixture River',account:true,idle:null,stability:'stable',kinds:['session','durable']},
  {id:'fixture-spruce',stability:'unknown',kinds:['session']},
 ];
 const manifest={providers:await Promise.all(placements.map(spec=>provider(root,spec)))};
 const api=createRouteApi({manifest,root,readContext:fakeReadContext({home:root})});
 const variants=[known(true),known(false),{known:false,reason:'fixture-unknown'}];
 const states=[];
 for(const observation of variants){
  const inventory=await api.listProviders({home:root,owner:'fixture-owner',refresh:true,hostCapabilities:{[cap]:observation}});
  assert.equal(inventory.providers.length,3);
  const ids=Object.fromEntries(inventory.providers.map(row=>[row.providerId,row]));
  const [first,second,third]=placements.map(({id})=>ids[id]);
  assert.deepEqual(first.displayName,known('Fixture Kestrel'));
  assert.deepEqual(first.copy.human,{name:known('Fixture Kestrel'),summary:known('Declared summary'),
   address:known('Declared address'),setup:known('Declared setup')});
  assert.deepEqual(first.needsAccount,known(false));
  assert.deepEqual(first.idleTimeoutMs,known(0));
  assert.deepEqual(first.addressStability,known('ephemeral'));
  assert.deepEqual(second.displayName,known('Fixture River'));
  assert.deepEqual(second.needsAccount,known(true));
  assert.deepEqual(second.idleTimeoutMs,known(null));
  assert.deepEqual(second.addressStability,known('stable'));
  assert.deepEqual(third.displayName,known('Declared fixture-spruce'));
  assert.deepEqual(third.needsAccount,unseen);
  assert.deepEqual(third.idleTimeoutMs,missing);
  assert.deepEqual(third.addressStability,unseen);
  assert.ok(Object.values(third.copy.human).every(field=>!field.known));
  assert.ok(!JSON.stringify(inventory).includes(sentinel));
  assert.ok(second.availability.durable);
  states.push(first.prerequisites.find(item=>item.id===cap)?.state);
 }
 assert.equal(new Set(states).size,3,'known true, known false and unknown must not collapse');
 assert.equal(typeof states[0],'string','known true must expose a declared prerequisite');
 assert.equal(states[1],'denied');
 assert.equal(states[2],'unknown');
});

test('a null declaration cannot stand in for a provider that explicitly declares zero',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gozar-presentation-mutant-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const mutant=await provider(root,{id:'fixture-tern',display:'Fixture Tern',account:false,
  idle:null,stability:'ephemeral',kinds:['session']});
 const api=createRouteApi({manifest:{providers:[mutant]},root,readContext:fakeReadContext({home:root})});
 const {providers:[row]}=await api.listProviders({home:root,owner:'fixture-owner',refresh:true,
  hostCapabilities:{[cap]:known(true)}});
 assert.deepEqual(row.idleTimeoutMs,known(null));
 assert.throws(()=>assert.deepEqual(row.idleTimeoutMs,known(0)),{code:'ERR_ASSERTION'});
});
