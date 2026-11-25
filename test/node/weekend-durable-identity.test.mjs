import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routeStatus, closeRoute, unknownProperties } from '../../packages/gozar-node/route-view.mjs';

import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';

// A persisted proof is historical evidence, not a substitute for a live controller.
test('public attached recovery preserves proof history but withdraws current authority', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gozar-proof-history-'));
  const handle = { kind: 'attached', id: 'att_0123456789abcdef', generation: 1 };
  const directory = join(home, 'attached', handle.id);
  const checkedAt = '2026-01-01T00:00:00.000Z';
  const subject = { instanceId: 'host-instance', bootId: 'old-supervisor-boot',
    handleGeneration: 1, origin: 'https://example.invalid', target: '127.0.0.1:32101' };
  const lastView = {
    schemaVersion: 2, handle, state: 'usable', routeState: 'active',
    origin: subject.origin, published: subject.origin, ownership: 'gozar-owned',
    binding: { target: subject.target }, properties: unknownProperties(),
    ingress: { validUntil: '2099-01-01T00:00:00.000Z' },
    verification: { status: 'verified', checkedAt, observedAt: checkedAt,
      subject, vantage: 'this-device', checks: ['nonce', 'tls'] },
    limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null },
    cleanup: { state: 'none' },
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const bytes = JSON.stringify({ handle, phase: 'usable', lastView, adapterId: 'fixture' });
    await writeFile(join(directory, 'state.json'), bytes, { mode: 0o600 });
    // No control.json: loss is independently represented by absent controller custody.
    // No network, provider, verifier, or daemon fixture is started.
    for (let i = 0; i < 3; i++) {
      const status = await routeStatus({ home, handle });
      assert.equal(status.verification.status, 'unverified');
      assert.equal(status.published, null);
      assert.equal(status.ingress, null);
      assert.equal(status.cleanup.state, 'unconfirmed');
      assert.equal(status.verification.checkedAt, checkedAt);
      assert.equal(status.verification.observedAt, checkedAt);
      assert.deepEqual(status.verification.subject, subject);
      assert.deepEqual(status.verification.checks, []);
      assert.deepEqual(status.handle, handle);
      assert.deepEqual(status.binding, lastView.binding);
    }
    const closed = await closeRoute({ home, handle, mode: 'remove' },
      { attachedDeps: { adapters: [] } });
    assert.equal(closed.cleanup.state, 'unconfirmed');
    assert.equal(closed.verification.status, 'unverified');
    assert.deepEqual(closed.verification.subject, subject);
    assert.equal(closed.verification.observedAt, checkedAt);
    assert.equal(closed.published, null);
    assert.equal(await readFile(join(directory, 'state.json'), 'utf8'), bytes);
    await assert.rejects(routeStatus({ home, handle: { ...handle, generation: 2 } }),
      error => error.code === 'route_conflict');
  } finally { await rm(home, { recursive: true, force: true }); }
});

const fileForRoute = id => createHash('sha256').update(id).digest('hex') + '.json';
const durableRecord = (routeId, owner = 'fixture-owner') => ({
  schemaVersion: 1, routeId, owner, ownership: 'gozar-owned', generation: 3,
  state: 'usable', origin: 'https://fixture.example.invalid', target: '127.0.0.1:32101',
  verification: {
    status: 'verified', checkedAt: '2026-01-01T00:00:00.000Z',
    observedAt: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
    subject: { instanceId: 'fixture-host', bootId: 'fixture-boot', handleGeneration: 3,
      origin: 'https://fixture.example.invalid', target: '127.0.0.1:32101' },
  },
});

async function withDurableFixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-durable-enumeration-'));
  try {
    const directory = join(home, 'routes');
    await mkdir(directory, { mode: 0o700 });
    const api = createRouteApi({ adapters: [] });
    const write = async (name, value) => {
      const file = join(directory, name);
      const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
      await writeFile(file, bytes, { mode: 0o600 });
      return { file, bytes };
    };
    await run({ list: () => api.listRoutes({ home, owner: 'fixture-owner' }), write });
  } finally { await rm(home, { recursive: true, force: true }); }
}

test('durable list retains the requested owner handle without claiming current publication', async () => {
  await withDurableFixture(async ({ list, write }) => {
    const own = await write(fileForRoute('fixture-route'), durableRecord('fixture-route'));
    const other = await write(fileForRoute('other-fixture-route'), durableRecord('other-fixture-route', 'other-fixture-owner'));
    const { routes } = await list();
    assert.equal(routes.length, 1);
    assert.deepEqual(routes[0].handle, { kind: 'durable', id: 'fixture-route', generation: 3 });
    assert.equal(routes[0].published, null);
    assert.equal(routes[0].state, 'uncertain');
    assert.equal(routes[0].verification.status, 'unverified');
    assert.deepEqual(routes[0].verification.checks, []);
    assert.deepEqual(routes[0].verification.subject, durableRecord('fixture-route').verification.subject);
    for (const { file, bytes } of [own, other]) assert.deepEqual(await readFile(file), bytes);
  });
});

test('durable list refuses invalid recorded evidence without rewriting it', async t => {
  const name = fileForRoute('fixture-route');
  const cases = [
    ['schema version', { schemaVersion: 2 }, name],
    ['non-string route ID', { routeId: 12 }, name],
    ['empty route ID', { routeId: '' }, name],
    ['ownership', { ownership: 'external-owned' }, name],
    ['non-string owner', { owner: null }, name],
    ['empty owner', { owner: '' }, name],
    ['zero generation', { generation: 0 }, name],
    ['fractional generation', { generation: 1.5 }, name],
    ['unsafe generation', { generation: Number.MAX_SAFE_INTEGER + 1 }, name],
    ['filename identity', {}, fileForRoute('another-id')],
    ...['schemaVersion', 'routeId', 'owner', 'ownership', 'generation']
      .map(field => ['missing ' + field, { [field]: undefined }, name]),
    ['null record', null, name],
    ['non-object record', 42, name],
  ];
  for (const [label, changes, filename] of cases) {
    await t.test(label, async () => {
      await withDurableFixture(async ({ list, write }) => {
        const value = changes === null || typeof changes !== 'object'
          ? changes : { ...durableRecord('fixture-route'), ...changes };
        const { file, bytes } = await write(filename, value);
        await assert.rejects(list(), { code: 'provider_unavailable', message: 'The durable route record is unreadable' });
        assert.deepEqual(await readFile(file), bytes);
      });
    });
  }
});

test('one invalid durable record refuses the whole inventory without rewriting valid evidence', async () => {
  await withDurableFixture(async ({ list, write }) => {
    const valid = await write(fileForRoute('valid-route'), durableRecord('valid-route'));
    const invalid = await write(fileForRoute('invalid-route'), { ...durableRecord('invalid-route'), generation: 0 });
    await assert.rejects(list(), { code: 'provider_unavailable', message: 'The durable route record is unreadable' });
    for (const { file, bytes } of [valid, invalid]) assert.deepEqual(await readFile(file), bytes);
  });
});

test('durable list sanitizes malformed JSON at the public boundary', async () => {
  await withDurableFixture(async ({ list, write }) => {
    const { file, bytes } = await write(fileForRoute('fixture-route'), '{"fixture-private-marker":');
    await assert.rejects(list(), error => {
      assert.equal(error.code, 'internal_error');
      assert.equal(error.message, 'Unexpected Gozar fault');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.doesNotMatch(error.message, /fixture-private-marker|Unexpected end of JSON|JSON at position/i);
      assert.equal(error.message.includes(file), false);
      return true;
    });
    assert.deepEqual(await readFile(file), bytes);
  });
});
