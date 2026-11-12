import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { processIdentity } from '../../packages/gozar-node/journal.mjs';
import { fixture } from './helpers.mjs';

const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
const run = promisify(execFile);

test('CLI status advises stop after immutable route loss and health for other degradation', async t => {
  const { directory: home } = await fixture(t, {});
  const port = 18765, dir = join(home, `port-${port}`), bin = join(home, 'bin');
  await mkdir(dir); await mkdir(bin);
  for (const command of ['ssh', 'tailscale']) await writeFile(join(bin, command), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const nonce = 'fixture-control';
  await writeFile(join(dir, 'control.json'), JSON.stringify({ pid: process.pid, startIdentity: await processIdentity(process.pid), nonce }));
  let response;
  const server = createServer(socket => { socket.on('data', data => {
    assert.equal(JSON.parse(data.toString()).nonce, nonce);
    socket.end(JSON.stringify(response) + '\n');
  }); });
  await new Promise(resolve => server.listen(join(dir, 'control.sock'), resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const status = async () => JSON.parse((await run(process.execPath, [cli, 'status', '--port', String(port), '--json'], {
    env: { ...process.env, HOME: home, GOZAR_HOME: home, PATH: bin }, timeout: 10000,
  })).stdout);
  const snapshot = { phase:'degraded', adapterId:'tunnl-gg', candidate:null, published:null,
    lastRouteChange:{ oldOrigin:'https://a.tunnl.gg', newOrigin:'https://b.tunnl.gg', generation:2 } };
  response = { snapshot, action:{ kind:'external', instruction:'Stop the current session and start a new route.', recheckCommand:'stop' } };
  assert.match((await status()).nextAction.command, /'stop' '--port' '18765'$/);
  // Health can replace the transient action after loss; the immutable route remains lost.
  response = { snapshot, action:{ kind:'external', recheckCommand:'health' } };
  const afterHealth = await status();
  assert.match(afterHealth.nextAction.command, /'stop' '--port' '18765'$/);
  assert.equal(afterHealth.action.recheckCommand, 'stop');
  response = { snapshot:{ phase:'degraded', adapterId:'localhost-run', candidate:'https://a.lhr.life' } };
  assert.match((await status()).nextAction.command, /'health' '--port' '18765'$/);
});


test('packed local recovery action executes without global gozar, including quoted paths', async t => {
  const { directory: home } = await fixture(t, {});
  const bin = join(home, 'bin'); await mkdir(bin);
  const trap = join(home, 'global-gozar-ran');
  await writeFile(join(bin, 'gozar'), `#!/bin/sh\nprintf trap > '${trap}'\nexit 91\n`, { mode:0o700 });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const packed = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', home], { cwd:root, timeout:30000 })).stdout)[0];
  const install = join(home, "local install's path");
  await run('npm', ['install', '--prefix', install, '--ignore-scripts', '--omit=optional', join(home, packed.filename)], { timeout:30000 });
  const installedCli = join(install, 'node_modules/@tnunamak/gozar/bin/gozar.mjs');
  const port = 18765, dir = join(home, `port-${port}`); await mkdir(dir);
  const nonce = randomUUID();
  await writeFile(join(dir, 'control.json'), JSON.stringify({ pid:process.pid, startIdentity:await processIdentity(process.pid), nonce }));
  const commands = [];
  let healthy = false;
  const server = createServer(socket => socket.on('data', data => {
    const message = JSON.parse(data.toString()); assert.equal(message.nonce, nonce);
    commands.push(message.command.type);
    const snapshot = message.command.type === 'stop' ? {phase:'stopped'} : healthy ? {phase:'published-ready',published:'https://a.tunnl.gg',adapterId:'tunnl-gg'} : {
      phase:'degraded', adapterId:'tunnl-gg', candidate:null, published:null,
      lastRouteChange:{oldOrigin:'https://a.tunnl.gg',newOrigin:'https://b.tunnl.gg',generation:2},
    };
    socket.end(JSON.stringify({snapshot,localCleanupFailures:[]})+'\n');
  }));
  await new Promise(resolve => server.listen(join(dir,'control.sock'),resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = {...process.env, HOME:home, GOZAR_HOME:home, PATH:bin};
  const reply = JSON.parse((await run(process.execPath,[installedCli,'status','--port',String(port),'--json'],{env,timeout:10000})).stdout);
  const stopped = await run('/bin/sh',['-c',reply.nextAction.command],{env,timeout:10000});
  assert.match(stopped.stdout,/Exposure stopped/);
  assert.deepEqual(commands,['status','stop']);
  healthy = true;
  const human = (await run(process.execPath,[installedCli,'status','--port',String(port)],{env,timeout:10000})).stdout;
  const recovery = human.split('After sleep or network loss: ')[1]?.split(';')[0];
  assert.ok(recovery, human);
  const rechecked = await run('/bin/sh',['-c',recovery],{env,timeout:10000});
  assert.match(rechecked.stdout,/Route checks passed/);
  assert.equal(commands.at(-1),'health');
  for (const line of human.split('\n').filter(line => /^(Status|Stop): /.test(line))) {
    assert.ok(line.includes(installedCli.replaceAll("'", "'\\''")), line);
  }
  const guided = await run(process.execPath,[installedCli,'expose','--port',String(port)],{env,timeout:10000}).catch(error => error);
  assert.match(guided.stdout,/For an internet client, run:/);
  assert.ok(guided.stdout.includes(installedCli.replaceAll("'", "'\\''")), guided.stdout);

  const missingOrigin = await run(process.execPath,[installedCli,'expose','--port',String(port),'--client-reach','internet','--adapter','own-address','--json'],{env,timeout:10000}).catch(error => error);
  const instruction = JSON.parse(missingOrigin.stdout).action.instruction;
  assert.ok(instruction.includes(installedCli.replaceAll("'", "'\\''")), instruction);
  const api = await import(pathToFileURL(join(install,'node_modules/@tnunamak/gozar/packages/gozar-node/api.mjs')));
  const external = { home:join(home,'external-state'),port };
  try {
    const setup = await api.expose({...external,origin:'https://owner.example',adapterId:'own-address',clientReach:'internet',yes:true});
    assert.ok(setup.action.instruction.includes(installedCli.replaceAll("'", "'\\''")), setup.action.instruction);
    assert.match(setup.action.instruction, /'health' '--port' '18765'/);
  } finally { await api.stop(external); }
  await assert.rejects(readFile(trap),{code:'ENOENT'});
});
