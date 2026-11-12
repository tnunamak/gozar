// A controller stand-in: `node fake-controller.mjs --daemon <directory>`. The mode comes from <directory>/mode.
// silent:  never acknowledges anything.
// failure: records a failure and exits, like a controller that failed to start.
// stubborn: ignores SIGTERM and never acknowledges.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.argv[3];
const mode = (await readFile(join(directory, 'mode'), 'utf8')).trim();
await writeFile(join(directory, 'controller.pid'), String(process.pid));
if (mode === 'failure') {
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ message: 'fake controller failed to start' }));
  process.exit(1);
}
if (mode === 'stubborn') process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
