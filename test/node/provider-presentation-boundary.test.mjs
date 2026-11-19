import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {definitionErrors,loadAdapters,providerPresentation,recipeAdapter} from '../../packages/gozar-node/adapter-runtime.mjs';

const known=value=>({known:true,value});
const unknown=value=>assert.equal(value.known,false);

test('shipped recipe metadata retains its wrapped provenance after loading',async()=>{
 const adapter=(await loadAdapters()).find(a=>a.id==='localhost-run');
 assert.ok(adapter?.operationalDefinition?.copy?.human);
 const effective={address:{stability:'stable'},needsAccount:false};
 const view=providerPresentation(adapter,effective);
 assert.deepEqual(view.displayName,known(adapter.operationalDefinition.displayName));
 assert.deepEqual(view.human.summary,known(adapter.operationalDefinition.copy.human.summary));
 assert.deepEqual(view.idleTimeoutMs,known(null));
 assert.deepEqual(view.addressStability,known('stable'));
 assert.deepEqual(view.needsAccount,known(false));

 const altered={...adapter,operationalDefinition:{...adapter.operationalDefinition,
  idleTimeoutMs:42,copy:{human:{summary:'Wrapped label',extra:'Not public'}}}};
 const withOverrides={...altered,definition:{...adapter.definition,copy:{human:{summary:'Normalized label'}},idleTimeoutMs:null}};
 assert.deepEqual(providerPresentation(withOverrides,effective).idleTimeoutMs,known(null));
 assert.deepEqual(providerPresentation(withOverrides,effective).human.summary,known('Normalized label'));
 assert.equal(Object.hasOwn(providerPresentation(altered,effective).human,'extra'),false);
});

test('unknown normalized definitions can declare only typed presentation metadata',async t=>{
 const shipped=(await loadAdapters()).find(a=>a.id==='localhost-run');
 const definition={...shipped.definition,id:'test-presentation',label:'Fixture',copy:{human:{name:'Synthetic name',summary:'Synthetic summary'}},idleTimeoutMs:0};
 assert.deepEqual(definitionErrors(definition),[]);
 const dir=await mkdtemp(join(tmpdir(),'gozar-presentation-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'fixture.json');
 await writeFile(file,JSON.stringify({adapter:definition}));
 const adapter=recipeAdapter({definition:file});
 assert.equal(adapter.operationalDefinition,null);
 const view=providerPresentation(adapter,{address:{stability:'unknown'},needsAccount:null});
 assert.deepEqual(view.displayName,known('Fixture'));
 assert.deepEqual(view.human.name,known('Synthetic name'));
 assert.deepEqual(view.human.summary,known('Synthetic summary'));
 assert.deepEqual(view.idleTimeoutMs,known(0));
 for(const value of [view.human.address,view.human.setup,view.addressStability,view.needsAccount])unknown(value);
 const {copy,idleTimeoutMs,...omitted}=definition;
 const missing=providerPresentation({...adapter,definition:omitted},{});
 unknown(missing.idleTimeoutMs);
 unknown(missing.human.summary);
 assert.deepEqual(definitionErrors({...definition,idleTimeoutMs:Number.MAX_SAFE_INTEGER}),[]);
 for(const bad of [{idleTimeoutMs:-1},{idleTimeoutMs:1.5},{idleTimeoutMs:Number.MAX_SAFE_INTEGER+1},{copy:{human:{summary:false}}},
  {copy:{human:{extra:'not public'}}},{copy:{extra:{}}},{displayName:'not a declaration'}]){
  assert.notDeepEqual(definitionErrors({...definition,...bad}),[]);
 }
});
