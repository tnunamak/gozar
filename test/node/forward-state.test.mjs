// The forward-run private state store (packages/gozar-node/forward-state.mjs).
// Every case exercises the real filesystem trust helpers, the process lock and atomic
// writes under a private scratch home; nothing is mocked. No TLA+/TLC toolchain is
// present in this checkout or PATH (and none may be installed), so the run/stop/debt
// transition rules are checked by the bounded reference-model table in the last test
// plus the deterministic CAS/late-transition cases; that is replay evidence against
// the real store, not a formal proof.
import assert from 'node:assert/strict';
import { chmod, lstat, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { openForwardState } from '../../packages/gozar-node/forward-state.mjs';
import { scratch } from './route-schema-check.mjs';

const moduleUrl = new URL('../../packages/gozar-node/forward-state.mjs', import.meta.url).href;
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const ISO = '2026-11-26T10:00:00.000Z';
const APPROVAL = { fingerprint: `sha256:${'ab'.repeat(32)}`, provider: 'tunnl.gg', disclosureRevision: 'd-1',
  factsDigest: `sha256:${'cd'.repeat(32)}` };
const ORIGIN = { url: 'https://try.tunnl.gg', observedAt: ISO };
const settledCleanup = () => ({ certainty: 'settled', debt: null });
const debtOf = r => ({ certainty: 'unconfirmed', debt: { runId: r.id, generation: r.generation, since: ISO } });
const run = (over = {}) => ({ id: RUN_A, generation: 1, operationId: null, handle: null, provider: null,
  phase: 'starting', ...over });
const content = (over = {}) => ({ run: run(), approval: null, origin: null, downSince: null,
  cleanup: settledCleanup(), ...over });
const store = (home, app = 'faravan') => openForwardState({ home, app });

async function rejects(promise, code, match, label) {
  try { await promise; } catch (error) {
    if (code) assert.equal(error.code, code, `${label ?? 'rejected'}: expected ${code}, got ${error.code}: ${error.message}`);
    if (match) assert.match(error.message, match, label);
    return error;
  }
  assert.fail(`${label ?? 'promise'} resolved; expected rejection`);
}

// The single record file of a one-app home (the store's filename is the hash of the app).
const recordFile = async home => {
  const name = (await readdir(join(home, 'forward'))).filter(n => n.endsWith('.json'));
  assert.equal(name.length, 1);
  return join(home, 'forward', name[0]);
};

test('a fresh app reads as missing and admits an explicit revision-0 commit', async t => {
  const home = await scratch(t);
  const state = store(home);
  assert.equal(await state.read(), null, 'missing is null, not an empty record');
  const committed = await state.commit(content(), { expectedRevision: 0 });
  assert.equal(committed.revision, 1);
  assert.deepEqual(await store(home).read(), committed, 'a reopened store reads the same record');
});

test('revisions advance monotonically and all fields survive reopening', async t => {
  const home = await scratch(t);
  const state = store(home);
  const first = await state.commit(content(), { expectedRevision: 0 });
  const second = await state.commit(content({ run: run({ phase: 'active', operationId: RUN_B, handle: 'route-7',
    provider: 'tunnl.gg' }), approval: APPROVAL, origin: ORIGIN, downSince: ISO }), { expectedRevision: first.revision });
  assert.equal(second.revision, 2);
  assert.deepEqual(await store(home).read(), second);
  // Stopping keeps the saved approval and last verified origin: closing is not revoking.
  const third = await state.commit(content({ run: run({ phase: 'stopped', handle: 'route-7',
    provider: 'tunnl.gg' }), approval: APPROVAL, origin: ORIGIN, downSince: ISO }), { expectedRevision: 2 });
  assert.equal(third.revision, 3);
  assert.deepEqual(third.approval, APPROVAL);
  assert.deepEqual(third.origin, ORIGIN);
});

test('managed directories are 0700 and records and locks are 0600 non-symlinks', async t => {
  const home = join(await scratch(t), 'nested', 'app-state');
  await store(home).commit(content(), { expectedRevision: 0 });
  assert.equal((await stat(home)).mode & 0o777, 0o700, 'a created home is owner-private');
  const forward = join(home, 'forward');
  assert.equal((await stat(forward)).mode & 0o777, 0o700);
  const names = await readdir(forward);
  const record = names.find(n => n.endsWith('.json')), lock = names.find(n => n.endsWith('.lock'));
  assert.ok(record && lock, `forward holds a record and a lock: ${names.join()}`);
  assert.match(record, /^[0-9a-f]{64}\.json$/, 'the record name is derived from the app identity, never raw input');
  assert.equal((await stat(join(forward, record))).mode & 0o777, 0o600);
  assert.equal((await stat(join(forward, lock))).mode & 0o777, 0o600);
  assert.ok(!(await lstat(join(forward, record))).isSymbolicLink());
});

test('two apps keep isolated records; hostile app names cannot alias or escape the scope', async t => {
  const home = await scratch(t);
  const a = store(home, 'faravan'), b = store(home, 'other-app');
  await a.commit(content({ run: run({ handle: 'h-a' }) }), { expectedRevision: 0 });
  await b.commit(content({ run: run({ handle: 'h-b' }) }), { expectedRevision: 0 });
  assert.equal((await a.read()).run.handle, 'h-a');
  assert.equal((await b.read()).run.handle, 'h-b');
  assert.equal((await readdir(join(home, 'forward'))).filter(n => n.endsWith('.json')).length, 2);
  // A stale CAS on one app cannot touch the other.
  await rejects(a.commit(content({ run: run({ handle: 'h-a2' }) }), { expectedRevision: 0 }), 'candidate_stale');
  assert.equal((await b.read()).revision, 1);
  for (const bad of ['../../etc', 'Faravan', '', 'a'.repeat(65), 'has/slash', 'has.dot', '..', null, 7])
    assert.throws(() => openForwardState({ home, app: bad }), error => error.code === 'invalid_input', `app ${JSON.stringify(bad)}`);
  assert.throws(() => openForwardState({ home: 'relative/path', app: 'faravan' }), error => error.code === 'invalid_input');
});

test('a group-writable home fails closed and is never rewritten', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const path = await recordFile(home);
  const before = await readFile(path, 'utf8');
  await chmod(home, 0o770);
  t.after(() => chmod(home, 0o700).catch(() => {}));
  await rejects(store(home).read(), 'unsafe_state_path');
  await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }), 'unsafe_state_path');
  assert.equal(await readFile(path, 'utf8'), before, 'nothing was rewritten while the home was insecure');
});

test('a weakened forward directory fails closed and is never rewritten', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const forward = join(home, 'forward');
  const path = await recordFile(home);
  const before = await readFile(path, 'utf8');
  await chmod(forward, 0o750);
  t.after(() => chmod(forward, 0o700).catch(() => {}));
  await rejects(store(home).read(), null, /chmod 700/);
  await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }), null, /chmod 700/);
  assert.equal(await readFile(path, 'utf8'), before);
});

test('a symlinked record fails closed; the link and its target are untouched', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const forward = join(home, 'forward');
  const path = await recordFile(home);
  const decoy = join(forward, 'decoy.json');
  await writeFile(decoy, 'decoy-body', { mode: 0o600 });
  await rm(path);
  await symlink(decoy, path);
  await rejects(store(home).read(), 'internal_error');
  await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }), 'internal_error');
  assert.ok((await lstat(path)).isSymbolicLink(), 'the symlink was not replaced by a write');
  assert.equal(await readFile(decoy, 'utf8'), 'decoy-body');
});

test('a world-readable record fails closed without a rewrite', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const path = await recordFile(home);
  await chmod(path, 0o644);
  await rejects(store(home).read(), 'internal_error');
  await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }), 'internal_error');
  assert.equal((await stat(path)).mode & 0o777, 0o644, 'the weakened file was not chmod-ed or replaced');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).revision, 1);
});

test('corrupt, empty, foreign and tampered records fail closed, never rewritten', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const path = await recordFile(home);
  const good = JSON.parse(await readFile(path, 'utf8'));
  const cases = [
    '{ not json',
    '',
    JSON.stringify({ hello: 'world' }),
    JSON.stringify({ ...good, schemaVersion: 2 }),
    JSON.stringify({ ...good, kind: 'some-other-module' }),
    JSON.stringify({ ...good, app: 'somebody-else' }),
    JSON.stringify({ ...good, bearerToken: 'tok_1' }),
    JSON.stringify({ ...good, revision: 0 }),
  ];
  for (const bytes of cases) {
    await writeFile(path, bytes);
    await rejects(store(home).read(), 'internal_error', /not a valid record/, `read of ${bytes.slice(0, 40)}`);
    await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }),
      'internal_error', /not a valid record/, 'commit over uncertainty');
    assert.equal(await readFile(path, 'utf8'), bytes, 'a failed read or commit must not rewrite the record');
  }
});

test('an oversize record fails closed without a rewrite', async t => {
  const home = await scratch(t);
  await store(home).commit(content(), { expectedRevision: 0 });
  const path = await recordFile(home);
  const bytes = '{' + 'a'.repeat(70000);
  await writeFile(path, bytes);
  await rejects(store(home).read(), 'internal_error', /not a valid record/);
  await rejects(store(home).commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 1 }), 'internal_error');
  assert.equal((await stat(path)).size, bytes.length);
});

test('a stale expectedRevision commits nothing', async t => {
  const home = await scratch(t);
  const state = store(home);
  await state.commit(content(), { expectedRevision: 0 });
  const error = await rejects(state.commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 0 }), 'candidate_stale');
  assert.match(error.message, /revision 1, not 0/);
  await rejects(state.commit(content({ run: run({ phase: 'active' }) }), { expectedRevision: 99 }), 'candidate_stale');
  assert.equal((await state.read()).revision, 1, 'nothing was written');
  // A missing record is revision 0 exactly: 1 is stale, not a silent accept.
  await rejects(store(join(home, 'never-used')).commit(content(), { expectedRevision: 1 }), 'candidate_stale');
});

test('competing commits on one revision: exactly one wins', async t => {
  const home = await scratch(t);
  const results = await Promise.allSettled([1, 2, 3, 4].map(n =>
    store(home).commit(content({ run: run({ handle: `h-${n}` }) }), { expectedRevision: 0 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'candidate_stale'));
  const record = await store(home).read();
  assert.equal(record.revision, 1);
  assert.match(record.run.handle, /^h-[1-4]$/);
});

test('a stopped run cannot become active again', async t => {
  const home = await scratch(t);
  const state = store(home);
  await state.commit(content(), { expectedRevision: 0 });
  await state.commit(content({ run: run({ phase: 'stopped' }) }), { expectedRevision: 1 });
  const path = await recordFile(home);
  const before = await readFile(path, 'utf8');
  for (const phase of ['starting', 'active', 'awaiting'])
    await rejects(state.commit(content({ run: run({ phase }) }), { expectedRevision: 2 }), 'stopped_by_user', null, `resurrection as ${phase}`);
  assert.equal(await readFile(path, 'utf8'), before, 'no resurrection attempt wrote anything');
  assert.equal((await state.read()).run.phase, 'stopped');
});

test('unconfirmed cleanup blocks a fresh run until a retry settles it', async t => {
  const home = await scratch(t);
  const state = store(home);
  await state.commit(content({ approval: APPROVAL, origin: ORIGIN, downSince: ISO }), { expectedRevision: 0 });
  const stopped = { run: run({ phase: 'stopped', handle: 'route-7', provider: 'tunnl.gg' }),
    approval: APPROVAL, origin: ORIGIN, downSince: ISO, cleanup: debtOf(run()) };
  await state.commit(stopped, { expectedRevision: 1 });
  // Debt blocks replacement.
  await rejects(state.commit({ run: run({ id: RUN_B, generation: 2, phase: 'starting' }),
    approval: APPROVAL, origin: ORIGIN, downSince: ISO, cleanup: settledCleanup() }, { expectedRevision: 2 }), 'cleanup_debt');
  // A cleanup retry settles the same stopped record.
  const settled = await state.commit({ ...stopped, cleanup: settledCleanup() }, { expectedRevision: 2 });
  assert.equal(settled.revision, 3);
  assert.equal(settled.cleanup.certainty, 'settled');
  // The settled record admits a fresh run with a new identity and an advanced generation.
  const fresh = await state.commit({ run: run({ id: RUN_B, generation: 2, phase: 'starting' }),
    approval: APPROVAL, origin: ORIGIN, downSince: null, cleanup: settledCleanup() }, { expectedRevision: 3 });
  assert.equal(fresh.revision, 4, 'the revision stays monotonic across turnover');
  assert.deepEqual(fresh.approval, APPROVAL, 'an unchanged saved approval is preserved across turnover');
  assert.deepEqual(fresh.origin, ORIGIN);
});

test('cleanup debt survives the writing process exiting', async t => {
  const home = await scratch(t);
  const child = `
const { openForwardState } = await import(${JSON.stringify(moduleUrl)});
const { randomUUID } = await import('node:crypto');
const runId = randomUUID();
const state = openForwardState({ home: process.env.GOZAR_CHILD_HOME, app: 'faravan' });
const base = { approval: null, origin: null, downSince: null };
const run = { id: runId, generation: 1, operationId: null, handle: 'route-7', provider: 'tunnl.gg' };
await state.commit({ ...base, run: { ...run, phase: 'starting' }, cleanup: { certainty: 'settled', debt: null } }, { expectedRevision: 0 });
await state.commit({ ...base, run: { ...run, phase: 'stopped' }, cleanup: { certainty: 'unconfirmed',
  debt: { runId, generation: 1, since: '2026-11-26T00:00:00.000Z' } } }, { expectedRevision: 1 });
console.log(runId);
`;
  const done = spawnSync(process.execPath, ['--input-type=module', '-e', child],
    { env: { ...process.env, GOZAR_CHILD_HOME: home }, encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  const runId = done.stdout.trim();
  // The exited process's debt is still here, and still blocks a fresh run.
  const record = await store(home).read();
  assert.equal(record.run.id, runId);
  assert.equal(record.run.phase, 'stopped');
  assert.equal(record.cleanup.certainty, 'unconfirmed');
  assert.equal(record.cleanup.debt.runId, runId);
  assert.equal(record.revision, 2);
  await rejects(store(home).commit(content({ run: run({ id: RUN_B, generation: 2 }) }), { expectedRevision: 2 }), 'cleanup_debt');
});

test('no bearer, candidate token, credential or raw payload can be persisted', async t => {
  const home = await scratch(t);
  const state = store(home);
  const attempts = [
    content({ approval: { fingerprint: 'Bearer eyJhbGci.eyJzdWIi.sig', provider: 'tunnl.gg',
      disclosureRevision: 'd-1', factsDigest: `sha256:${'ab'.repeat(32)}` } }),
    content({ approval: { ...APPROVAL, consentBearer: 'tok_bearer' } }),
    content({ candidateToken: 'tok_candidate' }),
    content({ run: run({ handle: 'Bearer tok with spaces' }) }),
    content({ origin: { ...ORIGIN, rawProviderOutput: 'log line' } }),
    content({ cleanup: { certainty: 'settled', debt: null, request: 'GET /whatever' } }),
    content({ run: { ...run(), extra: 'field' } }),
  ];
  for (const bad of attempts) await rejects(state.commit(bad, { expectedRevision: 0 }), 'invalid_input');
  assert.equal(await store(home).read(), null, 'no rejected attempt persisted anything');
  const good = await state.commit(content({ approval: APPROVAL }), { expectedRevision: 0 });
  assert.deepEqual(Object.keys(good.approval).sort(), ['disclosureRevision', 'factsDigest', 'fingerprint', 'provider']);
  const bytes = await readFile(await recordFile(home), 'utf8');
  for (const secret of ['Bearer', 'tok_', 'eyJhbGci', 'rawProviderOutput'])
    assert.ok(!bytes.includes(secret), `${secret} must never reach the state file`);
});

test('invalid store inputs are rejected before touching the filesystem', async t => {
  const home = join(await scratch(t), 'unused');
  const state = store(home);
  const bad = [
    [content(), {}],
    [content(), { expectedRevision: -1 }],
    [content(), { expectedRevision: '0' }],
    [content({ run: null }), { expectedRevision: 0 }],
    [content({ run: run({ phase: 'restarting' }) }), { expectedRevision: 0 }],
    [content({ run: run({ generation: 0 }) }), { expectedRevision: 0 }],
    [content({ run: run({ id: 'not-a-uuid' }) }), { expectedRevision: 0 }],
    [content({ run: run({ provider: 'has space' }) }), { expectedRevision: 0 }],
    [content({ approval: { ...APPROVAL, fingerprint: 'sha256:short' } }), { expectedRevision: 0 }],
    [content({ approval: { ...APPROVAL, factsDigest: 'md5:zz' } }), { expectedRevision: 0 }],
    [content({ origin: { url: 'http://insecure.example', observedAt: ISO } }), { expectedRevision: 0 }],
    [content({ origin: { url: 'https://x.example/a?b', observedAt: ISO } }), { expectedRevision: 0 }],
    [content({ downSince: 'yesterday' }), { expectedRevision: 0 }],
    [content({ cleanup: { certainty: 'maybe', debt: null } }), { expectedRevision: 0 }],
    [content({ cleanup: { certainty: 'unconfirmed', debt: null } }), { expectedRevision: 0 }],
    // Unconfirmed cleanup requires the stopped run it belongs to.
    [content({ cleanup: debtOf(run()) }), { expectedRevision: 0 }],
  ];
  for (const [record, options] of bad) await rejects(state.commit(record, options), 'invalid_input');
  await assert.rejects(stat(home), { code: 'ENOENT' }, 'no directory was created for invalid input');
});

test('bounded reference model: every transition in the table replays against the real store', async t => {
  const home = await scratch(t);
  const body = (run, cleanup) => ({ run, approval: null, origin: null, downSince: null, cleanup });
  const stopped = r => body({ ...r, phase: 'stopped' }, settledCleanup());
  const seeds = {
    starting: { first: body(run({ phase: 'starting' }), settledCleanup()), then: null },
    awaiting: { first: body(run({ phase: 'awaiting' }), settledCleanup()), then: null },
    active: { first: body(run({ phase: 'active' }), settledCleanup()), then: null },
    'stopped-settled': { first: body(run({ phase: 'starting' }), settledCleanup()), then: stopped(run()) },
    'stopped-debt': { first: body(run({ phase: 'starting' }), settledCleanup()),
      then: body(run({ phase: 'stopped' }), debtOf(run())) },
  };
  const builders = {
    sameActive: c => body({ ...c.run, phase: 'active' }, settledCleanup()),
    sameStoppedSettled: c => stopped(c.run),
    sameStoppedDebt: c => body({ ...c.run, phase: 'stopped' }, debtOf(c.run)),
    freshStarting: c => body({ ...c.run, id: RUN_B, generation: c.run.generation + 1, phase: 'starting' }, settledCleanup()),
    freshSameGen: c => body({ ...c.run, id: RUN_B, generation: c.run.generation, phase: 'starting' }, settledCleanup()),
    freshStopped: c => body({ id: RUN_B, generation: c.run.generation + 1, operationId: null, handle: null,
      provider: null, phase: 'stopped' }, { certainty: 'unconfirmed',
      debt: { runId: RUN_B, generation: c.run.generation + 1, since: ISO } }),
    sameIdNextGen: c => body({ ...c.run, generation: c.run.generation + 1, phase: 'active' }, settledCleanup()),
  };
  // The model: which commit each current state admits. Error rows assert nothing is written.
  const model = {
    starting: { sameActive: 'ok', sameStoppedSettled: 'ok', sameStoppedDebt: 'ok', freshStarting: 'route_conflict',
      freshSameGen: 'route_conflict', freshStopped: 'route_conflict', sameIdNextGen: 'invalid_input' },
    awaiting: { sameActive: 'ok', sameStoppedSettled: 'ok', sameStoppedDebt: 'ok', freshStarting: 'route_conflict',
      freshSameGen: 'route_conflict', freshStopped: 'route_conflict', sameIdNextGen: 'invalid_input' },
    active: { sameActive: 'ok', sameStoppedSettled: 'ok', sameStoppedDebt: 'ok', freshStarting: 'route_conflict',
      freshSameGen: 'route_conflict', freshStopped: 'route_conflict', sameIdNextGen: 'invalid_input' },
    'stopped-settled': { sameActive: 'stopped_by_user', sameStoppedSettled: 'ok', sameStoppedDebt: 'ok',
      freshStarting: 'ok', freshSameGen: 'invalid_input', freshStopped: 'invalid_input', sameIdNextGen: 'invalid_input' },
    'stopped-debt': { sameActive: 'stopped_by_user', sameStoppedSettled: 'ok', sameStoppedDebt: 'ok',
      freshStarting: 'cleanup_debt', freshSameGen: 'cleanup_debt', freshStopped: 'cleanup_debt', sameIdNextGen: 'invalid_input' },
  };
  let index = 0;
  for (const [seedName, seed] of Object.entries(seeds)) {
    for (const [name, build] of Object.entries(builders)) {
      const label = `${seedName} + ${name}`;
      const state = store(home, `m${index++}`);
      const first = await state.commit(seed.first, { expectedRevision: 0 });
      const current = seed.then ? await state.commit(seed.then, { expectedRevision: first.revision }) : first;
      const next = build(current);
      const expected = model[seedName][name];
      if (expected === 'ok') {
        const committed = await state.commit(next, { expectedRevision: current.revision });
        assert.equal(committed.revision, current.revision + 1, `${label} advances the revision`);
      } else {
        await rejects(state.commit(next, { expectedRevision: current.revision }), expected, null, label);
        assert.equal((await state.read()).revision, current.revision, `${label} changed nothing`);
      }
    }
  }
});
