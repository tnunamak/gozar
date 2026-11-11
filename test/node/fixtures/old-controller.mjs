import net from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, processIdentity } from '../../../packages/gozar-node/journal.mjs';
const directory = process.argv[2];
const journal = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
const server = net.createServer(socket => {
  let input = '';
  socket.on('data', chunk => {
    input += chunk;
    if (!input.includes('\n')) return;
    const request = JSON.parse(input.split('\n')[0]);
    if (request.nonce !== 'old-controller-nonce') return socket.end(JSON.stringify({ error: 'Wrong nonce' }) + '\n');
    socket.end(JSON.stringify({ snapshot: journal.snapshot, localCleanupFailures: [] }) + '\n');
  });
});
process.once('SIGTERM', async () => {
  await writeFile(join(directory, 'handed-over'), 'yes');
  server.close();
});
await new Promise(resolve => server.listen(join(directory, 'control.sock'), resolve));
await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce: 'old-controller-nonce' });
console.log('ready');
