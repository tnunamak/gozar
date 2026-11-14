import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
// Corrupt persisted recovery state must not become an empty or actionable catalog.
// These are catalog regressions, not an allocation/provider integration fixture.
test('public durable enumeration refuses unreadable records without altering them', async t => {
  const cases = [
    ['invalid JSON', '{'],
    ['wrong schema', { schemaVersion: 2 }],
    ['external ownership in durable store', { ownership: 'external-owned' }],
    ['missing owner', { owner: null }],
    ['empty route ID', { routeId: '' }],
    ['invalid generation', { generation: 0 }],
    ['filename does not bind route ID', { routeId: 'another-route' }],
  ];
  for (const [name, overrides] of cases) await t.test(name, async () => {
    const home = await mkdtemp(join(tmpdir(), 'gozar-durable-recovery-'));
    try {
      const dir = join(home, 'routes');
      await mkdir(dir, { mode: 0o700 });
      const path = join(dir, hash('recoverable') + '.json');
      const record = {
        schemaVersion: 1, routeId: 'recoverable', generation: 1,
        owner: 'recovery-test', ownership: 'gozar-owned', state: 'releasing',
        cleanupDebt: { reason: 'adapter-unavailable', port: 443 },
        ...typeof overrides === 'object' ? overrides : {},
      };
      const bytes = typeof overrides === 'string' ? overrides : JSON.stringify(record);
      await writeFile(path, bytes, { mode: 0o600 });
      const api = createRouteApi();
      await assert.rejects(api.listRoutes({ home, owner: 'recovery-test' }));
      // Even filtering for another owner cannot conceal unreadable durable state.
      await assert.rejects(api.listRoutes({ home, owner: 'other-owner' }));
      assert.equal(await readFile(path, 'utf8'), bytes);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
