// The packed tarball, installed into a fresh project, behaves like the repository: the root and /service exports
// import, the root exports are exactly the functions route-contract.d.ts declares, and the catalog answers from the
// installed registry bytes. The probe runs with an empty PATH and no provider socket, so no provider is reached.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { durableWorld, journeyRoot } from './journey-world.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const durableNetwork = fileURLToPath(new URL('./durable-network.mjs', import.meta.url));

// One npm pack and install serves every test in this file; the installed bytes are what each test exercises.
let sharedInstall;
const installedPackage = () => sharedInstall ??= (async () => {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  const base = await mkdtemp(join(homedir(), '.tmp', 'gozar-installed-'));
  const pack = join(base, 'pack'), project = join(base, 'project');
  for (const dir of [pack, project]) await mkdir(dir, { mode: 0o700 });
  // npm 11 prints an object keyed by package name; npm 10 printed an array.
  const output = JSON.parse((await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', pack], { cwd: root, timeout: 120_000 })).stdout);
  const packed = Array.isArray(output) ? output[0] : Object.values(output)[0];
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  // The optional ngrok SDK is never installed here: attached ngrok routes load it lazily and no probe reaches it.
  await exec('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', join(pack, packed.filename)], { cwd: project, timeout: 120_000 });
  return { base, project, installed: join(project, 'node_modules', '@tnunamak', 'gozar') };
})();
after(async () => { if (sharedInstall) await rm((await sharedInstall).base, { recursive: true, force: true }); });

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
  const { base, project, installed } = await installedPackage();
  const stateHome = join(base, 'home'), emptyBin = join(base, 'bin');
  await mkdir(emptyBin);
  await mkdir(stateHome, { mode: 0o700 });

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
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Creating a configured factory, forward included, starts no provider and writes nothing.
const entriesBefore = JSON.stringify((await readdir(${JSON.stringify(stateHome)})).sort());
const configured = root.createGozar({ forwardHome: join(${JSON.stringify(stateHome)}, 'managed') });
const constructionInert = JSON.stringify((await readdir(${JSON.stringify(stateHome)})).sort()) === entriesBefore;
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
console.log(JSON.stringify({ inventory, fixtureInventory, authorityInventory, installedIds: installedInventory.providers.map(item => item.providerId), testingExports: Object.keys(testing).sort(), fakeIds: fakeCatalog.candidates.map(item => item.providerId), fakeEligible: fakeCatalog.candidates.map(item => item.eligible), rootExports: Object.keys(root).sort(), forwardTypes: [typeof root.forward, typeof configured.forward], constructionInert, factoryKeys: Object.keys(configured).sort(), serviceExports: Object.keys(service).sort(), declared: [...new Set(declared)].sort(),
  types: pkg.types, exportsTypes: pkg.exports['.'].types, engines: pkg.engines.node, providers: manifest.providers.map(item => item.id),
  candidates: catalog.candidates.length, observedAt: typeof catalog.observedAt, tokens: catalog.candidates.filter(item => item.candidateToken).length }));
`);
  const { stdout } = await exec(process.execPath, [probe], { cwd: project, timeout: 60_000, env: { PATH: emptyBin, HOME: stateHome, GOZAR_HOME: stateHome, TMPDIR: stateHome } });
  const seen = JSON.parse(stdout);
  assert.deepEqual(seen.rootExports, seen.declared, 'the root exports exactly the functions route-contract.d.ts declares');
  assert.ok(seen.rootExports.includes('forward') && seen.rootExports.includes('createGozar'), 'the root exports forward beside the factory');
  assert.deepEqual(seen.forwardTypes, ['function', 'function'], 'the namespace and the configured factory both expose forward');
  assert.equal(seen.constructionInert, true, 'creating a configured factory writes nothing');
  for (const name of ['adoptRoute', 'approveRouteConsent', 'catalogRoutes', 'closeRoute', 'ensureRoute', 'expose', 'listProviders', 'listRoutes', 'routeStatus', 'runSetupAction', 'watchRoutes'])
    assert.ok(seen.factoryKeys.includes(name), `the configured factory keeps ${name}`);
  assert.ok(seen.factoryKeys.includes('forward'));
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

// --- forward: the consumer library experience, on the installed bytes ---------------------------------------------
//
// What is real: the packed and installed package (root namespace, configured factory, bundled provider registry, route engine, state
// files under the private Gozar home), a loopback HTTP listener this test's host process owns whose handler mounts the installed service
// verifier, and the bundled Tailscale provider adapter. What is simulated: the Tailscale node (a fake `tailscale status` CLI and a fake
// LocalAPI on a unix socket), the public HTTPS ingress (a loopback TLS listener that forwards by the fake node's own serve config), and
// DNS (the test-only network double refuses every other non-loopback destination). No real provider, account or public network is touched.

const exampleBlock = async () => {
  const guide = await readFile(new URL('../../docs/library-ux.md', import.meta.url), 'utf8');
  const block = guide.match(/```js\n([\s\S]*?)\n```/)?.[1];
  assert.ok(block, 'docs/library-ux.md starts with a JavaScript example');
  return block;
};

/** Runs the host fixture next to the installed package; `entry` is the consumer module it imports. Stdout lines are JSON reports. */
async function runHost(t, { entry, env, source }) {
  const { project } = await installedPackage();
  await copyFile(new URL('../fixtures/forward-installed-consumer.mjs', import.meta.url), join(project, 'forward-installed-consumer.mjs'));
  await writeFile(join(project, entry), source);
  const child = spawn(process.execPath, ['--import', durableNetwork, 'forward-installed-consumer.mjs', entry], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const reports = [], waiting = [];
  let buffer = '', stderr = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      reports.push(JSON.parse(buffer.slice(0, at)));
      buffer = buffer.slice(at + 1);
    }
    for (const check of waiting.splice(0)) check();
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { for (const check of waiting.splice(0)) check(); resolve({ code, signal }); }));
  const report = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} report in 60s; stderr: ${stderr}`)), 60_000);
    const check = () => {
      const found = reports.find(item => item.type === type);
      if (found) { clearTimeout(timer); resolve(found); } else if (child.exitCode !== null) { clearTimeout(timer); reject(new Error(`the host exited before ${type}; reports: ${JSON.stringify(reports)}; stderr: ${stderr}`)); } else waiting.push(check);
    };
    check();
  });
  return { report, exited, reports: () => reports, stderr: () => stderr, close: () => child.stdin.write('close\n') };
}

const hostWorld = async t => {
  const world = await journeyRoot();
  t.after(() => rm(world.root, { recursive: true, force: true }));
  return durableWorld(world, t);
};
const providerRules = fake => Object.keys(fake.state.config.Web ?? {});
// Owned failure evidence, taken before the world is torn down: the provider's rule shape, the stored managed record's phase and
// cleanup certainty, and the provider writes seen. No paths, secrets, tokens or digests.
const lossEvidence = async fake => {
  const dir = join(fake.home, 'forward');
  const records = await Promise.all((await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json'))
    .map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  return JSON.stringify({ providerConfigKeys: Object.fromEntries(Object.entries(fake.state.config).map(([key, value]) => [key, Object.keys(value)])),
    providerWrites: fake.state.writes.length, records: records.map(record => ({ phase: record.run?.phase, hasHandle: Boolean(record.run?.handle),
      downSince: Boolean(record.downSince), cleanup: record.cleanup?.certainty })) });
};

test('installed forward: the exact first documentation example runs on the imported namespace and cleans up exactly', async t => {
  const w = await hostWorld(t);
  const source = `const { port, ui, publishSignedAddress, showOffline, showOnline, showRecoveryFailure } = globalThis.faravanHost;\n${await exampleBlock()}\n`;
  const host = await runHost(t, { entry: 'documentation-example.mjs', env: w.env, source });
  const published = await host.report('published');
  // The example's own steps ran: one consent decision the UI mock approved, then the verified origin reached the app's real bytes.
  assert.deepEqual(published.shown.map(action => [action.step, action.kind, action.answer]), [['approve-route', 'consent', { type: 'decision', approve: 'boolean' }]]);
  assert.match(published.shown[0].disclosure.text, /\S/);
  assert.doesNotMatch(JSON.stringify(published.shown), /candidateToken|consentFactsDigest|operationId|approvalToken/, 'the descriptor carries no bearer, digest or operation plumbing');
  assert.deepEqual(published.signed, [{ origin: w.origin, previous: null }], 'the signed-address callback received the verified origin once, with no change event');
  assert.deepEqual(published.through, [{ origin: w.origin, status: 200, body: 'faravan-app-bytes' }], 'the verified origin serves the host application through the fake ingress');
  assert.deepEqual(providerRules(w), [`${new URL(w.origin).hostname}:${new URL(w.origin).port}`], 'exactly one provider rule exists while the example runs');
  assert.equal(w.state.config.Web[providerRules(w)[0]].Handlers['/'].Proxy, `http://127.0.0.1:${published.port}`, 'the rule points at the host listener and nothing else');
  assert.deepEqual(await w.cliCalls(), [], 'no provider CLI call beyond the read-only status probe');
  // Managed state lives under the private default Gozar home, beside nothing the host chose.
  assert.ok((await readdir(join(w.home, 'forward'))).length > 0, 'forward state is kept under the default home');
  host.close();
  const done = await host.report('done');
  assert.deepEqual(await host.exited, { code: 0, signal: null }, host.stderr());
  assert.equal(done.failure, null);
  assert.equal(done.listenerSurvived, true, 'closing the route leaves the host listener serving');
  assert.deepEqual(providerRules(w), [], 'route.close() removed the owned provider rule');
  assert.deepEqual(done.transitions, [], 'no outage and no recovery were observed');

  // A normal restart is the same call: unchanged approved disclosure needs no second click and reaches the same address.
  const again = await runHost(t, { entry: 'documentation-example-restart.mjs', env: { ...w.env, HOST_PORT: String(published.port) }, source });
  const restarted = await again.report('published');
  assert.deepEqual(restarted.shown, [], 'a restart with unchanged approval asks the user nothing');
  assert.deepEqual(restarted.through, [{ origin: w.origin, status: 200, body: 'faravan-app-bytes' }]);
  again.close();
  assert.equal((await again.report('done')).listenerSurvived, true);
  assert.deepEqual(providerRules(w), []);

  // A different listener is a different target: the saved approval does not carry over, so the user is asked again.
  const moved = await runHost(t, { entry: 'documentation-example-moved.mjs', env: w.env, source });
  const relocated = await moved.report('published');
  assert.notEqual(relocated.port, published.port);
  assert.deepEqual(relocated.shown.map(action => action.step), ['approve-route'], 'a changed target needs a fresh decision');
  moved.close();
  assert.equal((await moved.report('done')).listenerSurvived, true);
  assert.deepEqual(providerRules(w), []);
});

test('installed forward: provider rule loss withdraws the current url and re-establishes without another consent', async t => {
  const w = await hostWorld(t);
  const source = `import * as gozar from '@tnunamak/gozar';
const { port, ui } = globalThis.faravanHost;
const route = await gozar.forward({ app: 'faravan', port, onAction: ui.show });
try {
  route.on('down', event => console.log(JSON.stringify({ type: 'outage', ...event, url: route.url, currentDownSince: route.downSince })));
  route.on('back', event => console.log(JSON.stringify({ type: 'recovered', ...event, url: route.url, currentDownSince: route.downSince })));
  await ui.untilClosed();
} finally { await route.close(); }
`;
  const host = await runHost(t, { entry: 'lost-rule.mjs', env: w.env, source });
  await host.report('published');
  assert.equal(providerRules(w).length, 1);
  // A lost provider rule is a vanished serve config (what `tailscale serve reset` or a reinstalled node leaves, and how the durable
  // route suite models loss): the whole rule of TCP listener, web handler and Funnel flag is gone and tailscaled's ETag moves on.
  // Emptying only the web handler leaves a rule the SDK reads as changed, not lost (next test).
  w.state.config = {};
  w.state.etag++;
  const down = await host.report('outage');
  assert.equal(down.url, null, 'an observed outage must withdraw the current address');
  assert.equal(down.currentDownSince, down.downSince);
  assert.ok(Number.isFinite(Date.parse(down.downSince)));
  const back = await host.report('recovered').catch(async error => { throw new Error(`${error.message}\nowned evidence: ${await lossEvidence(w)}`); });
  assert.equal(back.url, w.origin);
  assert.equal(back.currentDownSince, null);
  assert.equal(back.downSince, down.downSince);
  assert.ok(Date.parse(back.at) >= Date.parse(down.downSince));
  assert.equal(providerRules(w).length, 1, 'recovery restores one owned rule');
  host.close();
  const done = await host.report('done');
  assert.deepEqual(await host.exited, { code: 0, signal: null }, host.stderr());
  assert.equal(done.shown.length, 1, 'unchanged disclosure does not ask again during recovery');
  assert.equal(done.listenerSurvived, true);
  assert.deepEqual(providerRules(w), []);
});

test('installed forward: a partly changed provider rule is not removed or replaced and is retained as cleanup debt', async t => {
  const w = await hostWorld(t);
  const source = `import * as gozar from '@tnunamak/gozar';
const { port, ui } = globalThis.faravanHost;
const route = await gozar.forward({ app: 'faravan', port, onAction: ui.show });
route.on('down', event => console.log(JSON.stringify({ type: 'outage', ...event, url: route.url })));
route.on('back', event => console.log(JSON.stringify({ type: 'recovered', ...event })));
await ui.untilClosed();
await route.close();
`;
  const host = await runHost(t, { entry: 'changed-rule.mjs', env: w.env, source });
  await host.report('published');
  // The web handler alone vanishes; the TCP listener and Funnel flag stay. That is no longer the rule Gozar wrote, so it is not Gozar's
  // to delete or to overwrite: the SDK keeps it as cleanup debt and the managed forward must not publish a second rule beside it.
  const left = structuredClone(w.state.config);
  left.Web = {};
  w.state.config = structuredClone(left);
  w.state.etag++;
  const writesBefore = w.state.writes.length;
  assert.equal((await host.report('outage')).url, null);
  const owed = async () => (await lossEvidence(w)).includes('"cleanup":"unconfirmed"');
  const deadline = Date.now() + 40_000;
  while (!await owed() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(await owed(), `the unremovable rule is retained as debt; evidence: ${await lossEvidence(w)}`);
  assert.deepEqual(w.state.config, left, 'the changed rule is left exactly as found');
  assert.equal(w.state.writes.length, writesBefore, 'nothing was written to the provider');
  assert.equal(host.reports().some(item => item.type === 'recovered'), false, 'no recovery is claimed');
  host.close();
  const done = await host.report('done');
  assert.equal(done.failure.code, 'cleanup_debt', 'close() names the retained debt');
  assert.deepEqual(w.state.config, left, 'close does not remove a rule it cannot attribute');
});

test('installed forward: with no ready provider the namespace rejects with a per-provider explanation and no invented next action', async t => {
  const { base } = await installedPackage();
  const home = join(base, 'home-no-match'), emptyBin = join(base, 'bin-no-match');
  await mkdir(emptyBin);
  await mkdir(home, { mode: 0o700 });
  const source = `import * as gozar from '@tnunamak/gozar';
const { port } = globalThis.faravanHost;
await gozar.forward({ app: 'faravan', port, policy: { accounts: 'existing-only', lifetime: 'lasting' } });
`;
  const host = await runHost(t, { entry: 'no-match.mjs', env: { PATH: emptyBin, HOME: home, GOZAR_HOME: home, TMPDIR: home }, source });
  const done = await host.report('done');
  assert.deepEqual(await host.exited, { code: 1, signal: null }, host.stderr());
  assert.equal(done.failure.code, 'requirements_unsatisfied');
  assert.equal(done.failure.nextAction, null, 'there is no setup action that can satisfy this policy');
  const { installed } = await installedPackage();
  const providers = JSON.parse(await readFile(join(installed, 'adapters/manifest.json'), 'utf8')).providers.map(provider => provider.id);
  assert.ok(done.failure.unmet.length > 0);
  for (const row of done.failure.unmet) {
    assert.ok(providers.includes(row.provider), `unmet names a shipped provider: ${row.provider}`);
    assert.ok(row.missing.length > 0, `${row.provider} explains what is missing`);
    assert.ok(row.policyChanges === null || (Object.keys(row.policyChanges).every(key => ['accounts', 'lifetime'].includes(key))), 'policyChanges is a policy or null');
  }
  assert.equal(done.listenerSurvived, true, 'a refused request leaves the host listener alone');
});

// The configured factory carries its own registry: the installed bundled registry narrowed to one provider, which is also how a host
// would ship a reduced provider set. Its `forwardHome`, registry and origin acknowledgment must govern `forward`, not the defaults.
const factoryConsumer = ({ refuse = false, lifetime = 'prefer-lasting' } = {}) => `import { createGozar } from '@tnunamak/gozar';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { port, ui } = globalThis.faravanHost;
const adapters = new URL('./node_modules/@tnunamak/gozar/adapters/', import.meta.url);
const bundled = JSON.parse(await readFile(new URL('manifest.json', adapters), 'utf8'));
const gozar = createGozar({
  manifest: { providers: bundled.providers.filter(provider => provider.id === 'tailscale-funnel') },
  root: fileURLToPath(adapters),
  forwardHome: process.env.FACTORY_HOME,
  acknowledgeOrigin: async request => {
    console.log(JSON.stringify({ type: 'ack', request }));
    if (${refuse}) throw new Error('the host refuses this origin');
    return { acknowledged: true, origin: request.origin, handle: { id: request.handle.id, generation: request.handle.generation }, attemptId: request.attemptId };
  },
});
let route = await gozar.forward({ app: 'faravan', port, policy: { lifetime: ${JSON.stringify(lifetime)} } });
while (route.needsAction) route = await route.resume(await ui.show(route.needsAction));
console.log(JSON.stringify({ type: 'route', url: route.url, provider: route.provider.id, lifetime: route.lifetime }));
await route.close();
`;

test('installed forward: a configured factory binds forward to its registry, managed home and origin acknowledgment', async t => {
  const w = await hostWorld(t);
  const { base } = await installedPackage();
  const managed = join(base, 'factory-managed');
  await mkdir(managed, { mode: 0o700 });
  const env = { ...w.env, FACTORY_HOME: managed };
  const accepted = await runHost(t, { entry: 'factory-accept.mjs', env, source: factoryConsumer() });
  const done = await accepted.report('done');
  assert.deepEqual(await accepted.exited, { code: 0, signal: null }, accepted.stderr());
  assert.equal(done.failure, null);
  assert.deepEqual(done.shown.map(action => action.step), ['approve-route']);
  const [route] = accepted.reports().filter(item => item.type === 'route');
  assert.equal(route.provider, 'tailscale-funnel');
  assert.equal(route.lifetime, 'lasting');
  assert.equal(route.url, w.origin);
  // The factory's own acknowledgment hook ran inside forward's publication, naming exactly the origin and target forward published.
  const acks = accepted.reports().filter(item => item.type === 'ack').map(item => item.request);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].origin, w.origin);
  assert.equal(acks[0].target, `127.0.0.1:${done.port}`);
  assert.equal(acks[0].owner, 'forward:faravan');
  assert.equal(acks[0].handle.kind, 'durable');
  assert.ok(acks[0].operationId, 'forward minted the operation id; the host never supplied one');
  assert.ok((await readdir(join(managed, 'forward'))).length > 0, 'forward kept its state under the factory forwardHome');
  await assert.rejects(readdir(join(w.home, 'forward')), { code: 'ENOENT' }, 'the default home was not used');
  assert.deepEqual(providerRules(w), [], 'close removed the owned rule');
  assert.equal(done.listenerSurvived, true);

  // A host that refuses the origin publishes nothing, and what was created is removed.
  const refused = await runHost(t, { entry: 'factory-refuse.mjs', env, source: factoryConsumer({ refuse: true }) });
  const refusal = await refused.report('done');
  assert.ok(refusal.failure, 'a refused acknowledgment is a failed forward');
  assert.equal(refused.reports().filter(item => item.type === 'route').length, 0, 'nothing was published');
  assert.equal(refused.reports().filter(item => item.type === 'ack').length, 1);
  assert.deepEqual(providerRules(w), [], 'the withdrawn route left no provider rule');
  assert.equal(refusal.listenerSurvived, true);
});

test('installed forward: a configured factory lists only its own registry in the no-match explanation', async t => {
  const { base } = await installedPackage();
  const home = join(base, 'home-factory-no-match'), emptyBin = join(base, 'bin-factory-no-match');
  await mkdir(emptyBin);
  await mkdir(home, { mode: 0o700 });
  const host = await runHost(t, { entry: 'factory-no-match.mjs', env: { PATH: emptyBin, HOME: home, GOZAR_HOME: home, TMPDIR: home, FACTORY_HOME: join(home, 'managed') },
    source: factoryConsumer({ lifetime: 'session' }) });
  const done = await host.report('done');
  assert.equal(done.failure.code, 'requirements_unsatisfied');
  assert.equal(done.failure.nextAction, null);
  assert.deepEqual([...new Set(done.failure.unmet.map(row => row.provider))], ['tailscale-funnel'], 'only the configured registry was considered');
  assert.ok(done.failure.unmet.every(row => row.missing.length > 0));
});

// The forward declarations compile strictly against the installed package: positive uses a host would write, and negative uses
// that must stay compile errors. Nothing in the contract may erase to `any`.
test('installed forward: strict TypeScript accepts the documented use and rejects wrong policies, answers, callbacks and pending misuse', async t => {
  const { project } = await installedPackage();
  const source = `import * as gozar from '@tnunamak/gozar';
import { createGozar } from '@tnunamak/gozar';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;
declare const port: number;
declare const ui: { show(action: gozar.ForwardAction): Promise<gozar.ForwardAnswer>; untilClosed(): Promise<void> };
declare function publishSignedAddress(origin: string, previous?: { oldOrigin: string; at: string }): void;
declare function showOffline(event: { downSince: string }): void;
declare function showOnline(event: gozar.ForwardBack): void;
declare function showRecoveryFailure(event: gozar.ForwardHalted): void;

// The documented example uses current nullable properties on the same resource throughout.
export async function firstUse() {
  let route = await gozar.forward({ app: 'faravan', port, policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  try {
    while (route.needsAction) route = await route.resume(await ui.show(route.needsAction));
    route.on('change', ({ oldOrigin, newOrigin, at }) => publishSignedAddress(newOrigin, { oldOrigin, at }));
    if (route.url !== null) publishSignedAddress(route.url);
    route.on('down', ({ downSince }) => showOffline({ downSince }));
    route.on('back', showOnline);
    route.on('halted', showRecoveryFailure);
    const stop = route.on('action', action => { void ui.show(action); });
    stop();
    await ui.untilClosed();
  } finally {
    await route.close();
  }
}

// The host-handled form returns the published route directly; the factory carries the same call and an explicit managed home.
export async function handled() {
  const route: gozar.ForwardRoute = await gozar.forward({ app: 'faravan', port, onAction: ui.show });
  const configured = createGozar({ forwardHome: '/var/lib/faravan/gozar' });
  const result: gozar.ForwardRoute = await configured.forward({ app: 'faravan', port, policy: { lifetime: 'session' } });
  const direct: gozar.ForwardRoute = await configured.forward({ app: 'faravan', port, onAction: answer => ({ approve: answer.kind === 'consent' }) });
  return [route, result, direct];
}

// The published route is current state, not a cached address.
declare const published: gozar.ForwardRoute;
const address: string | null = published.url;
const outage: string | null = published.downSince;
const pendingStep: gozar.ForwardAction | null = published.needsAction;
const lifetime: 'lasting' | 'session' | null = published.lifetime;
const traffic: boolean | null = published.provider?.traffic.providerCanReadPayload ?? null;
// @ts-expect-error url is null while the route is down.
published.url.length;
// @ts-expect-error a later decision may or may not be waiting.
published.needsAction.label;

// Answers: a decision, or a decision with the value or secret the step asked for.
export function answer(action: gozar.ForwardAction): gozar.ForwardAnswer {
  if (action.kind === 'consent') return { approve: action.disclosure.text.length > 0 };
  switch (action.answer.type) {
    case 'secret': return { approve: true, secret: action.answer.label ?? '' };
    case 'value': return { approve: true, value: action.answer.format };
    default: return { approve: false };
  }
}
// @ts-expect-error format exists only on a value step.
export const unnarrowed = (action: gozar.ForwardAction) => action.answer.format;

// Errors the caller renders, with the closed vocabulary and no invented next action.
export function render(error: unknown) {
  const unmet = (error as gozar.ForwardRequirementsError).unmet;
  const none: null = (error as gozar.ForwardRequirementsError).nextAction;
  for (const row of unmet) {
    const first: gozar.ForwardMissing | undefined = row.missing[0];
    const alternative: gozar.ForwardPolicy | null = row.policyChanges;
    void [first, alternative, row.provider];
  }
  const retry: string = (error as gozar.ForwardCleanupDebtError).nextAction.label;
  return [none, retry];
}
// @ts-expect-error missing is a closed vocabulary.
export const unknownMissing: gozar.ForwardMissing = 'revoked';
// @ts-expect-error requirements_unsatisfied never carries a next action.
export const fabricated: gozar.ForwardRequirementsError['nextAction'] = { id: 'x' };

// Wrong requests.
// @ts-expect-error accounts is existing-only or allow-setup.
void gozar.forward({ app: 'faravan', port, policy: { accounts: 'sometimes' } });
// @ts-expect-error lifetime is prefer-lasting, lasting or session.
void gozar.forward({ app: 'faravan', port, policy: { lifetime: 'forever' } });
// @ts-expect-error a policy has no other fields.
void gozar.forward({ app: 'faravan', port, policy: { region: 'eu' } });
// @ts-expect-error the listener port is required.
void gozar.forward({ app: 'faravan' });
// @ts-expect-error the port is a number.
void gozar.forward({ app: 'faravan', port: '8080' });
// @ts-expect-error onAction returns the user's answer.
void gozar.forward({ app: 'faravan', port, onAction: () => true });
// @ts-expect-error the current address can be null, even after an onAction call.
export const notPublished: string = (await gozar.forward({ app: 'faravan', port, onAction: ui.show })).url;
// @ts-expect-error forwardHome is a path.
createGozar({ forwardHome: 5 });

// Wrong answers.
declare const pending: gozar.ForwardRoute;
// @ts-expect-error approve is a boolean.
void pending.resume({ approve: 'yes' });
// @ts-expect-error an answer needs approve.
void pending.resume({});
// @ts-expect-error a secret alone is not a decision.
void pending.resume({ secret: 'token' });
// @ts-expect-error a value is text.
void pending.resume({ approve: true, value: 3 });
// @ts-expect-error a token or digest is never an answer.
void pending.resume({ approve: true, candidateToken: 'x' });

// Wrong event callbacks.
// @ts-expect-error there is no 'changed' event.
published.on('changed', () => {});
// @ts-expect-error a change listener receives origins, not an outage.
published.on('change', (event: gozar.ForwardDown) => void event);
// @ts-expect-error a down listener has no origins.
published.on('down', ({ oldOrigin }) => void oldOrigin);
// @ts-expect-error a back listener has no origins.
published.on('back', ({ newOrigin }) => void newOrigin);
published.on('change', event => { const typed: AssertFalse<IsAny<typeof event>> = false; void typed; });
published.on('down', event => { const typed: AssertFalse<IsAny<typeof event>> = false; void typed; });
published.on('back', event => { const typed: AssertFalse<IsAny<typeof event>> = false; void typed; });
published.on('action', event => { const typed: AssertFalse<IsAny<typeof event>> = false; void typed; });

// A waiting run is the same resource. Nullable state must be checked before use.
const waitingAddress: string | null = pending.url;
const waitingProvider: gozar.ForwardProvider | null = pending.provider;
pending.on('change', () => {});
const waitingOutage: string | null = pending.downSince;
// @ts-expect-error provider is null before first publication.
pending.provider.id;
// @ts-expect-error route kind is null before first publication.
const waitingKind: 'durable' | 'session' | 'attached' = pending.kind;
void [waitingAddress, waitingProvider, waitingOutage];

type NotAny = [
  AssertFalse<IsAny<gozar.ForwardRoute>>, AssertFalse<IsAny<gozar.ForwardRoute>>, AssertFalse<IsAny<gozar.ForwardRoute>>,
  AssertFalse<IsAny<gozar.ForwardAction>>, AssertFalse<IsAny<gozar.ForwardAnswer>>, AssertFalse<IsAny<gozar.ForwardPolicy>>,
  AssertFalse<IsAny<gozar.ForwardProvider>>, AssertFalse<IsAny<gozar.ForwardUnmet>>, AssertFalse<IsAny<gozar.ForwardChange>>,
  AssertFalse<IsAny<gozar.ForwardRequirementsError['unmet']>>, AssertFalse<IsAny<Awaited<ReturnType<typeof gozar.forward>>>>,
  AssertFalse<IsAny<Awaited<ReturnType<ReturnType<typeof createGozar>['forward']>>>>, AssertFalse<IsAny<typeof published.url>>,
  AssertFalse<IsAny<ReturnType<typeof published.on>>>, AssertFalse<IsAny<Awaited<ReturnType<typeof pending.resume>>>>,
];
export type { NotAny };
void [address, outage, pendingStep, lifetime, traffic];
`;
  await writeFile(join(project, 'forward-consumer.ts'), source);
  const tsconfig = join(project, 'tsconfig.forward.json');
  await writeFile(tsconfig, JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ['forward-consumer.ts'],
  }));
  await exec(process.env.GOZAR_TSC || 'tsc', ['--project', tsconfig, '--pretty', 'false'], { cwd: project, timeout: 60_000 }).catch(error => {
    assert.fail(`strict forward consumer did not compile:\n${error.stdout}${error.stderr}`);
  });
});

test('installed package: recovers one exact earlier draft and retries without changing saved bytes', async t => {
  const { project } = await installedPackage();
  // Reuse the one installation; only this probe's source and state are temporary.
  const fixture = await mkdtemp(join(project, 'earlier-draft-recovery-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const home = join(fixture, 'home'), emptyBin = join(fixture, 'bin');
  await mkdir(home, { mode: 0o700 });
  await mkdir(emptyBin, { mode: 0o700 });
  const consumer = join(fixture, 'consumer.mjs');
  await writeFile(consumer, `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGozar, discardEarlierConfigurationDraft } from '@tnunamak/gozar';

// Internal installed code is used only to seed synthetic predecessor state.
import { createEmbeddingServices } from '../node_modules/@tnunamak/gozar/packages/gozar-node/embedding-services.mjs';
assert.equal(typeof discardEarlierConfigurationDraft, 'function');
const root = fileURLToPath(new URL('../node_modules/@tnunamak/gozar/adapters/', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const fromRegistryId = 'registry-v1:' + '8'.repeat(64);
const request = { home: process.env.GOZAR_HOME, owner: 'fixture-consumer', providerId: 'localhost-run' };
const seeded = createEmbeddingServices({ registryId: fromRegistryId });
const prior = await seeded.readConfiguration(request);
const { draftId } = await seeded.beginConfigurationDraft({ ...request, expectedConfigurationRevision: prior.revision });
const make = () => createGozar({ manifest, root, registryLineage: { id: 'installed-recovery-fixture', replaces: [fromRegistryId] } });
const api = make();
const list = factory => factory.listProviders({ home: request.home, owner: request.owner });
const inventory = await list(api);
assert.deepEqual(inventory.providers.map(row => row.providerId).sort(), manifest.providers.map(row => row.id).sort());
const blocked = inventory.providers.filter(row => row.configuration.known === false);
assert.deepEqual(blocked.map(row => row.providerId), [request.providerId]);
const migration = blocked[0].configuration.migration;
assert.equal(migration.reason, 'inflight');
assert.deepEqual(migration.candidates.map(({ fromRegistryId, draftIds }) => ({ fromRegistryId, draftIds })), [{ fromRegistryId, draftIds: [draftId] }]);
const selection = { ...request, fromRegistryId, draftId };
assert.deepEqual(await api.discardEarlierConfigurationDraft(selection), { discarded: true });
const adopted = (await list(api)).providers.find(row => row.providerId === request.providerId).configuration;
assert.notEqual(adopted.known, false);
assert.notEqual(adopted.scopeId, prior.scopeId);

const state = join(request.home, 'embedding-state.json');
const before = await readFile(state);
assert.deepEqual(await make().discardEarlierConfigurationDraft(selection), { discarded: false });
assert.deepEqual(await readFile(state), before);
`);
  await exec(process.execPath, ['--import', durableNetwork, consumer], {
    cwd: project, timeout: 60_000,
    env: { PATH: emptyBin, HOME: home, GOZAR_HOME: home, TMPDIR: fixture },
  });
});
