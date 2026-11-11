#!/usr/bin/env node
// Real terminal walk: no provider selection or consent flags on the expose command.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireLiveLock, assertUnusedPort, canonical, routeBaseline } from './live-safety.mjs';
import { command } from './process.mjs';
import { probe } from './probe.mjs';
import { verifyPublicRelayService } from './public-relay-service.mjs';
import { processIdentity } from '../packages/gozar-node/journal.mjs';

const { values } = parseArgs({ options: { 'work-directory': { type: 'string' } } });
assert.ok(values['work-directory'], 'retain a private work directory for the actual transcript');
const directory = resolve(values['work-directory']);
await mkdir(directory, { recursive: true, mode: 0o700 });
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, GOZAR_HOME: join(directory, 'state') };
const report = { result: 'failed', commands: [], setupAnswers: [], remote: false };
let release, before, demo, demoExit, port, nonce, attempted = false, terminal, terminalExit;
const cli = async (args, json = true) => {
  const argv = [join(root, 'bin/gozar.mjs'), ...args];
  const result = await command(process.execPath, argv, { env, timeoutMs: 120000 });
  report.commands.push({ argv, ...result });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return json ? JSON.parse(result.stdout) : result.stdout;
};
try {
  release = await acquireLiveLock('no-flag-cli-walk');
  before = await routeBaseline(); report.before = before;
  assertUnusedPort(before, 8443);
  demo = spawn(process.execPath, [join(root, 'harness/dummy-server.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  demoExit = once(demo, 'exit');
  let demoOutput = '', demoError = '';
  demo.stdout.on('data', chunk => { demoOutput += chunk; });
  demo.stderr.on('data', chunk => { demoError += chunk; });
  while (!demoOutput.includes('\n')) {
    assert.equal(demo.exitCode, null, demoError);
    await once(demo.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  }
  report.demoTranscript = demoOutput;
  const match = /port (\d+): (http:\/\/127\.0\.0\.1:\d+)/.exec(demoOutput);
  assert.ok(match, demoOutput); port = Number(match[1]);
  nonce = (await (await fetch(match[2])).json()).nonce;
  report.local = await probe({ origin: match[2], nonce, toolName: 'echo' });
  const argv = [join(root, 'bin/gozar.mjs'), 'expose', '--port', String(port)];
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  terminal = spawn('script', ['-q', '-e', '-c', [process.execPath, ...argv].map(quote).join(' '), join(directory, 'expose.typescript')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  terminalExit = once(terminal, 'exit');
  const record = { argv, stdout: '', stderr: '' }; report.commands.push(record);
  let reachAnswered = false, consentAnswered = false;
  terminal.stdout.on('data', chunk => {
    record.stdout += chunk;
    if (!reachAnswered && record.stdout.includes('> ')) {
      reachAnswered = true; report.setupAnswers.push('internet'); terminal.stdin.write('internet\n');
    }
    if (!consentAnswered && record.stdout.includes('[y/N]')) {
      consentAnswered = true; attempted = true; report.setupAnswers.push('yes'); terminal.stdin.write('yes\n');
    }
  });
  terminal.stderr.on('data', chunk => { record.stderr += chunk; });
  const timeout = setTimeout(() => terminal.kill('SIGTERM'), 660000);
  try { [record.code, record.signal] = await terminalExit; } finally { clearTimeout(timeout); }
  assert.equal(record.code, 0, record.stderr || record.stdout);
  assert.equal(reachAnswered && consentAnswered, true, 'real terminal must show reach and consent prompts');
  report.statusTranscript = await cli(['status'], false);
  report.status = await cli(['status', '--json']);
  assert.equal(report.status.snapshot.phase, 'published-ready');
  const journal = JSON.parse(await readFile(join(env.GOZAR_HOME, `port-${port}`, 'session.json'), 'utf8'));
  report.proof = await verifyPublicRelayService({ origin: report.status.snapshot.published, serviceNonce: nonce, toolName: 'echo', validation: report.status.validation, authorization: journal.state.host.probe });
  report.result = 'passed';
} catch (error) { report.error = error.stack; }
finally {
  try {
    if (terminal && terminal.exitCode === null && terminal.signalCode === null) { terminal.kill('SIGTERM'); await terminalExit; }
    if (attempted) {
      const state = join(env.GOZAR_HOME, `port-${port}`);
      const previous = JSON.parse(await readFile(join(state, 'session.json'), 'utf8'));
      report.stopTranscript = await cli(['stop'], false);
      const after = JSON.parse(await readFile(join(state, 'session.json'), 'utf8'));
      assert.equal(after.snapshot.phase, 'stopped');
      assert.equal(Object.keys(after.owned).length, 0);
      for (const resource of Object.values(previous.owned).filter(resource => resource.kind === 'process')) {
        assert.notEqual(await processIdentity(resource.pid), resource.startIdentity);
      }
    }
    report.zeroOwnedResidue = true;
  } catch (error) { report.result = 'failed'; report.cleanupError = error.stack; }
  finally {
    try {
      if (before) { report.after = await routeBaseline(); assert.equal(canonical(report.after), canonical(before), 'full foreign baseline must survive'); assertUnusedPort(report.after, 8443); }
    } catch (error) { report.result = 'failed'; report.baselineError = error.stack; report.zeroOwnedResidue = false; }
    if (demo && demo.exitCode === null && demo.signalCode === null) { demo.kill('SIGTERM'); await demoExit; }
    if (release) await release();
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
}
console.log(JSON.stringify({ result: report.result, report: join(directory, 'report.json'), error: report.error, cleanupError: report.cleanupError }));
process.exitCode = report.result === 'passed' ? 0 : 1;
