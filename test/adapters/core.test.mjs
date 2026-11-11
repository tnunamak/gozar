import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import * as core from '../../packages/gozar-core/generated/gozar_core.js';

const root = new URL('../../', import.meta.url);
if (typeof core.default === 'function') {
  await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
}
const { step } = core;
const transition = input => JSON.parse(step(JSON.stringify(input)));
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const fixtureNames = (await readdir(new URL('./fixtures/', import.meta.url))).filter(name => name.endsWith('.json'));
const fixtures = await Promise.all(fixtureNames.map(name => json(`test/adapters/fixtures/${name}`)));
const projection = await json('adapters/detect-only.json');

function detect(parser, result, scope = {}) {
  const first = transition({ command: { type: 'detect', sessionId: 'adapter-fixture' }, adapters: [{ id: 'fixture-adapter', audience: 'public', ownership: 'owned', capabilities: {}, recipes: { detect: { kind: 'spawn', program: 'fixture-never-executed', args: [], parser, timeoutMs: 10, maxOutputBytes: 65536 } } }] });
  const effect = first.effects[0];
  const next = transition({ state: first.state, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: !result.truncated && !result.spawnError && result.exitCode === 0, result, ...scope } });
  return { first, next };
}

for (const fixture of fixtures) {
  for (const item of fixture.cases ?? []) {
    if (!item.predicate) continue;
    let parser;
    if (item.predicate.op === 'origin-tokens') {
      parser = { kind: 'url', prefix: 'https://', constraints: { hostnamePattern: item.predicate.hostnamePattern, exactOriginToken: true, rejectMultipleDistinct: true } };
    } else parser = { kind: 'json-document', predicate: item.predicate };
    test(`WASM parser ${item.id}`, () => {
      const { next } = detect(parser, item.completion);
      assert.equal(next.snapshot.observations['fixture-adapter'] === 'present', item.expected);
      assert.deepEqual(next.effects, []);
    });
  }
}

test('admitted catalog detects login state without provider execution', () => {
  const record = projection.find(item => item.id === 'tailscale-funnel');
  for (const [backend, expected] of [['Running', 'present'], ['NeedsLogin', 'unknown'], ['NeedsMachineAuth', 'unknown']]) {
    const { next } = detect(record.recipes.detect.parser, { exitCode: 0, stdout: JSON.stringify({ BackendState: backend }), stderr: '' });
    assert.equal(next.snapshot.observations['fixture-adapter'], expected);
  }
});

test('bare pointer extraction does not establish login', () => {
  const { next } = detect({ kind: 'json', pointer: '/BackendState' }, { exitCode: 0, stdout: '{"BackendState":"NeedsLogin"}', stderr: '' });
  assert.equal(next.snapshot.observations['fixture-adapter'], 'unknown');
});

test('unknown predicate and unknown source fail closed even under not', () => {
  for (const predicate of [{ op: 'not', rule: { op: 'invented' } }, { op: 'not', rule: { op: 'equals', source: 'invented', pointer: '/value', value: true } }]) {
    const { next } = detect({ kind: 'json-document', predicate }, { exitCode: 0, stdout: '{"value":true}', stderr: '' });
    assert.equal(next.snapshot.observations['fixture-adapter'], 'unknown');
  }
});

test('completion scope mismatch is rejected without consuming pending effect', () => {
  for (const scope of [{ effectId: 'wrong' }, { sessionId: 'wrong' }, { generation: 999 }]) {
    const { first, next } = detect({ kind: 'contains', value: 'fixture' }, { exitCode: 0, stdout: 'fixture', stderr: '' }, scope);
    assert.equal(next.snapshot.observations['fixture-adapter'], undefined);
    assert.equal(Object.keys(next.state.pending).length, Object.keys(first.state.pending).length);
  }
});

test('normalized Tailscale plans reject when host features are absent', async () => {
  for (const id of ['tailscale-funnel', 'tailscale-private']) {
    const { definition } = await json(`adapters/${id}.definition.json`);
    const record = { ...definition, capabilities: { https: true, sse: true } };
    const output = transition({ command: { type: 'start', sessionId: 'gated-fixture', adapterId: id, consent: true }, adapters: [record], requirements: { clientReach: definition.audience === 'public' ? 'internet' : 'tailnet', httpsRequired: true } });
    assert.deepEqual(output.effects, []);
    assert.notEqual(output.snapshot.phase, 'starting');
    assert.notEqual(output.snapshot.phase, 'persisting');
  }
});
