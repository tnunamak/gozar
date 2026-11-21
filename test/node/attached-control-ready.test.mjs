// Ordering contract: the authenticated controller channel (control.json) is published and the controller can be
// found by a caller BEFORE the first provider effect runs and before any startup failure can be exposed.
// The old creation IIFE started before control.json existed (diagnosis: attached-route-startup-diagnosis-1120),
// so a fast failing provider could expose failure.json while the controller was not yet reachable.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { closeAttachedRoute, openAttachedRoute } from '../../packages/gozar-node/attached-route.mjs';
import { attachedScratch, query, scratch, tokenStubs } from './route-schema-check.mjs';

const helperUrl = pathToFileURL(new URL('./route-schema-check.mjs', import.meta.url).pathname).href;
const readContext = { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };

// The controller delays the control.json rename so that the creation path certainly runs inside the window.
async function delayedControlFixture(t, { failCreate }) {
  const dir = await scratch(t), marks = join(dir, 'marks.log'), module = join(dir, 'controller.mjs');
  await writeFile(module, `import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stubAdapter } from ${JSON.stringify(helperUrl)};
const mark = event => appendFileSync(${JSON.stringify(marks)}, event + '\\n');
const rename = fsp.rename;
fsp.rename = async (from, to) => {
  if (String(to).endsWith('control.json')) await new Promise(resolve => setTimeout(resolve, 600));
  return rename(from, to);
};
syncBuiltinESMExports();
export default async function () {
  const directory = process.argv[3];
  const file = join(directory, 'bootstrap.json'), bootstrap = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...bootstrap, identity: { instanceId: 'fixture-instance', bootId: randomUUID() } }));
  const adapter = stubAdapter('stub-a');
  const { create, remove } = adapter;
  adapter.create = async (...args) => {
    mark('create:control-present=' + existsSync(join(directory, 'control.json')));
    if (${JSON.stringify(failCreate)}) { const error = new Error('provider refused'); error.code = 'provider_unavailable'; throw error; }
    return create(...args);
  };
  adapter.remove = async (...args) => { mark('removed'); return remove(...args); };
  return { adapters: [adapter], effectContext: () => ({}), validation: 'none',
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } };
}
`);
  const read = async () => { try { return (await readFile(marks, 'utf8')).split('\n').filter(Boolean); } catch { return []; } };
  return { module, read };
}
const attachedQuery = home => query({ home, usage: { kind: 'attached' } });
async function approved(tokens, home) {
  const q = attachedQuery(home);
  const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-a'), grant: { adapterId: 'stub-a', planDigest: `plan-stub-a-${q.target}`, observedResource: 'res-stub-a' } });
  return { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-a' }, wait: 'verified' };
}
const depsFor = (tokens, controllerModule) => ({ adapters: [], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext,
  controllerModule, leaseExpiryMs: 5000, heartbeatMs: 200, startTimeoutMs: 30_000 });

test('the first provider effect runs only after the authenticated control channel is published', async t => {
  const home = await attachedScratch(t), fixture = await delayedControlFixture(t, { failCreate: false }), tokens = tokenStubs();
  const { stubAdapter } = await import('./route-schema-check.mjs');
  const view = await openAttachedRoute(await approved(tokens, home), { ...depsFor(tokens, fixture.module), adapters: [stubAdapter('stub-a')] });
  assert.equal(view.state, 'usable');
  assert.deepEqual((await fixture.read()).slice(0, 1), ['create:control-present=true'], 'create observed the control channel already published');
  await closeAttachedRoute({ home, handle: view.handle });
});

test('a startup failure is never exposed while the control channel is still absent', async t => {
  const home = await attachedScratch(t), fixture = await delayedControlFixture(t, { failCreate: true }), tokens = tokenStubs();
  const { stubAdapter } = await import('./route-schema-check.mjs');
  const root = join(home, 'attached');
  const opening = openAttachedRoute(await approved(tokens, home), { ...depsFor(tokens, fixture.module), adapters: [stubAdapter('stub-a')] }).catch(error => error);
  // Watch the directory while the open settles: whenever failure.json is visible, control.json must be too.
  const violations = [];
  let settled = false;
  opening.finally(() => { settled = true; });
  while (!settled) {
    for (const id of await readdir(root).catch(() => [])) {
      const names = await readdir(join(root, id)).catch(() => []);
      if (names.includes('failure.json') && !names.includes('control.json')) violations.push(names.join(','));
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const outcome = await opening;
  assert.equal(outcome.code, 'provider_unavailable');
  assert.deepEqual(violations, [], 'failure.json appeared without control.json');
  assert.deepEqual((await fixture.read()).slice(0, 1), ['create:control-present=true']);
});
