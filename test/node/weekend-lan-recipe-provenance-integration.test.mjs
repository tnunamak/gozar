import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat, lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadAdapters, sessionRecipeFor, validateSessionRecipe} from '../../packages/gozar-node/adapter-runtime.mjs';
import {registryIdentity} from '../../packages/gozar-node/registry-identity.mjs';

const runtime = new URL('../../packages/gozar-node/adapter-runtime.mjs', import.meta.url).href;
const readJSON = async url => JSON.parse(await readFile(url,'utf8'));
const writeJSON = (path, value) => writeFile(path,JSON.stringify(value,null,2) + '\n',{mode:0o600});
const integrity = error => error?.code === 'artifact_integrity_failed';

// Data-only admission: no detect, provider transport, proof or route creation.
test('unknown recipe provenance survives scoped loading and rejects stale bootstrap bindings', async t => {
  const scratch = join(homedir(),'.tmp');
  await mkdir(scratch,{recursive:true,mode:0o700});
  const info = await lstat(scratch);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(),'fixture parent must be a real directory');
  assert.equal(info.mode & 0o777,0o700,'fixture parent must be private');
  if (process.getuid) assert.equal(info.uid,process.getuid(),'fixture parent must be owned');
  const root = await mkdtemp(join(scratch,'gozar-provenance-'));
  let succeeded = false;
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


    // Read/parse failures are artifact failures, never raw filesystem/parser errors.
    const original = new Map(await Promise.all([recipePath, definitionPath, manifest, modulePath]
      .map(async path => [path, await readFile(path)])));
    const canary = 'private-artifact-canary-' + randomUUID();
    const sanitizedIntegrity = error => {
      assert.equal(error?.code,'artifact_integrity_failed');
      assert.equal(Object.hasOwn(error,'cause'),false,'raw inspection errors must not escape via cause');
      for (const value of [error.message, JSON.stringify(error)]) {
        assert.equal(value.includes(root),false,'private fixture path must not escape');
        assert.equal(value.includes(canary),false,'inspected text must not escape');
      }
      return true;
    };
    for (const [label, path, bytes, direct, freshIdentity] of [
      ['missing wrapped',recipePath,null,true,false],
      ['malformed wrapped',recipePath,'{' + canary,true,false],
      ['missing definition',definitionPath,null,true,false],
      ['malformed definition',definitionPath,'{' + canary,true,false],
      ['invalid definition metadata',definitionPath,JSON.stringify({...publicData,adapter:{...publicData.adapter,schemaVersion:999}}),true,true],
      ['changed definition metadata',definitionPath,JSON.stringify({...publicData,adapter:{...publicData.adapter,label:canary}}),true,true],
      ['missing manifest',manifest,null,false,false],
      ['malformed manifest',manifest,'{' + canary,false,false],
      ['missing module',modulePath,null,false,true],
    ]) {
      try {
        if (bytes === null) await rm(path); else await writeFile(path,bytes,{mode:0o600});
        if (direct) assert.throws(() => sessionRecipeFor(adapter),sanitizedIntegrity,label);
        // Valid JSON changes must reach loader validation with a REAL current identity.
        const identity = freshIdentity ? await registryIdentity(registry) : registryId;
        await assert.rejects(validateSessionRecipe({...configuration,recipeRegistryId:identity,
          embedding:{registryId:identity}}),sanitizedIntegrity,label);
        assert.equal(module.createCalls,0,label + ' refuses before create');
      } finally {
        await writeFile(path,original.get(path),{mode:0o600});
      }
      assert.deepEqual(sessionRecipeFor(adapter),pristine,label + ' restores direct mapping');
      assert.equal(await registryIdentity(registry),registryId,label + ' restores exact identity');
      assert.deepEqual(await validateSessionRecipe(configuration),wrapped.definition,
        label + ' restores valid admission, not cached rejection');
      assert.equal(module.createCalls,0);
    }

    // An uncached module URL exercises the loader's import-failure branch.
    const malformedModule = join(directory,'malformed-' + randomUUID() + '.mjs');
    try {
      await writeFile(malformedModule,'export default { ' + canary,{mode:0o600});
      const changedManifest = JSON.parse(original.get(manifest).toString('utf8'));
      changedManifest.providers[0].module = 'providers/' + id + '/' + basename(malformedModule);
      await writeJSON(manifest,changedManifest);
      const identity = await registryIdentity(registry);
      // This is a negative candidate, never proof that altered files are admitted.
      await assert.rejects(validateSessionRecipe({...configuration,recipeRegistryId:identity,
        embedding:{registryId:identity}}),sanitizedIntegrity);
      assert.equal(module.createCalls,0);
    } finally {
      await writeFile(manifest,original.get(manifest),{mode:0o600});
      await rm(malformedModule,{force:true});
    }
    assert.equal(await registryIdentity(registry),registryId);
    assert.deepEqual(await validateSessionRecipe(configuration),wrapped.definition);
    assert.equal(module.createCalls,0);

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
    succeeded = true;
  } finally {
    if (succeeded) await rm(root,{recursive:true,force:true});
    else t.diagnostic('Failed synthetic provenance fixture retained at ' + root);
  }
});
