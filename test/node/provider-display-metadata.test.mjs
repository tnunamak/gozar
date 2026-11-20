import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {definitionErrors,loadAdapters} from '../../packages/gozar-node/adapter-runtime.mjs';
import {listProviders} from '../../packages/gozar-node/embedding-inventory.mjs';
import {createEmbeddingServices} from '../../packages/gozar-node/embedding-services.mjs';

const known=value=>({known:true,value});
const unknown=value=>assert.equal(value?.known,false);
const runtime=new URL('../../packages/gozar-node/adapter-runtime.mjs',import.meta.url).href;
const fakeInspection=(adapter,properties)=>({...adapter,
  detect:async()=>({state:'ready',facts:{}}),
  properties:()=>properties,
});

test('serialized inventory carries typed presentation from shipped and unfamiliar admitted declarations',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gozar-display-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'providers','fixture');
  await mkdir(dir,{recursive:true});
  const home=join(root,'home');
  await mkdir(home,{mode:0o700});
  const shipped=(await loadAdapters()).find(adapter=>adapter.id==='localhost-run');
  assert.ok(shipped?.operationalDefinition?.copy?.human);
  const id='fixture-display';
  const declaration={...shipped.definition,id,label:'Unfamiliar relay',
    copy:{human:{name:'Demo name',summary:'Demo summary'}},idleTimeoutMs:0,
    requiredCapabilities:['runtime.attached']};
  assert.deepEqual(definitionErrors(declaration),[]);
  assert.notDeepEqual(definitionErrors({...declaration,copy:{human:{privateExtra:'synthetic-marker'}}}),[]);
  await writeFile(join(dir,'definition.json'),JSON.stringify({adapter:declaration}));
  await writeFile(join(dir,'index.mjs'),
    'import {recipeAdapter} from '+JSON.stringify(runtime)+';\n'+
    "export default recipeAdapter({definition:new URL('./definition.json',import.meta.url)});\n");
  const [admitted]=await loadAdapters({root,manifest:{providers:[{
    id,module:'providers/fixture/index.mjs',definition:'providers/fixture/definition.json',
  }]}});
  assert.equal(admitted.id,id);
  assert.equal(admitted.operationalDefinition,null);
  const adapters=[
    fakeInspection(shipped,{...shipped.definition.capabilities,
      address:{...shipped.definition.capabilities.address,stability:'stable'},needsAccount:false}),
    fakeInspection(admitted,{...admitted.definition.capabilities,
      address:{...admitted.definition.capabilities.address,stability:'ephemeral'},needsAccount:false}),
  ];
  const deps={adapters,embeddingServices:createEmbeddingServices({registryId:'display-fixture'}),
    readContext:{configuration:async()=>null}};
  const {providers}=JSON.parse(JSON.stringify(await listProviders({home},deps)));
  const wrapped=providers.find(provider=>provider.providerId===shipped.id);
  const plain=providers.find(provider=>provider.providerId===id);
  assert.ok(wrapped&&plain,'both declared providers are present');
  assert.deepEqual(wrapped.displayName,known(shipped.operationalDefinition.displayName));
  assert.deepEqual(wrapped.copy.human.summary,known(shipped.operationalDefinition.copy.human.summary));
  assert.deepEqual(wrapped.addressStability,known('stable'));
  assert.deepEqual(wrapped.idleTimeoutMs,known(null));
  assert.deepEqual(wrapped.needsAccount,known(false));

  assert.deepEqual(plain.displayName,known('Unfamiliar relay'));
  assert.deepEqual(plain.copy.human.name,known('Demo name'));
  assert.deepEqual(plain.copy.human.summary,known('Demo summary'));
  unknown(plain.copy.human.address);
  unknown(plain.copy.human.setup);
  assert.deepEqual(Object.keys(plain.copy.human).sort(),['address','name','setup','summary']);
  assert.deepEqual(plain.addressStability,known('ephemeral'));
  assert.deepEqual(plain.idleTimeoutMs,known(0));
  assert.deepEqual(plain.needsAccount,known(false));
  assert.ok(plain.configuration,'configuration remains a separate API field');
  const required=plain.prerequisites.find(row=>row.id==='runtime.attached');
  assert.equal(required?.state,'unknown');
  assert.equal(required?.observation.reason,'host-capability-undeclared');
  assert.equal(plain.availability.attached.state,'unsupported');
  assert.equal(JSON.stringify(plain.copy).includes('synthetic-marker'),false);

  const supportedKinds=admitted.definition.supportedKinds;
  assert.ok(supportedKinds.length>0,'the loader-admitted declaration supports a usage');
  const readOffer=async observation=>{
    const result=JSON.parse(JSON.stringify(await listProviders({
      home,hostCapabilities:{'runtime.attached':observation},
    },deps)));
    const offer=result.providers.find(provider=>provider.providerId===id);
    assert.ok(offer,'the admitted provider remains present');
    return offer;
  };
  const allowed=await readOffer(known(true));
  for(const kind of supportedKinds)
    assert.equal(allowed.availability[kind]?.state,'available',kind);

  for(const [observation,state] of [
    [known(false),'denied'],
    [known('synthetic-nonboolean'),'unsupported'],
    [{known:false,reason:'fixture-unobserved'},'unknown'],
  ]){
    const offer=await readOffer(observation);
    const prerequisite=offer?.prerequisites.find(row=>row.id==='runtime.attached');
    assert.equal(prerequisite?.state,state);
    assert.deepEqual(prerequisite?.observation,observation);
    for(const kind of supportedKinds)
      assert.deepEqual(offer.availability[kind],{
        state:'unsupported',reason:`host-capability-${state}`,
      },kind);
    for(const key of ['displayName','copy','addressStability','idleTimeoutMs','needsAccount']){
      assert.deepEqual(offer?.[key],plain[key],key);
    }
  }
});
