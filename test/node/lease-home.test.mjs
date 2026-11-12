import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { fixture } from './helpers.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('lease stop command targets the owning home, including shell metacharacters', async t => {
  const { directory:base } = await fixture(t, {});
  const customHome = await mkdtemp(join(base, "gozar custom ' home "));
  const shellHome = join(base, 'shell-home');
  const defaultHome = join(shellHome, '.local', 'state', 'gozar');
  await mkdir(defaultHome, { recursive:true });
  const makeSession = async (home, port) => {
    const directory = join(home, `port-${port}`); await mkdir(directory);
    const adapter = structuredClone(await loadDefinition(root, 'tunnl-gg'));
    const executable = join(directory, 'relay');
    await writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({event:'tunnel',url:'https://home-test.tunnl.gg',upgrade:'https://tunnl.gg/pricing'}));setInterval(()=>{},1000);\n`, { mode:0o700 });
    adapter.recipes.create.program = executable; adapter.recipes.create.process.collectMs = 20;
    await atomicWrite(join(directory, 'bootstrap.json'), { adapters:[adapter], adapterId:adapter.id, targetPort:port,
      requirements:{ clientReach:'internet', httpsRequired:true, sse:true }, consent:true, approveOrigin:true, lifetimeMs:60000 });
    const probeExecutor = { vantages:['public'], async verify(request) { const now = Math.floor(performance.timeOrigin + performance.now());
      return { probeReceipt:{ ...request.authorization, origin:request.origin, vantage:'public', remote:true, observedAtMs:now, expiresAtMs:now+30000, tls:true, instanceMatched:true, sse:true } }; } };
    return { directory, probeExecutor };
  };
  const custom = await makeSession(customHome, 18765), defaultSession = await makeSession(defaultHome, 18765);
  const holder = await serve(custom.directory, { probeExecutor:custom.probeExecutor });
  const untouched = await serve(defaultSession.directory, { probeExecutor:defaultSession.probeExecutor });
  t.after(async () => { await Promise.all([holder.terminate(), untouched.terminate()]); });
  const contender = await makeSession(customHome, 18766);
  const refused = await serve(contender.directory, { probeExecutor:contender.probeExecutor }).then(() => assert.fail('second same-key route started'), error => error);
  const command = refused.message.match(/Stop it with ([\s\S]*)\.$/)?.[1];
  assert.ok(command, refused.message);
  const result = await exec('/bin/sh', ['-c', command], { env:{ PATH:process.env.PATH, HOME:shellHome, LANG:'C.UTF-8' }, timeout:15000 }).then(reply => ({...reply, code:0}), error => error);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(holder.controller.state.phase, 'stopped');
  assert.notEqual(untouched.controller.state.phase, 'stopped');
  assert.equal(JSON.parse(await readFile(join(defaultHome, 'port-18765', 'control.json'), 'utf8')).pid, process.pid);
});
