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

test('the origin sets the reach: a public name is internet, a private address or local name is lan, loopback is this-device', () => {
  const cases = { 'https://app.example.com': 'internet', 'https://203.0.113.9': 'internet', 'https://10.0.0.5': 'lan', 'https://192.168.1.20:8443': 'lan', 'https://172.20.0.1': 'lan',
    'https://printer.local': 'lan', 'https://nas.lan': 'lan', 'https://127.0.0.1:9000': 'this-device', 'https://localhost': 'this-device', 'https://[::1]': 'this-device', 'https://[fd00::1]': 'lan' };
  for (const [origin, reach] of Object.entries(cases)) assert.equal(reachOf(origin), reach, origin);
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
  for (const value of ['http://owner.example.test', 'https://owner.example.test/path', 'owner.example.test', 'https://u:p@owner.example.test', '']) {
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
