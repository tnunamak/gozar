import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, lstat, open, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const markdown = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const blocks = [...markdown.matchAll(/^```js\n([\s\S]*?)^```/gm)]
  .map(match => match[1]).filter(source => source.includes("const intentPath = join(intentDirectory, 'demo-route.json');"));
assert.equal(blocks.length, 1, 'execute exactly one actual durable-intent README example');
const imports = [
  "import { homedir } from 'node:os';",
  "import { join } from 'node:path';",
  "import { createInterface } from 'node:readline/promises';",
  "import { mkdir, lstat, open, readFile } from 'node:fs/promises';",
  "import { randomUUID } from 'node:crypto';",
  "import { catalogRoutes, expose, listRoutes, watchRoutes, closeRoute } from '@tnunamak/gozar';",
];
let source = blocks[0];
for (const declaration of imports) {
  assert.equal(source.split(declaration).length, 2, 'only known example imports may be injected');
  source = source.replace(declaration, '');
}
assert.doesNotMatch(source, /^\s*import\b/m, 'no unbound imports or live provider access');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('homedir', 'join', 'createInterface', 'mkdir', 'lstat', 'open',
  'readFile', 'randomUUID', 'catalogRoutes', 'expose', 'listRoutes', 'watchRoutes', 'closeRoute',
  'process', 'console', source);
const handle = {kind: 'session', id: 'owned-example-handle'};
const candidate = {eligible: true, candidateToken: 'fixture-candidate',
  consentFactsDigest: 'fixture-digest', disclosure: {revision: 'fixture-revision', text: 'Fixture disclosure'},
  consent: {disclosures: [{kind: 'fixture-disclosure'}], facts: [{label: 'Fixture fact', known: true, value: 'Fixture value', affectsConsent: true}]}};

async function runExample({recovered, saved = true, answer = 'y', listFails = false,
  catalogFails = true, cleanup = 'confirmed', wrongIntent = false} = {}) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-readme-recovery-'));
  const stateDirectory = join(home, 'gozar-state');
  const query = {schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:18765', home: stateDirectory,
    usage: {kind: 'session', lifetimeMs: 900_000},
    requirements: {reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: []}};
  const intentDirectory = join(home, '.gozar-route-example'), intentPath = join(intentDirectory, 'demo-route.json');
  const operationId = 'fixture-operation-id';
  const calls = [], logs = [];
  let releaseWatch, timer, run;
  const watchClosed = new Promise(resolve => { releaseWatch = resolve; });
  const exit = Symbol('example exit');
  const record = (name, value) => calls.push({name, value});
  let before;
  try {
    if (saved) {
      await mkdir(intentDirectory, {mode: 0o700});
      before = JSON.stringify({version: 1, intent: JSON.stringify(wrongIntent ? {...query, target: '127.0.0.1:9999'} : query), operationId}) + '\n';
      await writeFile(intentPath, before, {mode: 0o600});
    }
    const route = {operationId, handle, state: 'unverified', published: 'https://historical.invalid',
      cleanup: {state: recovered === 'terminal' ? 'confirmed' : 'unconfirmed'}};
    const api = {
      catalogRoutes: async value => {
        record('catalog', value);
        if (catalogFails) throw new Error('catalog unavailable');
        assert.deepEqual(value, query);
        return {candidates: [candidate]};
      },
      listRoutes: async value => {
        record('list', value);
        assert.deepEqual(value, {home: stateDirectory, owner: query.owner});
        if (listFails) throw new Error('listing unavailable');
        return {routes: recovered ? [route] : []};
      },
      expose: async value => {
        record('expose', value);
        assert.deepEqual(value, {...query, operationId, wait: 'verified',
          approval: {candidateToken: candidate.candidateToken, consentFactsDigest: candidate.consentFactsDigest,
            kind: 'route', disclosureRevision: candidate.disclosure.revision}});
        return {...route, published: null};
      },
      watchRoutes: async function* (value) {
        record('watch', {home: value.home, handle: value.handle});
        assert.equal(value.home, stateDirectory);
        assert.deepEqual(value.handle, handle);
        await watchClosed;
        yield {type: 'terminal', route: {state: 'released', published: null}};
      },
      closeRoute: async value => {
        record('close', value);
        assert.deepEqual(value, {home: stateDirectory, handle, mode: 'remove'});
        releaseWatch();
        return {handle, cleanup: {state: cleanup}};
      },
    };
    const readline = () => {
      record('readline');
      return {question: async question => {
        record('question', question);
        return question.startsWith('Press Enter') ? '' : answer;
      }, close: () => record('readline-close')};
    };
    run = execute(() => home, join, readline, mkdir, lstat, open, readFile,
      () => {record('uuid'); return operationId;},
      api.catalogRoutes, api.expose, api.listRoutes, api.watchRoutes, api.closeRoute,
      {env: {GOZAR_HOME: stateDirectory}, getuid: () => process.getuid(), stdin: null, stdout: null,
        exit: code => {assert.equal(code, 0); throw exit;}},
      {log: (...args) => logs.push(args)});
    const outcome = await Promise.race([
      run.then(() => null, error => error === exit ? null : error),
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('README fixture deadline')), 2000);}),
    ]);
    const after = await readFile(intentPath, 'utf8');
    if (saved) assert.equal(after, before, 'recovery must not replace intent or operation ID');
    else assert.equal(JSON.parse(after).operationId, operationId);
    assert.equal((await lstat(intentPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(intentDirectory)).mode & 0o777, 0o700);
    return {calls, logs, outcome};
  } finally {
    clearTimeout(timer);
    releaseWatch();
    // Release the owned watcher and settle the example before deleting its private files.
    // Retain evidence if a future example change prevents bounded settlement.
    if (run) {
      let drainTimer;
      try {
        await Promise.race([
          run.catch(() => {}),
          new Promise((_, reject) => {
            drainTimer = setTimeout(() => reject(new Error('Example did not settle; retained fixture: ' + home)), 1000);
          }),
        ]);
      } finally { clearTimeout(drainTimer); }
    }
    await rm(home, {recursive: true, force: true});
  }
}
const count = (result, name) => result.calls.filter(call => call.name === name).length;

test('README recovers and closes the exact handle without catalog or expose', async () => {
  const result = await runExample({recovered: 'unconfirmed'});
  assert.equal(result.outcome, null);
  assert.equal(count(result, 'list'), 1);
  assert.equal(count(result, 'catalog'), 0);
  assert.equal(count(result, 'expose'), 0);
  assert.equal(count(result, 'close'), 1);
  assert.equal(count(result, 'uuid'), 0);
  assert.ok(!JSON.stringify(result.logs).includes('https://historical.invalid'));
});

test('README confirmed terminal recovery never catalogs or prompts or reallocates', async () => {
  const result = await runExample({recovered: 'terminal'});
  assert.equal(result.outcome, null);
  for (const name of ['catalog', 'expose', 'close', 'readline', 'uuid']) assert.equal(count(result, name), 0);
  assert.equal(count(result, 'list'), 1);
});

test('README absent retained route catalogs and obtains approval before fresh allocation', async () => {
  for (const saved of [false, true]) {
    const result = await runExample({saved, catalogFails: false});
    assert.equal(result.outcome, null);
    assert.equal(count(result, 'catalog'), 1);
    assert.equal(count(result, 'expose'), 1);
    assert.equal(count(result, 'close'), 1);
    const names = result.calls.map(call => call.name);
    assert.ok(names.indexOf('catalog') < names.indexOf('question'));
    assert.ok(names.indexOf('question') < names.indexOf('expose'));
    assert.ok(result.logs.some(args => args[0] === 'Fixture disclosure'));
    assert.ok(result.logs.some(args => args[0] === 'Fixture fact'));
  }
});

test('README refusal or catalog failure cannot allocate', async () => {
  const refused = await runExample({catalogFails: false, answer: 'n'});
  assert.equal(refused.outcome, null);
  assert.equal(count(refused, 'catalog'), 1);
  assert.equal(count(refused, 'expose'), 0);
  const failed = await runExample();
  assert.match(failed.outcome.message, /catalog unavailable/);
  assert.equal(count(failed, 'expose'), 0);
});

test('README failed listing refuses before catalog and preserves the original intent', async () => {
  const result = await runExample({listFails: true, catalogFails: false});
  assert.match(result.outcome.message, /listing unavailable/);
  for (const name of ['catalog', 'expose', 'close', 'uuid']) assert.equal(count(result, name), 0);
});

test('README changed exact intent refuses before listing or allocation', async () => {
  const result = await runExample({wrongIntent: true, catalogFails: false});
  assert.match(result.outcome.message, /Different or unreadable intent/);
  for (const name of ['list', 'catalog', 'expose', 'uuid']) assert.equal(count(result, name), 0);
});

test('README unconfirmed cleanup retains intent after closing the exact recovered handle', async () => {
  const result = await runExample({recovered: 'unconfirmed', cleanup: 'unconfirmed'});
  assert.match(result.outcome.message, /Cleanup is unconfirmed/);
  assert.equal(count(result, 'close'), 1);
  assert.equal(count(result, 'catalog'), 0);
  assert.equal(count(result, 'expose'), 0);
});
