// The Tailscale macOS apps (Mac App Store and standalone) expose the LocalAPI as a loopback TCP port plus a token.
// These tests run that path on any host: the platform, the files, lsof and the port probe are injected, and the
// LocalAPI is a fake HTTP server on loopback that rejects a wrong token.
//
// Fixture provenance: nothing here was captured from a running app. The formats come from upstream
// (tailscale commit 1d32249f40ce9940c8ab5be63840756bf2cb6f68), safesocket/safesocket_darwin.go:
//   readMacsysSameUserProof  /Library/Tailscale/ipnport is a symlink to the port; sameuserproof-<port> holds the token.
//   readMacosSameUserProof   `lsof -n -a -u<uid> -c IPNExtension -F`; the line with ".tailscale.ipn.macos/sameuserproof-<port>-<token>".
// and the upstream authentication, client/local/local.go DoLocalRequest (SetBasicAuth("", token)) and
// ipn/localapi/localapi.go Handler.ServeHTTP (Host local-tailscaled.sock; 401 without auth; 403 on a wrong password).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getNode, getServeConfig, setServeConfig, setTransportEffectsForTest } from '../../packages/gozar-node/tailscale-localapi.mjs';
import { discoverAppLocalApi, parseLsofSameUserProof } from '../../packages/gozar-node/tailscale-app-discovery.mjs';
import { normalizeError } from '../../packages/gozar-node/error-normalizer.mjs';
import { durablePlanFacts } from '../../packages/gozar-node/durable-route.mjs';
import { startFakeLocalApi } from './fake-localapi.mjs';

// A synthetic token in upstream's shape (sameUserProofTokenLength = 10 random bytes, hex).
const token = '0a1b2c3d4e5f60718293';
const wrongToken = 'ffffffffffffffffffff';

// `lsof -F` output of an IPNExtension process: one field per line, the file name field starts with `n`.
// The one line upstream cuts on is the last. The path is the app group container of the App Store app.
const lsofOutput = port => [
  'p4242', 'g4242', 'R1', 'cIPNExtension', 'u501', 'Lexample-user',
  'fcwd', 'a ', 'l ', 'tDIR', 'n/',
  'f3', 'au', 'lu', 'tREG', 'n/Users/example-user/Library/Group Containers/ABCDE12345.io.tailscale.ipn.macos/Logs/ipn.log',
  'f4', 'aw', 'lu', 'tREG', `n/Users/example-user/Library/Group Containers/ABCDE12345.io.tailscale.ipn.macos/sameuserproof-${port}-${token}`,
  ''].join('\n');

async function startAppLocalApi(t, { state = {} } = {}) {
  const seen = [];
  const config = { value: null, etag: 1 };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
      const [user, ...rest] = basic ? Buffer.from(basic[1], 'base64').toString('utf8').split(':') : [null];
      seen.push({ method: req.method, path: req.url, host: req.headers.host, authenticated: basic !== null && rest.join(':') === token, user });
      if (req.headers.referer || req.headers.origin || req.headers.host !== 'local-tailscaled.sock') return send(res, 403, 'invalid localapi request');
      if (!basic) return send(res, 401, 'auth required');
      if (rest.join(':') !== token) return send(res, 403, 'bad password');
      if (req.url === '/localapi/v0/status?peers=false') {
        return send(res, 200, JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'node.tailnet.test.',
          CapMap: { funnel: null, https: null, 'https://tailscale.com/cap/funnel-ports?ports=8443': null } } }));
      }
      if (req.url !== '/localapi/v0/serve-config') return send(res, 404, '404 page not found');
      if (req.method === 'GET') return send(res, 200, config.value === null ? 'null' : JSON.stringify(config.value), { Etag: `"app-${config.etag}"` });
      if (req.headers['if-match'] && req.headers['if-match'] !== `"app-${config.etag}"`) return send(res, 412, 'etag mismatch');
      config.value = JSON.parse(Buffer.concat(chunks).toString('utf8')); config.etag += 1;
      send(res, 200, '');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { port: server.address().port, seen, config, ...state };
}

// A spy that records the call. It also throws, but discovery swallows errors, so tests assert the record.
const refuse = (what, calls) => () => { calls.push(what); throw new Error(`${what} must not run`); };
// Effects for a Mac with the given files and lsof output. A missing piece rejects, as the real call does.
const mac = ({ ports = {}, lsof = null, symlink = null, tokenFile = null, uid = 501, sockets = [], calls = [] } = {}) => ({
  platform: () => 'darwin', uid: () => uid, socketCandidates: () => sockets,
  runLsof: async args => { calls.push(['lsof', args]); if (lsof === null) throw new Error('no lsof'); return lsof; },
  readlink: async path => { calls.push(['readlink', path]); if (symlink === null) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return symlink; },
  readFile: async path => { calls.push(['readFile', path]); if (tokenFile === null) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return tokenFile; },
  portOpen: async port => ports.open ?? port === ports.listening,
});
const withEffects = async (effects, run) => { const restore = setTransportEffectsForTest(effects); try { return await run(); } finally { restore(); } };

// --- Discovery (upstream parsers) ----------------------------------------------------------------------

test('App Store variant: the lsof -F line is parsed as upstream parses it', () => {
  assert.deepEqual(parseLsofSameUserProof(lsofOutput(61577)), { port: 61577, token });
  // Upstream splits on the first dash only: the token is everything after it.
  assert.deepEqual(parseLsofSameUserProof('n/x/.tailscale.ipn.macos/sameuserproof-1234-ab-cd'), { port: 1234, token: 'ab-cd' });
  assert.equal(parseLsofSameUserProof('p1\ncIPNExtension\nn/dev/null\n'), null, 'no sameuserproof line');
  assert.equal(parseLsofSameUserProof('n/x/.tailscale.ipn.macos/sameuserproof-notaport-abc'), null, 'upstream: invalid port is an error');
  assert.equal(parseLsofSameUserProof('n/x/.tailscale.ipn.macos/sameuserproof-1234'), null, 'no token: upstream continues, finds nothing');
});

test('discovery runs lsof with upstream arguments and reads the standalone files from /Library/Tailscale', async () => {
  const calls = [];
  assert.deepEqual(await discoverAppLocalApi(mac({ lsof: lsofOutput(61577), calls })), { port: 61577, token, variant: 'app-store' });
  assert.deepEqual(calls, [['lsof', ['-n', '-a', '-u501', '-c', 'IPNExtension', '-F']]], 'App Store first, and a hit stops there');

  const files = [];
  const found = await discoverAppLocalApi(mac({ symlink: '61578', tokenFile: `${token}\n`, ports: { listening: 61578 }, calls: files }));
  assert.deepEqual(found, { port: 61578, token, variant: 'standalone' }, 'the token is trimmed');
  assert.deepEqual(files.filter(([name]) => name !== 'lsof'), [['readlink', '/Library/Tailscale/ipnport'], ['readFile', '/Library/Tailscale/sameuserproof-61578']]);
});

test('discovery order follows upstream: the App Store variant, then the standalone variant', async () => {
  const found = await discoverAppLocalApi(mac({ lsof: lsofOutput(61577), symlink: '61578', tokenFile: wrongToken, ports: { open: true } }));
  assert.equal(found.port, 61577);
  const fallback = await discoverAppLocalApi(mac({ lsof: 'p1\ncIPNExtension\n', symlink: '61578', tokenFile: token, ports: { open: true } }));
  assert.deepEqual(fallback, { port: 61578, token, variant: 'standalone' });
});

test('discovery finds nothing in the unusable cases and never throws', async () => {
  for (const effects of [
    mac(),
    mac({ symlink: 'not-a-port', tokenFile: token, ports: { open: true } }),
    mac({ symlink: '61578', tokenFile: ' \n', ports: { open: true } }),
    mac({ symlink: '61578', tokenFile: token, ports: { open: false } }),
    mac({ symlink: '70000', tokenFile: token, ports: { open: true } }),
    { ...mac(), uid: () => null },
  ]) assert.equal(await discoverAppLocalApi(effects), null);
});

test('Linux is unchanged: discovery runs no lsof and reads nothing under /Library', async () => {
  const touched = [];
  const effects = { platform: () => 'linux', uid: () => 501, runLsof: refuse('lsof', touched), readlink: refuse('readlink', touched), readFile: refuse('readFile', touched), portOpen: refuse('port probe', touched) };
  assert.equal(await discoverAppLocalApi(effects), null);
  // Through the transport: no socket and no app is provider_unavailable with the Linux next action, and nothing was touched.
  await withEffects({ ...effects, socketCandidates: () => [] }, async () => {
    await assert.rejects(getNode(), error => error.code === 'provider_unavailable' && error.nextAction === 'start tailscaled');
  });
  assert.deepEqual(touched, [], 'no lsof, no /Library read, no port probe on Linux');
});

// --- Transport -----------------------------------------------------------------------------------------

test('standalone app: the LocalAPI is reached over TCP with the token as the Basic password', async t => {
  const app = await startAppLocalApi(t);
  await withEffects(mac({ symlink: String(app.port), tokenFile: `${token}\n`, ports: { open: true } }), async () => {
    assert.deepEqual(await getNode(), { dnsName: 'node.tailnet.test', funnelPorts: [8443] });
    const read = await getServeConfig();
    assert.deepEqual(read.config, {});
    assert.equal(await setServeConfig({ TCP: { 8443: { HTTPS: true } } }, read.etag), true);
    assert.equal(await setServeConfig({ TCP: {} }, read.etag), false, 'the 412 contract is unchanged over TCP');
  });
  assert.equal(app.seen.length, 4);
  for (const request of app.seen) assert.deepEqual({ authenticated: request.authenticated, host: request.host, user: request.user }, { authenticated: true, host: 'local-tailscaled.sock', user: '' });
});

test('App Store app: the port and token from lsof reach the LocalAPI', async t => {
  const app = await startAppLocalApi(t);
  await withEffects(mac({ lsof: lsofOutput(app.port) }), async () => {
    assert.equal((await getNode()).dnsName, 'node.tailnet.test');
    assert.ok((await getServeConfig()).etag);
  });
  assert.ok(app.seen.length === 2 && app.seen.every(request => request.authenticated));
});

test('a token the app refuses is provider_denied, and no error carries the token', async t => {
  const app = await startAppLocalApi(t);
  // Stale token: the app was restarted and wrote a new one, but lsof or the file still names the old one.
  const stale = lsofOutput(app.port).replaceAll(token, wrongToken);
  const failures = [];
  await withEffects(mac({ lsof: stale }), async () => {
    for (const call of [getNode, getServeConfig, () => setServeConfig({}, '"x"')]) failures.push(await call().then(() => assert.fail('must be denied'), error => error));
  });
  assert.equal(app.seen.length, 3);
  for (const error of failures) {
    assert.equal(error.code, 'provider_denied');
    assert.match(error.nextAction, /Tailscale app/);
    // Everything an app or a log could print from the error, including hidden and nested fields.
    const everything = [error.message, error.nextAction, error.stack, JSON.stringify(error), JSON.stringify(Object.getOwnPropertyNames(error).map(name => error[name]))].join('\n');
    const normalized = normalizeError(error);
    assert.equal(normalized.code, 'setup_required', 'the public code');
    const seen = everything + JSON.stringify(normalized) + normalized.message + normalized.stack;
    assert.ok(!seen.includes(wrongToken) && !seen.includes(token), 'no token in the error');
  }
});

test('neither a socket nor an app: provider_unavailable that names what to start', async () => {
  await withEffects(mac(), async () => {
    for (const call of [getNode, getServeConfig]) {
      await assert.rejects(call(), error => error.code === 'provider_unavailable' && /Tailscale app/.test(error.message) && /tailscaled/.test(error.message) &&
        error.nextAction === 'open the Tailscale app, or start tailscaled');
    }
  });
});

test('stale app files (nothing listens on the port) are provider_unavailable', async () => {
  await withEffects(mac({ symlink: '61578', tokenFile: token, ports: { open: false } }), async () => {
    await assert.rejects(getNode(), error => error.code === 'provider_unavailable');
  });
});

test('a unix socket comes first, and GOZAR_TAILSCALED_SOCKET overrides the app', async t => {
  const dir = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? tmpdir(), 'gozar-app-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const socket = join(dir, 'tailscaled.socket');
  const fake = await startFakeLocalApi(socket, { dnsName: 'socket.tailnet.test' });
  t.after(() => fake.close());
  const app = await startAppLocalApi(t);
  const effects = mac({ lsof: lsofOutput(app.port), sockets: [socket] });

  await withEffects(effects, async () => assert.equal((await getNode()).dnsName, 'socket.tailnet.test'));
  assert.equal(app.seen.length, 0, 'the app was not asked while a socket exists');

  const saved = process.env.GOZAR_TAILSCALED_SOCKET;
  process.env.GOZAR_TAILSCALED_SOCKET = join(dir, 'missing.socket');
  try {
    const touched = [];
    await withEffects({ ...effects, runLsof: refuse('lsof', touched), readlink: refuse('readlink', touched) }, async () => {
      await assert.rejects(getNode(), error => error.code === 'provider_unavailable');
    });
    assert.deepEqual(touched, [], 'the override stops app discovery');
  } finally { if (saved === undefined) delete process.env.GOZAR_TAILSCALED_SOCKET; else process.env.GOZAR_TAILSCALED_SOCKET = saved; }
  assert.equal(app.seen.length, 0, 'the override wins over the app');
});

test('the token reaches no fact, result or file: durable plan facts through the app transport', async t => {
  const app = await startAppLocalApi(t);
  const home = await mkdtemp(join(process.env.GOZAR_TEST_TMPDIR ?? tmpdir(), 'gozar-app-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'inner'), { recursive: true, mode: 0o700 });
  let facts;
  await withEffects(mac({ lsof: lsofOutput(app.port) }), async () => { facts = await durablePlanFacts({ home, adapterId: 'tailscale-funnel', target: '127.0.0.1:3000' }); });
  assert.ok(facts.planDigest && facts.observedResource && facts.origin, 'the app was reached: node name and serve config were read');
  assert.ok(app.seen.length >= 2 && app.seen.every(request => request.authenticated));
  const files = [];
  const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else files.push(path); } };
  await walk(home);
  const written = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n');
  for (const text of [JSON.stringify(facts), written]) assert.ok(!text.includes(token), 'no token in facts or files');
});

// --- The live check a person runs on a Mac with a Tailscale app --------------------------------------------

test('check-tailscale-app prints the variant, the port and pass or fail, and never the token', async t => {
  const { checkTailscaleApp } = await import('../../packages/gozar-node/check-tailscale-app.mjs');
  const app = await startAppLocalApi(t);
  const env = { PATH: '/nonexistent/bin' };
  const resolve = () => '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  const check = effects => withEffects(effects, () => checkTailscaleApp({ platform: 'darwin', env, resolve: effects.resolve ?? resolve, discover: () => discoverAppLocalApi(effects) }));
  {
    const passed = await check(mac({ lsof: lsofOutput(app.port) }));
    assert.deepEqual(passed.lines, ['Gozar Tailscale check (read-only)', 'platform: darwin', 'tailscale CLI: the Tailscale app bundle',
      `Tailscale app LocalAPI: App Store app on loopback port ${app.port} (a unix socket is used first when one exists)`,
      'LocalAPI status: ok', 'LocalAPI serve-config: ok', 'result: reachable']);
    assert.equal(passed.ok, true);
  }
  {
    const failed = await check(mac({ lsof: lsofOutput(app.port).replaceAll(token, wrongToken) }));
    assert.equal(failed.ok, false);
    assert.match(failed.lines.at(-2), /^LocalAPI serve-config: provider_denied \(quit and reopen the Tailscale app\)$/);
    assert.ok(!failed.lines.join('\n').includes(token) && !failed.lines.join('\n').includes(wrongToken));
  }
  {
    const none = await check({ ...mac(), resolve: () => 'tailscale' });
    assert.deepEqual(none.lines.slice(2, 4), ['tailscale CLI: not found', 'Tailscale app LocalAPI: not found (a unix socket is used first when one exists)']);
    assert.equal(none.lines.at(-3), 'LocalAPI status: provider_unavailable (open the Tailscale app, or start tailscaled)');
  }
});
