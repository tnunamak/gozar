import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { statusServices, removeService } from '../../packages/gozar-node/service.mjs';

// Crash after publication while the add operation still holds its mutation lock.
test('controller crash releases its lock and preserves the registered route', async t => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'gozar-service-crash-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const origin = 'https://crash.example';
  const moduleUrl = new URL('../../packages/gozar-node/service.mjs', import.meta.url).href;
  const script = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const link = fs.link;
    fs.link = async (...args) => {
      await link(...args);
      process.stdout.write('published');
      await new Promise(() => { setInterval(() => {}, 1000); });
    };
    syncBuiltinESMExports();
    const {addService} = await import(${JSON.stringify(moduleUrl)});
    await addService({home:${JSON.stringify(home)},origin:${JSON.stringify(origin)},target:'localhost:3000',verifyCmd:'exit 0'});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let errors = '';
  child.stderr.on('data', chunk => errors += chunk);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No publication: ${errors}`)), 5000);
    child.stdout.once('data', chunk => { clearTimeout(timer); assert.equal(chunk.toString(), 'published'); resolve(); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Premature exit: ${errors}`)); });
  });
  child.kill('SIGKILL');
  await exited;
  const status = await statusServices({ home, origin });
  assert.equal(status.routes[0].verification.status, 'verified');
  let removed;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { removed = await removeService({ home, origin }); break; }
    catch (error) {
      if (!error.message.includes('busy')) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  assert.equal(removed?.removed, true);
});
