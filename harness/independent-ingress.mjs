import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIdentity } from '../packages/gozar-node/journal.mjs';

// Independent test ingress: Gozar never receives its PID, key path or mutation handle.
// Reuse the authorized trial recipe as data, without a second Gozar session.
export async function startIndependentIngress({ directory, target, recipe: fixtureRecipe }) {
  const definition = JSON.parse(await readFile(fileURLToPath(new URL('../adapters/localhost-run.definition.json', import.meta.url)), 'utf8')).definition;
  const recipe = fixtureRecipe ?? definition.recipes.create;
  const checkedTarget = value => {
    const url = new URL(value);
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.origin, value);
    return value;
  };
  let currentTarget = checkedTarget(target);
  const artifact = join(directory, 'independent-ingress');
  await mkdir(artifact, { mode: 0o700 });
  const knownHosts = join(artifact, 'known_hosts');
  await writeFile(knownHosts, '', { mode: 0o600, flag: 'wx' });
  const server = http.createServer((req, res) => {
    const destination = new URL(currentTarget);
    const upstream = http.request({ hostname: destination.hostname, port: destination.port, path: req.url,
      method: req.method, headers: { ...req.headers, host: destination.host } }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream); res.on('close', () => upstream.destroy());
  });
  let child, exited, startIdentity, args, output = '';
  const close = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(artifact, { recursive: true, force: true });
    if (startIdentity) assert.notEqual(await processIdentity(child.pid), startIdentity, 'independent fixture process residue');
    return { processGone: true, proxyClosed: !server.listening, privateArtifactRemoved: true };
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    args = recipe.args.map(arg => arg.replaceAll('{gatePort}', String(server.address().port)).replaceAll('{privateKnownHostsPath}', knownHosts));
    child = spawn(recipe.program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Independent ingress URL timed out')), recipe.timeoutMs);
      const inspect = chunk => {
        output += chunk;
        if (output.length > recipe.maxOutputBytes) { clearTimeout(timeout); reject(new Error('Independent ingress output limit')); return; }
        const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
        const urls = [...new Set(plain.match(/https:\/\/[^\s"'<>]+/g) ?? [])].filter(value => {
          try { return new URL(value).origin === value && new RegExp(recipe.parser.constraints.hostnamePattern).test(new URL(value).hostname); } catch { return false; }
        });
        if (urls.length > 1) { clearTimeout(timeout); reject(new Error('Ambiguous independent ingress origins')); }
        else if (urls.length === 1) { clearTimeout(timeout); resolve(urls[0]); }
      };
      child.stdout.on('data', inspect); child.stderr.on('data', inspect);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Independent ingress exited ${code}`)); });
    });
    startIdentity = await processIdentity(child.pid);
    assert.ok(startIdentity);
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const snapshot = async () => ({ origin, localOrigin, target: currentTarget, program: recipe.program, args, pid: child.pid, startIdentity: await processIdentity(child.pid), knownHosts: await readFile(knownHosts, 'utf8') });
    return { origin, transcript: () => output, snapshot, retarget(value) { currentTarget = checkedTarget(value); }, close };
  } catch (error) { await close(); throw error; }
}
