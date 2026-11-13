// ngrok attached runtime: the SDK is an injected stub; no network, no real token, no package install.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNgrokAdapter } from '../../adapters/providers/ngrok-https-edge/index.mjs';

const TOKEN = 'ngrok-stub-token-5d71c0aa';
const DOMAIN = 'reserved.example.ngrok.app';
const ORIGIN = `https://${DOMAIN}`;

/** A stub SDK that records every listener it opens and whether each was closed. */
function stubSdk({ url = ORIGIN, failForward = false, failClose = false, leakTokenInErrors = false } = {}) {
  const sdk = { opened: [], calls: [] };
  sdk.forward = async options => {
    sdk.calls.push(options);
    if (failForward) throw new Error(leakTokenInErrors ? `auth failed for ${options.authtoken}` : 'boom');
    const listener = { closed: false, url: () => url, close: async () => { if (failClose) throw new Error(`close failed ${options.authtoken}`); listener.closed = true; } };
    sdk.opened.push(listener);
    return listener;
  };
  sdk.open = () => sdk.opened.filter(listener => !listener.closed);
  return sdk;
}

const config = { auth: TOKEN, 'reserved-domain': DOMAIN };
const context = (extra = {}) => ({
  now: () => 0, platform: 'linux', generation: 1,
  configuration: async ref => (ref === 'ref-1' || ref === null ? config : null),
  probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified', checkedAt: '2026-01-01T00:00:00.000Z' }),
  assertGeneration: async () => {}, executePlan: async () => { throw new Error('the SDK runtime never uses executePlan'); }, compareAndRemove: async () => { throw new Error('unused'); },
  executeApprovedAction: async () => ({ state: 'complete', nextAction: null }),
  withSecret: async (handle, use) => use(new TextEncoder().encode(handle === 'domain-handle' ? DOMAIN : TOKEN)),
  ...extra,
});
const request = (extra = {}) => ({ target: '127.0.0.1:8123', origin: null, usage: { kind: 'attached' }, configurationRef: 'ref-1',
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'allow', protocols: [] }, ...extra });
const adapterWith = sdk => createNgrokAdapter({ loadSdk: async () => sdk });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code, `expected ${code}`);

/** Captures everything written to stdout/stderr and console while `run` executes. */
async function capture(run) {
  const chunks = [], originals = { out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return originals.out.call(process.stdout, '', ...rest.filter(item => typeof item === 'function')); };
  process.stderr.write = (chunk, ...rest) => { chunks.push(String(chunk)); return originals.err.call(process.stderr, '', ...rest.filter(item => typeof item === 'function')); };
  try { return { result: await run(), output: chunks.join('') }; } finally { process.stdout.write = originals.out; process.stderr.write = originals.err; }
}

test('attached create opens one SDK listener on the reserved domain; remove closes it', async () => {
  const sdk = stubSdk(), adapter = adapterWith(sdk), ctx = context();
  const plan = await adapter.plan(ctx, request());
  assert.equal(plan.origin, ORIGIN); assert.equal(plan.precondition, null);
  const receipt = await adapter.create(ctx, plan);
  assert.equal(sdk.open().length, 1);
  assert.deepEqual(sdk.calls[0], { addr: '127.0.0.1:8123', authtoken: TOKEN, domain: DOMAIN });
  assert.equal(receipt.identity.origin, ORIGIN); assert.equal(receipt.origin, ORIGIN); assert.equal(receipt.readback.target, '127.0.0.1:8123');
  const observed = await adapter.observe(ctx, request());
  assert.equal(observed.present, true); assert.equal(observed.revision, null);
  assert.equal((await adapter.verify(ctx, receipt)).status, 'verified');
  assert.deepEqual(await adapter.remove(ctx, receipt, observed), { removed: true, debt: null });
  assert.equal(sdk.open().length, 0);
  assert.equal((await adapter.observe(ctx, request())).present, false);
});

test('red: create without a context generation fails and opens nothing', async () => {
  const sdk = stubSdk(), adapter = adapterWith(sdk);
  const plan = await adapter.plan(context(), request());
  await rejects(adapter.create(context({ generation: undefined }), plan), 'provider_unavailable');
  assert.equal(sdk.opened.length, 0);
  await rejects(adapter.detect(context({ platform: undefined })), 'provider_unavailable');
});

test('other kinds are unsupported: the SDK runtime is attached only', async () => {
  const adapter = adapterWith(stubSdk());
  await rejects(adapter.plan(context(), request({ usage: { kind: 'session', lifetimeMs: 1000 } })), 'unsupported');
  await rejects(adapter.plan(context(), request({ usage: { kind: 'durable', routeId: 'r' } })), 'unsupported');
  await rejects(adapter.create(context(), { digest: 'd', origin: null, resourceKey: 'k', effects: [], readback: { kind: 'session' }, cleanup: null, precondition: null }), 'unsupported');
});

test('red: a different origin from the SDK fails closed and closes the listener', async () => {
  const sdk = stubSdk({ url: 'https://other.example.ngrok.app' }), adapter = adapterWith(sdk), ctx = context();
  const plan = await adapter.plan(ctx, request());
  await rejects(adapter.create(ctx, plan), 'provider_unavailable');
  assert.equal(sdk.opened.length, 1, 'the listener was opened');
  assert.equal(sdk.open().length, 0, 'and closed again');
  assert.equal((await adapter.observe(ctx, request())).present, false, 'nothing is recorded as open');
});

test('red: an unparseable SDK url also fails closed', async () => {
  const sdk = stubSdk({ url: 'not a url' });
  const adapter = adapterWith(sdk), ctx = context();
  await rejects(adapter.create(ctx, await adapter.plan(ctx, request())), 'provider_unavailable');
  assert.equal(sdk.open().length, 0);
});

test('a requested origin other than the reserved domain needs setup, not a guess', async () => {
  const adapter = adapterWith(stubSdk());
  await rejects(adapter.plan(context(), request({ origin: 'https://someone-else.example.com' })), 'setup_required');
  assert.equal((await adapter.plan(context(), request({ origin: ORIGIN }))).origin, ORIGIN);
});

test('red: denied setup gives setup_required, and a missing configuration blocks plan and create', async () => {
  const adapter = adapterWith(stubSdk());
  await rejects(adapter.setup(context({ withSecret: async () => { throw new Error(`denied ${TOKEN}`); } }), 'auth', 'secret-handle'), 'setup_required');
  await assert.rejects(adapter.setup(context({ withSecret: async () => { throw new Error(`denied ${TOKEN}`); } }), 'auth', 'secret-handle'), error => !error.message.includes(TOKEN));
  await rejects(adapter.plan(context({ configuration: async () => null }), request()), 'setup_required');
  await rejects(adapter.plan(context({ configuration: async () => { throw new Error('store locked'); } }), request()), 'setup_required');
  const plan = await adapter.plan(context(), request());
  await rejects(adapter.create(context({ configuration: async () => null }), plan), 'setup_required');
});

test('setup validates the stored value without keeping it', async () => {
  const adapter = adapterWith(stubSdk());
  assert.deepEqual(await adapter.setup(context(), 'auth', 'auth-handle'), { state: 'complete', nextAction: null });
  const blocked = await adapter.setup(context({ withSecret: async (handle, use) => use(new TextEncoder().encode('')) }), 'auth', 'h');
  assert.equal(blocked.state, 'blocked'); assert.equal(blocked.nextAction.id, 'auth');
  // The reserved domain is a provide-value action: Gozar checks and keeps it, so the adapter's own setup takes none.
  await rejects(adapter.setup(context(), 'reserved-domain', 'domain-handle'), 'unsupported');
  assert.equal((await adapter.setup(context(), 'auth')).state, 'pending', 'no handle yet: the action is still to be done');
  await rejects(adapter.setup(context(), 'no-such-action'), 'unsupported');
});

test('setup actions follow the facts: the token is a provide-secret action and the domain a provide-value action', async () => {
  const adapter = adapterWith(stubSdk());
  const fresh = await adapter.detect(context({ configuration: async () => null }));
  assert.equal(fresh.state, 'action-required');
  const actions = adapter.setupActions(fresh.facts);
  assert.deepEqual(actions.map(action => action.id), ['auth', 'reserved-domain']);
  const [auth, domain] = actions;
  assert.equal(auth.kind, 'provide-secret'); assert.ok(auth.secretLabel);
  assert.equal(domain.kind, 'provide-value'); assert.equal(domain.valueFormat, 'domain'); assert.equal(domain.required, true); assert.ok(domain.valueLabel);
  const ready = await adapter.detect(context());
  assert.equal(ready.state, 'ready'); assert.deepEqual(adapter.setupActions(ready.facts), []);
  const noSdk = await createNgrokAdapter({ loadSdk: async () => { throw new Error('not installed'); } }).detect(context());
  assert.equal(noSdk.state, 'action-required'); assert.equal(noSdk.facts.sdk, false);
});

test('red: a failed create leaves nothing behind', async () => {
  const sdk = stubSdk({ failForward: true }), adapter = adapterWith(sdk), ctx = context();
  await rejects(adapter.create(ctx, await adapter.plan(ctx, request())), 'provider_unavailable');
  assert.equal(sdk.open().length, 0);
  assert.equal((await adapter.observe(ctx, request())).present, false);
  const second = stubSdk(), retry = adapterWith(second);
  await retry.create(ctx, await retry.plan(ctx, request()));
  assert.equal(second.open().length, 1, 'the next create works');
});

test('a second create for the same domain is refused while one listener is open', async () => {
  const sdk = stubSdk(), adapter = adapterWith(sdk), ctx = context();
  const plan = await adapter.plan(ctx, request());
  await adapter.create(ctx, plan);
  await rejects(adapter.create(ctx, plan), 'provider_unavailable');
  assert.equal(sdk.open().length, 1);
});

test('a listener that will not close is reported as cleanup debt, not as removed', async () => {
  const sdk = stubSdk({ failClose: true }), adapter = adapterWith(sdk), ctx = context();
  const receipt = await adapter.create(ctx, await adapter.plan(ctx, request()));
  const removal = await adapter.remove(ctx, receipt, await adapter.observe(ctx, request()));
  assert.equal(removal.removed, false); assert.ok(removal.debt.message);
  assert.ok(!JSON.stringify(removal).includes(TOKEN));
});

test('red: the token appears nowhere: facts, plan, receipt, runtime facts, errors and output', async () => {
  const seen = [];
  const { output } = await capture(async () => {
    const sdk = stubSdk(), adapter = adapterWith(sdk), ctx = context();
    seen.push(await adapter.detect(ctx), await adapter.plan(ctx, request()), adapter.setupActions({ setupNeeded: true, sdk: true, configured: false }),
      await adapter.setup(ctx, 'auth', 'h'));
    const plan = await adapter.plan(ctx, request());
    const receipt = await adapter.create(ctx, plan);
    seen.push(receipt, await adapter.observe(ctx, request()), await adapter.verify(ctx, receipt), await adapter.runtimeFacts(ctx, receipt), adapter.properties({}), adapter.definition);
    seen.push(await adapter.remove(ctx, receipt, await adapter.observe(ctx, request())));
    // Every failure path, with an SDK that tries to put the token in its error text.
    for (const failing of [stubSdk({ failForward: true, leakTokenInErrors: true }), stubSdk({ url: 'https://other.example.ngrok.app' })]) {
      const other = adapterWith(failing);
      try { await other.create(ctx, await other.plan(ctx, request())); } catch (error) { seen.push({ code: error.code, message: error.message, stack: error.stack, own: Object.entries(error) }); }
    }
    try { await adapter.setup(context({ withSecret: async () => { throw new Error(TOKEN); } }), 'auth', 'h'); } catch (error) { seen.push({ code: error.code, message: error.message, stack: error.stack, own: Object.entries(error) }); }
  });
  for (const value of seen) assert.ok(!JSON.stringify(value).includes(TOKEN), `leak in ${JSON.stringify(value).slice(0, 80)}`);
  assert.ok(!output.includes(TOKEN));
});

test('win32: detect reports unsupported without loading the SDK', async () => {
  let loaded = false;
  const adapter = createNgrokAdapter({ loadSdk: async () => { loaded = true; return stubSdk(); } });
  const mac = await adapter.detect(context({ platform: 'win32' }));
  assert.equal(mac.state, 'unsupported'); assert.equal(loaded, false);
  await rejects(adapter.plan(context({ platform: 'win32' }), request()), 'unsupported');
});

test('the default adapter needs the optional SDK: without it detect asks for installation', async () => {
  const { default: adapter } = await import('../../adapters/providers/ngrok-https-edge/index.mjs');
  const detected = await adapter.detect(context());
  assert.ok(['ready', 'action-required'].includes(detected.state));
  if (!detected.facts.sdk) assert.ok(adapter.setupActions(detected.facts).some(action => action.id === 'install-sdk'));
});

test('macOS: the SDK adapter is not turned away by the platform check (its SDK ships darwin builds)', async () => {
  let loaded = false;
  const adapter = createNgrokAdapter({ loadSdk: async () => { loaded = true; return stubSdk(); } });
  const mac = await adapter.detect(context({ platform: 'darwin' }));
  assert.notEqual(mac.state, 'unsupported');
  assert.equal(loaded, true);
});

test('macOS: the SDK adapter is not turned away by the platform check (its SDK ships darwin builds)', async () => {
  let loaded = false;
  const adapter = createNgrokAdapter({ loadSdk: async () => { loaded = true; return stubSdk(); } });
  const mac = await adapter.detect(context({ platform: 'darwin' }));
  assert.notEqual(mac.state, 'unsupported');
  assert.equal(loaded, true);
});
