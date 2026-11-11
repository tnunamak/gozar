import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../../../packages/gozar-core/generated/gozar_core.js';
const root=new URL('../../../',import.meta.url);
const nativePath = process.env.GOZAR_NATIVE ?? path.resolve(fileURLToPath(root), process.env.CARGO_TARGET_DIR || 'target', 'debug/gozar-core-json');
const fixture=JSON.parse(await readFile(new URL('test/adapters/fixtures/plan-v1.json',root)));
const adapter=JSON.parse(await readFile(new URL('adapters/own-address.definition.json',root))).definition;
let steps=0;
function both(input) {
  const output=JSON.parse(core.step(JSON.stringify(input)));
  const native=spawnSync(nativePath,[],{input:JSON.stringify(input)+'\n',encoding:'utf8',timeout:10000});
  assert.equal(native.status,0,native.stderr);assert.deepEqual(JSON.parse(native.stdout),output);steps++;
  return output;
}
const cases=[
  {allow:true,ip:'1.1.1.1',pass:true},
  {allow:true,ip:'2606:4700:4700::1111',pass:true},
  {allow:false,ip:'1.1.1.1',pass:false},
  {allow:true,ip:'127.0.0.1',pass:false},
  {allow:true,ip:'192.168.1.1',pass:false},
  {allow:true,ip:'100.64.0.1',pass:false},
  {allow:true,ip:'1.1.1.1',patch:{vantage:'lan'},pass:false},
  {allow:true,ip:'1.1.1.1',patch:{publicDns:false},pass:false},
  {allow:true,ip:'1.1.1.1',patch:{nonceRef:'wrong-nonce'},pass:false},
  {allow:false,ip:'1.1.1.1',patch:{remote:true},pass:true},
];
for(const test of cases) {
  const host=structuredClone(fixture.host);host.probe.allowPublicRelay=test.allow;
  const first=both({command:{type:'start',sessionId:fixture.sessionId,adapterId:adapter.id,consent:true},adapters:[adapter],host,requirements:{clientReach:'internet',httpsRequired:true}});
  const effect=first.effects[0];assert.equal(effect.stage,'probe');
  const receipt={nonceRef:host.probe.nonceRef,verifierRef:host.probe.verifierRef,origin:effect.url,vantage:'public',observedAtMs:host.nowMs,expiresAtMs:100000,tls:true,instanceMatched:true,sse:true,streamableHttp:true,oauthDcr:true,remote:false,networkPath:'public-relay',publicDns:true,resolvedIp:test.ip,...test.patch};
  const output=both({state:first.state,host,command:{type:'effect-result',effectId:effect.id,sessionId:effect.sessionId,generation:effect.generation,ok:true,result:{probeReceipt:receipt}}});
  assert.equal(output.snapshot.phase,test.pass?'candidate-ready':'degraded',JSON.stringify(test));
}
console.log(JSON.stringify({nativeWasmEqual:true,relayCases:cases.length,transitions:steps,providerCommandsExecuted:0}));
