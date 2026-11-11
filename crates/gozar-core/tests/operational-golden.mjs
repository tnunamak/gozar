import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const trace = [];
import * as core from '../../../packages/gozar-core/generated/gozar_core.js';

const root = new URL('../../../', import.meta.url);
if (typeof core.default === 'function') await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
const nativePath = process.env.GOZAR_NATIVE ?? path.resolve(fileURLToPath(root), process.env.CARGO_TARGET_DIR || 'target', 'debug/gozar-core-json');
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('adapters/manifest.json');
const fixture = await json('test/adapters/fixtures/plan-v1.json');
const contract = await json('adapters/plan-contract.json');
const records = await Promise.all(manifest.normalizedDefinitions.map(async path => (await json(`adapters/${path}`)).definition));
const clone = value => structuredClone(value);
function transition(input) {
  const output = JSON.parse(core.step(JSON.stringify(input)));
  assert.ok(output.state, `runtime rejected plan input: ${JSON.stringify(output)}`);
  const native = spawnSync(nativePath, [], { input: JSON.stringify(input)+'\n',encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024 });
  assert.equal(native.status,0,native.stderr);
  assert.deepEqual(JSON.parse(native.stdout),output,'native and WASM transition mismatch');
  trace.push({command:input.command,effects:output.effects,snapshot:output.snapshot});
  return output;
}
function begin(record, host = clone(fixture.host)) {
  const reach = record.audience === 'public' ? 'internet' : record.audience;
  return transition({ adapters: [record], host, command: { type: 'start', sessionId: fixture.sessionId, adapterId: record.id, consent: true }, requirements: { clientReach: reach, httpsRequired: record.id !== 'lan' } });
}
function complete(output, effect, result, host, ok = true) {
  return transition({ state: output.state, host, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok, result } });
}
function expand(value, bindings) {
  if (typeof value === 'string') {
    const exact = /^\{([^{}]+)\}$/.exec(value);
    if (exact) return bindings[exact[1]].value ?? bindings[exact[1]].handleRef;
    return value.replace(/\{([^{}]+)\}/g, (_, name) => String(bindings[name].value ?? bindings[name].handleRef));
  }
  if (Array.isArray(value)) return value.map(item => expand(item, bindings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, expand(item, bindings)]));
  return value;
}
function readback(record, effect, baseline) {
  const raw = clone(baseline);
  const port = effect.bindings?.port?.value;
  if (!port) return raw;
  const hostname = effect.bindings.dnsName.value;
  const view = fixture.modes[record.id].configPlacement === 'foreground' ? (raw.Foreground['owned-fixture'] = { TCP: {}, Web: {}, AllowFunnel: {} }) : raw;
  view.TCP[String(port)] = { HTTPS: true };
  view.Web[`${hostname}:${port}`] = { Handlers: { '/': { Proxy: effect.bindings.loopbackTarget.value } } };
  if (record.audience === 'public') view.AllowFunnel[`${hostname}:${port}`] = true;
  return raw;
}
function receipt(effect, host, overrides = {}) {
  return { handleRef: 'fixture-resource', continuityRef: 'fixture-continuity', sessionId: fixture.sessionId, observedAtMs: host.nowMs, expiresAtMs: 100000, continuous: true, ...overrides };
}
// Responses are synthetic trusted-driver fixtures. No effect is dispatched to the OS/network.
function response(record, effect, host, baseline, options) {
  if (effect.kind === 'persist') return { durable: true };
  if (effect.recipeRef === 'remove/ownership') return {
    details: effect.ownership.details, ownershipReceipt: receipt(effect, host, options.continuityPatch),
    observation: { sessionId: fixture.sessionId, authorityRef: 'fixture-observation', observedAtMs: host.nowMs, expiresAtMs: 100000 }
  };
  if (effect.stage === 'probe' || effect.operation === 'probe') {
    const origin = effect.url ?? effect.origin ?? fixture.modes[record.id].origin;
    return { status: 200, vantage: effect.vantage, probeReceipt: { nonceRef: host.probe.nonceRef, verifierRef: host.probe.verifierRef, origin, vantage: effect.vantage, observedAtMs: host.nowMs, expiresAtMs: 100000, tls: origin.startsWith('https://'), instanceMatched: true, sse: true, streamableHttp: true, oauthDcr: true, remote: true, ...(options.probePatch ?? {}) } };
  }
  if (effect.stage === 'before' || effect.stage === 'after') {
    let raw;
    if (['status', 'permission', 'identity'].includes(effect.stepId)) raw = clone(fixture.rawStatus);
    else if (effect.stepId === 'config') raw = clone(baseline);
    else if (effect.operation === 'remove' || effect.recipeRef?.startsWith('remove/')) raw = effect.stage === 'after' ? clone(baseline) : readback(record, effect, baseline);
    else raw = readback(record, effect, baseline);
    options.editObservation?.(raw, effect);
    return { exitCode: 0, stdout: JSON.stringify(raw), stderr: '', observation: { sessionId: fixture.sessionId, authorityRef: 'fixture-observation', observedAtMs: host.nowMs, expiresAtMs: 100000, ...(options.observationPatch ?? {}) }, ...(effect.recipeRef?.startsWith('remove/') ? { ownershipReceipt: receipt(effect, host, options.continuityPatch) } : {}) };
  }
  if (effect.operation === 'remove') return { exitCode: 0, removed: true, resourceId: 'fixture-resource', ownershipReceipt: receipt(effect, host, options.continuityPatch) };
  const mode = fixture.modes[record.id];
  return { exitCode: 0, stdout: mode.stdout ?? '', stderr: '', origin: mode.origin, resourceId: 'fixture-resource', ownership: { handleRef: 'fixture-resource', continuityRef: 'fixture-continuity', kind: mode.ownershipKind, sessionId: fixture.sessionId, generation: effect.generation, details: expand(record.recipes.create.ledger, effect.bindings) } };
}
function run(record, options = {}) {
  const host = clone(fixture.host);
  options.editHost?.(host);
  const baseline = clone(fixture.baselineConfig);
  options.editBaseline?.(baseline);
  return drain(record, begin(record, host), host, baseline, options);
}
function drain(record, output, host, baseline, options = {}) {
  const effects = [];
  for (let count = 0; output.effects.length && count < 24; count++) {
    assert.equal(output.effects.length, 1, 'bounded plan must serialize dependent effects');
    const effect = output.effects[0];
    if (effect.stage === 'health') return { output, effects, host, baseline, effect };
    effects.push(effect);
    if (options.stopAt?.(effect)) return { output, effects, host, baseline, effect };
    output = complete(output, effect, response(record, effect, host, baseline, options), host);
  }
  assert.ok(effects.length < 24, 'plan exceeded bounded fixture trace');
  return { output, effects, host, baseline };
}

for (const id of contract.normalizedOptIn) {
  const record=records.find(record=>record.id===id);
  const ready=run(record);
  assert.equal(ready.output.snapshot.phase,'candidate-ready',id+JSON.stringify(ready.output.snapshot));
  const stopped=transition({state:ready.output.state,host:ready.host,command:{type:'stop'}});
  const done=drain(record,stopped,ready.host,ready.baseline);
  assert.equal(done.output.snapshot.phase,'stopped',id+JSON.stringify(done.output.snapshot));
}
const external=records.find(record=>record.ownership==='external-owned');
const ready=run(external); const host=clone(ready.host);
host.bindings.externalOrigin.value='https://rotated.example';host.probe.nonceRef='rotated-nonce';
const rotated=transition({state:ready.output.state,host,command:{type:'update-origin'}});
assert.equal(rotated.snapshot.published,null);
const checked=drain(external,rotated,host,ready.baseline);
assert.equal(checked.output.snapshot.phase,'candidate-ready');
const file=process.env.GOZAR_TRACE_PATH;
if(file) await writeFile(file,JSON.stringify({scope:'synthetic trusted provider outcomes; no route or network effects dispatched',nativeWasmEqual:true,steps:trace.length,trace},null,2)+'\n');
console.log(JSON.stringify({nativeWasmEqual:true,steps:trace.length,plans:contract.normalizedOptIn.length,operationalProviderEvidence:false}));
