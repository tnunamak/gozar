// Fakes shared by the public-API journey and the CLI parity tests: a durable world (real registry, fake LocalAPI, an app and a
// loopback HTTPS ingress per port) and a registry world (a provider that exists only as a test manifest entry).
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServiceVerifier } from '../../packages/gozar-node/service.mjs';
import { startFakeLocalApi, forwardTarget } from './fake-localapi.mjs';

export const exec = promisify(execFile);
const here = path => fileURLToPath(new URL(path, import.meta.url));
export const runner = here('./public-api-runner.mjs'), network = here('./durable-network.mjs'), cli = here('../../bin/gozar.mjs');
const adapterRoot = here('../../adapters');
export const requirements = { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [] };
export const dnsName = 'node.tailnet.test';
export const listen = (server, port = 0) => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
export const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

/** A scratch root under ~/.tmp (disk-backed) with one throwaway certificate for the fake node name. */
export async function journeyRoot() {
  await mkdir(join(homedir(), '.tmp'), { recursive: true });
  const root = await mkdtemp(join(homedir(), '.tmp', 'gozar-journey-'));
  const certificate = { cert: join(root, 'cert.pem'), key: join(root, 'key.pem') };
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certificate.key, '-out', certificate.cert,
    '-days', '1', '-subj', `/CN=${dnsName}`, '-addext', `subjectAltName=DNS:${dnsName}`]);
  return { root, certificate };
}

/** Runs one public API operation in a fresh child process; a kill by signal is reported, not thrown. */
export function runner_(env) {
  return async (operation, input) => {
    try {
      const { stdout } = await exec(process.execPath, ['--import', network, runner, operation, JSON.stringify(input)], { env, timeout: 60_000 });
      return JSON.parse(stdout);
    } catch (error) {
      if (error.stdout) return JSON.parse(error.stdout);
      throw error;
    }
  };
}

// What `tailscale status --json` prints in the fake CLI: the structure a real status has, so the catalog's readiness probe passes.
const tailscaleStatus = JSON.stringify({ BackendState: 'Running', Self: { ID: 'fixture-node', DNSName: 'device.example-tailnet.ts.net.',
  CapMap: { funnel: null, https: null, 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': null } },
  CurrentTailnet: { MagicDNSSuffix: 'example-tailnet.ts.net', MagicDNSEnabled: true }, CertDomains: ['device.example-tailnet.ts.net'] });

// --- The durable world: the real registry, a fake LocalAPI, an app and a loopback HTTPS ingress per port ------------

export async function durableWorld({ root, certificate }, t) {
  const base = await mkdtemp(join(root, 'd-'));
  const bin = join(base, 'bin'), home = join(base, 'home'), socket = join(base, 'ts.sock'), cliLog = join(base, 'cli.log');
  await mkdir(bin, { mode: 0o700 }); await mkdir(home, { mode: 0o700 });
  // The catalog's read-only detect probe runs `tailscale status`; any other CLI call is a durable-path violation.
  await writeFile(join(bin, 'tailscale'), `#!/bin/sh\nif [ "$1" = status ]; then echo '${tailscaleStatus}'; exit 0; fi\necho "$*" >> "${cliLog}"\nexit 97\n`); await chmod(join(bin, 'tailscale'), 0o755);
  const fake = await startFakeLocalApi(socket);
  t.after(() => fake.close());
  const state = fake.state;
  const verifier = createServiceVerifier();
  // `challenge.answer = false` is an app that is not configured for its address yet: it serves, but not the challenge.
  const challenge = { answer: true };
  const app = http.createServer((req, res) => { if (!(challenge.answer && verifier(req, res))) res.end('app'); });
  await listen(app); t.after(() => close(app));
  const routes = {};
  for (const port of [443, 8443, 10000]) {
    const ingress = https.createServer({ cert: await readFile(certificate.cert), key: await readFile(certificate.key) }, (req, res) => {
      const proxy = forwardTarget(state.config, state.dnsName, port);
      if (!proxy) { res.writeHead(404); res.end(); return; }
      const upstream = http.request(new URL(req.url, proxy), { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
    });
    await listen(ingress); t.after(() => close(ingress));
    routes[`${dnsName}:${port}`] = ingress.address().port;
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOZAR_TAILSCALED_SOCKET: socket, GOZAR_HOME: home,
    NODE_EXTRA_CA_CERTS: certificate.cert, GOZAR_TEST_NETWORK: JSON.stringify(routes) };
  const target = `127.0.0.1:${app.address().port}`;
  const query = (extra = {}) => ({ schemaVersion: 1, owner: 'example-app', target, usage: { kind: 'durable', routeId: 'coordinator' }, requirements, home, ...extra });
  const cliCalls = async () => (await readFile(cliLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { home, env, api: runner_(env), state, target, query, cliCalls, app, challenge, origin: `https://${dnsName}:8443` };
}

/** What a consumer does: ask by requirement, take the first eligible candidate's token and approval. */
export const approvalFrom = catalog => {
  const candidate = catalog.candidates.find(item => item.eligible && item.candidateToken);
  assert.ok(candidate, `no eligible candidate: ${JSON.stringify(catalog.candidates.map(c => [c.name, c.eligible, c.unmet]))}`);
  return { candidate, approval: {kind:'route',consentFactsDigest:candidate.consentFactsDigest, candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } };
};

// --- The registry world: a provider that exists only as a test manifest entry --------------------------------------

/** A complete attached adapter that lives only in a test manifest. It logs each provider write to a file. */
export async function fakeRegistry({ root }, t, id = 'fake-edge') {
  const base = await mkdtemp(join(root, 'r-'));
  const providerDir = join(base, 'providers', id), writes = join(base, 'writes.log');
  await mkdir(providerDir, { recursive: true });
  const ngrok = JSON.parse(await readFile(join(adapterRoot, 'providers/ngrok-https-edge/definition.json'), 'utf8')).adapter;
  const text = `Serve this app through the synthetic ${id} edge while the app runs.`;
  const definition = { ...ngrok, id, label: `Synthetic ${id}`, needsAccount: false,
    capabilities: { ...ngrok.capabilities, needsAccount: false, address: { stability: 'ephemeral', scope: 'synthetic', conditions: ['test fixture'] },
      traffic: { ...ngrok.capabilities.traffic, readers: [`${id} edge`], metadataVisibleTo: [`${id} edge`], evidenceRef: null } },
    disclosure: { revision: `disc-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`, text, links: [] } };
  delete definition.needsAccount;
  await writeFile(join(providerDir, 'definition.json'), JSON.stringify({ adapter: definition }));
  await writeFile(join(providerDir, 'index.mjs'), `import { readFileSync, appendFileSync } from 'node:fs';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const log = event => appendFileSync(${JSON.stringify(writes)}, event + '\\n');
const origin = 'https://example-app.' + definition.id + '.invalid';
const capabilities = definition.capabilities;
export default {
  id: definition.id, definition,
  async detect() { return { state: 'ready', facts: { id: definition.id } }; },
  properties: () => capabilities,
  setupActions: () => [],
  async setup() { return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) { return { digest: 'plan-' + request.target, origin, resourceKey: 'res-' + definition.id, effects: [], readback: null, cleanup: null, precondition: null }; },
  async observe() { return { present: false, resourceKey: 'res-' + definition.id, identity: null, revision: null }; },
  async create(ctx, plan) { log('create'); return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation ?? 1, identity: { origin }, readback: null, origin }; },
  async verify() { return { status: 'verified', checkedAt: new Date().toISOString() }; },
  async remove() { log('remove'); return { removed: true, debt: null }; },
  async runtimeFacts() { return { properties: capabilities, ingress: null, limits: { recommendedPollIntervalMs: 1000, idleTimeoutMs: null } }; },
};
`);
  // The controller process of an attached route loads the same registry; this module only swaps in a no-gate runtime.
  const controller = join(base, 'controller.mjs');
  await writeFile(controller, `import { loadAdapters } from ${JSON.stringify(new URL('../../packages/gozar-node/adapter-runtime.mjs', import.meta.url).href)};
export default async function () {
  return { adapters: await loadAdapters({ manifest: ${JSON.stringify({ providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] })}, root: ${JSON.stringify(base)} }),
    validation: 'none', readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } };
}
`);
  const manifest = { providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] };
  const home = join(base, 'home'); await mkdir(home, { mode: 0o700 });
  const app = http.createServer((req, res) => res.end('app')); await listen(app); t.after(() => close(app));
  const env = { ...process.env, GOZAR_TEST_REGISTRY: JSON.stringify({ manifest, root: base, controllerModule: controller }) };
  const attached = (extra = {}) => ({ schemaVersion: 1, owner: 'example-app', target: `127.0.0.1:${app.address().port}`, home, usage: { kind: 'attached' },
    requirements: { ...requirements, address: 'any' }, ...extra });
  const writesSeen = async () => (await readFile(writes, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { base, home, env, api: runner_(env), attached, writesSeen, manifest, controller, root: base };
}

