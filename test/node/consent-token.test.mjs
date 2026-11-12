// Consent tokens: one route creation or adoption, short-lived, bound to a ConsentBinding (owner,
// home, target, usage, intent, requirements, route, origin, disclosureRevision) and usable once.
// The grant it carries names the adapter. Fakes only: no provider, no network.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { issueConsentToken, redeemConsentToken, consentBinding } from '../../packages/gozar-node/consent-token.mjs';

const exec = promisify(execFile);
const module = fileURLToPath(new URL('../../packages/gozar-node/consent-token.mjs', import.meta.url));
const query = { schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:3000', usage: { kind: 'durable', routeId: 'coordinator' },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: ['sse', 'streamable-http'] },
  home: '/unused', route: 'hosting', origin: 'https://node.example.test:8443' };
const grant = { adapterId: 'adapter-one', planDigest: 'sha256:plan', observedResource: 'sha256:resource' };
const bindingFor = (home, change = {}) => ({ ...consentBinding(query, home, 'disclosure-1'), ...change });
let root;
before(async () => { await mkdir(join(homedir(), '.tmp'), { recursive: true }); root = await mkdtemp(join(homedir(), '.tmp', 'gozar-consent-')); });
after(() => rm(root, { recursive: true, force: true }));
const freshHome = () => mkdtemp(join(root, 'h-'));
const refusal = promise => promise.then(() => null, error => error.code);
const filesUnder = async dir => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path)); else found.push(path);
  }
  return found;
};
const consentFiles = home => readdir(join(home, 'routes', 'consent')).catch(() => []);

test('consentBinding is pure and fills every field the token binds', () => {
  const copy = structuredClone(query);
  const binding = consentBinding(query, '/canonical/home', 'disclosure-1');
  assert.deepEqual(query, copy);
  assert.deepEqual(binding, { owner: 'example-app', home: '/canonical/home', target: '127.0.0.1:3000', usage: query.usage, intent: 'create',
    requirements: query.requirements, route: 'hosting', origin: 'https://node.example.test:8443', disclosureRevision: 'disclosure-1' });
  // Absent route and origin are null; the intent comes from the request.
  const bare = consentBinding({ ...query, route: undefined, origin: undefined, intent: 'adopt' }, '/h', 'd');
  assert.equal(bare.route, null); assert.equal(bare.origin, null); assert.equal(bare.intent, 'adopt');
  // The binding shares no object with the request.
  binding.requirements.protocols.push('oauth-dcr');
  assert.deepEqual(query, copy);
});

test('a. replay: redeem returns the grant once and the second redeem is consent_unknown', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const { token, expiresAt } = await issueConsentToken({ home, binding, grant });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.deepEqual(await redeemConsentToken({ home, token, binding }), grant);
  assert.equal(await refusal(redeemConsentToken({ home, token, binding })), 'consent_unknown');
  assert.equal(await refusal(redeemConsentToken({ home, token: 'never-issued', binding })), 'consent_unknown');
});

test('b. every bound field is compared: a change in any one is consent_mismatch and spends the token', async () => {
  const changes = {
    owner: 'other-app', home: '/another/home', target: '127.0.0.1:3001', usage: { kind: 'durable', routeId: 'other' }, intent: 'adopt',
    requirements: { ...query.requirements, address: 'any' }, route: 'other-policy', origin: 'https://node.example.test:10000', disclosureRevision: 'disclosure-2',
  };
  assert.deepEqual(Object.keys(changes).sort(), Object.keys(bindingFor('/h')).sort());
  const home = await freshHome();
  for (const [field, value] of Object.entries(changes)) {
    const { token } = await issueConsentToken({ home, binding: bindingFor(home), grant });
    assert.equal(await refusal(redeemConsentToken({ home, token, binding: bindingFor(home, { [field]: value }) })), 'consent_mismatch', field);
    assert.equal(await refusal(redeemConsentToken({ home, token, binding: bindingFor(home) })), 'consent_unknown', `${field}: spent`);
  }
  // null versus a value, and a nested requirement change, are mismatches too.
  for (const change of [{ route: null }, { origin: null }, { requirements: { ...query.requirements, protocols: ['sse'] } }]) {
    const { token } = await issueConsentToken({ home, binding: bindingFor(home), grant });
    assert.equal(await refusal(redeemConsentToken({ home, token, binding: bindingFor(home, change) })), 'consent_mismatch', JSON.stringify(change));
  }
});

test('the binding is compared as canonical JSON: key order does not matter', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const { token } = await issueConsentToken({ home, binding, grant });
  const shuffled = Object.fromEntries(Object.entries({ ...binding, requirements: Object.fromEntries(Object.entries(binding.requirements).reverse()) }).reverse());
  assert.deepEqual(await redeemConsentToken({ home, token, binding: shuffled }), grant);
});

test('c. an incomplete binding or grant is invalid_input and issues nothing', async () => {
  const home = await freshHome();
  assert.equal(await refusal(issueConsentToken({ home, binding: { ...bindingFor(home), owner: '' }, grant })), 'invalid_input');
  assert.equal(await refusal(issueConsentToken({ home, binding: { ...bindingFor(home), intent: 'close' }, grant })), 'invalid_input');
  assert.equal(await refusal(issueConsentToken({ home, binding: bindingFor(home), grant: { adapterId: 'a' } })), 'invalid_input');
  assert.equal(await refusal(issueConsentToken({ home, binding: bindingFor(home), grant, ttlMs: 0 })), 'invalid_input');
  assert.equal(await refusal(issueConsentToken({ home, binding: bindingFor(home), grant, ttlMs: 24 * 3600_000 })), 'invalid_input');
  assert.deepEqual(await consentFiles(home), []);
});

test('d. an expired token is consent_expired and is spent', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const { token } = await issueConsentToken({ home, binding, grant, ttlMs: 50 });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await refusal(redeemConsentToken({ home, token, binding })), 'consent_expired');
  assert.equal(await refusal(redeemConsentToken({ home, token, binding })), 'consent_unknown');
});

test('e. two concurrent redeems in separate processes: exactly one wins', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const script = `import { redeemConsentToken } from ${JSON.stringify(module)};
    const [home, token, start, binding] = process.argv.slice(1);
    while (Date.now() < Number(start)) {}
    try { console.log(JSON.stringify({ result: await redeemConsentToken({ home, token, binding: JSON.parse(binding) }) })); }
    catch (error) { console.log(JSON.stringify({ error: error.code })); }`;
  for (let round = 0; round < 3; round++) {
    const fresh = await issueConsentToken({ home, binding, grant });
    const start = String(Date.now() + 400);
    const replies = await Promise.all([0, 1, 2].map(() => exec(process.execPath, ['--input-type=module', '-e', script, home, fresh.token, start, JSON.stringify(binding)])
      .then(({ stdout }) => JSON.parse(stdout))));
    assert.equal(replies.filter(reply => reply.result?.adapterId === grant.adapterId).length, 1, JSON.stringify(replies));
    assert.deepEqual(replies.filter(reply => reply.error).map(reply => reply.error), ['consent_unknown', 'consent_unknown']);
  }
});

test('f. only hashes reach disk: the raw token and the binding values appear in no file, and token files are private', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const { token } = await issueConsentToken({ home, binding, grant });
  const files = await filesUnder(home);
  assert.ok(files.length > 0);
  for (const file of files) {
    const bytes = (await readFile(file)).toString('utf8');
    assert.ok(!bytes.includes(token) && !file.includes(token), file);
    for (const secret of [binding.owner, binding.target, binding.origin, 'coordinator', 'disclosure-1']) assert.ok(!bytes.includes(secret), `${secret} in ${file}`);
  }
  const consent = files.filter(file => file.includes(join('routes', 'consent')));
  assert.equal(consent.length, 1);
  assert.equal((await stat(consent[0])).mode & 0o777, 0o600);
  assert.ok((await readFile(consent[0], 'utf8')).includes(grant.adapterId));
  await redeemConsentToken({ home, token, binding });
  assert.deepEqual(await filesUnder(join(home, 'routes', 'consent')), []);
});

test('redeem leaves nothing behind after success, mismatch or expiry', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const a = await issueConsentToken({ home, binding, grant }), b = await issueConsentToken({ home, binding, grant }), c = await issueConsentToken({ home, binding, grant, ttlMs: 1 });
  await redeemConsentToken({ home, token: a.token, binding });
  await refusal(redeemConsentToken({ home, token: b.token, binding: { ...binding, owner: 'x' } }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await refusal(redeemConsentToken({ home, token: c.token, binding }));
  assert.deepEqual(await filesUnder(join(home, 'routes', 'consent')), []);
});

test('issue sweeps expired tokens and leftover spent or unfinished files older than the longest TTL, and keeps live tokens', async () => {
  const home = await freshHome();
  const binding = bindingFor(home);
  const expired = await issueConsentToken({ home, binding, grant, ttlMs: 1 });
  const live = await issueConsentToken({ home, binding, grant });
  const dir = join(home, 'routes', 'consent');
  const hex = 'a'.repeat(64);
  const longAgo = new Date(Date.now() - 2 * 3600_000), recent = new Date();
  for (const [name, time] of [[`${hex}.old.spent`, longAgo], [`${hex}.young.spent`, recent], [`${hex}.json.old.tmp`, longAgo], [`${hex}.json.young.tmp`, recent]]) {
    await writeFile(join(dir, name), '{}', { mode: 0o600 });
    await utimes(join(dir, name), time, time);
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  const next = await issueConsentToken({ home, binding, grant });
  const left = await consentFiles(home);
  assert.equal(left.length, 4, left.join(' '));
  assert.ok(left.includes(`${hex}.young.spent`) && left.includes(`${hex}.json.young.tmp`));
  assert.ok(!left.some(name => name.endsWith('.old.spent') || name.endsWith('.old.tmp')));
  assert.equal(await refusal(redeemConsentToken({ home, token: expired.token, binding })), 'consent_unknown');
  assert.deepEqual(await redeemConsentToken({ home, token: live.token, binding }), grant);
  assert.deepEqual(await redeemConsentToken({ home, token: next.token, binding }), grant);
});
