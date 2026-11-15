import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createTestingGozar } from '../../packages/gozar-node/testing.mjs';
import { selectedInterfaceAddress } from '../../packages/gozar-node/interfaces.mjs';

const row = (address, internal = false) => ({ address, internal });
const inventory = rows => ({ interfaces: { fixture0: rows } });
const ipv4 = () => row('192.0.2.17');
const linkLocal = () => row('fe80::1');

// Public catalog only: mappings admit observations, not allocation or proof.
async function fixture(t) {
  const base = join(homedir(), '.tmp');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(base, 'gozar-lan-mixed-'));
  await chmod(home, 0o700);
  let current;
  const calls = [];
  const harness = await createTestingGozar({ effects: [{
    kind: 'recipe', operation: 'probe', async handle({ recipe }) {
      calls.push(recipe.kind);
      if (recipe.kind !== 'interfaces') throw new Error('Only interface observations are mapped');
      return structuredClone(current);
    },
  }] });
  t.after(async () => {
    try { await harness.close(); } finally { await rm(home, { recursive: true, force: true }); }
  });
  const query = { schemaVersion: 1, owner: 'lan-mixed-test', home,
    target: '127.0.0.1:18765', usage: { kind: 'session', lifetimeMs: 60000 },
    requirements: { reach: 'lan', transport: 'any', payloadAccess: 'allow-provider',
      address: 'any', setup: 'allow', protocols: [] } };
  return async value => {
    current = value;
    const before = calls.filter(kind => kind === 'interfaces').length;
    const catalog = await harness.gozar.catalogRoutes(query);
    const matches = catalog.candidates.filter(c => c.properties.reach === 'lan' && c.properties.transport === 'http');
    assert.equal(matches.length, 1);
    assert.ok(calls.filter(kind => kind === 'interfaces').length > before, 'fresh raw inventory requested');
    assert.ok(harness.events.every(e => e.kind === 'recipe' && e.operation === 'probe'),
      'catalog must perform only mapped read-only probes, never create/remove/network effects');
    return matches[0];
  };
}

test('usable IPv4 survives unselected rows, order changes and multiple interfaces', async t => {
  const read = await fixture(t);
  assert.equal((await read(inventory([ipv4()]))).setup.state, 'ready');
  for (const value of [
    inventory([ipv4(), linkLocal()]),
    inventory([linkLocal(), ipv4()]),
    { interfaces: { other: [linkLocal()], fixture0: [ipv4()] } },
    { interfaces: { fixture0: [ipv4()], other: [linkLocal(), row('::1', true)] } },
    inventory([row('0.0.0.0'), row('ff02::1'), ipv4()]),
  ]) {
    const candidate = await read(value);
    assert.equal(candidate.setup.state, 'ready');
  }
  // No cached positive verdict can survive loss of the usable row.
  const internal = await read(inventory([row('127.0.0.1', true)]));
  assert.notEqual(internal.setup.state, 'ready');
  assert.equal(internal.candidateToken, null);
  assert.equal((await read(inventory([linkLocal(), ipv4()]))).setup.state, 'ready');
});

test('well-formed unselectable addresses reach the existing core predicate without gaining bind authority', async t => {
  const read = await fixture(t);
  for (const address of ['fe80::1', '::', '::1', 'ff02::1', '0.0.0.0']) {
    assert.equal(selectedInterfaceAddress(address), false);
    const candidate = await read(inventory([row(address)]));
    // Deliberately do not promise ready/not-ready: the core owns inventory semantics.
    // An invalid transport observation yields unknown; a well-formed observation must reach core.
    assert.notEqual(candidate.setup.state, 'unknown');
  }
});

for (const [name, value] of [
  ['array inventory', { interfaces: [] }],
  ['null inventory', { interfaces: null }],
  ['non-array rows', { interfaces: { fixture0: {} } }],
  ['null row', inventory([null])],
  ['array row', inventory([[]])],
  ['invalid address with usable sibling', inventory([ipv4(), row('not-an-address')])],
  ['invalid internal address', inventory([ipv4(), row('not-an-address', true)])],
  ['non-string address', inventory([ipv4(), row(42)])],
  ['non-boolean internal', inventory([ipv4(), row('fe80::1', 'false')])],
  ['oversized inventory', inventory(Array.from({ length: 4096 }, ipv4))],
]) test(name + ' fails closed without discarding just the malformed row', async t => {
  const read = await fixture(t);
  const candidate = await read(value);
  assert.notEqual(candidate.setup.state, 'ready');
  assert.equal(candidate.candidateToken, null);
});
