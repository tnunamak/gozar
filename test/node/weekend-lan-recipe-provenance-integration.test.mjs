import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadAdapters, sessionRecipeFor, validateSessionRecipe} from '../../packages/gozar-node/adapter-runtime.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

const runtime = new URL('../../packages/gozar-node/adapter-runtime.mjs', import.meta.url).href;
const readJSON = async url => JSON.parse(await readFile(url,'utf8'));
const writeJSON = (path, value) => writeFile(path,JSON.stringify(value,null,2) + '\n',{mode:0o600});
const integrity = error => error?.code === 'artifact_integrity_failed';

// Data-only admission: no detect, provider transport, proof or route creation.
test('unknown recipe provenance survives scoped loading and rejects stale bootstrap bindings', async () => {
  const scratch = join(homedir(),'.tmp');
  await mkdir(scratch,{recursive:true,mode:0o700});
  const info = await stat(scratch);
  assert.equal(info.mode & 0o077,0,'fixture parent must be private');
  const root = await mkdtemp(join(scratch,'gozar-provenance-'));
  try {
    assert.equal((await stat(root)).mode & 0o077,0);
    const id = 'fixture-' + randomUUID();
    const directory = join(root,'providers',id);
    await mkdir(directory,{recursive:true,mode:0o700});
    const publicData = structuredClone(await readJSON(new URL('../../adapters/providers/lan/definition.json',import.meta.url)));
    const wrapped = structuredClone(await readJSON(new URL('../../adapters/lan.definition.json',import.meta.url)));
    publicData.adapter.id = id;
    wrapped.definition.id = id;
    const recipeName = id + '.definition.json';
    publicData.wraps = '../../' + recipeName;
    const definitionPath = join(directory,'definition.json');
    const recipePath = join(root,recipeName);
    await writeJSON(definitionPath,publicData);
    await writeJSON(recipePath,wrapped);
    const modulePath = join(directory,'index.mjs');
    await writeFile(modulePath,
      'import {recipeAdapter} from ' + JSON.stringify(runtime) + ';\n' +
      'export let createCalls = 0;\n' +
      'export default recipeAdapter({definition:new URL("./definition.json",import.meta.url),' +
      'extend:()=>({create(){createCalls++;throw new Error("Unexpected create effect");}})});\n',
      {mode:0o600});
    const manifest = join(root,'manifest.json');
    await writeJSON(manifest,{schemaVersion:1,definitions:[recipeName],
      providers:[{id,module:'providers/' + id + '/index.mjs',definition:'providers/' + id + '/definition.json'}]});
    const registry = {root,manifest};
    const module = await import(pathToFileURL(modulePath).href);
    const [adapter] = await loadAdapters(registry);
    assert.notEqual(adapter,module.default,'actual scopedAdapter wrapper is exercised');
    assert.equal(adapter.id,id);
    const pristine = sessionRecipeFor(adapter);
    assert.equal(pristine.schemaVersion,1);
    assert.equal(pristine.adapterId,id);
    assert.match(pristine.digest,/^[a-f0-9]{64}$/);
    assert.deepEqual(pristine.definition,wrapped.definition);
    assert.deepEqual(sessionRecipeFor(module.default),pristine);
    const copy = sessionRecipeFor(adapter);
    copy.definition.recipes.create.timeoutMs++;
    copy.definition.admission.requiredFeatures.push('changed-copy');
    assert.deepEqual(sessionRecipeFor(adapter),pristine,'returned nested data cannot mutate provenance');
    assert.deepEqual(await readJSON(recipePath),wrapped,'returned mapping cannot mutate source');

    const registryId = await registryIdentity(registry);
    const configuration = {adapterId:id,recipeMapping:pristine,recipeRegistry:registry,
      recipeRegistryId:registryId,adapters:[pristine.definition],embedding:{registryId}};
    assert.deepEqual(await validateSessionRecipe(configuration),wrapped.definition,
      'current exact registry and adapter set must be accepted');
    const withoutEmbedding = {...configuration};
    delete withoutEmbedding.embedding;
    assert.deepEqual(await validateSessionRecipe(withoutEmbedding),wrapped.definition);
    for (const change of [
      c => {delete c.recipeMapping;},
      c => {c.recipeMapping.digest = 'altered';},
      c => {c.recipeMapping.definition.recipes.create.timeoutMs++;},
      c => {c.adapters = [];},
      c => {c.adapters.push(structuredClone(c.adapters[0]));},
      c => {c.adapters = [{...c.adapters[0],label:c.adapters[0].label + ' changed'}];},
      c => {c.recipeRegistryId += '-stale';},
      c => {c.embedding.registryId += '-stale';},
      c => {c.adapterId += '-other';},
    ]) {
      const changed = structuredClone(configuration);
      change(changed);
      await assert.rejects(validateSessionRecipe(changed),integrity);
      assert.equal(module.createCalls,0,'refusal precedes all create effects');
    }

    // Change actual registry bytes, rather than merely supplying a wrong hash.
    const manifestBytes = await readFile(manifest);
    await writeJSON(manifest,{schemaVersion:1,definitions:[recipeName],providers:[]});
    await assert.rejects(validateSessionRecipe(configuration),integrity);
    await writeFile(manifest,manifestBytes);
    assert.deepEqual(await validateSessionRecipe(configuration),wrapped.definition);

    // Same module URL remains cached; a freshly computed registry identity does
    // not excuse a wrapped file differing from that module's private provenance.
    const altered = structuredClone(wrapped);
    altered.definition.recipes.create.timeoutMs++;
    await writeJSON(recipePath,altered);
    assert.equal((await import(pathToFileURL(modulePath).href)).default,module.default);
    assert.throws(() => sessionRecipeFor(adapter),integrity);
    const currentId = await registryIdentity(registry);
    await assert.rejects(validateSessionRecipe({...configuration,recipeRegistryId:currentId,
      embedding:{registryId:currentId}}),integrity);
    assert.equal(module.createCalls,0);
    await writeJSON(recipePath,wrapped);
    assert.deepEqual(sessionRecipeFor(adapter),pristine);
    assert.deepEqual(await validateSessionRecipe(configuration),wrapped.definition);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
