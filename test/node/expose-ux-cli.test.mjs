import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { fixture } from './helpers.mjs';
import { processIdentity } from '../../packages/gozar-node/journal.mjs';
import { planned } from './fixtures/expose-ux.mjs';
const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
const run = promisify(execFile);

test('fake-provider CLI reaches the compact prompt in both modes; declining starts no route', async t => {
  const { directory } = await fixture(t, {});
  const bin = join(directory, 'bin'); await mkdir(bin);
  const calls = join(directory, 'calls');
  const preload = join(directory, 'tty.mjs');
  await writeFile(preload, 'Object.defineProperty(process.stdin, "isTTY", { value: true });\n');
  for (const program of ['tailscale', 'ssh']) await writeFile(join(bin, program), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
const args = process.argv.slice(2);
if (args[0] === 'status') console.log(JSON.stringify({BackendState:'Running', Self:{DNSName:'node.tailnet.test.'}}));
else if (args[0] === 'serve' && args[1] === 'status') console.log('{}');
else if (args[0] === '-V') process.stderr.write('OpenSSH_fixture');
else process.exit(99);
`, { mode: 0o700 });
  const env = { ...process.env, PATH: bin, GOZAR_HOME: join(directory, 'home') };
  for (const flags of [[], ['--alternatives'], ['--verbose']]) {
    const child = spawn(process.execPath, ['--import', preload, cli, 'expose', '--port', '18765', '--client-reach', 'internet', ...flags], { env });
    let stdout = '', stderr = '', declined = false;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => {
      stdout += data;
      if (!declined && stdout.includes('Expose it with Tailscale Funnel? [y/N]')) { declined = true; child.stdin.end('n\n'); }
    });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    clearTimeout(timeout);
    assert.equal(code, 0, stdout + stderr);
    assert.ok(declined, stdout);
    const plan = stdout.slice(stdout.indexOf('Gozar will make'));
    if (!flags.includes('--verbose')) assert.ok(plan.split('\n').filter(line => line.trim()).length <= 12, stdout);
    assert.match(stdout, /Address\s+https:\/\/<machine>\.<tailnet>\.ts\.net, port 8443 or 10000 \(a pattern; the exact address comes after you approve\)/);
    assert.doesNotMatch(stdout, /Public URL:/);
  }
  const invocations = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(invocations.every(args => args[0] === 'status' || args[0] === '-V' || (args[0] === 'serve' && args[1] === 'status')), JSON.stringify(invocations));
  await assert.rejects(readFile(join(directory, 'home', 'last.json')), { code: 'ENOENT' });
});

test('JSON from a fake controller is byte-identical to the frozen 0.3.3 projection with all display flags', async t => {
  const { directory: home } = await fixture(t, {});
  const directory = join(home, 'port-18765'); await mkdir(directory);
  const nonce = 'ux-fixture';
  await writeFile(join(directory, 'control.json'), JSON.stringify({ pid: process.pid, startIdentity: await processIdentity(process.pid), nonce }));
  let response = planned;
  const server = createServer(socket => socket.on('data', data => {
    assert.equal(JSON.parse(data.toString()).nonce, nonce);
    socket.end(JSON.stringify(response) + '\n');
  }));
  await new Promise(resolve => server.listen(join(directory, 'control.sock'), resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const expected = await readFile(new URL('./fixtures/expose-ux-cli-033.json', import.meta.url), 'utf8');
  for (const command of ['status', 'health']) for (const flags of [[], ['--alternatives', '--verbose']]) {
    const result = await run(process.execPath, [cli, command, '--port', '18765', '--json', ...flags], { env: { ...process.env, GOZAR_HOME: home, PATH: '/missing-fixture-binaries' } });
    assert.equal(result.stdout, expected);
  }
  response = { error: 'Fixture immutable process identity readback failed' };
  for (const flags of [[], ['--verbose']]) {
    const failed = await run(process.execPath, [cli, 'expose', '--port', '18765', '--client-reach', 'internet', '--via', 'tailscale-funnel', '--yes', ...flags],
      { env: { ...process.env, GOZAR_HOME: home, PATH: '/missing-fixture-binaries' } }).catch(error => error);
    assert.equal(failed.code, 1);
    assert.match(failed.stderr, /Public access or a background process may remain\. Cleanup is not confirmed\./);
    assert.match(failed.stderr, /'stop' '--port' '18765'/);
    assert.doesNotMatch(failed.stderr, /Nothing was published/);
    if (flags.length) assert.match(failed.stderr, /Full detail: Fixture immutable process identity readback failed/);
    else assert.doesNotMatch(failed.stderr, /immutable process identity|readback/);
  }
  const unknown = await run(process.execPath, [cli, 'expose', '--via', 'no-such-way']).catch(error => error);
  assert.match(unknown.stderr, /Valid names:.*localhost.run/);
});
