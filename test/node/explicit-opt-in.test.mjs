import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';

const api = fileURLToPath(new URL('../../packages/gozar-node/api.mjs', import.meta.url));

test('API accepts explicit admitted relay selection but continues to block next-drop modes', async t => {
  const { directory } = await fixture(t, {});
  const bin = join(directory, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'ssh'), '#!/bin/sh\nif [ "$1" = "-V" ]; then echo OpenSSH_fixture >&2; exit 0; fi\nexit 1\n', { mode: 0o700 });
  await writeFile(join(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const source = `import { expose } from ${JSON.stringify(api)};\nfor (const adapterId of ['tunnl-gg', 'ngrok-https-edge']) {\n  try { await expose({ port: 18765, clientReach:'internet', adapterId, home:process.env.GOZAR_HOME }); console.log('unexpected success'); }\n  catch (error) { console.log(JSON.stringify({ adapterId, message:error.message })); }\n}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding:'utf8', timeout:30000, env:{ ...process.env, HOME:directory, GOZAR_HOME:join(directory, 'home'), PATH:bin },
  });
  assert.equal(child.status, 0, child.stderr);
  const lines = child.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.match(lines[0].message, /Exposure requires approval/);
  assert.match(lines[1].message, /Selected route is not available in this version/);
});
