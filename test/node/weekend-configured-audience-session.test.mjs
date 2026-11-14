import assert from 'node:assert/strict';
import test from 'node:test';
import ownerAddress from '../../adapters/providers/own-address/index.mjs';

// Adapter boundary only. No forced ready observation, publication or proof.
test('owner-address session uses the configured origin that detect reports',async()=>{
 const ctx={platform:'linux',configuration:async()=>({origin:'https://configured.invalid'})};
 const detected=await ownerAddress.detect(ctx);
 assert.equal(detected.state,'ready');
 assert.equal(detected.facts.origin,'https://configured.invalid');
 const plan=await ownerAddress.plan(ctx,{target:'127.0.0.1:12345',
   usage:{kind:'session',lifetimeMs:60000}});
 assert.equal(plan.origin,detected.facts.origin);
 assert.equal(plan.readback.origin,detected.facts.origin);
 assert.deepEqual(plan.effects,[]);
 assert.deepEqual(plan.cleanup,{kind:'external-owned'});
});
test('explicit invalid origin cannot be replaced by valid stored configuration',async()=>{
 const ctx={platform:'linux',configuration:async()=>({origin:'https://configured.invalid'})};
 await assert.rejects(()=>ownerAddress.plan(ctx,{origin:'http://invalid.invalid',
   target:'127.0.0.1:12345',usage:{kind:'session',lifetimeMs:60000}}),{code:'invalid_input'});
});
test('missing configured mapping refuses rather than inventing an address',async()=>{
 await assert.rejects(()=>ownerAddress.plan({platform:'linux',configuration:async()=>null},
  {target:'127.0.0.1:12345',usage:{kind:'session',lifetimeMs:60000}}),{code:'setup_required'});
});
