// The packed tarball, installed into a fresh project, behaves like the repository: the root and /service exports
// import, the root exports are exactly the functions route-contract.d.ts declares, and the catalog answers from the
// installed registry bytes. The probe runs with an empty PATH and no provider socket, so no provider is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('installed package: root and /service import, exports equal the contract, catalogRoutes runs on the installed bytes', async t => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  const base = await mkdtemp(join(homedir(), '.tmp', 'gozar-installed-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const pack = join(base, 'pack'), project = join(base, 'project'), stateHome = join(base, 'home'), emptyBin = join(base, 'bin');
  for (const dir of [pack, project, emptyBin]) await mkdir(dir);
  await mkdir(stateHome, { mode: 0o700 });

  // npm 11 prints an object keyed by package name; npm 10 printed an array.
  const output = JSON.parse((await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', pack], { cwd: root, timeout: 120_000 })).stdout);
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0];
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  // The optional ngrok SDK is never installed here: attached ngrok routes load it lazily and no probe reaches it.
  await exec('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', join(pack, packed.filename)], { cwd: project, timeout: 120_000 });
  const installed = join(project, 'node_modules', '@tnunamak', 'gozar');

  const probe = join(project, 'probe.mjs');
  await writeFile(probe, `import * as root from '@tnunamak/gozar';
import * as service from '@tnunamak/gozar/service';
import * as testing from '@tnunamak/gozar/testing';
import { readFile } from 'node:fs/promises';
const dts = await readFile(new URL('./node_modules/@tnunamak/gozar/packages/gozar-node/route-contract.d.ts', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('./node_modules/@tnunamak/gozar/package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('./node_modules/@tnunamak/gozar/adapters/manifest.json', import.meta.url), 'utf8'));
const declared = [...dts.matchAll(/^export function (\\w+)/gm)].map(match => match[1]);
const catalog = await root.catalogRoutes({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:9', home: ${JSON.stringify(stateHome)},
  usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } });
const registry = await testing.fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
const fake = testing.createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: testing.fakeReadContext({ home: ${JSON.stringify(stateHome)} }) });
const fakeCatalog = await fake.catalogRoutes({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:9', home: ${JSON.stringify(stateHome)}, usage: { kind: 'session', lifetimeMs: 60000 },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } });
await registry.cleanup();
console.log(JSON.stringify({ testingExports: Object.keys(testing).sort(), fakeIds: fakeCatalog.candidates.map(item => item.providerId), fakeEligible: fakeCatalog.candidates.map(item => item.eligible), rootExports: Object.keys(root).sort(), serviceExports: Object.keys(service).sort(), declared: [...new Set(declared)].sort(),
  types: pkg.types, exportsTypes: pkg.exports['.'].types, engines: pkg.engines.node, providers: manifest.providers.map(item => item.id),
  candidates: catalog.candidates.length, observedAt: typeof catalog.observedAt, tokens: catalog.candidates.filter(item => item.candidateToken).length }));
`);
  const { stdout } = await exec(process.execPath, [probe], { cwd: project, timeout: 60_000, env: { PATH: emptyBin, HOME: stateHome, GOZAR_HOME: stateHome, TMPDIR: stateHome } });
  const seen = JSON.parse(stdout);
  assert.deepEqual(seen.rootExports, seen.declared, 'the root exports exactly the functions route-contract.d.ts declares');
  assert.deepEqual(seen.serviceExports, ['addService', 'cancelHandBack', 'confirmHandBack', 'createServiceVerifier', 'releaseRoute', 'removeService', 'statusServices']);
  assert.deepEqual(seen.testingExports, ['createReadContext', 'createRouteApi', 'fakeReadContext', 'fakeRegistry', 'fakeRouteScenarios'], 'the testing export is in the archive and names its public helpers');
  assert.deepEqual(seen.fakeIds, ['fake-0a1b2c3d']);
  assert.deepEqual(seen.fakeEligible, [true], 'the fake provider is listed from the installed bytes');
  assert.equal(seen.types, './packages/gozar-node/route-contract.d.ts');
  assert.equal(seen.exportsTypes, seen.types);
  assert.equal(seen.engines, '>=22.13');
  assert.deepEqual(seen.providers, JSON.parse(await readFile(new URL('../../adapters/manifest.json', import.meta.url), 'utf8')).providers.map(provider => provider.id), 'the installed registry is the source registry');
  assert.equal(seen.candidates, seen.providers.length, 'one candidate per installed registry entry');
  assert.equal(seen.tokens, 0, 'nothing is ready on a host with no provider tooling, so no token is issued');
  const example = join(installed, 'examples/remote-access-screen.mjs');
  const exampleEnv = { PATH: emptyBin, HOME: stateHome, GOZAR_HOME: stateHome, TMPDIR: stateHome };
  const fakeScreen = await exec(process.execPath, [example, '--fakes'], { cwd: project, timeout: 60_000, env: exampleEnv });
  for (const kind of ['session', 'attached', 'durable']) for (const state of ['detected', 'verified', 'expired', 'cleanup-unconfirmed']) {
    assert.ok(fakeScreen.stdout.includes(`Route: ${kind} ${state}`), `${kind} ${state}`);
  }
  assert.match(fakeScreen.stdout, /Credential present.*true/);
  assert.doesNotMatch(fakeScreen.stdout, /fixture-credential-value/);
  const detectedScreen = await exec(process.execPath, [example, '--detect'], { cwd: project, timeout: 60_000, env: exampleEnv });
  assert.match(detectedScreen.stdout, /detect-only/);
  assert.match(detectedScreen.stdout, /needs-provider-call/);
  const fixture = JSON.parse((await exec(process.execPath, [join(installed, 'examples/provider-lifecycle-fixture.mjs')], { cwd: project, timeout: 60_000, env: exampleEnv })).stdout);
  assert.match(fixture.providerId, /^fixture-[a-f0-9]{16}$/);
  assert.deepEqual(fixture.events, ['setup', 'start', 'proof', 'stop', 'cleanup']);
  assert.deepEqual(fixture.facts.map(fact => [fact.known, fact.value]), [[true, false], [true, 0], [true, ''], [false, null]]);
  assert.equal(fixture.inputRequirements[0].secret, true);
  assert.match(fixture.screen, /Input requirement: Fixture credential/);
  assert.deepEqual(fixture.resourceLedger, { ownedAfter: [], foreignPreserved: true });
  assert.equal(fixture.statusPreservedProofTime, true);
  for (const path of ['packages/gozar-node/route-contract.d.ts', 'runtime/route-catalog.schema.json', 'runtime/error-normalization.json', 'adapters/providers/ngrok-https-edge/index.mjs']) {
    assert.ok((await readFile(join(installed, path), 'utf8')).length > 0, path);
  }
  // The installed CLI answers a route-contract command with one envelope and the documented exit code.
  const bin = join(project, 'node_modules', '.bin', 'gozar');
  const run = await exec(process.execPath, [bin, 'catalog', '--json'], { cwd: project, env: { PATH: emptyBin, HOME: stateHome, GOZAR_HOME: stateHome } }).catch(error => error);
  assert.equal(run.code, 1);
  assert.equal(JSON.parse(run.stdout).error.code, 'invalid_input');
});
