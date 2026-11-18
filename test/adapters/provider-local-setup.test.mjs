import assert from 'node:assert/strict';
import { test } from 'node:test';
import lan from '../../adapters/providers/lan/index.mjs';
import localhost from '../../adapters/providers/localhost-run/index.mjs';
import ownAddress from '../../adapters/providers/own-address/index.mjs';
import tunnl from '../../adapters/providers/tunnl-gg/index.mjs';

const target = '127.0.0.1:45670';
const gateTarget = '127.0.0.1:45541';
const inventory = {
  en0: [{ address: '192.168.50.8', internal: false }],
  en1: [{ address: '192.168.60.8', internal: false }],
  lo: [{ address: '127.0.0.1', internal: true }],
};
const at = '2026-11-17T21:30:00.000Z';
const operation = { id: 'setup-fixture', cancelled: false, resources: [] };
const observed = value => ({ known: true, value });
const routeView = (origin, fields = {}) => ({
  state: 'unverified',
  handle: { id: 'route-fixture', kind: 'session', generation: 1 },
  hostConfiguration: { target: observed(target), bindTarget: observed(gateTarget) },
  cleanup: { state: 'none' },
  published: null,
  origin,
  ...fields,
});
const context = ({ values = {}, interfaces = inventory, detected = true, keygen = detected, route, localPort } = {}) => ({
  platform: 'linux',
  now: () => Date.parse(at),
  probe: async recipe => ({ ok: recipe.program === 'ssh-keygen' ? keygen : detected }),
  configuration: async () => values,
  observeInterfaces: async () => ({ interfaces }),
  route,
  target,
  localPort,
});

for (const adapter of [localhost, tunnl]) {
  test(`${adapter.id} detects missing OpenSSH and offers a truthful approved dependency step`, async () => {
    const ctx = context({ detected: false });
    const { facts } = await adapter.detect(ctx);
    const [action] = adapter.setupActions(facts);
    assert.equal(action.id, 'ssh-install');
    assert.equal(action.step.actor, 'administrator');
    assert.match(action.instructions, /approve/i);
    assert.match(action.instructions, /OpenSSH/);
    assert.equal((await adapter.observeSetup(ctx, operation)).state, 'blocked');
    const observed = await adapter.observeSetup(context(), operation);
    assert.equal(observed.state, 'complete');
    assert.deepEqual(observed.evidence, {
      operationId: operation.id, stepId: 'ssh-install', observedAt: at, source: 'host', summary: observed.evidence.summary,
    });
    assert.match(observed.evidence.summary, /OpenSSH/);
  });

  test(`${adapter.id} presents first-use trust, exposure and exact cleanup in route guidance`, async () => {
    const ctx = context({ route: routeView(`https://sample.${adapter === localhost ? 'lhr.life' : 'tunnl.gg'}`) });
    const result = await adapter.observeSetup(ctx, operation);
    assert.equal(result.state, 'pending');
    assert.equal(result.nextAction.step.actor, 'trusted-client');
    assert.match(result.nextAction.instructions, /exact.*address/i);
    assert.match(result.nextAction.instructions, /actual.*app/i);
    assert.match(result.nextAction.instructions, /stop/i);
    if (adapter === tunnl) assert.match(result.nextAction.instructions, /warning/i);
    assert.equal(result.evidence.known, false);
    const { facts } = await adapter.detect(context());
    const start = adapter.setupActions({ ...facts, setupNeeded: true })[0];
    assert.match(start.instructions, /accept-new/);
    assert.match(start.instructions, /changed.*refus/i);
    assert.match(start.disclosure.text, /can read payloads/);
  });
}

test('tunnl.gg requires its key generator and never exposes key or raw SSH diagnostics', async () => {
  const ctx = context({ keygen: false });
  const prerequisites = await tunnl.observeSetup(ctx, operation);
  assert.equal(prerequisites.state, 'blocked');
  assert.match(prerequisites.nextAction.instructions, /ssh-keygen/);
  const secret = 'ssh-output-canary';
  const route = routeView(null, { state: 'uncertain', cleanup: { state: 'unconfirmed', message: secret } });
  const result = await tunnl.observeSetup(context({ route }), { ...operation, cancelled: true });
  assert.equal(result.state, 'reconciling');
  assert.equal(result.evidence.known, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.equal(result.nextAction.step.purpose, 'reconcile');
});

test('reconnect requires public proof for the exact target and current generation', async () => {
  const origin = 'https://sample.lhr.life';
  const proof = {
    status: 'verified', vantage: 'public', observedAt: at, checks: ['tls', 'nonce'],
    subject: { origin, target: gateTarget, handleGeneration: 1 },
  };
  const route = routeView(origin, { state: 'usable', published: origin, verification: proof });
  const observe = route => localhost.observeSetup(context({ route }), operation);
  assert.equal((await observe(route)).evidence.known, false, 'an unrelated target cannot verify the route');
  proof.subject.target = target;
  assert.equal((await observe(route)).state, 'complete');
  assert.equal((await observe({ ...route, handle: { ...route.handle, generation: 2 } })).state, 'pending');
  const stopped = await observe({ ...route, state: 'released', cleanup: { state: 'confirmed' } });
  assert.equal(stopped.evidence.known, false, 'confirmed local process stop is not provider retirement evidence');
});

test('LAN lists current interfaces and refuses a stale offered option before configuration', async () => {
  const seen = await lan.observeSetup(context(), operation);
  assert.equal(seen.nextAction.id, 'interface');
  assert.deepEqual(seen.nextAction.step.options.map(row => row.label), [
    'en0 (192.168.50.8)', 'en1 (192.168.60.8)',
  ]);
  assert.equal(seen.nextAction.step.options[0].value, '192.168.50.8');
  await assert.rejects(lan.executeSetup(context({ interfaces: { en1: inventory.en1 } }), {
    action: seen.nextAction, value: seen.nextAction.step.options[0].value,
  }), { code: 'candidate_stale' });
  const changed = await lan.observeSetup(context({
    values: { interface: '192.168.50.8', firewall: '192.168.50.8' }, interfaces: { en1: inventory.en1 },
  }), operation);
  assert.equal(changed.state, 'blocked');
  assert.match(changed.nextAction.help, /no longer observed/);
});

test('LAN separates exact firewall permission from independent client verification', async () => {
  const values = { interface: '192.168.50.8' };
  const before = await lan.observeSetup(context({ values, localPort: 45444 }), operation);
  assert.equal(before.nextAction.id, 'firewall');
  assert.match(before.nextAction.help, /192\.168\.50\.8/);
  assert.match(before.nextAction.help, /TCP port 45444/);
  const configured = { ...values, firewall: values.interface };
  const route = routeView('http://192.168.50.8:45444', {
    verification: { status: 'verified', vantage: 'this-device', checks: ['nonce'] },
  });
  const client = await lan.observeSetup(context({ values: configured, route }), operation);
  assert.equal(client.state, 'pending');
  assert.equal(client.nextAction.step.verification, 'trusted-client');
  assert.equal(client.evidence.known, false);
  assert.match(client.nextAction.instructions, /http:\/\/192\.168\.50\.8:45444/);
  const guidance = await lan.routeGuidance(context({ values: configured, route: { ...route, operationId: operation.id } }));
  assert.equal(guidance.id, 'verify-lan');
  assert.match(guidance.instructions, /http:\/\/192\.168\.50\.8:45444/);
  const admin = await lan.observeSetup(context({ values: configured, route: { ...route, state: 'lost' } }), operation);
  assert.equal(admin.state, 'blocked');
  assert.equal(admin.nextAction.step.actor, 'administrator');
  assert.match(admin.nextAction.instructions, /TCP port 45444/);
  assert.doesNotMatch(admin.nextAction.instructions, /disable (?:the |your )?firewall/i);
});

test('own-address completes configured setup, then waits for exact route mapping and proof', async () => {
  const origin = 'https://owner.example';
  assert.equal((await ownAddress.observeSetup(context(), operation)).nextAction.id, 'origin');
  const values = { origin };
  const configured = await ownAddress.observeSetup(context({ values }), operation);
  assert.equal(configured.state, 'complete');
  assert.equal(configured.evidence.source, 'host');
  assert.equal(configured.evidence.stepId, 'origin');
  assert.equal(configured.nextAction.kind, 'instructions');
  assert.match(configured.nextAction.instructions, /DNS.*TLS|TLS.*DNS/);
  const mapping = await ownAddress.observeSetup(context({
    values, route: routeView(origin, { verification: { status: 'verified', vantage: 'this-device', checks: ['tls', 'nonce'] } }),
  }), operation);
  assert.equal(mapping.state, 'pending');
  assert.equal(mapping.evidence.known, false);
  assert.match(mapping.nextAction.instructions, /127\.0\.0\.1:45541/);
  assert.doesNotMatch(mapping.nextAction.instructions, /45670/);
  assert.match(mapping.nextAction.instructions, /retains? .*DNS.*certificate.*proxy.*router/i);
  assert.deepEqual(mapping.observations ?? [], []);
  const cancelled = await ownAddress.observeSetup(context({ values }), { ...operation, cancelled: true });
  assert.equal(cancelled.state, 'cancelled');
});

test('own-address refuses unsafe configuration without echoing a credential canary', async () => {
  const canary = 'private-canary-43';
  const ctx = { ...context(), origin: `https://example:${canary}@owner.example` };
  assert.doesNotMatch(JSON.stringify(await ownAddress.detect(ctx)), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(await ownAddress.observeSetup(ctx, operation)), new RegExp(canary));
  await assert.rejects(ownAddress.executeSetup(context(), {
    action: { id: 'origin' }, value: `https://example:${canary}@owner.example`,
  }), error => error.code === 'invalid_input' && !String(error).includes(canary));
});

test('own-address offers verification from the intended network after an exact local TLS/application check', async () => {
  const origin = 'https://owner.example';
  const verification = {
    status: 'verified', vantage: 'this-device', observedAt: at, checks: ['tls', 'nonce'],
    subject: { origin, target, handleGeneration: 1 },
  };
  const active = routeView(origin, { published: origin, verification });
  const observe = route => ownAddress.observeSetup(context({ values: { origin }, route }), operation);
  const pending = await observe(active);
  assert.equal(pending.state, 'pending');
  assert.equal(pending.nextAction.step.actor, 'trusted-client');
  assert.equal(pending.evidence.known, false);
  assert.match(pending.nextAction.instructions, /https:\/\/owner\.example/);
  const done = await observe({ ...active, verification: { ...verification, vantage: 'public' } });
  assert.equal(done.state, 'complete');
  assert.equal(done.evidence.observedAt, at);
  assert.equal(done.evidence.operationId, operation.id);
  assert.equal((await observe({ ...active, handle: { ...active.handle, generation: 2 } })).nextAction.step.actor, 'administrator');
});
