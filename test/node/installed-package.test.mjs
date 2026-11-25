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

const assertFixturePresentation = rows => {
  assert.deepEqual(rows.map(row => ({
    id: row.providerId,
    name: row.displayName,
    idle: row.idleTimeoutMs,
    account: row.needsAccount,
    undeclaredCopy: row.copy?.human?.summary,
  })), [
    { id: 'fake-meta-zero', name: { known: true, value: 'Fixture Zero' },
      idle: { known: true, value: 0 }, account: { known: true, value: false },
      undeclaredCopy: { known: false, reason: 'not-declared' } },
    { id: 'fake-meta-null', name: { known: true, value: 'Fixture Null' },
      idle: { known: true, value: null }, account: { known: true, value: false },
      undeclaredCopy: { known: false, reason: 'not-declared' } },
  ]);
};

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

  const consumer = join(project, 'release-public-api-consumer.ts');
  await writeFile(consumer, await readFile(new URL('../fixtures/release-public-api-consumer.ts', import.meta.url)));
  const tsconfig = join(project, 'tsconfig.json');
  await writeFile(tsconfig, JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ['release-public-api-consumer.ts'],
  }));
  await exec(process.env.GOZAR_TSC || 'tsc', ['--project', tsconfig, '--pretty', 'false'], { cwd: project, timeout: 30_000 });

  const probe = join(project, 'probe.mjs');
  await writeFile(probe, `import * as root from '@tnunamak/gozar';
import * as service from '@tnunamak/gozar/service';
import * as testing from '@tnunamak/gozar/testing';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const installedAdaptersRoot = fileURLToPath(new URL('./node_modules/@tnunamak/gozar/adapters/', import.meta.url));
const dts = await readFile(new URL('./node_modules/@tnunamak/gozar/packages/gozar-node/route-contract.d.ts', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('./node_modules/@tnunamak/gozar/package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('./node_modules/@tnunamak/gozar/adapters/manifest.json', import.meta.url), 'utf8'));
const declared = [...dts.matchAll(/^export (?:function|const) (\\w+)/gm)].map(match => match[1]);
const catalog = await root.catalogRoutes({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:9', home: ${JSON.stringify(stateHome)},
  usage: { kind: 'attached' }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } });
const registry = await testing.fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
const fake = testing.createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: testing.fakeReadContext({ home: ${JSON.stringify(stateHome)} }) });
const fakeCatalog = await fake.catalogRoutes({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:9', home: ${JSON.stringify(stateHome)}, usage: { kind: 'session', lifetimeMs: 60000 },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] } });
const inventory = await fake.listProviders({ home: ${JSON.stringify(stateHome)}, owner: 'example-app' });
await registry.cleanup();
const installedApi = testing.createRouteApi({ manifest, root: installedAdaptersRoot, readContext: testing.fakeReadContext({ home: ${JSON.stringify(stateHome)} }) });
const installedInventory = await installedApi.listProviders({ home: ${JSON.stringify(stateHome)}, owner: 'example-app', refresh: true });
const fixtureInventory = [];
for (const [id, label, idleTimeoutMs] of [['fake-meta-zero', 'Fixture Zero', 0], ['fake-meta-null', 'Fixture Null', null]]) {
  const registry = await testing.fakeRegistry({ id, label, kinds: ['durable'], reach: 'internet' });
  try {
    const folder = join(registry.root, 'providers', id);
    const wrappedPath = join(folder, 'wrapped.definition.json');
    const wrapped = JSON.parse(await readFile(wrappedPath, 'utf8'));
    wrapped.definition.idleTimeoutMs = idleTimeoutMs;
    await writeFile(wrappedPath, JSON.stringify(wrapped));
    // The durable fake keeps its normal methods; expose the actual installed
    // recipe adapter's operational definition to the inventory reader.
    await rename(join(folder, 'index.mjs'), join(folder, 'fixture-original.mjs'));
    const runtimeUrl = new URL('./node_modules/@tnunamak/gozar/packages/gozar-node/adapter-runtime.mjs', import.meta.url).href;
    await writeFile(join(folder, 'index.mjs'), [
      'import original from "./fixture-original.mjs";',
      'import { recipeAdapter } from ' + JSON.stringify(runtimeUrl) + ';',
      'const recipe = recipeAdapter({ definition: new URL("./definition.json", import.meta.url) });',
      'export default { ...original, operationalDefinition: recipe.operationalDefinition };',
    ].join('\\n'));
    const api = testing.createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: testing.fakeReadContext({ home: ${JSON.stringify(stateHome)} }) });
    const snapshot = await api.listProviders({ home: ${JSON.stringify(stateHome)}, owner: 'example-app', refresh: true });
    fixtureInventory.push(...snapshot.providers);
  } finally {
    await registry.cleanup();
  }
}
// Capture serialized inventory through the installed public testing facade. No route is started.
async function inventoryProbe(id, wrapped) {
  const fixture = await testing.fakeRegistry({ id, label:'Fixture relay', kinds:['session','durable'], reach:'internet' });
  try {
    const folder = join(fixture.root,'providers',id);
    const declarationFile = join(folder,'definition.json');
    const declaration = JSON.parse(await readFile(declarationFile, 'utf8'));
    declaration.adapter.requiredCapabilities = ['runtime.attached'];
    await writeFile(declarationFile, JSON.stringify(declaration));
    const moduleFile = join(folder,'index.mjs');
    const moduleBytes = await readFile(moduleFile, 'utf8');
    await writeFile(join(folder,'registry-original.mjs'), moduleBytes);
    const fixtureModule = [
      "import original from './registry-original.mjs';",
      'export default {...original,',
      wrapped ? "operationalDefinition: {displayName:'Wrapped relay', idleTimeoutMs:null, copy:{human:{name:'Fallback name', address:'Fallback address', setup:'Fallback setup'}}}," : 'operationalDefinition:null,',
      "async detect(ctx) {return {...await original.detect(ctx),rawProbe:'synthetic-probe-not-for-inventory', candidateToken:'synthetic-inventory-bearer', proof:'synthetic-inventory-proof'};},",
      wrapped ? 'properties: () => original.properties(),' : "properties: () => {const p=original.properties();return {...p,address:{...p.address,stability:'ephemeral'}};},",
      '};',
    ].join('\\n');
    await writeFile(moduleFile, fixtureModule);
    const home = ${JSON.stringify(stateHome)};
    const api = testing.createRouteApi({manifest:fixture.manifest,root:fixture.root,readContext:testing.fakeReadContext({home})});
    const rows = [];
    for (const capability of [{known:true,value:true},{known:true,value:false},{known:false,reason:'fixture-unobserved'}]) {
      const result = await api.listProviders({home,owner:'example-app',refresh:true,hostCapabilities:{'runtime.attached':capability}});
      rows.push(result.providers);
    }
    return rows;
  } finally {
    await fixture.cleanup();
  }
}
const authorityInventory = await Promise.all([inventoryProbe('fixture-opaque-inventory-a7', false), inventoryProbe('fixture-opaque-inventory-b8', true)]);
console.log(JSON.stringify({ inventory, fixtureInventory, authorityInventory, installedIds: installedInventory.providers.map(item => item.providerId), testingExports: Object.keys(testing).sort(), fakeIds: fakeCatalog.candidates.map(item => item.providerId), fakeEligible: fakeCatalog.candidates.map(item => item.eligible), rootExports: Object.keys(root).sort(), serviceExports: Object.keys(service).sort(), declared: [...new Set(declared)].sort(),
  types: pkg.types, exportsTypes: pkg.exports['.'].types, engines: pkg.engines.node, providers: manifest.providers.map(item => item.id),
  candidates: catalog.candidates.length, observedAt: typeof catalog.observedAt, tokens: catalog.candidates.filter(item => item.candidateToken).length }));
`);
  const { stdout } = await exec(process.execPath, [probe], { cwd: project, timeout: 60_000, env: { PATH: emptyBin, HOME: stateHome, GOZAR_HOME: stateHome, TMPDIR: stateHome } });
  const seen = JSON.parse(stdout);
  assert.deepEqual(seen.rootExports, seen.declared, 'the root exports exactly the functions route-contract.d.ts declares');
  // 0.4 adds the external-route consent review/approval and the service context the host API uses; they ship from the same module.
  assert.deepEqual(seen.serviceExports, ['addService', 'approveExternalConsent', 'cancelHandBack', 'confirmHandBack', 'createServiceVerifier', 'releaseRoute', 'removeService',
    'reviewExternalConsent', 'statusServices', 'withServiceContext']);
  assert.deepEqual(seen.testingExports, ['createReadContext', 'createRouteApi', 'createTestingGozar', 'fakeReadContext', 'fakeRegistry', 'fakeRouteScenarios'], 'the testing export is in the archive and names its public helpers');
  assert.deepEqual(seen.fakeIds, ['fake-0a1b2c3d']);
  assert.deepEqual(seen.fakeEligible, [true], 'the fake provider is listed from the installed bytes');
  assert.equal(seen.types, './packages/gozar-node/route-contract.d.ts');
  assert.equal(seen.exportsTypes, seen.types);
  assert.equal(seen.engines, '>=22.13');
  assert.deepEqual(seen.installedIds.sort(), [...seen.providers].sort(), 'read-only inventory lists every shipped manifest ID exactly once');
  assert.deepEqual(seen.providers, JSON.parse(await readFile(new URL('../../adapters/manifest.json', import.meta.url), 'utf8')).providers.map(provider => provider.id), 'the installed registry is the source registry');
  assert.deepEqual(seen.inventory.providers.map(row => row.providerId), ['fake-0a1b2c3d']);
  const checkObservation = (observation, isValue, field) => {
    assert.ok(observation && typeof observation === 'object', field);
    if (observation.known === true) {
      assert.deepEqual(Object.keys(observation).sort(), ['known', 'value'], field);
      assert.ok(isValue(observation.value), field);
    } else {
      assert.equal(observation.known, false, field);
      assert.deepEqual(Object.keys(observation).sort(), ['known', 'reason'], field);
      assert.equal(typeof observation.reason, 'string', field);
    }
  };
  for (const row of seen.inventory.providers) {
    const isString = value => typeof value === 'string';
    checkObservation(row.displayName, isString, 'displayName');
    for (const field of ['name', 'address', 'summary', 'setup'])
      checkObservation(row.copy?.human?.[field], isString, 'copy.human.' + field);
    checkObservation(row.addressStability, value => value === 'stable' || value === 'ephemeral', 'addressStability');
    checkObservation(row.idleTimeoutMs, value => value === null || typeof value === 'number', 'idleTimeoutMs');
    checkObservation(row.needsAccount, value => typeof value === 'boolean', 'needsAccount');
  }
  assertFixturePresentation(seen.fixtureInventory);
  const known = value => ({known:true,value}), unknown = reason => ({known:false,reason});
  for (const [index, id] of ['fixture-opaque-inventory-a7','fixture-opaque-inventory-b8'].entries()) {
    const wrapped = index === 1;
    const versions = seen.authorityInventory[index];
    for (const [variant, providers] of versions.entries()) {
      assert.deepEqual(providers.map(row => row.providerId), [id], 'lookup uses the exact unfamiliar provider ID');
      const provider = providers.find(row => row.providerId === id);
      assert.deepEqual(provider.displayName, known(wrapped ? 'Wrapped relay' : 'Fixture relay'));
      assert.deepEqual(provider.copy.human, {
        name:wrapped ? known('Fallback name') : unknown('not-declared'), summary:unknown('not-declared'),
        address:wrapped ? known('Fallback address') : unknown('not-declared'),
        setup:wrapped ? known('Fallback setup') : unknown('not-declared'),
      });
      assert.deepEqual(provider.addressStability, known(wrapped ? 'stable' : 'ephemeral'));
      assert.deepEqual(provider.idleTimeoutMs, wrapped ? known(null) : unknown('not-declared'));
      assert.deepEqual(provider.needsAccount, known(false));
      const prereq = provider.prerequisites.find(row => row.id === 'runtime.attached');
      assert.ok(prereq, 'the real capability prerequisite survives serialization');
      if (variant === 1) {
        assert.equal(prereq.state, 'denied');
        assert.deepEqual(prereq.observation, known(false));
      } else if (variant === 2) {
        assert.equal(prereq.state, 'unknown');
        assert.deepEqual(prereq.observation, unknown('fixture-unobserved'));
      }
      for (const kind of ['session','durable']) {
        if (variant === 0) assert.equal(provider.availability[kind].state, 'available', kind);
        else assert.deepEqual(provider.availability[kind], {
          state:'unsupported', reason:variant === 1 ? 'host-capability-denied' : 'host-capability-unknown',
        }, kind);
      }
      assert.doesNotMatch(JSON.stringify(provider), /synthetic-probe-not-for-inventory|synthetic-inventory-bearer|synthetic-inventory-proof|"candidateToken"|"rawProbe"/);
    }
  }
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
