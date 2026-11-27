import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// The README example is extracted verbatim and run against a recording stand-in for the package.
// It checks the example's own control flow (recovery order), not the real route runtime.
const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

test('the exact earlier-setup guide requires an approved inventory selection', async () => {
  const doc = await readFile(new URL('../../docs/embedding-contract.md', import.meta.url), 'utf8');
  const fenced = doc.split('<!-- earlier-setup-recovery-example -->')[1]?.match(/\x60\x60\x60js\n([\s\S]*?)\n\x60\x60\x60/);
  assert.ok(fenced, 'missing runnable recovery fence');
  const { recoverEarlierSetup } = await import('data:text/javascript;base64,' + Buffer.from(fenced[1]).toString('base64'));
  const scope = { home: '/fixture', owner: 'fixture-owner', providerId: 'fixture-provider' };
  const exact = { providerId: scope.providerId, fromRegistryId: 'earlier-a', draftId: 'draft-a' };
  const flat = { revision: 'next', scopeId: 'stable', values: {}, actions: [] };
  const candidate = { fromRegistryId: 'earlier-a', draftIds: ['draft-a'], setupOperationIds: ['op-a'], uses: 0 };
  const refused = { known: false, migration: { reason: 'inflight', candidates: [candidate] } };

  for (const variant of ['approve', 'decline', 'wrong-draft', 'wrong-registry', 'wrong-provider', 'flat', 'unaddressable']) {
    const calls = [];
    const seen = [];
    const configuration = variant === 'flat' ? flat : variant === 'unaddressable' ? {
      known: false,
      migration: { candidates: [{ ...candidate, unaddressableSetupOperations: 2 }],
        recovery: { available: false, reason: 'unaddressable_setup_operations' } },
    } : refused;
    const api = {
      async listProviders(input) {
        assert.deepEqual(input, { home: scope.home, owner: scope.owner });
        calls.push('read');
        return { providers: [{ providerId: scope.providerId, configuration: calls.includes('discard') ? flat : configuration }] };
      },
      async discardEarlierConfigurationDraft(input) {
        assert.deepEqual(input, { ...scope, ...exact });
        calls.push('discard');
        return { discarded: true };
      },
    };
    const result = await recoverEarlierSetup(api, scope, {
      show(view) { calls.push('show'); seen.push(view); },
      async selectDraft(view) {
        calls.push('select');
        assert.equal(view.providerId, scope.providerId);
        assert.deepEqual(view.candidates[0], { ...candidate, unaddressableSetupOperations: 0 });
        if (variant === 'wrong-draft') return { ...exact, draftId: 'different' };
        if (variant === 'wrong-registry') return { ...exact, fromRegistryId: 'different' };
        if (variant === 'wrong-provider') return { ...exact, providerId: 'different' };
        return exact;
      },
      async approveDiscard(input) {
        assert.deepEqual(input, exact);
        calls.push('approve');
        return variant === 'approve';
      },
    });
    if (variant === 'approve') {
      assert.deepEqual(calls, ['read', 'select', 'approve', 'discard', 'read']);
      assert.deepEqual(result, { state: 'reread', discarded: true, configuration: flat });
    } else if (variant === 'decline') {
      assert.deepEqual(calls, ['read', 'select', 'approve']);
      assert.deepEqual(result, { state: 'declined' });
    } else if (variant.startsWith('wrong-')) {
      assert.deepEqual(calls, ['read', 'select']);
      assert.deepEqual(result, { state: 'selection_mismatch' });
    } else if (variant === 'flat') {
      assert.deepEqual(calls, ['read']);
      assert.deepEqual(result, { state: 'configured_view', configuration: flat });
    } else {
      assert.deepEqual(calls, ['read', 'show']);
      assert.deepEqual(result, { state: 'no_supported_action' });
      assert.deepEqual(seen, [{ state: 'needs_attention', reason: 'unaddressable_setup_operations',
        candidates: [{ ...candidate, unaddressableSetupOperations: 2 }] }]);
    }
  }
});

const marker = "import { catalogRoutes, expose, listRoutes, watchRoutes, closeRoute }";
const start = readme.lastIndexOf('```js\n', readme.indexOf(marker)) + 6;
const snippet = readme.slice(start, readme.indexOf('\n```', start));

const fakePackage = `
import {appendFileSync} from 'node:fs';
const log = (name, arg) => appendFileSync(process.env.FAKE_LOG, JSON.stringify({name, arg}) + '\\n');
export const catalogRoutes = async query => { log('catalogRoutes', query.owner);
  if (process.env.FAKE_CATALOG === 'fail') throw new Error('catalog down');
  if (process.env.FAKE_CATALOG === 'ready') return {candidates: [{
    eligible: true, candidateToken: 'synthetic-candidate', consentFactsDigest: 'synthetic-facts',
    disclosure: {text: 'Synthetic disclosure', revision: 'synthetic-revision'},
    consent: {disclosures: {traffic: 'synthetic disclosure'}, facts: []}, ignored: 'not approval',
  }]};
  return {candidates: [], noMatch: {code: 'no_candidates'}}; };
export const listRoutes = async arg => { log('listRoutes', arg.owner);
  if (process.env.FAKE_LIST === 'fail') throw new Error('list failed');
  const state = process.env.FAKE_LIST === 'confirmed' ? 'confirmed' : 'pending';
  return {routes: [{operationId: process.env.FAKE_OPERATION_ID, handle: 'h-1', cleanup: {state}, published: 'https://old.example'}]}; };
export const expose = async arg => { log('expose', arg);
  if (process.env.FAKE_CATALOG !== 'ready') throw new Error('expose must not run on recovery');
  return {handle: 'fresh-handle', published: 'https://fresh.example.invalid'}; };
export const watchRoutes = async function* () {};
export const closeRoute = async arg => { log('closeRoute', arg); return {cleanup: {state: 'confirmed'}}; };
`;

async function seedHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'readme-recovery-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const pkg = join(home, 'node_modules', '@tnunamak', 'gozar');
  await mkdir(pkg, {recursive: true});
  await writeFile(join(pkg, 'package.json'), JSON.stringify({name: '@tnunamak/gozar', type: 'module', exports: './index.mjs'}));
  await writeFile(join(pkg, 'index.mjs'), fakePackage);
  await writeFile(join(home, 'route-example.mjs'), snippet);
  return home;
}
// Runs the extracted example once in `home`; the app intent file under home persists between runs.
async function exec(home, env, operationId = '', approval = 'y') {
  const log = join(home, 'calls.jsonl');
  await writeFile(log, '');
  const child = spawn(process.execPath, [join(home, 'route-example.mjs')], {
    cwd: home, stdio: ['pipe', 'pipe', 'pipe'], timeout: 8_000,
    env: {PATH: process.env.PATH, HOME: home, GOZAR_HOME: join(home, 'state'), FAKE_LOG: log, FAKE_OPERATION_ID: operationId, ...env},
  });
  let out = '', err = '';
  let approved = false, closing = false;
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') err += error.message; });
  child.stdout.on('data', d => {
    out += d;
    if (!approved && /(?:Create this route|Inspect and close this recovered route)\? \[y\/N\] /.test(out)) {
      approved = true;
      child.stdin.write(approval + '\n');
    }
    if (!closing && out.includes('Press Enter to close the route ')) {
      closing = true;
      child.stdin.end('\n');
    }
  });
  child.stderr.on('data', d => { err += d; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  return {code, out, err, calls, names: calls.map(c => c.name)};
}
// First run: new allocation. The catalog finds nothing, but the intent and operation ID are saved first.
async function firstRun(t) {
  const home = await seedHome(t);
  const first = await exec(home, {});
  assert.notEqual(first.code, 0);
  assert.deepEqual(first.names, ['catalogRoutes']);
  const saved = JSON.parse(await readFile(join(home, '.gozar-route-example', 'demo-route.json'), 'utf8'));
  return {home, operationId: saved.operationId};
}

test('README recovery closes a retained route without the catalog, approval or expose, even when the catalog is down', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'pending'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes', 'closeRoute']);
  assert.equal(second.calls[1].arg.handle, 'h-1');
  assert.equal(second.calls[1].arg.mode, 'remove');
  assert.match(second.out, /Not currently published/); // historical publication is suppressed
  assert.doesNotMatch(second.out, /old\.example/);
});
test('a confirmed terminal operation ends with no catalog, no close and no expose', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'confirmed'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes']);
  assert.match(second.out, /already closed/);
});
test('a failed listing refuses the restart: no catalog, no expose, no close', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_LIST: 'fail'}, operationId);
  assert.notEqual(second.code, 0);
  assert.match(second.err, /list failed/);
  assert.deepEqual(second.names, ['listRoutes']);
});

test('README fresh approval sends only the exact approved request and closes its own handle', async t => {
  const home = await seedHome(t);
  const result = await exec(home, {FAKE_CATALOG: 'ready'});
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Create this route\? \[y\/N\]/);
  const saved = JSON.parse(await readFile(join(home, '.gozar-route-example', 'demo-route.json'), 'utf8'));
  assert.deepEqual(result.names, ['catalogRoutes', 'expose', 'closeRoute']);
  assert.deepEqual(result.calls[1].arg, {
    schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:18765', home: join(home, 'state'),
    usage: {kind: 'session', lifetimeMs: 900_000},
    requirements: {reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: []},
    operationId: saved.operationId, wait: 'verified',
    approval: {kind: 'route', candidateToken: 'synthetic-candidate', consentFactsDigest: 'synthetic-facts', disclosureRevision: 'synthetic-revision'},
  });
  assert.deepEqual(result.calls[2].arg, {home: join(home, 'state'), handle: 'fresh-handle', mode: 'remove'});
});

test('README explicit negative leaves the fresh allocation untouched', async t => {
  const home = await seedHome(t);
  const result = await exec(home, {FAKE_CATALOG: 'ready'}, '', 'n');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Create this route\? \[y\/N\]/);
  assert.deepEqual(result.names, ['catalogRoutes']);
});

test('README catalog failure retains the staged intent and never prompts or allocates', async t => {
  const home = await seedHome(t);
  const result = await exec(home, {FAKE_CATALOG: 'fail'});
  assert.notEqual(result.code, 0);
  assert.match(result.err, /catalog down/);
  assert.doesNotMatch(result.out, /Create this route/);
  assert.deepEqual(result.names, ['catalogRoutes']);
  const saved = JSON.parse(await readFile(join(home, '.gozar-route-example', 'demo-route.json'), 'utf8'));
  assert.match(saved.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(saved.intent).owner, 'example-app');
});

test('embedding guide durably journals exact intent and closes only its retained handle', async t => {
  const home = await seedHome(t);
  const guide = await readFile(new URL('../../docs/embedding-contract.md', import.meta.url), 'utf8');
  const block = guide.match(/<!-- gozar-public-host-example -->\n```js\n([\s\S]+?)\n```/);
  assert.ok(block, 'the canonical example remains extractable');
  await writeFile(join(home, 'host-route-example.mjs'), block[1]);
  await writeFile(join(home, 'node_modules', '@tnunamak', 'gozar', 'index.mjs'),
    'export const createGozar = ({ api, acknowledgeOrigin }) => ({ ...api, acknowledgeOrigin });');
  const { createHost, openApproved, recoverAndClose } =
    await import(pathToFileURL(join(home, 'host-route-example.mjs')).href);

  const operationId = 'synthetic-operation', owner = 'synthetic-owner';
  const target = 'http://127.0.0.1:8080', usage = { kind: 'attached' };
  const requirements = { reach: 'public', transport: 'https', payloadAccess: 'allow-provider',
    address: 'any', setup: 'none', protocols: [] };
  const query = { schemaVersion: 1, home, owner, target, usage, requirements };
  const handle = { kind: 'attached', id: 'owned-fixture', generation: 2 };
  const candidate = { eligible: true, providerId: 'fixture-provider', setup: { state: 'ready' },
    consent: { consentFactsDigest: 'fixture-digest', facts: [], disclosures: {} },
    consentFactsDigest: 'fixture-digest', candidateToken: 'synthetic-bearer',
    disclosure: { revision: 'fixture-revision' } };
  const calls = [];
  const journal = {
    async saveIntent(value) { await writeFile(join(home, 'intent.json'), JSON.stringify(value)); calls.push('intent'); },
    async saveHandle(id, value) {
      assert.equal(id, operationId);
      await writeFile(join(home, 'handle.json'), JSON.stringify(value));
      calls.push('handle');
    },
  };
  let retained = { operationId, handle, rawProviderSecret: 'synthetic-secret' };
  const api = createHost({api: {
    async catalogRoutes(args) { assert.deepEqual(args, query); calls.push('catalog'); return { candidates: [candidate] }; },
    async expose(args) {
      calls.push('expose');
      assert.deepEqual(JSON.parse(await readFile(join(home, 'intent.json'), 'utf8')),
        { home, owner, operationId, query, providerId: candidate.providerId });
      assert.deepEqual(args, { ...query, operationId, wait: 'verified', approval: { kind: 'route',
        candidateToken: candidate.candidateToken, consentFactsDigest: 'fixture-digest',
        disclosureRevision: 'fixture-revision' } });
      const origin = 'https://example.invalid', attemptId = 'only-attempt';
      const reply = await api.acknowledgeOrigin({ home, owner, handle, origin, attemptId });
      assert.deepEqual(reply, { acknowledged: true, origin, handle: { id: handle.id, generation: 2 }, attemptId });
      return retained;
    },
    async listRoutes(args) {
      assert.deepEqual(args, {home, owner});
      calls.push('list');
      return { routes: [{ operationId: 'another-operation', handle: { ...handle, id: 'other' } }, retained] };
    },
    async closeRoute(args) {
      assert.deepEqual(args, { home, handle, mode: 'remove' });
      calls.push('close');
      return { cleanup: {state: 'confirmed'} };
    },
  }}, async request => {
    assert.equal(request.origin, 'https://example.invalid');
    assert.deepEqual(request.handle, handle);
    calls.push('ack');
    return true;
  });
  await openApproved({ api, home, owner, target, usage, requirements, operationId,
    choose: candidates => candidates[0], confirm: consent => { assert.deepEqual(consent, candidate.consent); return true; },
    journal });
  const intentText = await readFile(join(home, 'intent.json'), 'utf8');
  const handleText = await readFile(join(home, 'handle.json'), 'utf8');
  assert.doesNotMatch(intentText + handleText, /synthetic-bearer|synthetic-secret/);
  assert.deepEqual(JSON.parse(handleText), handle);
  const args = { api, intent: JSON.parse(intentText), savedHandle: JSON.parse(handleText), journal };
  retained = { ...retained, handle: { ...handle, generation: 3 } };
  await assert.rejects(recoverAndClose(args), /exact retained route/);
  retained = { ...retained, handle };
  assert.equal((await recoverAndClose(args)).cleanup.state, 'confirmed');
  assert.deepEqual(calls, ['catalog', 'intent', 'expose', 'ack', 'handle', 'list', 'list', 'handle', 'close']);
});
