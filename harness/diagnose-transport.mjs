#!/usr/bin/env node
// Read-only diagnosis of this harness's exact owned child. Does not read its live pipes.
import assert from 'node:assert/strict';
import { readFile, writeFile, readlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { processIdentity } from '../packages/gozar-node/journal.mjs';
const directory = resolve(process.argv[2]);
const context = JSON.parse(await readFile(join(directory, 'service-context.json'), 'utf8'));
const stateDirectory = join(directory, 'state', `port-${new URL(context.serviceOrigin).port}`);
const journal = JSON.parse(await readFile(join(stateDirectory, 'session.json'), 'utf8'));
const processes = [];
for (const resource of Object.values(journal.owned).filter(value => value.kind === 'process')) {
  assert.equal(await processIdentity(resource.pid), resource.startIdentity, 'exact owned child must still exist');
  const argv = (await readFile(`/proc/${resource.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  assert.equal(await processIdentity(resource.pid), resource.startIdentity, 'child identity changed during inspection');
  processes.push({ resourceId: resource.id, pid: resource.pid, startIdentity: resource.startIdentity, executable: await readlink(`/proc/${resource.pid}/exe`), argvSanitized: argv.map(value => value.replace(directory, '<run>')), exactForwardArgument: argv[argv.indexOf('-R') + 1] });
}
const report = { recordedAt: new Date().toISOString(), vantage: 'local', candidateExtractedByCore: journal.snapshot.candidate,
  phase: journal.snapshot.phase, processes,
  sshOutput: { initial: 'Unavailable: EffectDriver consumes bounded stdout/stderr transiently; no transcript file or diagnostics API is retained.', subsequent: 'Unavailable through the current host API. Live pipes were not read or intercepted; no disconnect or rotation output is asserted.' },
  limitations: ['A live SSH process and a candidate string do not prove current relay forwarding.', 'No provider command, route creation, restart, or configuration change performed.'] };
const path = join(directory, 'transport-diagnostic.json'); await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ path, ...report }));
