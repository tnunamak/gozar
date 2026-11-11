import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, lstat, unlink, symlink, chmod } from 'node:fs/promises';
import { PrivateFiles } from '../../packages/gozar-node/private-files.mjs';
import { fixture, effect, persist } from './helpers.mjs';

test('credential materializes only in a mode 0600 private file; completion and journal contain handles only', async t => {
  const { journal } = await fixture(t, {});
  const secret = 'fixture-secret-never-in-journal';
  const files = new PrivateFiles({ journal, sessionId: 'test', resolveCredential: async ref => { assert.equal(ref, 'credential:one'); return secret; } });
  const result = await files.create({ format: 'json', template: { token: { kind: 'credential-ref', handleRef: 'credential:one' } }, credentialRefs: ['credential:one'] });
  assert.deepEqual(Object.keys(result), ['fileHandle']);
  const path = await files.path(result.fileHandle);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).token, secret);
  assert.equal((await readFile(journal.path, 'utf8')).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  await files.remove(result.fileHandle);
  await assert.rejects(lstat(path), { code: 'ENOENT' });
});

test('private file cannot resolve another session, changed inode, symlink or weakened permissions', async t => {
  const { journal } = await fixture(t, {});
  const files = new PrivateFiles({ journal, sessionId: 'test' });
  const { fileHandle } = await files.create();
  const path = await files.path(fileHandle);
  const foreign = new PrivateFiles({ journal, sessionId: 'other' });
  await assert.rejects(foreign.path(fileHandle), /outside session/);
  await chmod(path, 0o644);
  await assert.rejects(files.path(fileHandle), /identity or mode/);
  await chmod(path, 0o600);
  await unlink(path); await symlink('/dev/null', path);
  await assert.rejects(files.remove(fileHandle), /identity or mode/);
  assert.equal((await lstat(path)).isSymbolicLink(), true);
});

test('unadmitted credential references fail before writing; resolver failure never exposes secret detail', async t => {
  const { journal } = await fixture(t, {});
  const files = new PrivateFiles({ journal, sessionId: 'test', resolveCredential: async () => { throw new Error('sensitive-provider-error'); } });
  await assert.rejects(files.create({ format: 'json', template: { kind: 'credential-ref', handleRef: 'not-admitted' } }), /outside admitted/);
  await assert.rejects(files.create({ format: 'json', template: { kind: 'credential-ref', handleRef: 'one' }, credentialRefs: ['one'] }), error => error.message === 'Credential handle unavailable');
  assert.equal(Object.keys(journal.value.owned).length, 0);
});

test('owned-process resolves a private-file argv handle and removes only its recorded artifacts after exit', async t => {
  const { driver, journal } = await fixture(t, {});
  const secret = 'private-fixture-material';
  driver.privateFiles.resolveCredential = async () => secret;
  const file = await driver.privateFiles.create({ format: 'json', template: { token: { kind: 'credential-ref', handleRef: 'one' } }, credentialRefs: ['one'] });
  const path = await driver.privateFiles.path(file.fileHandle);
  const recipe = { kind: 'spawn', program: process.execPath, args: ['-e', 'const f=require("node:fs");console.log(JSON.parse(f.readFileSync(process.argv[1],"utf8")).token.length);setInterval(()=>{},1000)', { kind: 'private-file', handleRef: file.fileHandle }],
    longRunning: true, collectMs: 20, timeoutMs: 1000 };
  const remove = { kind: 'owned-process', signal: 'SIGTERM', graceMs: 100, thenSignal: 'SIGKILL', confirmExit: true };
  driver.adapters[0].recipes = { create: recipe, remove };
  await persist(driver);
  const created = await driver.execute(effect(recipe, 'create'));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(Number(created.result.stdout), secret.length);
  const processResource = journal.value.owned[created.result.resourceId];
  const argv = await readFile(`/proc/${processResource.pid}/cmdline`, 'utf8');
  assert.equal(argv.includes(secret), false);
  assert.equal(argv.includes(path), true);
  assert.equal((await readFile(journal.path, 'utf8')).includes(secret), false);
  await persist(driver, 'remove', created.result.resourceId, 2);
  const stopped = await driver.execute(effect(remove, 'remove', 'stop-owned', { resourceId: created.result.resourceId, generation: 2 }));
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await assert.rejects(lstat(path), { code: 'ENOENT' });
});
