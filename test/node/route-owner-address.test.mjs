// Plain HTTP for the local network, and the owner-run address in the catalog: both reach an app as data only.
// Real registered adapters, fake probes, and the service tests' own verification stand-in (`exit 0`): no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { addService, statusServices } from '../../packages/gozar-node/service.mjs';
import { checkValue } from '../../packages/gozar-node/route-setup.mjs';
import { reachOf } from '../../adapters/providers/own-address/index.mjs';
import { assertShape, codeOf, query, scratch } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}adapters/manifest.json`, 'utf8'));
const adapters = await loadAdapters();
const ownerId = adapters.find(adapter => adapter.definition.ownership === 'external-owned').id;
const readContext = { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified', checkedAt: null }) };
const apiFor = () => createRouteApi({ adapters, platform: 'linux', readContext, service: { addService: input => addService({ ...input, verifyCmd: 'exit 0' }) } });
const requirements = over => ({ reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [], ...over });
const durable = async (t, over = {}) => query({ home: await scratch(t), usage: { kind: 'durable', routeId: 'example-main' }, requirements: requirements(), ...over });
const ORIGIN = 'https://owner.example.test';

test("red: transport 'any' is valid only with reach lan or this-device, and a plain-HTTP candidate is eligible only under it", async t => {
  const api = apiFor();
  for (const reach of ['internet', 'tailnet']) {
    assert.equal(await codeOf(api.catalogRoutes(await durable(t, { usage: { kind: 'session', lifetimeMs: 60_000 }, requirements: requirements({ reach, transport: 'any' }) }))), 'invalid_input', reach);
  }
  const session = { usage: { kind: 'session', lifetimeMs: 60_000 } };
  const lan = (await api.catalogRoutes(await durable(t, { ...session, providerId: 'lan', requirements: requirements({ reach: 'lan', transport: 'any', address: 'any' }) }))).candidates[0];
  assertShape('Candidate', lan);
  assert.equal(lan.properties.transport, 'http');
  assert.equal(lan.eligible, true);
  assert.ok(lan.candidateToken);
  const strict = (await api.catalogRoutes(await durable(t, { ...session, providerId: 'lan', requirements: requirements({ reach: 'lan', address: 'any' }) }))).candidates[0];
  assert.equal(strict.eligible, false);
  assert.ok(strict.unmet.some(item => item.requirement === 'transport'));
  assert.match(lan.disclosure.text, /read the traffic/, 'the disclosure says plain HTTP is not private');
});

test('red: an owner-run address without an origin is action-required with one provide-value https-origin action', async t => {
  const { candidates: [own] } = await apiFor().catalogRoutes(await durable(t, { providerId: ownerId }));
  assertShape('Candidate', own);
  assert.equal(own.setup.state, 'action-required');
  assert.equal(own.eligible, false);
  assert.equal(own.candidateToken, null);
  assert.equal(own.setup.actions.length, 1);
  const [step] = own.setup.actions;
  assert.equal(step.kind, 'provide-value');
  assert.equal(step.valueFormat, 'https-origin');
  assert.equal(step.required, true);
  assert.ok(step.valueLabel && step.valuePlaceholder);
});

test('red: with a public https origin it is eligible, reaches the internet, is checked from this device and gets a candidateToken', async t => {
  const { candidates: [own] } = await apiFor().catalogRoutes(await durable(t, { providerId: ownerId, origin: ORIGIN }));
  assertShape('Candidate', own);
  assert.equal(own.properties.reach, 'internet');
  assert.equal(own.properties.proof.vantage, 'this-device');
  assert.equal(own.eligible, true, JSON.stringify(own.unmet));
  assert.equal(own.setup.state, 'ready');
  assert.equal(typeof own.candidateToken, 'string');
});

test('shared carrier-grade NAT space (100.64.0.0/10) has unknown reach, and its neighbours stay internet', () => {
  for (const origin of ['https://100.64.0.1', 'https://100.127.255.254:8443']) assert.equal(reachOf(origin), 'unknown', origin);
  for (const origin of ['https://100.63.255.255', 'https://100.128.0.0']) assert.equal(reachOf(origin), 'internet', origin);
});

test('the origin sets the reach: a public name is internet, a private address or local name is lan, loopback is this-device', () => {
  const cases = { 'https://app.example.com': 'internet', 'https://203.0.113.9': 'internet', 'https://10.0.0.5': 'lan', 'https://192.168.1.20:8443': 'lan', 'https://172.20.0.1': 'lan',
    'https://printer.local': 'lan', 'https://nas.lan': 'lan', 'https://127.0.0.1:9000': 'this-device', 'https://localhost': 'this-device', 'https://[::1]': 'this-device', 'https://[fd00::1]': 'lan' };
  for (const [origin, reach] of Object.entries(cases)) assert.equal(reachOf(origin), reach, origin);
});

test('red: every host shape gets the reach of the address it really is', () => {
  const cases = {
    // An IPv4 address inside IPv6 is that IPv4 address.
    'https://[::ffff:127.0.0.1]': 'this-device', 'https://[::ffff:10.0.0.5]': 'lan', 'https://[::ffff:192.168.1.1]': 'lan', 'https://[::ffff:203.0.113.9]': 'internet',
    // The deprecated IPv4-compatible form is not routed as IPv4: only loopback keeps its reading.
    'https://[::127.0.0.1]': 'this-device', 'https://[::10.0.0.5]': 'unknown', 'https://[::8.8.8.8]': 'unknown',
    // The unspecified addresses name no host.
    'https://0.0.0.0': 'unknown', 'https://[::]': 'unknown', 'https://0.1.2.3': 'unknown',
    // The URL parser prints an IPv4-compatible address whose first two bytes are zero as one hextet: [::2] is ::0.0.0.2.
    'https://[::2]': 'unknown', 'https://[::0.0.1.2]': 'unknown', 'https://[::1]': 'this-device',
    // Multicast and broadcast addresses are never one host's address.
    'https://224.0.0.1': 'unknown', 'https://239.1.2.3': 'unknown', 'https://255.255.255.255': 'unknown', 'https://240.0.0.1': 'unknown', 'https://[ff02::1]': 'unknown',
    // The parser drops leading zeros, so [fd::1] is 00fd::1 and [ff::1] is 00ff::1: global addresses, not unique-local or multicast.
    'https://[fd::1]': 'internet', 'https://[ff::1]': 'internet', 'https://[fe8::1]': 'internet', 'https://[fd12:3456::1]': 'lan',
    // Names that only resolve on a local network.
    'https://nas': 'lan', 'https://build.internal': 'lan', 'https://printer.home.arpa': 'lan', 'https://home.arpa': 'lan', 'https://[fec0::1]': 'lan', 'https://localhost.localdomain': 'this-device',
    // What was already right stays right.
    'https://10.1.2.3': 'lan', 'https://172.16.0.1': 'lan', 'https://172.31.255.255': 'lan', 'https://172.32.0.1': 'internet', 'https://192.168.0.1': 'lan',
    'https://169.254.1.1': 'lan', 'https://[fe80::1]': 'lan', 'https://[fd00::1]': 'lan', 'https://printer.local': 'lan', 'https://nas.lan': 'lan',
    'https://localhost': 'this-device', 'https://app.localhost': 'this-device', 'https://NAS.LOCAL.': 'lan', 'https://LOCALHOST': 'this-device', 'https://100.64.0.1': 'unknown',
    'https://app.example.com': 'internet', 'https://[2001:db8::1]': 'internet',
  };
  for (const [origin, reach] of Object.entries(cases)) assert.equal(reachOf(origin), reach, origin);
});

test('red: an origin the app sent that is not a valid https origin is refused, and the stored address never replaces it', async t => {
  const api = apiFor(), home = await scratch(t);
  const plain = query({ home, providerId: ownerId, usage: { kind: 'durable', routeId: 'example-main' }, requirements: requirements() });
  const [step] = (await api.catalogRoutes(plain)).candidates[0].setup.actions;
  await api.runSetupAction({ home, actionId: step.id, approval: { digest: step.digest, disclosureRevision: step.disclosure.revision }, value: 'https://configured.example.test' });
  assert.equal((await api.catalogRoutes(plain)).candidates[0].eligible, true, 'with no origin in the query the stored address is used');
  for (const origin of ['http://evil.example.test', 'junk', 'https://u:p@evil.example.test']) {
    const { candidates: [own] } = await api.catalogRoutes({ ...plain, origin });
    assert.equal(own.eligible, false, origin);
    assert.equal(own.candidateToken, null, origin);
    // The owner's setup action cannot fix an origin the app named, so none is offered.
    assert.deepEqual(own.setup.actions, [], origin);
    // A token issued for the stored address cannot be spent with a bad origin either.
    const stored = (await api.catalogRoutes(plain)).candidates[0];
    const approval = { candidateToken: stored.candidateToken, disclosureRevision: stored.disclosure.revision };
    assert.equal(await codeOf(api.ensureRoute({ ...plain, origin, approval })), 'consent_mismatch', origin);
  }
  // Without a token in the way, the provider itself refuses a bad origin rather than planning the stored address.
  const [ownAdapter] = adapters.filter(adapter => adapter.id === ownerId);
  const ctx = { ...readContext, origin: null, platform: 'linux', configuration: async () => ({ origin: 'https://configured.example.test' }) };
  const request = { target: plain.target, usage: plain.usage, requirements: plain.requirements, configurationRef: null };
  assert.equal((await ownAdapter.plan(ctx, { ...request, origin: null })).origin, 'https://configured.example.test');
  assert.equal(await codeOf(ownAdapter.plan(ctx, { ...request, origin: 'http://evil.example.test' })), 'invalid_input');
  assert.deepEqual((await statusServices({ home })).routes, [], 'no route was created');
});

test('red: ensureRoute with that candidate creates an external-owned route through the service-route path and returns a RouteView', async t => {
  const api = apiFor();
  const q = await durable(t, { providerId: ownerId, origin: ORIGIN });
  const { candidates: [own] } = await api.catalogRoutes(q);
  const approval = { candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision };
  const view = await api.ensureRoute({ ...q, approval });
  assertShape('RouteView', view);
  assert.equal(view.ownership, 'external-owned');
  assert.equal(view.handle.kind, 'external');
  assert.equal(view.origin, ORIGIN);
  assert.equal(view.state, 'usable');
  assert.equal(view.verification.vantage, 'this-device');
  const { routes } = await statusServices({ home: q.home });
  assert.deepEqual(routes.map(route => [route.origin, route.target, route.adapterId, route.ownership]), [[ORIGIN, q.target, ownerId, 'external-owned']]);
  assert.equal(await codeOf(api.ensureRoute({ ...q, approval })), 'consent_unknown', 'the token is single use');
  const again = await api.routeStatus({ home: q.home, handle: view.handle });
  assert.equal(again.ownership, 'external-owned');
});

test('the consent token still binds the request: another target or origin does not redeem it', async t => {
  const api = apiFor();
  const q = await durable(t, { providerId: ownerId, origin: ORIGIN });
  const { candidates: [own] } = await api.catalogRoutes(q);
  const approval = { candidateToken: own.candidateToken, disclosureRevision: own.disclosure.revision };
  assert.equal(await codeOf(api.ensureRoute({ ...q, origin: 'https://other.example.test', approval })), 'consent_mismatch');
  assert.deepEqual((await statusServices({ home: q.home })).routes, []);
});

test('red: the provide-value action rejects a value that does not match its valueFormat, and keeps one that does as configuration, not as a secret', async t => {
  const api = apiFor(), home = await scratch(t);
  const { candidates: [own] } = await api.catalogRoutes(query({ home, providerId: ownerId, usage: { kind: 'durable', routeId: 'example-main' }, requirements: requirements() }));
  const [step] = own.setup.actions;
  const approval = { digest: step.digest, disclosureRevision: step.disclosure.revision };
  for (const value of ['http://owner.example.test', 'https://owner.example.test/path', 'owner.example.test', 'https://u:p@owner.example.test', '',
    'https://owner.example.test?q=1', 'https://owner.example.test#x', '//owner.example.test', 'javascript:alert(1)']) {
    assert.equal(await codeOf(api.runSetupAction({ home, actionId: step.id, approval, value })), 'invalid_input', JSON.stringify(value));
  }
  assert.equal(await codeOf(api.runSetupAction({ home, actionId: step.id, approval, value: ORIGIN, secretHandle: 'sec_0123456789abcdef0123456789abcdef' })), 'invalid_input');
  const done = await api.runSetupAction({ home, actionId: step.id, approval, value: ORIGIN });
  assert.equal(done.state, 'complete');
  const files = async directory => (await readdir(directory, { withFileTypes: true })).flatMap(entry => entry.isDirectory() ? [entry.name] : []);
  assert.ok(!(await files(home)).includes('secrets'), 'nothing went to the secret store');
  assert.match(await readFile(join(home, 'setup', `${ownerId}.json`), 'utf8'), new RegExp(ORIGIN.replaceAll('.', '\\.')));
  // The value now answers the action, so the catalog no longer asks for it.
  const after = (await api.catalogRoutes(query({ home, providerId: ownerId, usage: { kind: 'durable', routeId: 'example-main' }, requirements: requirements() }))).candidates[0];
  assert.equal(after.setup.state, 'ready');
  assert.equal(after.properties.reach, 'internet');
});

test('checkValue holds each format to its rule', () => {
  assert.equal(checkValue('https-origin', ' https://a.example.test/ '), 'https://a.example.test');
  assert.equal(checkValue('https-origin', 'https://a.example.test:8443'), 'https://a.example.test:8443');
  assert.equal(checkValue('https-origin', 'http://a.example.test'), null);
  assert.equal(checkValue('domain', 'one.example.ngrok.app'), 'one.example.ngrok.app');
  assert.equal(checkValue('domain', 'https://one.example.ngrok.app'), null);
  assert.equal(checkValue('domain', 'localhost'), null);
  assert.equal(checkValue('text', ' note '), 'note');
  assert.equal(checkValue('text', ''), null);
  assert.equal(checkValue('unknown-format', 'x'), null);
  assert.equal(checkValue('text', 5), null);
});

test('core names no provider for an owner-kept route: service.mjs holds no registry id and takes it from the definition', () => {
  const source = readFileSync(`${root}packages/gozar-node/service.mjs`, 'utf8');
  for (const { id } of manifest.providers) assert.ok(!source.includes(id), `service.mjs names ${id}`);
});

test('invalid query origin is named in the unmet setup actual without extending closed enums', async t => {
  const origin = 'https://a.example.com/path';
  const { candidates: [own] } = await apiFor().catalogRoutes(await durable(t, { providerId: ownerId, origin }));
  assertShape('Candidate', own);
  assert.equal(own.eligible, false);
  assert.equal(own.candidateToken, null);
  assert.deepEqual(own.unmet.find(item => item.requirement === 'setup'), {
    requirement: 'setup', actual: { origin, reason: 'invalid_origin' }, reasonCode: 'not_met',
  });
});
