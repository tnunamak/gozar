// Not a test file. A generic session controller in a real detached process with a stub adapter standing in for the provider:
// start, close, expiry, provider loss and the failure record are the real code. `tune` edits the stub adapter inside the controller process.
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';
import { processIdentity } from '../../packages/gozar-node/process-identity.mjs';
import { attachedScratch, query, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const helperUrl = pathToFileURL(join(root, 'test/node/route-schema-check.mjs')).href;
const readContext = { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };

/** A controller module: `tune` edits the stub adapter the controller process holds (e.g. makes create throw or verify fail). */
export async function sessionWorld(t, tune = '', { port = 8799, validation = 'none' } = {}) {
  const home = await attachedScratch(t), tokens = tokenStubs(), module = join(home, 'controller.mjs');
  await writeFile(module, `import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { stubAdapter } from ${JSON.stringify(helperUrl)};
export default async function () {
  const file = process.argv[3] + '/bootstrap.json', bootstrap = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...bootstrap, identity: { instanceId: 'fixture-instance', bootId: randomUUID() } }));
  const adapter = stubAdapter('stub-b');
  ${tune}
  return { adapters: [adapter], effectContext: () => ({}), validation: ${JSON.stringify(validation)},
    readContext: { now: () => Date.now(), configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } };
}
`);
  const q = query({ home, target: `127.0.0.1:${port}`, usage: { kind: 'session', lifetimeMs: 60_000 } });
  const approve = async wait => {
    const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, 'disc-stub-b'), grant: { adapterId: 'stub-b', planDigest: `plan-stub-b-${q.target}`, observedResource: 'res-stub-b' } });
    return { ...q, approval: { candidateToken: token, disclosureRevision: 'disc-stub-b' }, wait };
  };
  const run = async ({ wait = 'verified', ...deps } = {}) => openSessionRoute(await approve(wait), { adapters: [stubAdapter('stub-b')], redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux',
    readContext, controllerModule: module, leaseExpiryMs: 1500, heartbeatMs: 200, startTimeoutMs: 30_000, ...deps });
  const directory = join(home, `port-${port}`);
  const controller = async () => { const identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8').catch(() => 'null')); return identity; };
  const alive = async () => { const identity = await controller(); return Boolean(identity?.pid) && await processIdentity(identity.pid) === identity.startIdentity; };
  t.after(async () => { const identity = await controller(); if (identity?.pid && await processIdentity(identity.pid) === identity.startIdentity) { try { process.kill(identity.pid, 'SIGKILL'); } catch { /* gone */ } } });
  return { home, run, approve, directory, alive, controller };
}
export async function gone(world) {
  for (let end = Date.now() + 8000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 50))) if (!await world.alive()) return true;
  return false;
}

