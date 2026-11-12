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

test('all operations reject writable ancestors with a repair message', async t => {
  const { root, home } = await fixture(t);
  for (const mode of process.getuid() === 0 ? [0o770, 0o777] : [0o770, 0o777, 0o1777]) {
    await fs.chmod(root, mode);
    for (const operation of [() => statusServices({ home }),
      () => addService({ home, ...route }), () => removeService({ home, origin })])
      await assert.rejects(operation(), error => error.message.includes(root) && /fix|chmod|owner/i.test(error.message));
  }
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

// Switch only the alias, immediately after the real resolution has completed.
function resolutionHook(t, alias, afterResolve) {
  const realpath = fs.realpath;
  let calls = 0;
  fs.realpath = async (path, ...args) => {
    const canonical = await realpath(path, ...args);
    if (String(path) === alias) { calls++; await afterResolve(canonical); }
    return canonical;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.realpath = realpath; syncBuiltinESMExports(); });
  return () => calls;
}

test('owner-controlled symlinked home supports add, status and remove', async t => {
  const { root, home } = await fixture(t);
  const alias = join(root, 'home-alias');
  await fs.symlink(home, alias);
  assert.equal((await removeService({ home: alias, origin })).removed, true);
  assert.equal((await addService({ home: alias, ...route })).route.verification.status, 'verified');
  assert.equal((await statusServices({ home: alias })).routes[0].verification.status, 'verified');
  assert.equal((await removeService({ home: alias, origin })).removed, true);
  assert.deepEqual((await statusServices({ home })).routes, []);
});

test('root-style parent alias works when resolved ancestry is trusted', async t => {
  const { root, home } = await fixture(t);
  const alias = join(root, 'var-alias');
  // Simulate an OS alias such as /var -> /private/var without root privileges.
  await fs.symlink(root, alias);
  const requested = join(alias, 'home');
  assert.equal((await addService({ home: requested, ...route })).route.verification.status, 'verified');
  assert.equal((await statusServices({ home: requested })).routes.length, 1);
  assert.equal((await removeService({ home: requested, origin })).removed, true);
  assert.deepEqual((await statusServices({ home })).routes, []);
});

for (const operation of ['add', 'status', 'remove']) {
  test(`${operation} keeps the canonical home when its alias changes after resolution`, async t => {
    const { root, home, record } = await fixture(t);
    const evil = await replacement(root);
    const alias = join(root, 'alias');
    await fs.symlink(home, alias);
    if (operation === 'add') await fs.unlink(record);
    const replacementRecord = join(evil.home, 'services', name);
    const before = await fs.readFile(replacementRecord, 'utf8');
    const calls = resolutionHook(t, alias, async canonical => {
      assert.equal(canonical, home);
      await fs.unlink(alias);
      await fs.symlink(evil.home, alias);
    });
    if (operation === 'add') {
      await addService({ home: alias, ...route });
      assert.deepEqual(JSON.parse(await fs.readFile(record, 'utf8')), route);
    } else if (operation === 'status') {
      assert.equal((await statusServices({ home: alias })).routes[0].verifyCmd, 'exit 0');
    } else {
      assert.equal((await removeService({ home: alias, origin })).removed, true);
      await assert.rejects(fs.stat(record), { code: 'ENOENT' });
    }
    assert.equal(calls(), 1, 'resolve the requested home exactly once');
    assert.equal(await fs.readFile(replacementRecord, 'utf8'), before);
    assert.equal(await fs.stat(evil.sentinel).then(() => true, () => false), false);
    assert.deepEqual(await fs.readdir(join(evil.home, 'services')), [name]);
  });
}

for (const unsafe of ['writable', 'foreign']) {
  test(`home alias refuses a resolved ${unsafe} ancestor`, async t => {
    const { root, home } = await fixture(t);
    // This ancestor is absent from the alias's lexical ancestry.
    const parent = join(root, 'resolved-parent');
    await fs.mkdir(parent, { mode: 0o700 });
    const canonical = join(parent, 'home');
    await fs.rename(home, canonical);
    const alias = join(root, 'alias');
    await fs.symlink(canonical, alias);
    if (unsafe === 'writable') await fs.chmod(parent, 0o777);
    else metadataHook(t, parent, value => new Proxy(value, { get(target, key) {
      return key === 'uid' ? process.getuid() + 1 : Reflect.get(target, key);
    } }));
    for (const requested of [alias, join(alias, 'missing', 'state')]) {
      for (const operation of [() => statusServices({ home: requested }),
        () => addService({ home: requested, ...route }), () => removeService({ home: requested, origin })])
        await assert.rejects(operation(), error => error.message.includes(parent) && /Unsafe service state path.*chmod/.test(error.message));
    }
    await assert.rejects(fs.stat(join(canonical, 'missing')), { code: 'ENOENT' });
  });
}

test('missing home is created below canonical ancestor despite an alias switch', async t => {
  const { root, home } = await fixture(t);
  const evil = await replacement(root);
  const alias = join(root, 'alias');
  await fs.symlink(home, alias);
  const calls = resolutionHook(t, alias, async () => {
    await fs.unlink(alias);
    await fs.symlink(evil.home, alias);
  });
  const requested = join(alias, 'missing', 'state');
  assert.deepEqual((await statusServices({ home: requested })).routes, []);
  // Status does not create missing state. Restore the alias for the mutation.
  assert.equal(calls(), 1);
  await assert.rejects(fs.stat(join(home, 'missing')), { code: 'ENOENT' });
  await fs.unlink(alias);
  await fs.symlink(home, alias);
  await addService({ home: requested, ...route });
  const canonical = join(home, 'missing', 'state');
  assert.equal((await statusServices({ home: canonical })).routes.length, 1);
  assert.equal((await fs.stat(canonical)).mode & 0o777, 0o700);
  await assert.rejects(fs.stat(join(evil.home, 'missing')), { code: 'ENOENT' });
  assert.equal((await removeService({ home: canonical, origin })).removed, true);
});

test('newly created canonical home components are revalidated', async t => {
  const { root, home } = await fixture(t);
  const alias = join(root, 'alias');
  await fs.symlink(home, alias);
  const created = join(home, 'missing');
  const mkdir = fs.mkdir;
  fs.mkdir = async (path, ...args) => {
    const result = await mkdir(path, ...args);
    if (String(path) === created) await fs.chmod(created, 0o777);
    return result;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.mkdir = mkdir; syncBuiltinESMExports(); });
  await assert.rejects(addService({ home: join(alias, 'missing', 'state'), ...route }), /Unsafe service state path.*chmod/);
  assert.equal((await fs.stat(created)).mode & 0o777, 0o777, 'creation hook ran on the canonical path');
  await assert.rejects(fs.stat(join(created, 'state')), { code: 'ENOENT' });
});

for (const kind of ['dangling', 'looping']) {
  test(`${kind} home aliases fail with a plain message for existing and missing descendants`, async t => {
    const { root } = await fixture(t);
    const alias = join(root, 'alias');
    await fs.symlink(kind === 'looping' ? alias : join(root, 'absent'), alias);
    for (const home of [alias, join(alias, 'missing', 'state')]) {
      for (const operation of [() => statusServices({ home }),
        () => addService({ home, ...route }), () => removeService({ home, origin })])
        await assert.rejects(operation(), /Cannot resolve service home.*dangling|Cannot resolve service home.*loop/i);
    }
    await assert.rejects(fs.stat(join(root, 'absent')), { code: 'ENOENT' });
  });
}
