// This test driver executes only the generic effect emitted by the Rust machine.
const { spawnSync } = require('node:child_process');
const { strict: assert } = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../..');
const wasm = require(path.join(root, 'packages/gozar-core/generated/gozar_core.js'));
const native = process.env.GOZAR_NATIVE || path.resolve(root, process.env.CARGO_TARGET_DIR || 'target', 'debug/gozar-core-json');
const adapter = { id:'opaque-fixture', audience:'public', ownership:'owned', capabilities:{https:true}, recipes:{detect:{kind:'spawn',program:'ssh',args:['-V'],timeoutMs:5000,maxOutputBytes:16384,parser:{kind:'contains',value:'OpenSSH',stream:'combined'}}}};
const first = {command:{type:'detect',sessionId:'golden'},adapters:[adapter],requirements:{clientReach:'internet'}};
function nativeStep(input) {
  const p=spawnSync(native,[],{input:JSON.stringify(input)+'\n',encoding:'utf8',timeout:10000});
  assert.equal(p.status,0,p.stderr); return JSON.parse(p.stdout);
}
const trace=[];
function both(input) {
  const w=JSON.parse(wasm.step(JSON.stringify(input))); const n=nativeStep(input);
  assert.deepEqual(w,n); trace.push({input,output:w}); return w;
}
const detected=both(first); const effect=detected.effects[0];
assert.equal(effect.kind,'spawn');
const child=spawnSync(effect.program,effect.args,{encoding:'utf8',timeout:effect.timeoutMs,maxBuffer:effect.maxOutputBytes});
assert.equal(child.status,0,child.stderr);
const completed=both({state:detected.state,command:{type:'effect-result',effectId:effect.id,sessionId:effect.sessionId,generation:effect.generation,ok:true,result:{stdout:child.stdout,stderr:child.stderr,exitCode:child.status}}});
assert.equal(completed.snapshot.observations['opaque-fixture'],'present');
both({state:completed.state,command:{type:'recommend'}});
// Replay the lifecycle counterexamples through both compiled targets, with no route IO.
const machineAdapter={...adapter,id:'machine-fixture',recipes:{
  create:{kind:'spawn',program:'fixture-only',args:[],parser:{kind:'url',constraints:{hostnamePattern:'^[a-z0-9-]+\\.relay\\.example$',exactOriginToken:true}}},
  remove:{kind:'spawn',program:'fixture-only',args:['{resourceId}']}
}};
function ack(output,result,ok=true) {
  const e=output.effects[0];
  return both({state:output.state,command:{type:'effect-result',effectId:e.id,sessionId:e.sessionId,generation:e.generation,ok,result}});
}
const intent=both({command:{type:'start',sessionId:'lifecycle',adapterId:machineAdapter.id,consent:true},adapters:[machineAdapter],requirements:{clientReach:'internet'}});
const create=ack(intent,{durable:true});
const stop=both({state:create.state,command:{type:'stop'}});
const late=both({state:stop.state,command:{type:'effect-result',effectId:create.effects[0].id,sessionId:create.effects[0].sessionId,generation:create.effects[0].generation,ok:true,result:{stdout:'https://one.relay.example',resourceId:'owned-fixture'}}});
assert.equal(late.snapshot.resources[0].cleanup,'pending');
const remove=ack(late,{durable:true});
const removed=ack(remove,{removed:true,exitCode:0});
assert.equal(removed.snapshot.phase,'stopped');
both({state:removed.state,command:{type:'reconcile'}});
const candidate=ack(create,{stdout:'Banner https://docs.example route https://one.relay.example',resourceId:'owned-fixture'});
assert.equal(candidate.snapshot.candidate,'https://one.relay.example');
const ready=ack(candidate,{status:200,vantage:'public'});
const published=both({state:ready.state,command:{type:'approve-origin',generation:ready.state.generation,origin:ready.snapshot.candidate}});
assert.equal(published.snapshot.phase,'published-ready');
const withdrawn=both({state:candidate.state,command:{type:'stop'}});
const staleProbe=both({state:withdrawn.state,command:{type:'effect-result',effectId:candidate.effects[0].id,sessionId:candidate.effects[0].sessionId,generation:candidate.effects[0].generation,ok:true,result:{status:200,vantage:'public'}}});
assert.equal(staleProbe.snapshot.published,null);
if (process.env.GOZAR_TRACE_PATH) fs.writeFileSync(process.env.GOZAR_TRACE_PATH,JSON.stringify(trace,null,2)+'\n');
console.log(JSON.stringify({nativeWasmEqual:true,steps:trace.length,spawn:{program:effect.program,args:effect.args,exitCode:child.status},observation:completed.snapshot.observations['opaque-fixture'],wasmBytes:fs.statSync(path.join(root,'packages/gozar-core/generated/gozar_core_bg.wasm')).size}));
