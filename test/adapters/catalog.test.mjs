import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const manifest = await json('adapters/manifest.json');
const definitions = await Promise.all(manifest.definitions.map(async path => (await json(`adapters/${path}`)).definition));
const projection = await json('adapters/detect-only.json');
const fixtureNames = (await readdir(new URL('./fixtures/', import.meta.url))).filter(name => name.endsWith('.json'));
const fixtures = await Promise.all(fixtureNames.map(name => json(`test/adapters/fixtures/${name}`)));

// A fixture oracle for the proposed data language, not an implementation of provider behavior.
// Core golden tests below separately exercise the shipped JSON/WASM parser.
function valuesAt(document, pointer) {
  if (pointer === '') return [document];
  if (!pointer.startsWith('/')) return [];
  return pointer.slice(1).split('/').reduce((values, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    return values.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      return key === '*' ? Object.values(value) : Object.hasOwn(value, key) ? [value[key]] : [];
    });
  }, [document]);
}
function predicate(document, rule) {
  switch (rule.op) {
    case 'all': return (rule.rules ?? rule.items ?? rule.predicates).every(item => predicate(document, item));
    case 'not': return !predicate(document, rule.rule ?? rule.predicate);
    case 'exists': return valuesAt(document, rule.pointer).length > 0;
    case 'equals': return valuesAt(document, rule.pointer).some(value => JSON.stringify(value) === JSON.stringify(rule.value));
    default: throw new Error(`Unsupported fixture predicate: ${rule.op}`);
  }
}
function originTokens(text, rule) {
  const clean = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  const origins = new Set();
  for (const token of clean.split(/\s+/)) {
    try {
      const url = new URL(token);
      if (url.protocol !== `${rule.scheme}:` || url.username || url.password || token !== url.origin) continue;
      if (new RegExp(rule.hostnamePattern).test(url.hostname)) origins.add(url.origin);
    } catch { /* Non-URL banner tokens are not endpoints. */ }
  }
  return origins.size === 1;
}
function accepts(completion, rule) {
  if (completion.truncated || completion.spawnError || completion.exitCode !== 0) return false;
  if (rule.op === 'origin-tokens') return originTokens(completion.stdout, rule);
  try { return predicate(JSON.parse(completion.stdout), rule); } catch { return false; }
}

test('ten full mode definitions, each covered by concrete fixtures', () => {
  assert.equal(definitions.length, 10);
  assert.equal(new Set(definitions.map(item => item.id)).size, 10);
  for (const definition of definitions) {
    assert.ok(definition.label && definition.reason && definition.actions.length);
    assert.ok(definition.recipes.detect);
    assert.ok(definition.capabilityRecords.length);
    assert.equal(definition.planVersion, 1);
    assert.equal(definition.admission.state, definition.id.startsWith('ngrok-') || definition.id === 'cloudflare-named' ? 'blocked' : 'admitted');
    assert.ok(definition.admission.requiredFeatures.length);
    assert.ok(fixtures.some(fixture => fixture.adapterIds?.includes(definition.id)));
    if (definition.ownership === 'external-owned') {
      assert.equal(definition.recipes.create, undefined);
      assert.equal(definition.recipes.remove, undefined);
    } else {
      assert.ok(definition.recipes.create && definition.recipes.remove);
    }
  }
});

test('auto-admitted projection contains detection only and no optimistic capabilities', () => {
  assert.equal(projection.length, 9);
  for (const record of projection) {
    assert.deepEqual(Object.keys(record.recipes), ['lan', 'own-address'].includes(record.id) ? [] : ['detect']);
    assert.ok(Object.values(record.capabilities).every(value => value !== true));
    const definition = definitions.find(definition => definition.id === record.id);
    assert.ok(definition);
    if (record.recipes.detect) assert.deepEqual(record.recipes.detect, definition.recipes.detect);
    assert.deepEqual(record.unknowns.slice(0, -1), definition.unknowns);
  }
});

test('Funnel and Serve never target protected ports or use global cleanup', () => {
  for (const id of ['tailscale-funnel', 'tailscale-private']) {
    const definition = definitions.find(item => item.id === id);
    assert.ok([443, 10000].every(port => definition.safety.protectedPorts.includes(port)));
    const expectedPorts = id === 'tailscale-funnel' ? [8443] : [9444, 9445];
    if (id === 'tailscale-funnel') assert.equal(definition.bindings.port.value, 8443);
    else { assert.deepEqual(definition.bindings.port.candidates, expectedPorts); assert.deepEqual(definition.bindings.port.protectedPorts, [443, 10000]); }
    for (const operation of ['create', 'remove']) {
      const recipe = definition.recipes[operation];
      if (operation === 'remove') { assert.equal(recipe.kind, 'owned-process'); continue; }
      assert.ok(recipe.args.includes('--https={port}'));
      assert.ok(recipe.args.includes('--set-path={mount}'));
      assert.ok(recipe.before.length && recipe.requires.length && recipe.after.length);
      assert.ok(!recipe.args.some(arg => ['reset', 'logout', '--https=443', '--https=10000'].includes(arg)));
    }
    assert.equal(definition.safety.fallbackPort, null);
    assert.equal(definition.bindings.mount.value, '/');
    assert.equal(definition.safety.rootMountRequiresDedicatedUnusedPort, true);
  }
});

test('trial isolates SSH identity and host checks, owns its process and bounds lifetime', () => {
  const definition = definitions.find(item => item.id === 'localhost-run');
  const args = definition.recipes.create.args;
  for (const option of ['IdentityAgent=none', 'IdentityFile=none', 'IdentitiesOnly=yes', 'ForwardAgent=no', 'StrictHostKeyChecking=accept-new', 'UserKnownHostsFile={privateKnownHostsPath}', 'GlobalKnownHostsFile=/dev/null', 'BatchMode=yes']) assert.ok(args.includes(option));
  assert.equal(definition.lifecycle.durationMs, 900000);
  assert.deepEqual(definition.recipes.create.process, { mode: 'owned-long-running', stdin: 'closed', lifetimeMs: 900000 });
  assert.equal(definition.recipes.remove.kind, 'owned-process');
});

test('transport modes and named route remain distinct and owner-scoped', () => {
  for (const [id, scheme] of [['ngrok-https-edge', 'https'], ['ngrok-tls-passthrough', 'tls'], ['ngrok-tcp-passthrough', 'tcp']]) {
    const definition = definitions.find(item => item.id === id);
    assert.equal(definition.transport.publicScheme, scheme);
    assert.equal(definition.privateConfigTemplate.endpoints[0].url, `${scheme}://{reservedAddress}`);
    assert.equal(definition.transport.silentFallback, false);
    assert.equal(definition.bindings.loopbackTarget.type, scheme === 'https' ? 'loopback-http-origin' : 'literal');
    if (scheme !== 'https') assert.ok(definition.recipes.create.requires.some(item => item.fact === 'no-terminating-edge-policy-or-agent-termination'));
    assert.equal(definition.recipes.remove.kind, 'owned-process');
    assert.ok(!definition.recipes.create.args.includes('--authtoken'));
  }
  const named = definitions.find(item => item.id === 'cloudflare-named');
  assert.ok(named.recipes.create.args.includes('run'));
  assert.ok(named.recipes.create.args.includes('--token-file'));
  assert.equal(named.transport.quickTunnelFallback, false);
  assert.equal(named.transport.dnsMutation, false);
  assert.equal(named.transport.tunnelMutation, false);
  assert.ok(!named.recipes.create.args.includes('--token'));
});

for (const fixture of fixtures) {
  for (const item of fixture.cases ?? []) {
    if (!item.predicate) continue;
    test(`fixture ${item.id}`, () => assert.equal(accepts(item.completion, item.predicate), item.expected));
  }
}

test('completion must match exact effect, session and generation', () => {
  const fixture = fixtures.find(item => item.pending);
  for (const item of fixture.cases) {
    assert.equal(['effectId', 'sessionId', 'generation'].every(key => item.completion[key] === fixture.pending[key]), item.expected, item.id);
  }
});
