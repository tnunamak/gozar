import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function example(t) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const doc = await readFile(new URL('../../docs/embedding-contract.md', import.meta.url), 'utf8');
  const match = doc.match(/<!-- public-consumer -->\s*```js\n([\s\S]*?)\n```/);
  assert.ok(match, 'public consumer example must be present');
  const dir = await mkdtemp(join(tmpdir(), 'gozar-guide-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'node_modules', '@tnunamak'), { recursive: true });
  await symlink(root, join(dir, 'node_modules', '@tnunamak', 'gozar'), 'dir');
  const path = join(dir, 'guide.mjs');
  await writeFile(path, match[1]);
  return import(pathToFileURL(path).href);
}
function fixture() {
  const calls = [];
  const candidate = { providerId: 'fixture-provider', eligible: true,
    setup: { state: 'ready' }, candidateToken: 'fixture-only-token',
    disclosure: { revision: 'r' }, consentFactsDigest: 'd',
    consent: { scope: { kind: 'route' }, consentFactsDigest: 'd',
      facts: [{ label: 'Unknown', known: false, reason: 'unobserved', affectsConsent: true }],
      disclosures: { reach: 'internet' } } };
  const view = { handle: { kind: 'attached', id: 'h', generation: 1 }, published: null,
    cleanup: { state: 'unconfirmed' } };
  const api = {
    catalogRoutes: async () => ({ candidates: [candidate] }),
    expose: async request => { calls.push(['expose', request]); return view; },
    ensureRoute: async request => { calls.push(['ensure', request]); return view; },
    closeRoute: async request => { calls.push(['close', request]); return view; },
    listRoutes: async request => { calls.push(['list', request]); return { routes: [view] }; },
  };
  const journal = {
    saveIntent: async value => { calls.push(['intent', value]); },
    saveHandle: async value => { calls.push(['handle', value]); },
  };
  const query = { schemaVersion: 1, home: '/fixture', owner: 'host', target: '127.0.0.1:1234',
    usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https',
      payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } };
  return { calls, api, journal, query, candidate, view };
}
test('public consumer snippet imports and journals exact consented intent before effects', async t => {
  const sample = await example(t), f = fixture();
  let card;
  await sample.openApproved({ ...f, operationId: 'op',
    choose: async rows => rows[0], confirm: async shown => { card = shown; return true; } });
  assert.deepEqual(card, f.candidate.consent);
  assert.ok(!JSON.stringify(card).includes('fixture-only-token'));
  assert.deepEqual(f.calls.map(row => row[0]), ['intent', 'expose', 'handle']);
  assert.equal(f.calls[0][1].query.owner, 'host');
  assert.equal(f.calls[1][1].operationId, 'op');
  assert.equal(f.calls[1][1].approval.kind, 'route');
  assert.equal(f.calls[1][1].approval.consentFactsDigest, 'd');
  assert.ok(!JSON.stringify(f.calls[0]).includes('fixture-only-token'));
});
test('declined consent and failed durable journal cause zero allocation', async t => {
  const sample = await example(t), f = fixture();
  assert.equal(await sample.openApproved({ ...f, operationId: 'op',
    choose: async rows => rows[0], confirm: async () => false }), null);
  assert.deepEqual(f.calls, []);
  f.journal.saveIntent = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(sample.openApproved({ ...f, operationId: 'op',
    choose: async rows => rows[0], confirm: async () => true }), /disk unavailable/);
  assert.deepEqual(f.calls, []);
});
test('error handles and unconfirmed cleanup remain recoverable without re-create', async t => {
  const sample = await example(t), f = fixture();
  f.api.expose = async () => { throw Object.assign(new Error('stopped'), { code: 'stopped_by_user', route: f.view }); };
  await assert.rejects(sample.openApproved({ ...f, operationId: 'op',
    choose: async rows => rows[0], confirm: async () => true }), /stopped/);
  assert.deepEqual(f.calls.map(row => row[0]), ['intent', 'handle']);
  const recovered = await sample.recover({ api: f.api, home: f.query.home, owner: f.query.owner });
  assert.equal(recovered.routes[0].published, null);
  await sample.closeRetained({ api: f.api, journal: f.journal, home: f.query.home, handle: f.view.handle });
  assert.equal(f.calls.at(-1)[1].cleanup.state, 'unconfirmed');
  assert.equal(f.calls.filter(row => row[0] === 'expose' || row[0] === 'ensure').length, 0);
});
