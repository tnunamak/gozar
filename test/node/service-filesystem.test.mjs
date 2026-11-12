import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { addService, statusServices, removeService } from '../../packages/gozar-node/service.mjs';

const origin = 'https://filesystem.example';
const name = createHash('sha256').update(origin).digest('hex') + '.json';
const route = { schemaVersion: 1, origin, target: 'localhost:1', adapterId: 'own-address',
  ownership: 'external-owned', verifyCmd: 'exit 0' };
async function fixture(t) {
  const root = await fs.mkdtemp(join(homedir(), '.tmp', 'gozar-fs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await fs.mkdir(join(home, 'services'), { recursive: true, mode: 0o700 });
  const record = join(home, 'services', name);
  await fs.writeFile(record, JSON.stringify(route), { mode: 0o600 });
  return { root, home, record };
}
// Interpose only at the filesystem boundary, after the real metadata lookup.
// Cover both main's path validation and descriptor validation, with no timing sleeps.
function metadataHook(t, record, afterStat) {
  const lstat = fs.lstat, open = fs.open;
  fs.lstat = async (path, ...args) => {
    const value = await lstat(path, ...args);
    return String(path) === record ? afterStat(value) : value;
  };
  fs.open = async (path, ...args) => {
    const handle = await open(path, ...args);
    if (String(path) === record) {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...options) => afterStat(await stat(...options));
    }
    return handle;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.lstat = lstat; fs.open = open; syncBuiltinESMExports(); });
}
async function replacement(root) {
  const home = join(root, 'replacement');
  await fs.mkdir(join(home, 'services'), { recursive: true, mode: 0o700 });
  const sentinel = join(root, 'sentinel');
  await fs.writeFile(join(home, 'services', name), JSON.stringify({ ...route,
    verifyCmd: `touch '${sentinel}'` }), { mode: 0o600 });
  return { home, sentinel };
}

test('status refuses an unsafe ancestor before a post-validation subtree swap can execute code', async t => {
  const { root, home, record } = await fixture(t);
  const evil = await replacement(root);
  await fs.chmod(root, 0o777);
  let swapped = false;
  metadataHook(t, record, async value => {
    if (!swapped) {
      swapped = true;
      await fs.rename(home, join(root, 'original'));
      await fs.symlink(evil.home, home);
    }
    return value;
  });
  const result = await Promise.allSettled([statusServices({ home })]);
  const exists = await fs.stat(evil.sentinel).then(() => true, () => false);
  assert.equal(exists, false, 'replacement verifyCmd must never execute');
  assert.equal(result[0].status, 'rejected');
  assert.match(result[0].reason.message, /Unsafe service state path/);
});

test('record bytes come from the validated descriptor after a pathname replacement', async t => {
  const { root, home, record } = await fixture(t);
  const evil = await replacement(root);
  let swapped = false;
  metadataHook(t, record, async value => {
    if (!swapped) {
      swapped = true;
      await fs.rename(record, record + '.old');
      await fs.copyFile(join(evil.home, 'services', name), record);
      await fs.chmod(record, 0o600);
    }
    return value;
  });
  const result = await statusServices({ home });
  assert.equal(swapped, true);
  assert.equal(await fs.stat(evil.sentinel).then(() => true, () => false), false);
  assert.equal(result.routes[0].verifyCmd, route.verifyCmd);
});

test('stable foreign uid is rejected independently of valid mode and content', async t => {
  const { home, record } = await fixture(t);
  // No chown privilege is needed: real inode/type/mode/content, only uid differs.
  metadataHook(t, record, value => new Proxy(value, { get(target, key) {
    return key === 'uid' ? process.getuid() + 1 : Reflect.get(target, key);
  } }));
  await assert.rejects(statusServices({ home }), /Invalid service record/);
  await assert.rejects(removeService({ home, origin }), /Invalid service record/);
});

test('final record symlinks and services directory symlinks are refused', async t => {
  const { root, home, record } = await fixture(t);
  await fs.rename(record, join(root, 'record'));
  await fs.symlink(join(root, 'record'), record);
  await assert.rejects(statusServices({ home }));
  await assert.rejects(removeService({ home, origin }));
  await fs.unlink(record);
  await fs.rename(join(home, 'services'), join(root, 'services'));
  await fs.symlink(join(root, 'services'), join(home, 'services'));
  await assert.rejects(statusServices({ home }));
  await assert.rejects(addService({ home, ...route }));
  await assert.rejects(removeService({ home, origin }));
});

test('all operations reject writable ancestors and home symlinks with a repair message', async t => {
  const { root, home } = await fixture(t);
  for (const mode of [0o770, 0o777, 0o1777]) {
    await fs.chmod(root, mode);
    for (const operation of [() => statusServices({ home }),
      () => addService({ home, ...route }), () => removeService({ home, origin })])
      await assert.rejects(operation(), error => error.message.includes(root) && /fix|chmod|owner/i.test(error.message));
  }
  await fs.chmod(root, 0o700);
  const alias = join(root, 'alias');
  await fs.symlink(home, alias);
  await assert.rejects(statusServices({ home: alias }), /symlink|symbolic/i);
  await assert.rejects(addService({ home: alias, ...route }), /symlink|symbolic/i);
  await assert.rejects(removeService({ home: alias, origin }), /symlink|symbolic/i);
});

test('mutation locks reject symlinks, nonregular files and nonprivate modes without touching their target', async t => {
  const { home } = await fixture(t);
  const locks = join(home, 'services', '.locks');
  await fs.mkdir(locks, { mode: 0o700 });
  const lock = join(locks, name.slice(0, -5));
  const target = join(home, 'untouched');
  await fs.writeFile(target, 'keep', { mode: 0o600 });
  await fs.symlink(target, lock);
  await assert.rejects(addService({ home, ...route }));
  await assert.rejects(removeService({ home, origin }));
  assert.equal(await fs.readFile(target, 'utf8'), 'keep');
  await fs.unlink(lock);
  await fs.mkdir(lock);
  await assert.rejects(removeService({ home, origin }), /Invalid service lock/);
  await fs.rmdir(lock);
  await fs.writeFile(lock, '', { mode: 0o644 });
  await assert.rejects(addService({ home, ...route }), /Invalid service lock.*chmod 600/);
  await assert.rejects(removeService({ home, origin }), /Invalid service lock.*chmod 600/);
});

test('bounded descriptor reads reject oversized records including growth after fstat', async t => {
  const { home, record } = await fixture(t);
  await fs.writeFile(record, ' '.repeat(65537));
  await assert.rejects(statusServices({ home }), /size limit/);
  await fs.writeFile(record, JSON.stringify(route));
  metadataHook(t, record, async value => {
    await fs.appendFile(record, ' '.repeat(65537));
    return value;
  });
  await assert.rejects(statusServices({ home }), /size limit/);
});

test('foreign-owned ancestor is refused even when not writable by group or others', async t => {
  const { root, home } = await fixture(t);
  const lstat = fs.lstat;
  fs.lstat = async (path, ...args) => {
    const value = await lstat(path, ...args);
    return String(path) === root ? new Proxy(value, { get(target, key) {
      return key === 'uid' ? process.getuid() + 1 : Reflect.get(target, key);
    } }) : value;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.lstat = lstat; syncBuiltinESMExports(); });
  for (const operation of [() => statusServices({ home }),
    () => addService({ home, ...route }), () => removeService({ home, origin })])
    await assert.rejects(operation(), /Unsafe service state path.*set owner/);
});

test('root-owned sticky ancestor permits private owner-controlled state', async t => {
  const stat = await fs.lstat('/tmp');
  if (stat.uid !== 0 || !(stat.mode & 0o1000)) { t.skip('/tmp is not root-owned and sticky'); return; }
  const home = await fs.mkdtemp('/tmp/gozar-sticky-');
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await addService({ home, ...route });
  assert.equal((await statusServices({ home })).routes[0].verification.status, 'verified');
  assert.equal((await removeService({ home, origin })).removed, true);
});
