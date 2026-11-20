import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {currentRuntimeSocketDirectory,withRuntimeSockets} from '../../packages/gozar-node/runtime-sockets.mjs';

test('the factory serializes only its optional resolved directory, independently across awaits',async()=>{
  assert.equal(currentRuntimeSocketDirectory(),undefined);
  assert.throws(()=>withRuntimeSockets('relative',currentRuntimeSocketDirectory),{code:'invalid_input'});
  const left=resolve('/fixture/left/../a'),right=resolve('/fixture/b');
  const ready=Promise.withResolvers(), release=Promise.withResolvers();
  const first=withRuntimeSockets('/fixture/left/../a',async()=>{
    ready.resolve();
    await release.promise;
    const bootstrap=JSON.parse(JSON.stringify({runtimeSocketDirectory:currentRuntimeSocketDirectory()}));
    assert.equal(bootstrap.runtimeSocketDirectory,left);
    return currentRuntimeSocketDirectory();
  });
  try {
    await ready.promise;
    assert.equal(await withRuntimeSockets(right,async()=>{
      await Promise.resolve();
      return currentRuntimeSocketDirectory();
    }),right);
    assert.equal(currentRuntimeSocketDirectory(),undefined);
  } finally {release.resolve();}
  assert.equal(await first,left);
  assert.equal(currentRuntimeSocketDirectory(),undefined);
});
