import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeRegistry } from '@tnunamak/gozar/testing';
import { scratch } from './route-schema-check.mjs';

test('sync preserves a no-wrap adapter own non-HTTP proof without requiring any legacy recipe', async t => {
  const home=await scratch(t),id='custom-proof-fixture';
  const registry=await fakeRegistry({id,kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo',dir:join(home,'registry')});t.after(registry.cleanup);
  const definitionPath=join(registry.root,'providers',id,'definition.json');
  const definition=JSON.parse(await readFile(definitionPath,'utf8'));definition.adapter.capabilities.proof={vantage:'this-device',checks:['nonce']};
  await writeFile(definitionPath,JSON.stringify(definition));
  const before=await readFile(definitionPath,'utf8'),manifest=join(home,'manifest.json');
  await writeFile(manifest,JSON.stringify({...registry.manifest,definitions:[`${id}.definition.json`],normalizedDefinitions:[`${id}.definition.json`]}));
  const script=fileURLToPath(new URL('../../scripts/sync-adapter-registry.mjs',import.meta.url));
  for(const options of [['--check'],[]]) execFileSync(process.execPath,[script,'--manifest',manifest,'--root',registry.root,...options]);
  assert.equal(await readFile(definitionPath,'utf8'),before);
});
