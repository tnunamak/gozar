import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDefinition } from '../../packages/gozar-node/catalog.mjs';
import { serve } from '../../packages/gozar-node/daemon.mjs';
import { fixture } from './helpers.mjs';
import { atomicWrite } from '../../packages/gozar-node/journal.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

// A tunnl-gg session whose relay is a local script that prints one public URL and stays alive.
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

test('lease stop command targets the owning home, including shell metacharacters', async t => {
  // A control socket path must fit in about 104 bytes, and the default home adds 45 to HOME, so the homes stay short.
  const base = await mkdtemp(join(tmpdir(), 'g-'));
  const customHome = await mkdtemp(join(base, "c ' h "));
  const shellHome = join(base, 's');
  const defaultHome = join(shellHome, '.local', 'state', 'gozar');
  await mkdir(defaultHome, { recursive:true });
  const custom = await makeSession(customHome, 18765), defaultSession = await makeSession(defaultHome, 18765);
  const holder = await serve(custom.directory, { probeExecutor:custom.probeExecutor });
  const untouched = await serve(defaultSession.directory, { probeExecutor:defaultSession.probeExecutor });
  t.after(async () => { await Promise.all([holder.terminate(), untouched.terminate()]); await rm(base, { recursive:true, force:true }); });
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

test('a session folder too long for a control socket is refused and leaves nothing listening', async t => {
  const { directory:base } = await fixture(t, {});
  const home = join(base, 'h'.repeat(Math.max(1, 110 - Buffer.byteLength(join(base, 'port-18767', 'control.sock')))));
  await mkdir(home);
  const session = await makeSession(home, 18767);
  const servers = () => process.getActiveResourcesInfo().filter(kind => kind === 'TCPServerWrap' || kind === 'PipeServerWrap').length;
  const before = servers();
  await assert.rejects(serve(session.directory, { probeExecutor:session.probeExecutor }), error => {
    assert.equal(error.code, 'invalid_input'); assert.match(error.message, /too long/); return true;
  });
  // A closed server leaves the active-handle list shortly after its close event.
  for (let tries = 0; servers() > before && tries < 50; tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(servers(), before);
});

test('a session that fails before its control socket opens leaves nothing listening', async t => {
  const { directory:home } = await fixture(t, {});
  const session = await makeSession(home, 18768);
  // An external origin binding with a plain-HTTP origin: host preparation refuses it after the gate is open.
  const bootstrap = JSON.parse(await readFile(join(session.directory, 'bootstrap.json'), 'utf8'));
  bootstrap.adapters[0].bindings = { ...bootstrap.adapters[0].bindings, origin:{ type:'credential-free-https-origin' } };
  bootstrap.origin = 'http://bad.example.test';
  await atomicWrite(join(session.directory, 'bootstrap.json'), bootstrap);
  const servers = () => process.getActiveResourcesInfo().filter(kind => kind === 'TCPServerWrap' || kind === 'PipeServerWrap').length;
  const before = servers();
  await assert.rejects(serve(session.directory, { probeExecutor:session.probeExecutor }), /External origin requires HTTPS/);
  for (let tries = 0; servers() > before && tries < 50; tries++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(servers(), before);
});
