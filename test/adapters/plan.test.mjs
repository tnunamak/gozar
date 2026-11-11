import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as core from '../../packages/gozar-core/generated/gozar_core.js';

const root = new URL('../../', import.meta.url);
if (typeof core.default === 'function') await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('adapters/manifest.json');
const fixture = await json('test/adapters/fixtures/plan-v1.json');
const contract = await json('adapters/plan-contract.json');
const records = await Promise.all(manifest.normalizedDefinitions.map(async path => (await json(`adapters/${path}`)).definition));
const clone = value => structuredClone(value);
function transition(input) {
  const output = JSON.parse(core.step(JSON.stringify(input)));
  assert.ok(output.state, `runtime rejected plan input: ${JSON.stringify(output)}`);
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
  const record = records.find(record => record.id === id);
  test(`WASM plan valid ${id} with scoped synthetic driver receipts`, () => {
    const { output, effects } = run(record);
    assert.equal(output.snapshot.phase, 'candidate-ready', JSON.stringify(output.snapshot));
    assert.equal(output.snapshot.candidate, fixture.modes[id].origin);
    assert.equal(output.snapshot.published, null);
    if (record.ownership === 'external-owned') assert.ok(effects.every(effect => !['create', 'remove'].includes(effect.operation)));
    if (record.bindings.port) {
      const execute = effects.find(effect => effect.stage === 'execute');
      assert.equal(execute.bindings.port.value, fixture.modes[id].selectedPort);
      assert.ok(!JSON.stringify(output.state).includes('must-not-survive-capture'));
    }
  });
  for (const feature of record.admission.requiredFeatures) {
    test(`WASM denies ${id} without host feature ${feature}`, () => {
      const host = clone(fixture.host); host.features = host.features.filter(value => value !== feature);
      const output = begin(record, host);
      assert.deepEqual(output.effects, []);
      assert.notEqual(output.snapshot.phase, 'candidate-ready');
    });
  }
}

test('each available feature has a valid first-five trace plus missing-feature denial', () => {
  const covered = new Set(records.filter(record => contract.normalizedOptIn.includes(record.id)).flatMap(record => record.admission.requiredFeatures));
  assert.deepEqual([...covered].sort(), [...fixture.host.features].sort());
});

for (const [id, unavailable] of Object.entries(contract.blocked)) {
  test(`WASM denies unsupported ${id} even when host advertises unavailable features`, () => {
    const record = clone(records.find(record => record.id === id));
    const host = clone(fixture.host); host.features.push(...record.admission.requiredFeatures);
    assert.deepEqual(begin(record, host).effects, []);
    // Removing the wrapper's explicit block cannot bypass the core/host feature intersection.
    record.admission.state = 'admitted';
    assert.deepEqual(begin(record, host).effects, []);
    assert.ok(unavailable.length > 0);
  });
}

test('private port selection preserves preexisting 9443/8444 and falls back only to explicit 9445', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  const { output, effects } = run(record, { editBaseline: raw => { raw.Foreground.administrator.TCP['9444'] = { HTTPS: true }; } });
  assert.equal(output.snapshot.phase, 'candidate-ready');
  assert.equal(effects.find(effect => effect.stage === 'execute').bindings.port.value, 9445);
});

test('all private candidates occupied means no persistence or mutation', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  const { effects, output } = run(record, { editBaseline: raw => { raw.TCP['9444'] = { HTTPS: true }; raw.Foreground.administrator.TCP['9445'] = { HTTPS: true }; } });
  assert.ok(effects.every(effect => effect.stage === 'before'));
  assert.notEqual(output.snapshot.phase, 'candidate-ready');
});

test('public 8443 occupied never falls back or mutates', () => {
  const record = records.find(record => record.id === 'tailscale-funnel');
  const { effects } = run(record, { editBaseline: raw => { raw.Web['administrator.example:8443'] = { Handlers: { '/': { Proxy: 'http://127.0.0.1:7000' } } }; } });
  assert.ok(effects.every(effect => effect.stage === 'before'));
});

test('unknown listener key syntax denies allocation', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  const { effects } = run(record, { editBaseline: raw => { raw.TCP.unknown = {}; } });
  assert.ok(effects.every(effect => effect.stage === 'before'));
});

test('administrator handler added in readback blocks publication and retains debt', () => {
  const record = records.find(record => record.id === 'tailscale-funnel');
  const { output } = run(record, { editObservation: (raw, effect) => {
    if (effect.stage === 'after') raw.Foreground['owned-fixture'].Web['fixture.example-tailnet.ts.net:8443'].Handlers['/administrator'] = { Proxy: 'http://127.0.0.1:7000' };
  } });
  assert.equal(output.snapshot.published, null);
  assert.notEqual(output.snapshot.phase, 'candidate-ready');
  assert.ok(output.snapshot.resources.length > 0);
});

for (const patch of [{ remote: false }, { verifierRef: 'wrong-verifier' }, { instanceMatched: false }, { observedAtMs: 200000 }]) {
  test(`genuine probe receipt fields enforced ${JSON.stringify(patch)}`, () => {
    const record = records.find(record => record.id === 'own-address');
    const { output } = run(record, { probePatch: patch });
    assert.notEqual(output.snapshot.phase, 'candidate-ready');
    assert.equal(output.snapshot.published, null);
  });
}

test('late allocation after stop cannot publish', () => {
  const record = records.find(record => record.id === 'localhost-run');
  const held = run(record, { stopAt: effect => effect.stage === 'execute' });
  assert.ok(held.effect, 'trace must reach owned process dispatch');
  const stopped = transition({ state: held.output.state, host: held.host, command: { type: 'stop' } });
  const late = complete(stopped, held.effect, response(record, held.effect, held.host, held.baseline, {}), held.host);
  assert.equal(late.snapshot.published, null);
  assert.ok(late.snapshot.resources.some(resource => resource.cleanup !== 'removed'));
});

test('own-address rotation withdraws old publication and validates new origin without mutation', () => {
  const record = records.find(record => record.id === 'own-address');
  const initial = run(record);
  assert.equal(initial.output.snapshot.phase, 'candidate-ready');
  const approved = transition({ state: initial.output.state, host: initial.host, command: { type: 'approve-origin', generation: initial.output.snapshot.generation, origin: initial.output.snapshot.candidate } });
  assert.equal(approved.snapshot.published, fixture.modes['own-address'].origin);
  const host = clone(initial.host);
  host.probe.nonceRef = 'fixture-rotated-nonce';
  host.bindings.externalOrigin.value = 'https://rotated.example.com';
  const rotated = transition({ state: approved.state, host, command: { type: 'update-origin' } });
  assert.equal(rotated.snapshot.published, null);
  assert.ok(rotated.snapshot.generation > approved.snapshot.generation);
  assert.ok(rotated.effects.every(effect => effect.operation === 'probe'));
  const probe = rotated.effects[0];
  assert.ok(probe);
  const done = complete(rotated, probe, response(record, probe, host, fixture.baselineConfig, {}), host);
  assert.equal(done.snapshot.candidate, 'https://rotated.example.com');
  assert.equal(done.snapshot.phase, 'candidate-ready');
  assert.equal(done.snapshot.resources.length, 0);
});

test('expired own-origin health withdraws publication and gives external-owner action', () => {
  const record = records.find(record => record.id === 'own-address');
  const ready = run(record);
  const approved = transition({ state: ready.output.state, host: ready.host, command: { type: 'approve-origin', generation: ready.output.snapshot.generation, origin: ready.output.snapshot.candidate } });
  const host = clone(ready.host); host.nowMs = 100001;
  const expired = complete(approved, ready.effect, { elapsed: true }, host);
  assert.equal(expired.snapshot.published, null);
  assert.equal(expired.action.kind, 'external');
  assert.deepEqual(expired.effects, []);
  assert.equal(expired.snapshot.resources.length, 0);
});

test('LAN health failure requires external action without declaring local fetch a peer', () => {
  const record = records.find(record => record.id === 'lan');
  const ready = run(record);
  assert.equal(ready.output.snapshot.phase, 'candidate-ready');
  const host = clone(ready.host); host.probe.nonceRef = 'fixture-lan-health-nonce';
  const health = transition({ state: ready.output.state, host, command: { type: 'health' } });
  assert.equal(health.snapshot.published, null);
  const probe = health.effects[0];
  assert.ok(probe);
  const failed = complete(health, probe, response(record, probe, host, fixture.baselineConfig, { probePatch: { remote: false } }), host);
  assert.notEqual(failed.snapshot.phase, 'candidate-ready');
  assert.equal(failed.action.kind, 'external');
  assert.equal(failed.snapshot.resources.length, 1, 'health failure retains owned listener for explicit cleanup');
});

for (const id of ['localhost-run', 'lan']) {
  test(`immutable local ownership cleanup ${id} uses intrinsic inspection`, () => {
    const record = records.find(record => record.id === id);
    const ready = run(record);
    assert.equal(ready.output.snapshot.phase, 'candidate-ready');
    const stopping = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
    assert.equal(stopping.effects[0]?.recipeRef, 'remove/ownership');
    const done = drain(record, stopping, ready.host, ready.baseline);
    assert.equal(done.output.snapshot.phase, 'stopped', JSON.stringify(done.output.snapshot));
    assert.ok(done.output.snapshot.resources.every(resource => resource.cleanup === 'removed'));
  });
  test(`immutable local ownership cleanup ${id} denies broken continuity`, () => {
    const record = records.find(record => record.id === id);
    const ready = run(record);
    const stopping = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
    const done = drain(record, stopping, ready.host, ready.baseline, { continuityPatch: { continuous: false } });
    assert.ok(done.effects.every(effect => effect.stage === 'before'));
    assert.ok(done.output.snapshot.resources.some(resource => resource.cleanup !== 'removed'));
  });
}

test('route cleanup uses original selected port and exact live record', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  const ready = run(record);
  const stopping = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
  const done = drain(record, stopping, ready.host, ready.baseline);
  const execute = done.effects.find(effect => effect.stage === 'execute');
  assert.ok(execute);
  assert.ok(execute.args.includes('--https=9444'));
  assert.ok(execute.args.includes('--set-path=/'));
  assert.equal(done.output.snapshot.phase, 'stopped');
});

for (const change of ['handler', 'node', 'tailnet', 'continuity']) {
  test(`route cleanup preserves administrator changes: ${change}`, () => {
    const record = records.find(record => record.id === 'tailscale-funnel');
    const ready = run(record);
    const host = clone(ready.host);

    const stopping = transition({ state: ready.output.state, host, command: { type: 'stop' } });
    const done = drain(record, stopping, host, ready.baseline, {
      ...(change === 'continuity' ? { continuityPatch: { continuous: false } } : {}),
      editObservation: (raw, effect) => {
        if (change === 'node' && effect.stepId === 'identity') raw.Self.ID = 'different-node';
        if (change === 'tailnet' && effect.stepId === 'identity') raw.CurrentTailnet.StableID = 'different-tailnet';
        if (change === 'handler' && effect.stage === 'after') { raw.TCP['8443'] = { HTTPS: true }; }
      }
    });
    if (change !== 'handler') assert.ok(done.effects.every(effect => effect.stage === 'before'));
    assert.ok(done.output.snapshot.resources.some(resource => resource.cleanup !== 'removed'));
  });
}

test('Tailscale raw extra listener field is not hidden by whitelist capture', () => {
  const record = records.find(record => record.id === 'tailscale-funnel');
  const { output } = run(record, { editObservation: (raw, effect) => {
    if (effect.stage === 'after') raw.Foreground['owned-fixture'].TCP['8443'].TCPForward = '127.0.0.1:7000';
  } });
  assert.equal(output.snapshot.published, null);
  assert.notEqual(output.snapshot.phase, 'candidate-ready');
  assert.ok(output.snapshot.resources.length > 0);
});

for (const editHost of [host => { host.bindings.loopbackTarget.expiresAtMs = 999; }, host => { host.bindings.loopbackTarget.sessionId = 'other-session'; }]) {
  test(`stale or wrong-session profile binding denies before mutation ${editHost.toString()}`, () => {
    const record = records.find(record => record.id === 'tailscale-funnel');
    const { output, effects } = run(record, { editHost });
    assert.ok(effects.every(effect => effect.stage === 'before'));
    assert.notEqual(output.snapshot.phase, 'candidate-ready');
  });
}

for (const [name, edit] of [
  ['unknown executable guard', record => { record.recipes.create.unimplementedGuard = true; }],
  ['unknown predicate under not', record => { record.recipes.create.requires.push({ op: 'not', predicate: { op: 'unimplemented' } }); }],
  ['unknown binding option', record => { record.bindings.port.unimplementedFallback = true; }],
  ['unknown capture option', record => { record.recipes.create.before[0].captures.nodeId.persistRaw = true; }]
]) {
  test(`unsupported plan data fails before observation: ${name}`, () => {
    const record = clone(records.find(record => record.id === 'tailscale-funnel'));
    edit(record);
    const output = begin(record);
    assert.deepEqual(output.effects, []);
    assert.notEqual(output.snapshot.phase, 'candidate-ready');
  });
}

for (const patch of [{ observedAtMs: 0 }, { expiresAtMs: 999 }]) {
  test(`stale observation cannot authorize mutation ${JSON.stringify(patch)}`, () => {
    const record = records.find(record => record.id === 'tailscale-funnel');
    const { output, effects } = run(record, { observationPatch: patch });
    assert.ok(effects.every(effect => effect.stage === 'before'));
    assert.notEqual(output.snapshot.phase, 'candidate-ready');
  });
}
