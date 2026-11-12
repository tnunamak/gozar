import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  assert.equal((await status()).nextAction.command, `gozar stop --port ${port}`);
  // Health can replace the transient action after loss; the immutable route remains lost.
  response = { snapshot, action:{ kind:'external', recheckCommand:'health' } };
  const afterHealth = await status();
  assert.equal(afterHealth.nextAction.command, `gozar stop --port ${port}`);
  assert.equal(afterHealth.action.recheckCommand, 'stop');
  response = { snapshot:{ phase:'degraded', adapterId:'localhost-run', candidate:'https://a.lhr.life' } };
  assert.equal((await status()).nextAction.command, `gozar health --port ${port}`);
});
