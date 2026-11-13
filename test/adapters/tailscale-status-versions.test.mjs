// A session and the catalog must agree about whether Tailscale can host a route, on every CLI version we support.
// The fixtures hold only the key structure of `tailscale status --json --peers=false`; every value is invented.
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as core from '../../packages/gozar-core/generated/gozar_core.js';
import { loadCatalog } from '../../packages/gozar-node/catalog.mjs';
import { createReadContext, loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';

const root = new URL('../../', import.meta.url);
if (typeof core.default === 'function') await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const planFixture = await json('test/adapters/fixtures/plan-v1.json');
const records = await loadCatalog(new URL(root).pathname, { operational: true });
const adapters = await loadAdapters();
const step = input => JSON.parse(core.step(JSON.stringify(input)));
const VERSIONS = ['1.102.5', '1.104.6'];
const fixtureFor = version => json(`test/adapters/fixtures/tailscale-status-${version}.json`);

// A session plans: it reads status, checks permission and the occupied ports, then reaches its durable intent with a current candidate.
function startSession(adapterId, fixture) {
  const record = records.find(item => item.id === adapterId);
  const host = structuredClone(planFixture.host); host.facts = {}; delete host.bindings.profileId;
  let output = step({ adapters: [record], host, command: { type: 'start', sessionId: planFixture.sessionId, adapterId, consent: true }, requirements: { clientReach: record.audience === 'public' ? 'internet' : record.audience, httpsRequired: true } });
  for (let count = 0; count < 8 && output.effects[0]?.stage === 'before'; count++) {
    const effect = output.effects[0];
    const raw = effect.stepId === 'config' ? { TCP: Object.fromEntries(fixture.occupiedPorts.map(port => [String(port), { HTTPS: true }])) } : fixture.status;
    output = step({ state: output.state, host, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: true,
      result: { exitCode: 0, stdout: JSON.stringify(raw), stderr: '', observation: { sessionId: planFixture.sessionId, authorityRef: 'fixture-readonly-observation', observedAtMs: host.nowMs, expiresAtMs: 100000 } } } });
  }
  return output;
}

// The catalog's detect, asking a fake `tailscale` that prints the fixture.
async function catalogState(t, adapterId, status) {
  const directory = await mkdtemp(join(tmpdir(), 'gozar-ts-status-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const program = join(directory, 'tailscale');
  await writeFile(program, `#!${process.execPath}\nconst a=process.argv.slice(2).join(' ');\nprocess.stdout.write(a==='status --json --peers=false'?${JSON.stringify(JSON.stringify(status))}:'{}');\n`);
  await chmod(program, 0o700);
  const context = createReadContext({ home: directory, platform: 'linux' });
  const probe = context.probe;
  context.probe = recipe => probe({ ...recipe, program });
  return (await adapters.find(item => item.id === adapterId).detect(context)).state;
}

for (const adapterId of ['tailscale-funnel', 'tailscale-private']) for (const version of VERSIONS) {
  test(`red: ${adapterId} plans a session with a current candidate from Tailscale ${version} status`, async () => {
    const fixture = await fixtureFor(version);
    const output = startSession(adapterId, fixture);
    assert.equal(output.effects[0]?.kind, 'persist', JSON.stringify(output.snapshot));
    assert.equal(output.effects[0].record.bindings.nodeId.value, fixture.status.Self.ID);
    assert.equal(output.effects[0].record.bindings.tailnetSuffix.value, fixture.status.CurrentTailnet.MagicDNSSuffix);
    assert.notEqual(output.snapshot.phase, 'degraded');
  });

  test(`red: ${adapterId} catalog readiness agrees with session start on Tailscale ${version}`, async t => {
    const fixture = await fixtureFor(version);
    assert.equal(startSession(adapterId, fixture).effects[0]?.kind, 'persist');
    assert.equal(await catalogState(t, adapterId, fixture.status), 'ready');
  });
}

// The same agreement must hold when the session refuses: no Funnel capability means no `ready`.
for (const version of VERSIONS) test(`red: catalog says not ready exactly when the session refuses, Tailscale ${version}`, async t => {
  const refusals = [
    ['HTTPS capability absent', status => { delete status.Self.CapMap.https; }],
    ['MagicDNS disabled', status => { status.CurrentTailnet.MagicDNSEnabled = false; }],
    ['node ID absent', status => { delete status.Self.ID; }],
  ];
  for (const [name, edit] of refusals) {
    const fixture = await fixtureFor(version);
    edit(fixture.status);
    assert.notEqual(startSession('tailscale-funnel', fixture).effects[0]?.kind, 'persist', `${name}: the session refuses`);
    assert.notEqual(await catalogState(t, 'tailscale-funnel', fixture.status), 'ready', `${name}: the catalog must not say ready`);
  }
});

test('the Funnel disclosure names the port the plan will use', () => {
  const planned = records.find(item => item.id === 'tailscale-funnel').bindings.port.value;
  const { disclosure } = adapters.find(item => item.id === 'tailscale-funnel').definition;
  assert.ok(disclosure.text.includes(`port ${planned}`), disclosure.text);
});
