// Controlled subprocess used by operational tests. Never invokes a provider CLI.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
const [operation, path, audit, ...args] = process.argv.slice(2);
if (audit) await appendFile(audit, `${operation}\n`);
if (operation === 'observe-resource') {
  const journal = JSON.parse(await readFile(path, 'utf8'));
  const resource = journal.owned[args[0]];
  console.log(JSON.stringify({ route: resource?.details ?? null }));
}
else if (operation === 'observe-slow') { await new Promise(resolve => setTimeout(resolve, 500)); console.log(await readFile(path, 'utf8')); }
else if (operation === 'observe') console.log(await readFile(path, 'utf8'));
else if (operation === 'process') {
  await writeFile(path, 'allocated', { flag: 'wx' });
  console.log(args[0]);
  const timer = setInterval(() => {}, 1000);
  process.on('SIGTERM', () => { clearInterval(timer); process.exit(0); });
} else if (operation === 'mutation') {
  await writeFile(path, args[0] ?? 'mutated', { flag: 'wx' }); console.log(args[1]);
} else throw new Error('Unknown controlled fixture operation');
