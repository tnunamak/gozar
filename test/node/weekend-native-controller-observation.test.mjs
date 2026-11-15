import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Controller} from '../../packages/gozar-node/controller.mjs';
import {createGate} from '../../packages/gozar-node/gate.mjs';

// Owning Controller/driver unit, not a public-provider or daemon IPC journey.
// Proof is obtained through the real local gate and EffectDriver.verifyProbe.
test('native cached observation is detached, deadline-bound and effect-free',async()=>{
  const app=http.createServer((req,res)=>res.end('local fixture'));
  await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve);});
  let gate;
  try{
    gate=await createGate(app.address().port,{lifetimeMs:60000,onExpire:()=>{}});
    const counts={step:0,save:0,execute:0,verify:0};
    const journal={value:{owned:{}},save:async()=>{counts.save++;}};
    const sessionId='native-observation-unit';
    const controller=new Controller({sessionId,adapters:[],requirements:{},targetPort:gate.port,journal,
      step:()=>{counts.step++;throw new Error('observation must not step');}});
    const driver=controller.driver;
    driver.gate=gate;
    driver.host.probe={...gate.rotate(),expiresAtMs:driver.nowMs()+15000};
    const origin='http://'+gate.target;
    counts.verify++;
    await driver.verifyProbe({url:origin,vantage:'local',generation:7,timeoutMs:3000});
    const receipt=structuredClone(driver.acceptedProbeReceipt);
    assert.equal(receipt.instanceMatched,true);
    // Controlled owning cache model; no assertion that the core/public provider published it.
    controller.state={sessionId,generation:7,selected:'local-fixture',stopRequested:false};
    controller.last={state:controller.state,snapshot:{sessionId,generation:7,phase:'published-ready',
      published:origin,candidate:origin,resources:[],limitations:[]},effects:[]};
    driver.execute=async()=>{counts.execute++;throw new Error('no effects');};
    const before={...counts},original=structuredClone(controller.last);
    const first=controller.observe(),again=controller.observe();
    assert.equal(first.snapshot.published,origin);
    assert.deepEqual(first.validation.probeReceipt,receipt);
    assert.deepEqual(again,first);
    first.snapshot.published='tampered';first.validation.probeReceipt.origin='tampered';
    assert.deepEqual(controller.last,original);assert.deepEqual(driver.acceptedProbeReceipt,receipt);
    const now=driver.nowMs.bind(driver);
    for(const mutation of [
      ()=>{driver.nowMs=()=>receipt.expiresAtMs;},
      ()=>{driver.proofGeneration=6;},
      ()=>{driver.proofExpiries.set(7,0);},
      ()=>{driver.stopped=true;},
      ()=>{controller.state.stopRequested=true;},
      ()=>{driver.acceptedProbeReceipt={...receipt,instanceMatched:false};},
    ]){
      driver.nowMs=now;driver.proofGeneration=7;driver.proofExpiries.set(7,receipt.expiresAtMs);
      driver.stopped=false;controller.state.stopRequested=false;driver.acceptedProbeReceipt=structuredClone(receipt);
      mutation();
      const observed=controller.observe();
      assert.equal(observed.snapshot.published,null);assert.equal(observed.validation,null);
      assert.equal(observed.observationEvidence.probeReceipt.observedAtMs,receipt.observedAtMs);
      assert.deepEqual(observed.snapshot.resources,original.snapshot.resources,'not cleanup evidence');
    }
    driver.nowMs=now;driver.stopped=false;controller.state.stopRequested=false;
    driver.acceptedProbeReceipt=receipt;driver.proofGeneration=7;driver.proofExpiries.set(7,receipt.expiresAtMs);
    // Pure deadline control at owning boundary, without changing gate timers.
    assert.equal(controller.observe({gateExpiresAtMs:driver.nowMs()-1}).snapshot.published,null);
    assert.deepEqual(counts,before,'observation must not execute, verify, step, or save');
    assert.deepEqual(driver.acceptedProbeReceipt,receipt);
  } finally {
    await gate?.close();
    await new Promise((resolve,reject)=>app.close(error=>error?reject(error):resolve()));
  }
});
