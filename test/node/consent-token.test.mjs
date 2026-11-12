// Consent tokens: one route creation, short-lived, bound to {adapterId, target, originClass, owner},
// usable once. Fakes only: no provider, no network.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { issueConsentToken, redeemConsentToken } from '../../packages/gozar-node/consent-token.mjs';

const exec = promisify(execFile);
const module = fileURLToPath(new URL('../../packages/gozar-node/consent-token.mjs', import.meta.url));
const binding = { adapterId: 'tailscale-funnel', target: '127.0.0.1:3000', originClass: 'public-stable', owner: 'example-app' };
let root;
before(async () => { await mkdir(join(homedir(), '.tmp'), { recursive: true }); root = await mkdtemp(join(homedir(), '.tmp', 'gozar-consent-')); });
after(() => rm(root, { recursive: true, force: true }));
const freshHome = () => mkdtemp(join(root, 'h-'));
const redeem = (home, token, change = {}) => redeemConsentToken({ home, token, target: binding.target, originClass: binding.originClass, owner: binding.owner, ...change });
const refusal = promise => promise.then(() => null, error => error.code);
const filesUnder = async dir => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path)); else found.push(path);
  }
  return found;
};

test('a. replay: redeem succeeds once and the second redeem is consent_unknown', async () => {
  const home = await freshHome();
  const { token, expiresAt } = await issueConsentToken({ home, ...binding });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(expiresAt) > Date.now());
  assert.deepEqual(await redeem(home, token), { adapterId: binding.adapterId });
  assert.equal(await refusal(redeem(home, token)), 'consent_unknown');
  assert.equal(await refusal(redeem(home, 'never-issued')), 'consent_unknown');
});

test('b. a different target is consent_mismatch and spends the token', async () => {
  const home = await freshHome();
  const { token } = await issueConsentToken({ home, ...binding });
  assert.equal(await refusal(redeem(home, token, { target: '127.0.0.1:3001' })), 'consent_mismatch');
  assert.equal(await refusal(redeem(home, token)), 'consent_unknown');
});

test('c. a different owner and a different originClass are each consent_mismatch', async () => {
  const home = await freshHome();
  const one = await issueConsentToken({ home, ...binding });
  assert.equal(await refusal(redeem(home, one.token, { owner: 'other-app' })), 'consent_mismatch');
  const two = await issueConsentToken({ home, ...binding });
  assert.equal(await refusal(redeem(home, two.token, { originClass: 'private' })), 'consent_mismatch');
  assert.equal(await refusal(redeem(home, two.token)), 'consent_unknown');
});

test('d. an expired token is consent_expired and is spent', async () => {
  const home = await freshHome();
  const { token } = await issueConsentToken({ home, ...binding, ttlMs: 50 });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(await refusal(redeem(home, token)), 'consent_expired');
  assert.equal(await refusal(redeem(home, token)), 'consent_unknown');
});

test('e. two concurrent redeems in separate processes: exactly one wins', async () => {
  const home = await freshHome();
  const { token } = await issueConsentToken({ home, ...binding });
  const script = `import { redeemConsentToken } from ${JSON.stringify(module)};
    const [home, token, start] = process.argv.slice(1);
    while (Date.now() < Number(start)) {}
    try { console.log(JSON.stringify({ result: await redeemConsentToken({ home, token, target: ${JSON.stringify(binding.target)}, originClass: ${JSON.stringify(binding.originClass)}, owner: ${JSON.stringify(binding.owner)} }) })); }
    catch (error) { console.log(JSON.stringify({ error: error.code })); }`;
  for (let round = 0; round < 3; round++) {
    const fresh = round === 0 ? { token } : await issueConsentToken({ home, ...binding });
    const start = String(Date.now() + 400);
    const replies = await Promise.all([0, 1, 2].map(() => exec(process.execPath, ['--input-type=module', '-e', script, home, fresh.token, start])
      .then(({ stdout }) => JSON.parse(stdout))));
    assert.equal(replies.filter(reply => reply.result?.adapterId === binding.adapterId).length, 1, JSON.stringify(replies));
    assert.deepEqual(replies.filter(reply => reply.error).map(reply => reply.error), ['consent_unknown', 'consent_unknown']);
  }
});

test('f. the raw token appears in no file under the home, and token files are private', async () => {
  const home = await freshHome();
  const { token } = await issueConsentToken({ home, ...binding });
  const files = await filesUnder(home);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(!(await readFile(file)).includes(token), file);
    assert.ok(!file.includes(token), file);
  }
  const consent = files.filter(file => file.includes(`${join('routes', 'consent')}`));
  assert.equal(consent.length, 1);
  assert.equal((await stat(consent[0])).mode & 0o777, 0o600);
  await redeem(home, token);
  assert.deepEqual((await filesUnder(join(home, 'routes', 'consent'))), []);
});

test('redeem leaves nothing behind after success, mismatch or expiry', async () => {
  const home = await freshHome();
  const a = await issueConsentToken({ home, ...binding }), b = await issueConsentToken({ home, ...binding }), c = await issueConsentToken({ home, ...binding, ttlMs: 1 });
  await redeem(home, a.token);
  await refusal(redeem(home, b.token, { owner: 'x' }));
  await new Promise(resolve => setTimeout(resolve, 20));
  await refusal(redeem(home, c.token));
  assert.deepEqual(await filesUnder(join(home, 'routes', 'consent')), []);
});
