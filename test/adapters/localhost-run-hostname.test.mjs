// Regression for the live localhost.run banner: the relay now announces `<id>.app.lhr.life`.
// The recipe's hostnamePattern is the single matcher: the WASM core parser (the only announcement parser),
// the provider setup check and the public fixture all read that one pattern.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as core from '../../packages/gozar-core/generated/gozar_core.js';
import localhost from '../../adapters/providers/localhost-run/index.mjs';

const root = new URL('../../', import.meta.url);
if (typeof core.default === 'function') {
  await core.default({ module_or_path: await readFile(new URL('packages/gozar-core/generated/gozar_core_bg.wasm', root)) });
}
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const { definition } = await json('adapters/localhost-run.definition.json');
const parser = definition.recipes.create.parser;
const fixture = await json('test/adapters/fixtures/localhost-run.json');

const id = 'fixture-trial';
const OBSERVED = `${id}.app.lhr.life`;
// Shape captured live from `ssh nokey@localhost.run` (QR block elided): bare host, then the https origin.
const bannerFor = host => `\x1b[1mWelcome\x1b[0m\r\nhttps://admin.localhost.run/\r\n${host} tunneled with tls termination, https://${host}\r\n` +
  'create an account ... see https://localhost.run/docs/forever-free/ for more\r\n';

const wasm = line => {
  const send = input => JSON.parse(core.step(JSON.stringify(input)));
  const first = send({ command: { type: 'detect', sessionId: 's' }, adapters: [{ id: 'a', audience: 'public', ownership: 'owned', capabilities: {}, recipes: { detect: { kind: 'spawn', program: 'x', args: [], parser, timeoutMs: 10, maxOutputBytes: 65536 } } }] });
  const effect = first.effects[0];
  const next = send({ state: first.state, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: true, result: { exitCode: 0, stdout: line, stderr: '', truncated: false } } });
  return next.snapshot.observations.a === 'present';
};

// Provider setup completes only for a verified route whose published origin passes the recipe matcher.
const setupAccepts = async origin => {
  const target = '127.0.0.1:1';
  const route = {
    state: 'usable', origin, published: origin, handle: { id: 'r', kind: 'session', generation: 1 }, cleanup: { state: 'none' },
    hostConfiguration: { target: { known: true, value: target }, bindTarget: { known: true, value: '127.0.0.1:2' } },
    verification: { status: 'verified', vantage: 'public', observedAt: '2026-11-17T21:30:00.000Z', checks: ['tls', 'nonce'],
      subject: { origin, target, handleGeneration: 1 } },
  };
  const ctx = { platform: 'linux', now: () => 0, probe: async () => ({ ok: true }), configuration: async () => ({}), target, route };
  return (await localhost.observeSetup(ctx, { id: 'op', cancelled: false, resources: [] })).state === 'complete';
};

const accepted = [OBSERVED, 'a.app.lhr.life', `${'a'.repeat(63)}.app.lhr.life`, 'fixture-trial.lhr.life'];
const rejected = [
  ['fake provider suffix', 'fixture-trial.app.lhr.life.attacker.example'],
  ['fake suffix lookalike', 'fixture-trial.app.lhr.life.evil.lhr.life.example'],
  ['wrong middle label', 'fixture-trial.evil.lhr.life'],
  ['app only', 'app.lhr.life.attacker.example'],
  ['too deep', 'x.fixture-trial.app.lhr.life'],
  ['double app', 'fixture-trial.app.app.lhr.life'],
  ['oversize label', `${'a'.repeat(64)}.app.lhr.life`],
  ['leading hyphen', '-bad.app.lhr.life'],
  ['trailing hyphen', 'bad-.app.lhr.life'],
  ['underscore', 'bad_id.app.lhr.life'],
  ['empty label', '.app.lhr.life'],
  ['bare app host', 'app.lhr.life.'],
];

test('observed live banner yields exactly the new-family origin through the core parser', () => {
  const line = bannerFor(OBSERVED);
  assert.equal(wasm(line), true);
});

for (const host of accepted) {
  test(`accepts ${host.length > 40 ? 'long label host' : host} in WASM and setup`, async () => {
    assert.equal(wasm(`https://${host}`), true);
    assert.equal(await setupAccepts(`https://${host}`), true);
  });
}

for (const [name, host] of rejected) {
  test(`rejects ${name}`, async () => {
    assert.equal(wasm(`https://${host}`), false);
    assert.equal(await setupAccepts(`https://${host}`), false);
  });
}

test('credentials, query, fragment, path, port and scheme are refused for the new family', async () => {
  for (const origin of [`https://user@${OBSERVED}`, `https://user:pw@${OBSERVED}`, `https://${OBSERVED}?t=1`, `https://${OBSERVED}#f`, `https://${OBSERVED}/p`, `http://${OBSERVED}`]) {
    assert.equal(wasm(origin), false, origin);
    assert.equal(await setupAccepts(origin), false, origin);
  }
});

// A port is refused by setup validation. The core parser compares only hostnames, as it did for the
// single-label family, so the new family must behave exactly like the old one there.
test('a port is refused by setup validation and parses like the old family', async () => {
  const oldFamily = 'https://fixture-trial.lhr.life:8443', newFamily = `https://${OBSERVED}:8443`;
  assert.equal(await setupAccepts(newFamily), false);
  assert.equal(await setupAccepts(oldFamily), false);
  assert.equal(wasm(newFamily), wasm(oldFamily));
});

test('two distinct origins stay ambiguous, across and within families', () => {
  for (const other of ['https://other.app.lhr.life', 'https://other.lhr.life']) {
    const line = `https://${OBSERVED} ${other}`;
    assert.equal(wasm(line), false);
  }
  assert.equal(wasm(`https://${OBSERVED} https://${OBSERVED}`), true);
});

test('a banner whose bare hostname line carries no https origin is not an endpoint', () => {
  assert.equal(wasm(`${OBSERVED} tunneled`), false);
});

test('public fixture carries the observed family and every copy equals the recipe pattern', () => {
  const cases = new Map(fixture.cases.map(item => [item.id, item]));
  assert.equal(cases.get('observed-app-subdomain-banner')?.expected, true);
  assert.equal(cases.get('observed-app-subdomain-banner').completion.stdout.includes(`https://${OBSERVED}`), true);
  for (const item of fixture.cases.filter(item => item.predicate?.hostnamePattern)) {
    assert.equal(item.predicate.hostnamePattern, parser.constraints.hostnamePattern, item.id);
  }
});
