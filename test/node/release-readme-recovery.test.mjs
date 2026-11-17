import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The README example is extracted verbatim and run against a recording stand-in for the package.
// It checks the example's own control flow (recovery order), not the real route runtime.
const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const marker = "import { catalogRoutes, expose, listRoutes, watchRoutes, closeRoute }";
const start = readme.lastIndexOf('```js\n', readme.indexOf(marker)) + 6;
const snippet = readme.slice(start, readme.indexOf('\n```', start));

const fakePackage = `
import {appendFileSync} from 'node:fs';
const log = (name, arg) => appendFileSync(process.env.FAKE_LOG, JSON.stringify({name, arg}) + '\\n');
export const catalogRoutes = async query => { log('catalogRoutes', query.owner);
  if (process.env.FAKE_CATALOG === 'fail') throw new Error('catalog down');
  return {candidates: [], noMatch: {code: 'no_candidates'}}; };
export const listRoutes = async arg => { log('listRoutes', arg.owner);
  if (process.env.FAKE_LIST === 'fail') throw new Error('list failed');
  const state = process.env.FAKE_LIST === 'confirmed' ? 'confirmed' : 'pending';
  return {routes: [{operationId: process.env.FAKE_OPERATION_ID, handle: 'h-1', cleanup: {state}, published: 'https://old.example'}]}; };
export const expose = async arg => { log('expose', arg); throw new Error('expose must not run on recovery'); };
export const watchRoutes = async function* () {};
export const closeRoute = async arg => { log('closeRoute', arg); return {cleanup: {state: 'confirmed'}}; };
`;

async function seedHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'readme-recovery-'));
  t.after(() => rm(home, {recursive: true, force: true}));
  const pkg = join(home, 'node_modules', '@tnunamak', 'gozar');
  await mkdir(pkg, {recursive: true});
  await writeFile(join(pkg, 'package.json'), JSON.stringify({name: '@tnunamak/gozar', type: 'module', exports: './index.mjs'}));
  await writeFile(join(pkg, 'index.mjs'), fakePackage);
  await writeFile(join(home, 'route-example.mjs'), snippet);
  return home;
}
// Runs the extracted example once in `home`; the app intent file under home persists between runs.
async function exec(home, env, operationId = '') {
  const log = join(home, 'calls.jsonl');
  await writeFile(log, '');
  const child = spawn(process.execPath, [join(home, 'route-example.mjs')], {
    cwd: home, stdio: ['pipe', 'pipe', 'pipe'],
    env: {PATH: process.env.PATH, HOME: home, GOZAR_HOME: join(home, 'state'), FAKE_LOG: log, FAKE_OPERATION_ID: operationId, ...env},
  });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  setTimeout(() => child.stdin.write('y\n'), 400);
  setTimeout(() => child.stdin.write('\n'), 900);
  const code = await new Promise(resolve => child.on('close', resolve));
  const calls = (await readFile(log, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  return {code, out, err, calls, names: calls.map(c => c.name)};
}
// First run: new allocation. The catalog finds nothing, but the intent and operation ID are saved first.
async function firstRun(t) {
  const home = await seedHome(t);
  const first = await exec(home, {});
  assert.notEqual(first.code, 0);
  assert.deepEqual(first.names, ['catalogRoutes']);
  const saved = JSON.parse(await readFile(join(home, '.gozar-route-example', 'demo-route.json'), 'utf8'));
  return {home, operationId: saved.operationId};
}

test('README recovery closes a retained route without the catalog, approval or expose, even when the catalog is down', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'pending'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes', 'closeRoute']);
  assert.equal(second.calls[1].arg.handle, 'h-1');
  assert.equal(second.calls[1].arg.mode, 'remove');
  assert.match(second.out, /Not currently published/); // historical publication is suppressed
  assert.doesNotMatch(second.out, /old\.example/);
});
test('a confirmed terminal operation ends with no catalog, no close and no expose', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_CATALOG: 'fail', FAKE_LIST: 'confirmed'}, operationId);
  assert.equal(second.code, 0, second.err);
  assert.deepEqual(second.names, ['listRoutes']);
  assert.match(second.out, /already closed/);
});
test('a failed listing refuses the restart: no catalog, no expose, no close', async t => {
  const {home, operationId} = await firstRun(t);
  const second = await exec(home, {FAKE_LIST: 'fail'}, operationId);
  assert.notEqual(second.code, 0);
  assert.match(second.err, /list failed/);
  assert.deepEqual(second.names, ['listRoutes']);
});
