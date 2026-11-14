import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createTestingGozar } from '../../packages/gozar-node/testing.mjs';

// Inventory is observation only: no route is allocated, firewall approved or peer proof invented.
const usable = () => ({ interfaces: { fixture0: [{ address: '192.0.2.17', internal: false }] } });
async function fixture(t, effects) {
  const base = join(homedir(), '.tmp');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(base, 'gozar-lan-observation-'));
  await chmod(home, 0o700);
  const harness = await createTestingGozar({ effects });
  t.after(async () => { await harness.close(); await rm(home, { recursive: true, force: true }); });
  const query = { schemaVersion: 1, owner: 'lan-observation-test', home,
    target: '127.0.0.1:18765', usage: { kind: 'session', lifetimeMs: 60000 },
    requirements: { reach: 'lan', transport: 'any', payloadAccess: 'allow-provider',
      address: 'any', setup: 'allow', protocols: [] } };
  const read = async () => {
    const result = await harness.gozar.catalogRoutes(query);
    const matches = result.candidates.filter(c => c.properties.reach === 'lan' && c.properties.transport === 'http');
    assert.equal(matches.length, 1, 'one declared LAN/HTTP candidate, selected by capabilities not provider ID');
    return matches[0];
  };
  return { harness, read };
}
function mapping(read, calls) {
  return [{ kind: 'recipe', operation: 'probe', async handle({ recipe }) {
    if (recipe.kind !== 'interfaces') throw new Error('No other observation is supplied');
    calls.count++;
    return read();
  } }];
}
test('declared interfaces observation uses core parser and is refreshed on each catalog read', async t => {
  let current = usable();
  const calls = { count: 0 };
  const { harness, read } = await fixture(t, mapping(() => current, calls));
  const first = await read();
  assert.equal(first.setup.state, 'ready');
  assert.ok(calls.count > 0);
  const before = calls.count;
  current = { interfaces: { fixture0: [{ address: '127.0.0.1', internal: true }] } };
  const second = await read();
  assert.notEqual(second.setup.state, 'ready');
  assert.ok(calls.count > before, 'changed inventory must be observed again');
  assert.equal(second.candidateToken, null);
  current = usable();
  assert.equal((await read()).setup.state, 'ready');
  assert.ok(harness.events.filter(e => e.kind === 'recipe' && e.operation === 'probe').length >= 3);
  assert.equal(harness.events.some(e => ['open', 'run', 'fetch', 'close'].includes(e.operation)), false);
});
test('missing fixture mapping cannot fall back to real host interfaces', async t => {
  const { harness, read } = await fixture(t, []);
  assert.notEqual((await read()).setup.state, 'ready');
  assert.equal(harness.events.length, 0);
});
for (const [name, result] of [
  ['absent inventory', {}],
  ['empty inventory', { interfaces: {} }],
  ['internal only', { interfaces: { lo: [{ address: '127.0.0.1', internal: true }] } }],
  ['malformed inventory', { interfaces: [] }],
  ['malformed address', { interfaces: { fixture0: [{ address: 'not-an-address', internal: false }] } }],
  ['malformed internal flag', { interfaces: { fixture0: [{ address: '192.0.2.17', internal: 'false' }] } }],
]) test(name + ' cannot establish an available interface', async t => {
  const calls = { count: 0 };
  const { read } = await fixture(t, mapping(() => result, calls));
  const candidate = await read();
  assert.notEqual(candidate.setup.state, 'ready');
  assert.equal(candidate.candidateToken, null);
  assert.ok(calls.count > 0);
});
