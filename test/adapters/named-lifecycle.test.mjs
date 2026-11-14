import test from 'node:test';
import assert from 'node:assert/strict';
import { createNamedAdapter } from '../../adapters/providers/cloudflare-named/index.mjs';

test('named connector uses saved input, scopes cleanup to its runtime and never returns a token', async () => {
  const ledger=new Set(), secret='unique-named-secret-canary', calls=[];
  const adapter=createNamedAdapter({ detectBinary:async()=>true, startConnector:async input=>{
    calls.push(input);ledger.add('owned');return {alive:()=>ledger.has('owned'),close:async()=>{ledger.delete('owned');}};
  }});
  const context={platform:'linux',now:Date.now,configuration:async()=>({token:secret,origin:'https://named.example.invalid','gate-port':'18479'}),generation:1,assertGeneration:async()=>{}};
  const detected=await adapter.detect(context);assert.equal(detected.state,'ready');
  const request={target:'127.0.0.1:3000',origin:null,usage:{kind:'attached'},requirements:{protocols:[]}};
  const plan=await adapter.plan(context,request);assert.ok(!JSON.stringify(plan).includes(secret));
  const receipt=await adapter.create(context,plan);assert.equal(ledger.size,1);assert.equal(calls[0].token,secret);
  assert.ok(!JSON.stringify(receipt).includes(secret));
  const observed=await adapter.observe(context,request);
  assert.equal((await adapter.remove(context,receipt,observed)).removed,true);assert.equal(ledger.size,0);
  assert.equal((await adapter.remove(context,receipt,observed)).removed,true);
});

test('named connector refuses incomplete inputs before starting and reports uncertain cleanup', async () => {
  let starts=0;
  const adapter=createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>{starts++;return {alive:()=>true,close:async()=>{throw new Error('private-runtime-diagnostic');}};}});
  const base={platform:'linux',now:Date.now,generation:1,assertGeneration:async()=>{}};
  await assert.rejects(adapter.plan({...base,configuration:async()=>({token:'present'})},{usage:{kind:'attached'},target:'127.0.0.1:3000'}),e=>e.code==='setup_required');assert.equal(starts,0);
  const ctx={...base,configuration:async()=>({token:'present',origin:'https://named.example.invalid','gate-port':'18479'})};
  const request={usage:{kind:'attached'},target:'127.0.0.1:3000'}, plan=await adapter.plan(ctx,request), receipt=await adapter.create(ctx,plan);
  const removal=await adapter.remove(ctx,receipt,{});assert.equal(removal.removed,false);assert.equal(removal.debt.reason,'listener-absence-unconfirmed');assert.ok(!JSON.stringify(removal).includes('private-runtime-diagnostic'));
});

test('a resolving close is not absence when the owned connector remains alive', async () => {
  const adapter=createNamedAdapter({detectBinary:async()=>true,startConnector:async()=>({alive:()=>true,close:async()=>{}})});
  const ctx={platform:'linux',now:Date.now,generation:1,assertGeneration:async()=>{},configuration:async()=>({token:'fake-secret',origin:'https://named.example.invalid','gate-port':'18479'})};
  const plan=await adapter.plan(ctx,{target:'127.0.0.1:3000',usage:{kind:'attached'}}),receipt=await adapter.create(ctx,plan);
  assert.equal((await adapter.remove(ctx,receipt,{})).removed,false);
});
