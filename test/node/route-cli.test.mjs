// CLI parity for the route contract: every command takes its request from files, prints one envelope on stdout that
// validates against the frozen schema, sends progress to stderr, and reaches each documented exit code. Spawned runs use
// the real binary against the durable fakes; in-process runs inject a registry-only provider for the attached lease.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';
import { exitCodeFor, routeMain } from '../../packages/gozar-node/route-cli.mjs';
import { approvalFrom, cli, durableWorld, fakeRegistry, journeyRoot, network } from './journey-world.mjs';
import { assertShape, fixtures } from './route-schema-check.mjs';

let world;
before(async () => { world = await journeyRoot(); });
after(() => rm(world.root, { recursive: true, force: true }));

/** Runs the real binary once. Resolves with exit code, stdout and stderr; never leaves the child behind. */
function gozar(env, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', network, cli, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}
const envelope = result => {
  const lines = result.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `stdout must be one envelope, got: ${result.stdout}`);
  return JSON.parse(lines[0]);
};
const privateFile = async (path, value) => { await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); await chmod(path, 0o600); return path; };
const files = async (w, name) => { const dir = join(w.home, '..', 'cli-files'); await mkdir(dir, { recursive: true }); return join(dir, name); };

test('real binary journey: catalog -> ensure -> watch (NDJSON) -> stop, with the legacy status and stop still working', async t => {
  const w = await durableWorld(world, t);
  const queryFile = await privateFile(await files(w, 'query.json'), w.query());

  const catalog = await gozar(w.env, ['catalog', '--query-file', queryFile, '--json']);
  assert.equal(catalog.code, 0, catalog.stderr);
  assertShape('Catalog', envelope(catalog));
  assert.match(catalog.stderr, /catalog/i, 'progress is on stderr');
  const { approval } = approvalFrom(envelope(catalog));
  const approvalFile = await privateFile(await files(w, 'approval.json'), approval);

  const ensured = await gozar(w.env, ['ensure', '--query-file', queryFile, '--approval-file', approvalFile, '--json']);
  assert.equal(ensured.code, 0, ensured.stderr + ensured.stdout);
  const view = envelope(ensured);
  assertShape('RouteView', view);
  assert.equal(view.state, 'usable');
  assert.deepEqual(await w.cliCalls(), [], 'the durable path makes no provider CLI call');

  const again = await gozar(w.env, ['ensure', '--query-file', queryFile, '--json']);
  assert.equal(again.code, 0, again.stderr + again.stdout);
  assert.equal(envelope(again).handle.id, view.handle.id, 'a later identical ensure needs no approval');

  // watch: NDJSON until the route is stopped from outside.
  const handleFile = await files(w, 'handle.json');
  await writeFile(handleFile, JSON.stringify({ home: w.home, handle: view.handle }));
  const child = spawn(process.execPath, ['--import', network, cli, 'watch', '--handle-file', handleFile, '--interval-ms', '250', '--json'], { env: w.env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  const firstLine = async () => { for (let waited = 0; waited < 20_000; waited += 50) { if (out.includes('\n')) return out.split('\n')[0]; await new Promise(r => setTimeout(r, 50)); } throw new Error('no event'); };
  const snapshot = JSON.parse(await firstLine());
  assertShape('WatchEvent', snapshot);
  assert.equal(snapshot.type, 'snapshot');

  const stopped = await gozar(w.env, ['stop', '--route', view.handle.id, '--json']);
  assert.equal(stopped.code, 0, stopped.stderr + stopped.stdout);
  assert.equal(await closed, 0, 'watch ends on the terminal event');
  const events = out.split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const event of events) assertShape('WatchEvent', event);
  assert.equal(events.at(-1).type, 'terminal');
  assert.equal(events.at(-1).route.state, 'released');
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index));
});

test('exit codes: 0 ok, 2 requirements, 3 missing or stale approval, 1 operational or usage — each reachable through the binary', async t => {
  const w = await durableWorld(world, t);
  const queryFile = await privateFile(await files(w, 'query.json'), w.query());
  const run = args => gozar(w.env, [...args, '--json']);
  const failure = (result, code) => {
    const body = envelope(result);
    assertShape('GozarError', body);
    assert.equal(body.error.code, code, JSON.stringify(body));
    return body;
  };

  assert.equal((await run(['catalog', '--query-file', queryFile])).code, 0);

  // 2: nothing meets the requirement. The catalog still prints its answer; the code says it is unmet.
  const impossible = await privateFile(await files(w, 'impossible.json'), w.query({ requirements: { ...w.query().requirements, reach: 'lan' } }));
  const unmet = await run(['catalog', '--query-file', impossible]);
  assert.equal(unmet.code, 2);
  assert.equal(envelope(unmet).noMatch.code, 'requirements_unsatisfied');

  // 3: no approval for a first allocation.
  const missing = await run(['ensure', '--query-file', queryFile]);
  assert.equal(missing.code, 3);
  failure(missing, 'consent_required');
  // 3: a token that is not one the catalog issued.
  const forged = await privateFile(await files(w, 'forged.json'), { candidateToken: 'tok_not_real', disclosureRevision: 'disc-none' });
  const stale = await run(['ensure', '--query-file', queryFile, '--approval-file', forged]);
  assert.equal(stale.code, 3);
  assert.ok(['consent_unknown', 'candidate_stale', 'consent_mismatch'].includes(envelope(stale).error.code));
  // 3: adopt and expose need an approval; there is no flag to skip it.
  const handover = await privateFile(await files(w, 'handover.json'), { from: 'example-app', generation: 1 });
  const noApproval = await run(['adopt', '--query-file', queryFile, '--handover-file', handover]);
  assert.equal(noApproval.code, 3);
  failure(noApproval, 'consent_required');

  // 1: usage and schema errors, including an attempt at a bypass flag.
  for (const args of [['ensure', '--query-file', queryFile, '--yes'], ['catalog'], ['catalog', '--query-file', join(w.home, 'nope.json')], ['preference', 'frobnicate']]) {
    const result = await run(args);
    assert.equal(result.code, 1, args.join(' '));
    failure(result, 'invalid_input');
  }
  // 1: an approval another user could read is refused before it is used.
  const open = await files(w, 'open-approval.json');
  await writeFile(open, JSON.stringify({ candidateToken: 'tok', disclosureRevision: 'd' }), { mode: 0o644 }); await chmod(open, 0o644);
  const loose = await run(['ensure', '--query-file', queryFile, '--approval-file', open]);
  assert.equal(loose.code, 1);
  assert.match(envelope(loose).error.message, /0600/);
  assert.deepEqual(w.state.writes, [], 'none of these touched the provider');
});

test('preference show and set round-trip, and a stale revision is a conflict', async t => {
  const w = await durableWorld(world, t);
  const profile = join(w.home, '..', 'profile');
  await mkdir(profile, { mode: 0o700, recursive: true });
  const run = args => gozar(w.env, [...args, '--json']);
  const shown = await run(['preference', 'show', '--profile-home', profile]);
  assert.equal(shown.code, 0, shown.stderr + shown.stdout);
  assertShape('PreferenceRecord', envelope(shown));
  assert.equal(envelope(shown).revision, 0);
  const queryFile = await privateFile(await files(w, 'query.json'), w.query());
  const { candidate } = approvalFrom(envelope(await run(['catalog', '--query-file', queryFile])));
  const set = await run(['preference', 'set', '--profile-home', profile, '--expected-revision', '0', '--prefer', candidate.preferenceRef]);
  assert.equal(set.code, 0, set.stderr + set.stdout);
  assert.deepEqual(envelope(set).adapterPreference, [candidate.preferenceRef]);
  const conflict = await run(['preference', 'set', '--profile-home', profile, '--expected-revision', '0', '--prefer', candidate.preferenceRef]);
  assert.equal(conflict.code, 1);
  assert.equal(envelope(conflict).error.code, 'preference_conflict');
});

test('setup refuses a world-readable secret file and never prints the secret', async t => {
  const w = await durableWorld(world, t);
  const approval = await privateFile(await files(w, 'setup-approval.json'), { digest: 'sha256:none', disclosureRevision: 'disc-none' });
  const secret = await files(w, 'secret.txt');
  await writeFile(secret, 'synthetic-secret-value\n', { mode: 0o644 }); await chmod(secret, 0o644);
  const loose = await gozar(w.env, ['setup', 'some-action', '--approval-file', approval, '--secret-file', secret, '--home', w.home, '--json']);
  assert.equal(loose.code, 1);
  assert.doesNotMatch(loose.stdout + loose.stderr, /synthetic-secret-value/);
  // An action the catalog does not list is stale, with a private secret too: still no echo.
  await chmod(secret, 0o600);
  const stale = await gozar(w.env, ['setup', 'some-action', '--approval-file', approval, '--secret-file', secret, '--home', w.home, '--json']);
  assert.equal(stale.code, 3, stale.stdout + stale.stderr);
  assertShape('GozarError', envelope(stale));
  assert.doesNotMatch(stale.stdout + stale.stderr, /synthetic-secret-value/);
});

test('every frozen error code has one exit code, and every failure envelope validates', async t => {
  const expected = { requirements_unsatisfied: 2, setup_required: 2, unsupported: 2, consent_required: 3, consent_unknown: 3, consent_expired: 3, consent_mismatch: 3,
    candidate_stale: 3, route_not_found: 3 };
  const w = await fakeRegistry(world, t);
  const queryFile = await privateFile(join(w.root, 'query.json'), w.attached());
  for (const code of fixtures.frozenErrorCodes) {
    const lines = [];
    const api = { catalogRoutes: async () => { throw Object.assign(new Error(`${code} happened`), { code }); } };
    const exit = await routeMain(['catalog', '--query-file', queryFile, '--json'], { api, stdout: { write: line => lines.push(line) }, stderr: { write() {} } });
    assert.equal(exit, expected[code] ?? 1, code);
    assert.equal(exitCodeFor(code), exit);
    const body = JSON.parse(lines.join(''));
    assertShape('GozarError', body);
    assert.equal(body.error.code, code);
  }
});

test('expose of an attached route is held by the CLI process: stdin closing ends it', async t => {
  const w = await fakeRegistry(world, t);
  const api = createRouteApi({ manifest: w.manifest, root: w.root, expose: { controllerModule: w.controller } });
  const lines = [], errors = [];
  const stdout = { write: line => lines.push(line) }, stderr = { write: line => errors.push(line) };
  const queryFile = await privateFile(join(w.root, 'query.json'), w.attached());
  const { result: catalog } = { result: await api.catalogRoutes(w.attached()) };
  const approvalFile = await privateFile(join(w.root, 'approval.json'), approvalFrom(catalog).approval);

  const stdin = new PassThrough();
  const running = routeMain(['expose', '--query-file', queryFile, '--approval-file', approvalFile, '--wait', 'verified', '--json'], { api, stdin, stdout, stderr });
  for (let waited = 0; waited < 20_000 && !lines.length; waited += 50) await new Promise(r => setTimeout(r, 50));
  assert.equal(lines.length, 1, 'one envelope while the route is held');
  const view = JSON.parse(lines[0]);
  assertShape('RouteView', view);
  assert.equal(view.handle.kind, 'attached');
  assert.deepEqual(await w.writesSeen(), ['create']);
  assert.match(errors.join(''), /Close stdin/);
  const status = await api.routeStatus({ home: w.home, handle: view.handle });
  assert.equal(status.state, 'usable', 'the route is up while the lease is held');

  stdin.end();
  assert.equal(await running, 0);
  assert.equal(lines.length, 1, 'ending the lease prints no second envelope');
  assert.deepEqual(await w.writesSeen(), ['create', 'remove'], 'the route was removed when the lease ended');
  const after = await api.routeStatus({ home: w.home, handle: view.handle }).catch(error => error);
  assert.ok(after.code === 'route_not_found' || after.state === 'released', 'the route is gone after the lease ends');
});

test('red: expose without an approval file cannot publish, whatever else is passed', async t => {
  const w = await fakeRegistry(world, t);
  const api = createRouteApi({ manifest: w.manifest, root: w.root, expose: { controllerModule: w.controller } });
  const queryFile = await privateFile(join(w.root, 'query.json'), w.attached());
  const lines = [];
  const exit = await routeMain(['expose', '--query-file', queryFile, '--json'], { api, stdin: new PassThrough(), stdout: { write: line => lines.push(line) }, stderr: { write() {} } });
  assert.equal(exit, 3);
  assert.equal(JSON.parse(lines.join('')).error.code, 'consent_required');
  assert.deepEqual(await w.writesSeen(), []);
});

test('--provider-id sets query.providerId for catalog, and a query file value is replaced by the flag', async t => {
  const w = await durableWorld(world, t);
  const queryFile = await privateFile(await files(w, 'provider-query.json'), { ...w.query(), providerId: 'from-file' });
  const seen = [];
  const api = { catalogRoutes: async query => { seen.push(query.providerId); return { schemaVersion: 1, candidates: [], ranking: { order: [], reasons: [] } }; } };
  const run = args => routeMain(['catalog', '--query-file', queryFile, ...args, '--json'], { api, stdout: { write() {} }, stderr: { write() {} } });
  await run(['--provider-id', 'example-provider']);
  await run([]);
  assert.deepEqual(seen, ['example-provider', 'from-file']);
  assert.equal(await routeMain(['setup', 'x', '--provider-id', 'a', '--json'], { api, stdout: { write() {} }, stderr: { write() {} } }), 1, 'a command that takes no provider id refuses the flag');
});
