import { mkdir, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../packages/gozar-node/core.mjs';
import { Controller } from '../packages/gozar-node/controller.mjs';
import { EffectDriver } from '../packages/gozar-node/driver.mjs';
import { Journal } from '../packages/gozar-node/journal.mjs';

export const planFeatures = ['recipe-sequence', 'typed-bindings', 'predicate-parser', 'owned-resource-ledger', 'owned-process', 'interface-forwarder', 'private-file-reference', 'probe-assertions', 'client-vantage-probe', 'unused-port-selection'];
const actor = fileURLToPath(new URL('./plan-actor.mjs', import.meta.url));
export async function operationalFixture(t, { targetPort, kind = 'forwarder', ownership = 'owned', guard = true } = {}) {
  const base = (process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.cache', 'gozar', 'tests')); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'gz-plan-'));
  const files = Object.fromEntries(['config', 'after', 'audit', 'mutation'].map(name => [name, join(directory, name)]));
  const route = { origin: `http://127.0.0.1:${targetPort}` };
  await writeFile(files.config, JSON.stringify({ allow: guard, TCP: { 443: {}, 10000: {}, 8444: {}, 9443: {} }, route }));
  await writeFile(files.after, JSON.stringify({ route }));
  const observe = path => ({ kind: 'spawn', program: process.execPath, args: [actor, 'observe', path, files.audit], timeoutMs: 2000, maxOutputBytes: 16384, parser: { kind: 'json-document', predicate: { op: 'exists', pointer: '/route' } } });
  const before = [{ id: 'config', recipe: observe(files.config), assert: { op: 'equals', pointer: '/allow', value: true }, captures: { occupiedPorts: { type: 'port-set', paths: ['/TCP'] }, allowed: { type: 'bool', pointer: '/allow' } } }];
  const after = [{ id: 'readback', recipe: observe(files.after), assert: { op: 'equals', pointer: '/route', value: route }, captures: { route: { type: 'record', pointer: '/route', fields: { origin: { type: 'origin', pointer: '/origin' } } } } }];
  const create = kind === 'process'
    ? { kind: 'spawn', program: process.execPath, args: [actor, 'process', files.mutation, files.audit, route.origin], timeoutMs: 2000, maxOutputBytes: 16384, process: { mode: 'owned-long-running', stdin: 'closed', lifetimeMs: 10_000, collectMs: 100 }, parser: { kind: 'url' } }
    : { kind: 'local-forwarder', targetPort: '{targetPort}', targetHost: '127.0.0.1', bindAddress: '127.0.0.1', port: 0, timeoutMs: 2000, maxOutputBytes: 16384, parser: { kind: 'json', pointer: '/origin' } };
  const adapter = { id: 'controlled-plan', planVersion: 1, admission: { state: 'admitted', requiredFeatures: [...planFeatures] }, audience: 'local', ownership, capabilities: { https: false, sse: true, streamableHttp: true },
    bindings: { targetPort: { type: 'loopback-port' } }, endpoint: ownership === 'external-owned' ? route.origin : undefined,
    recipes: ownership === 'external-owned' ? {} : { create: { ...create, before, requires: [{ op: 'equals', source: 'config', pointer: '/allowed', value: true }], after },
      remove: { kind: kind === 'process' ? 'owned-process' : 'local-forwarder', ...(kind === 'process' ? { signal: 'SIGTERM', graceMs: 1000, thenSignal: 'SIGKILL', confirmExit: true } : {}),
        before: [{ id: 'live', recipe: { kind: 'spawn', program: process.execPath, args: [actor, 'observe-resource', join(directory, 'session.json'), files.audit, '{resourceId}'], timeoutMs: 2000, maxOutputBytes: 16384, parser: { kind: 'json-document', predicate: { op: 'exists', pointer: '/route' } } },
          assert: { op: 'owned-ledger-match', source: 'stdout', pointer: '/route' }, captures: { route: { type: 'record', pointer: '/route', fields: {} } } }],
        requires: [{ op: 'owned-ledger-match', source: 'live', pointer: '/route' }] } } };
  const nowMs = Date.now(); const sessionId = `controlled-${directory.split('/').at(-1)}`;
  const host = { nowMs, features: [...planFeatures], bindings: { targetPort: { type: 'loopback-port', value: targetPort, authorityRef: 'fixture:target', sessionId, observedAtMs: nowMs - 1, expiresAtMs: nowMs + 60_000 } }, facts: {},
    probe: { nonceRef: 'fixture:nonce', verifierRef: 'fixture:local-verifier', expiresAtMs: nowMs + 60_000 } };
  const journal = new Journal(directory); await journal.load();
  const driver = new EffectDriver({ adapters: [adapter], journal, sessionId, targetPort, features: [...planFeatures], host });
  const transitions = [], dispatched = [], completions = [];
  const wasm = await loadCore();
  // Provide the trusted harness host input at the core boundary. No effect results are fabricated.
  const step = input => { const output = wasm({ ...input, host: { ...host, nowMs: Date.now() } }); transitions.push({ input, output }); return output; };
  const execute = driver.execute.bind(driver);
  driver.execute = async effect => { dispatched.push(effect); const result = await execute(effect); completions.push(result); return result; };
  const controller = new Controller({ step, driver, journal, adapters: [adapter], requirements: { clientReach: 'this-device' }, targetPort, sessionId, host });
  t.after(async () => { await controller.shutdown().catch(() => {}); await driver.closeLocal(); await rm(directory, { recursive: true, force: true }); });
  return { directory, files, route, adapter, host, sessionId, journal, driver, controller, step, transitions, dispatched, completions,
    audit: () => readFile(files.audit, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; }) };
}
