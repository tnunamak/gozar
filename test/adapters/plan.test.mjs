import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
function addMissingLeavesDuplicate(raw, effect, duplicate) {
  if (effect.stage !== 'after') return;
  const port = String(effect.bindings.port.value);
  const hostPort = `${effect.bindings.dnsName.value}:${port}`;
  raw.Foreground['foreign-missing-leaves'] = {
    ...(duplicate !== 'web-missing-Proxy' ? { TCP: { [port]: { TCPForward: '127.0.0.1:7000' } } } : {}),
    ...(duplicate !== 'listener-missing-HTTPS' ? { Web: { [hostPort]: { Handlers: { '/other': { Text: 'foreign handler' } } } } } : {})
  };
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

test('private cleanup stops only the owned child using original selected port', () => {
  const record = records.find(record => record.id === 'tailscale-private');
  const ready = run(record);
  const stopping = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
  const done = drain(record, stopping, ready.host, ready.baseline);
  const execute = done.effects.find(effect => effect.stage === 'execute');
  assert.ok(execute);
  assert.equal(execute.kind, 'owned-process');
  assert.equal(execute.bindings.port.value, 9444);
  assert.equal(execute.args, undefined);
  assert.ok(done.effects.some(effect => effect.recipeRef === 'remove/ownership'));
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
  test(`stale or wrong-session loopback binding denies before mutation ${editHost.toString()}`, () => {
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

for (const [name, editHost] of [
  ['missing firewall approval', host => { delete host.facts['firewall-user-approved']; }],
  ['unscoped boolean firewall approval', host => { host.facts['firewall-user-approved'].value = true; }],
  ['different interface', host => { host.facts['selected-interface-still-present'].value.address = '192.0.2.21'; }],
  ['different firewall target', host => { host.facts['firewall-user-approved'].value.targetPort++; }],
  ['wrong fact generation', host => { host.facts['firewall-user-approved'].generation = 2; }]
]) {
  test(`LAN exact authority denies before allocation: ${name}`, () => {
    const { output, effects } = run(records.find(record => record.id === 'lan'), { editHost });
    assert.equal(output.snapshot.published, null);
    assert.ok(effects.every(effect => effect.stage === 'before'));
  });
}

test('LAN HTTP plan denies required HTTPS before any effect', () => {
  const record = records.find(record => record.id === 'lan');
  const output = transition({ adapters: [record], host: clone(fixture.host), command: { type: 'start', sessionId: fixture.sessionId, adapterId: record.id, consent: true }, requirements: { clientReach: 'lan', httpsRequired: true } });
  assert.deepEqual(output.effects, []);
  assert.equal(output.snapshot.published, null);
});

for (const [name, editObservation] of [
  ['HTTPS capability absent', (raw, effect) => { if (effect.stepId === 'status') delete raw.Self.CapMap.https; }],
  ['MagicDNS disabled', (raw, effect) => { if (effect.stepId === 'status') raw.CurrentTailnet.MagicDNSEnabled = false; }],
  ['certificate domain mismatches', (raw, effect) => { if (effect.stepId === 'permission') raw.CertDomains = ['unrelated.example.com']; }],
  ['tailnet changes during permission check', (raw, effect) => { if (effect.stepId === 'permission') raw.CurrentTailnet.StableID = 'different-tailnet'; }],
  ['public visibility on private listener', (raw, effect) => { if (effect.stage === 'after') raw.Foreground['owned-fixture'].AllowFunnel[`${effect.bindings.dnsName.value}:${effect.bindings.port.value}`] = true; }],
  ['extra handler on private listener', (raw, effect) => { if (effect.stage === 'after') raw.Foreground['owned-fixture'].Web[`${effect.bindings.dnsName.value}:${effect.bindings.port.value}`].Handlers['/other'] = { Proxy: 'http://127.0.0.1:7000' }; }],
  ['persistent duplicate on private listener', (raw, effect) => { if (effect.stage === 'after') raw.TCP[String(effect.bindings.port.value)] = { HTTPS: true }; }]
]) {
  test(`private Serve rejects ${name}`, () => {
    const { output, effects } = run(records.find(record => record.id === 'tailscale-private'), { editObservation });
    assert.notEqual(output.snapshot.phase, 'candidate-ready');
    assert.equal(output.snapshot.published, null);
    if (effects.some(effect => effect.stage === 'execute')) assert.ok(output.snapshot.resources.length > 0);
    else assert.ok(effects.every(effect => effect.stage === 'before'));
  });
}

test('private Serve requires no public capability or fabricated profile fact', () => {
  const { output } = run(records.find(record => record.id === 'tailscale-private'), {
    editHost: host => { host.facts = {}; },
    editObservation: (raw, effect) => { if (['status', 'permission'].includes(effect.stepId)) { delete raw.Self.CapMap.funnel; delete raw.Self.CapMap['https://tailscale.com/cap/funnel-ports?ports=443,8443,10000']; } }
  });
  assert.equal(output.snapshot.phase, 'candidate-ready');
});

for (const id of ['tailscale-private', 'lan']) {
  for (const probePatch of [{ remote: false }, { vantage: 'public' }, { tls: false, instanceMatched: false }, ...(id === 'tailscale-private' ? [{ tls: false }] : [])]) {
    test(`${id} denies invalid intended-client probe ${JSON.stringify(probePatch)}`, () => {
      const { output } = run(records.find(record => record.id === id), { probePatch });
      assert.notEqual(output.snapshot.phase, 'candidate-ready');
      assert.equal(output.snapshot.published, null);
    });
  }
}

for (const value of ['http://origin.example.com', 'https://user:password@origin.example.com', 'https://origin.example.com/other']) {
  test(`own-address denies non-origin or non-HTTPS binding ${value}`, () => {
    const { output, effects } = run(records.find(record => record.id === 'own-address'), { editHost: host => { host.bindings.externalOrigin.value = value; } });
    assert.deepEqual(effects, []);
    assert.equal(output.snapshot.published, null);
  });
}

for (const [flag, receiptFlag] of [['sse', 'sse'], ['streamableHttp', 'streamableHttp'], ['oauthDcr', 'oauthDcr']]) {
  test(`own-address requires actual ${flag} proof when requested`, () => {
    const record = records.find(record => record.id === 'own-address');
    const host = clone(fixture.host);
    const output = transition({ adapters: [record], host, command: { type: 'start', sessionId: fixture.sessionId, adapterId: record.id, consent: true }, requirements: { clientReach: 'internet', httpsRequired: true, [flag]: true } });
    const done = drain(record, output, host, fixture.baselineConfig, { probePatch: { [receiptFlag]: false } });
    assert.notEqual(done.output.snapshot.phase, 'candidate-ready');
    assert.equal(done.output.snapshot.published, null);
    assert.ok(done.effects.every(effect => !['create', 'remove'].includes(effect.operation)));
  });
}

test('own-address stop withdraws publication without external route authority', () => {
  const ready = run(records.find(record => record.id === 'own-address'));
  const stopped = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
  assert.deepEqual(stopped.effects, []);
  assert.equal(stopped.snapshot.published, null);
  assert.equal(stopped.snapshot.phase, 'stopped');
  assert.deepEqual(stopped.snapshot.resources, []);
});


test('capture actual generated-WASM first-five and denial traces with artifact identity', async () => {
  const summarize = ({ output, effects }) => ({
    phase: output.snapshot.phase,
    candidate: output.snapshot.candidate,
    published: output.snapshot.published,
    resources: output.snapshot.resources.map(resource => ({ kind: resource.kind, cleanup: resource.cleanup })),
    action: output.action ?? null,
    effects: effects.map(effect => ({ kind: effect.kind, operation: effect.operation, stage: effect.stage, recipeRef: effect.recipeRef, selectedPort: effect.bindings?.port?.value ?? null }))
  });
  const traces = [];
  for (const id of contract.normalizedOptIn) {
    const record = records.find(record => record.id === id);
    const result = run(record);
    assert.equal(result.output.snapshot.phase, 'candidate-ready');
    traces.push({ case: `positive:${id}`, ...summarize(result) });
  }
  const cases = [
    ['private-occupied-candidates', 'tailscale-private', { editBaseline: raw => { raw.TCP['9444'] = {}; raw.TCP['9445'] = {}; } }],
    ['private-public-visibility-readback', 'tailscale-private', { editObservation: (raw, effect) => { if (effect.stage === 'after') raw.Foreground['owned-fixture'].AllowFunnel[`${effect.bindings.dnsName.value}:${effect.bindings.port.value}`] = true; } }],
    ['LAN-unscoped-firewall', 'lan', { editHost: host => { host.facts['firewall-user-approved'].value = true; } }],
    ['LAN-local-is-not-peer', 'lan', { probePatch: { remote: false } }],
    ['own-address-instance-mismatch', 'own-address', { probePatch: { instanceMatched: false } }]
  ];
  for (const [name, id, options] of cases) {
    const result = run(records.find(record => record.id === id), options);
    assert.notEqual(result.output.snapshot.phase, 'candidate-ready');
    traces.push({ case: name, ...summarize(result) });
  }
  for (const id of ['tailscale-private', 'tailscale-funnel']) {
    for (const duplicate of ['listener-missing-HTTPS', 'web-missing-Proxy', 'both-missing-leaves']) {
      const result = run(records.find(record => record.id === id), { editObservation: (raw, effect) => addMissingLeavesDuplicate(raw, effect, duplicate) });
      assert.notEqual(result.output.snapshot.phase, 'candidate-ready');
      assert.equal(result.output.snapshot.published, null);
      traces.push({ case: `${id}:${duplicate}`, ...summarize(result) });
      if (duplicate === 'both-missing-leaves') {
        const foreignBaseline = clone(result.baseline);
        const original = result.effects.find(effect => effect.stage === 'execute');
        addMissingLeavesDuplicate(foreignBaseline, { ...original, stage: 'after' }, duplicate);
        const stopping = transition({ state: result.output.state, host: result.host, command: { type: 'stop' } });
        const cleanup = drain(records.find(record => record.id === id), stopping, result.host, foreignBaseline);
        assert.equal(cleanup.output.snapshot.phase, 'cleanup-pending');
        traces.push({ case: `${id}:missing-leaves-foreign-mapping-cleanup`, ...summarize(cleanup) });
      }

    }
  }
  const record = records.find(record => record.id === 'tailscale-private');
  const ready = run(record);
  const stopping = transition({ state: ready.output.state, host: ready.host, command: { type: 'stop' } });
  const denied = drain(record, stopping, ready.host, ready.baseline, { continuityPatch: { continuous: false } });
  assert.ok(denied.output.snapshot.resources.some(resource => resource.cleanup !== 'removed'));
  traces.push({ case: 'private-broken-ownership-continuity', ...summarize(denied) });
  if (process.env.GOZAR_ADAPTER_TRACE_OUTPUT) {
    const wasm = await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root));
    const bindings = await readFile(new URL('packages/gozar-core/generated/gozar_core.js', root));
    const plans = Object.fromEntries(await Promise.all(contract.normalizedOptIn.map(async id => [id, createHash('sha256').update(await readFile(new URL(`adapters/${id}.definition.json`, root))).digest('hex')])));
    const evidence = {
      provenance: 'Actual generated-WASM step outputs using synthetic trusted-driver completions. No OS effects dispatched; no live ownership, TLS, DNS, remote vantage or provider evidence.',
      command: 'nice -n 19 ionice -c3 node --test --test-concurrency=2 test/adapters/plan.test.mjs',
      exports: Object.keys(core).sort(),
      wasmSha256: createHash('sha256').update(wasm).digest('hex'),
      bindingsSha256: createHash('sha256').update(bindings).digest('hex'),
      planSha256: plans,
      traces
    };
    await writeFile(process.env.GOZAR_ADAPTER_TRACE_OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
  }
});

test('own-address declares explicit host proxy-target setup without core mutation recipes', () => {
  const record = records.find(record => record.id === 'own-address');
  assert.deepEqual(record.setup, { requiresProxyTarget: true });
  assert.equal(record.recipes.create, undefined);
  assert.equal(record.recipes.remove, undefined);
});

for (const id of ['tailscale-private', 'tailscale-funnel']) {
  for (const duplicate of ['listener-missing-HTTPS', 'web-missing-Proxy', 'both-missing-leaves']) {
    test(`${id} readback denies duplicate whole records with ${duplicate}`, () => {
      const { output } = run(records.find(record => record.id === id), {
        editObservation: (raw, effect) => addMissingLeavesDuplicate(raw, effect, duplicate)
      });
      assert.notEqual(output.snapshot.phase, 'candidate-ready', 'existential whole-record predicates and leaf captures must not accept a second selected record');
      assert.equal(output.snapshot.published, null);
      assert.ok(output.snapshot.resources.length > 0, 'failed readback retains the owned child as cleanup debt');
    });
  }
}

for (const id of ['tailscale-private', 'tailscale-funnel']) {
  test(`${id} missing-leaves cleanup stops original child and retains foreign mapping debt`, () => {
    const record = records.find(record => record.id === id);
    const options = { editObservation: (raw, effect) => addMissingLeavesDuplicate(raw, effect, 'both-missing-leaves') };
    const denied = run(record, options);
    assert.equal(denied.output.snapshot.phase, 'cleanup-pending');
    const foreignBaseline = clone(denied.baseline);
    const original = denied.effects.find(effect => effect.stage === 'execute');
    addMissingLeavesDuplicate(foreignBaseline, { ...original, stage: 'after' }, 'both-missing-leaves');
    const foreign = clone(foreignBaseline.Foreground['foreign-missing-leaves']);
    const stopping = transition({ state: denied.output.state, host: denied.host, command: { type: 'stop' } });
    const cleanup = drain(record, stopping, denied.host, foreignBaseline);
    const removals = cleanup.effects.filter(effect => effect.operation === 'remove' && effect.stage === 'execute');
    assert.equal(removals.length, 1);
    assert.equal(removals[0].kind, 'owned-process');
    assert.equal(removals[0].resourceId, 'fixture-resource');
    assert.equal(removals[0].args, undefined, 'cleanup has no provider mutation command');
    assert.ok(cleanup.effects.some(effect => effect.recipeRef === 'remove/ownership'));
    assert.ok(cleanup.effects.some(effect => effect.recipeRef === 'remove/after/readback'));
    assert.equal(cleanup.output.snapshot.phase, 'cleanup-pending');
    assert.equal(cleanup.output.snapshot.published, null);
    assert.ok(cleanup.output.snapshot.resources.some(resource => resource.cleanup !== 'removed'));
    assert.deepEqual(foreignBaseline.Foreground['foreign-missing-leaves'], foreign);
  });
}
