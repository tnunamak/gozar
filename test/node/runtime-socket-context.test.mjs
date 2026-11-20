import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {
 currentRuntimeSocketDirectory,withRuntimeSockets,
} from '../../packages/gozar-node/runtime-sockets.mjs';

test('runtime socket directory survives isolated async scopes and bootstrap serialization',async()=>{
 assert.equal(currentRuntimeSocketDirectory(),undefined);
 assert.equal(withRuntimeSockets(undefined,currentRuntimeSocketDirectory),undefined);
 assert.throws(()=>withRuntimeSockets('relative-only',currentRuntimeSocketDirectory),
  {code:'invalid_input'});
 const raw=resolve('/synthetic-sockets','first')+'/../first';
 const first=resolve(raw),second=resolve('/synthetic-sockets','second');
 let enter,leave;
 const entered=new Promise(resolve=>{enter=resolve;});
 const leaveFirst=new Promise(resolve=>{leave=resolve;});
 const pending=withRuntimeSockets(raw,async()=>{
  enter();
  assert.equal(currentRuntimeSocketDirectory(),first);
  await leaveFirst;
  assert.deepEqual(JSON.parse(JSON.stringify({socketDirectory:currentRuntimeSocketDirectory()})),
   {socketDirectory:first});
 });
 try {
  await entered;
  await withRuntimeSockets(second,async()=>{
   await Promise.resolve();
   assert.equal(currentRuntimeSocketDirectory(),second);
  });
  assert.equal(currentRuntimeSocketDirectory(),undefined);
 } finally {
  leave();
  await pending;
 }
 assert.equal(currentRuntimeSocketDirectory(),undefined);
});
