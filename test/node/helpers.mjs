import { after } from 'node:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Journal } from '../../packages/gozar-node/journal.mjs';
import { EffectDriver } from '../../packages/gozar-node/driver.mjs';

const directories = new Set();
after(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

export async function fixture(t, recipes, options = {}) {
  // The OS temp directory is root-owned and sticky (Linux) or private to the user (macOS), so it passes Gozar's
  // unsafe-parent check on any host; a group-writable ~/.cache would not.
  const base = process.env.GOZAR_TEST_TMPDIR ?? tmpdir(); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gozar-node-'));
  directories.add(directory);
  const journal = new Journal(directory); await journal.load();
  const adapter = { id: 'fake', audience: 'local', ownership: 'owned', capabilities: { https: false }, recipes };
  const driver = new EffectDriver({ adapters: [adapter], journal, sessionId: 'test', targetPort: 8123, ...options });
  driver.authorize('fake');
  t.after(async () => { await driver.closeLocal(); });
  return { directory, journal, adapter, driver };
}
export function effect(recipe, operation = 'detect', id = 'test:1:1', extra = {}) {
  const { parser, ...fields } = recipe;
  return { ...fields, id, sessionId: 'test', generation: 1, operation, adapterId: 'fake', resourceId: null, ...extra };
}
export async function persist(driver, operation = 'create', resourceId = null, generation = 1) {
  return driver.execute({ kind: 'persist', operation, id: `test:${generation}:persist:${operation}:${resourceId}`, sessionId: 'test', generation,
    adapterId: 'fake', resourceId, record: { operation, adapterId: 'fake', resourceId, sessionId: 'test', generation } });
}
