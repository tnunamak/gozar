import assert from 'node:assert/strict';
import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runSetupAction, storeSecret, withSecret } from '../../packages/gozar-node/route-setup.mjs';
import { catalogRoutes } from '../../packages/gozar-node/route-catalog.mjs';
import { action, assertShape, codeOf, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const readContext = { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
const approvalOf = a => ({ digest: a.digest, disclosureRevision: a.disclosure.revision });

/** An adapter whose one action moves it from action-required to ready, and records what ran. */
function loginAdapter(kind = 'gozar-runs', over = {}) {
  const log = { executed: [], secrets: [], configs: [] };
  const state = { value: 'action-required', action: action('login', kind, over) };
  const adapter = stubAdapter('needs-login', { actions: [state.action] });
  adapter.detect = async () => { adapter.calls.detect++; return { state: state.value, facts: {} }; };
  adapter.setupActions = () => (state.value === 'action-required' ? [state.action] : []);
  adapter.setup = async (ctx, actionId, secretHandle) => {
    adapter.calls.setup++;
    if (secretHandle) {
      await ctx.withSecret(secretHandle, async secret => { log.secrets.push(Buffer.from(secret).toString()); });
      log.configs.push(Buffer.from(await ctx.configuration(secretHandle)).toString());
    }
    const result = await ctx.executeApprovedAction(actionId);
    state.value = result.state === 'complete' ? 'ready' : state.value;
    return result;
  };
  return { adapter, state, log };
}
const base = (t, over = {}) => ({ platform: 'linux', readContext, ...over });
const run = (adapters, request, extra = {}) => runSetupAction(request, { adapters, platform: 'linux', readContext,
  executeApprovedAction: async id => { extra.ran?.push(id); return { state: 'complete', nextAction: null }; }, ...extra });

test('an approved gozar-runs action runs once through the adapter and returns a valid SetupActionResult', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter(), ran = [];
  const result = await run([adapter], { home, actionId: 'login', approval: approvalOf(state.action) }, { ran });
  assertShape('SetupActionResult', result);
  assert.equal(result.state, 'complete');
  assert.deepEqual(ran, ['login']);
  assert.equal(adapter.calls.setup, 1);
  assert.equal(state.value, 'ready');
});

test('red: setup denied — no approval means nothing runs and the error is consent_required', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter(), ran = [];
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login' }, { ran })), 'consent_required');
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: { digest: '', disclosureRevision: '' } }, { ran })), 'consent_required');
  assert.deepEqual(ran, []);
  assert.equal(adapter.calls.setup, 0);
  assert.equal(state.value, 'action-required');
});

test('red: setup drift — a changed digest or disclosure revision runs nothing and is candidate_stale', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter(), ran = [];
  const approved = approvalOf(state.action);
  state.action = { ...state.action, digest: 'sha256:login-2' };          // the action changed after the user approved it
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: approved }, { ran })), 'candidate_stale');
  state.action = { ...action('login'), disclosure: { revision: 'disc-login-2', text: 'New terms.', links: [] } };
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: approved }, { ran })), 'candidate_stale');
  assert.equal(await codeOf(run([adapter], { home, actionId: 'gone', approval: approved }, { ran })), 'candidate_stale');
  assert.deepEqual(ran, []);
  assert.equal(adapter.calls.setup, 0);
  assert.equal(state.value, 'action-required');
});

test('open-url and instructions actions are steps for the user: Gozar runs nothing and reports them pending', async t => {
  for (const kind of ['open-url', 'instructions']) {
    const home = await scratch(t), { adapter, state } = loginAdapter(kind, kind === 'open-url' ? { href: 'https://example.invalid/login' } : { instructions: 'Install it yourself.' }), ran = [];
    const result = await run([adapter], { home, actionId: 'login', approval: approvalOf(state.action) }, { ran });
    assertShape('SetupActionResult', result);
    assert.equal(result.state, 'pending');
    assert.equal(result.nextAction.id, 'login');
    assert.deepEqual(ran, []);
    assert.equal(adapter.calls.setup, 0);
  }
});

test('a provide-secret action reads the secret only through the approved handle, and the secret never appears in the result', async t => {
  const home = await scratch(t), { adapter, state, log } = loginAdapter('provide-secret');
  const { handle } = await storeSecret({ home, value: 'synthetic-secret-value-1' });
  assert.match(handle, /^sec_[0-9a-f]{32}$/);
  const result = await run([adapter], { home, actionId: 'login', approval: approvalOf(state.action), secretHandle: handle });
  assertShape('SetupActionResult', result);
  assert.deepEqual(log.secrets, ['synthetic-secret-value-1']);
  assert.deepEqual(log.configs, ['synthetic-secret-value-1']);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
  // The adapter may not reach any other handle.
  const other = await storeSecret({ home, value: 'synthetic-secret-value-2' });
  const peek = loginAdapter('provide-secret');
  peek.adapter.setup = async ctx => { await ctx.withSecret(other.handle, async () => {}); return { state: 'complete', nextAction: null }; };
  assert.equal(await codeOf(run([peek.adapter], { home, actionId: 'login', approval: approvalOf(peek.state.action), secretHandle: handle })), 'invalid_input');
});

test('a provide-secret action without a handle is invalid_input and runs nothing', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter('provide-secret');
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: approvalOf(state.action) })), 'invalid_input');
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: approvalOf(state.action), secretHandle: '/etc/passwd' })), 'invalid_input');
  assert.equal(adapter.calls.setup, 0);
});

test('secrets are stored 0600 in a 0700 private directory and a missing handle is setup_required', async t => {
  const home = await scratch(t);
  const { handle } = await storeSecret({ home, value: 'synthetic-secret-value-3' });
  const entries = await readdir(home, { recursive: true });
  const secretFile = entries.find(entry => entry.endsWith(handle));
  assert.ok(secretFile);
  assert.equal((await stat(join(home, secretFile))).mode & 0o777, 0o600);
  assert.equal((await stat(join(home, 'secrets'))).mode & 0o777, 0o700);
  assert.equal(await withSecret(home, handle, async secret => Buffer.from(secret).toString()), 'synthetic-secret-value-3');
  assert.equal(await codeOf(withSecret(home, `sec_${'0'.repeat(32)}`, async () => {})), 'setup_required');
  assert.equal(await codeOf(storeSecret({ home, value: '' })), 'invalid_input');
});

test('Gozar never runs an installer: with no approved-action runner wired the call is unsupported, and the adapter sees no other way to execute', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter();
  const code = await codeOf(runSetupAction({ home, actionId: 'login', approval: approvalOf(state.action) }, { adapters: [adapter], platform: 'linux', readContext }));
  assert.equal(code, 'unsupported');
});

test('the adapter can run only the one approved action id', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter();
  adapter.setup = async ctx => ctx.executeApprovedAction('some-other-action');
  assert.equal(await codeOf(run([adapter], { home, actionId: 'login', approval: approvalOf(state.action) })), 'invalid_input');
});

test('on macOS setup is unsupported and nothing runs', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter(), ran = [];
  assert.equal(await codeOf(runSetupAction({ home, actionId: 'login', approval: approvalOf(state.action) }, { adapters: [adapter], platform: 'darwin', readContext, executeApprovedAction: async id => { ran.push(id); } })), 'unsupported');
  assert.deepEqual(ran, []);
});

test('after setup completes the catalog offers a token for that adapter and its revision matches the setup result', async t => {
  const home = await scratch(t), { adapter, state } = loginAdapter(), tokens = tokenStubs();
  const ask = () => catalogRoutes(query({ home, requirements: { ...query().requirements, setup: 'allow' } }), { adapters: [adapter], platform: 'linux', readContext,
    preferenceRecord: { schemaVersion: 1, scope: 'user', revision: 0, adapterPreference: [], onUnavailable: 'ask' }, issue: tokens.issue, consentBinding: tokens.consentBinding, durablePlanFacts: async () => ({}) });
  const before = await ask();
  assert.equal(before.candidates[0].candidateToken, null);
  const result = await run([adapter], { home, actionId: 'login', approval: approvalOf(state.action) });
  const after = await ask();
  assert.equal(result.catalogRevision, after.catalogRevision);
  assert.notEqual(before.catalogRevision, after.catalogRevision);
  assert.match(after.candidates[0].candidateToken, /^tok_/);
});
