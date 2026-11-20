// Not a test file. A controller module (bootstrap `controllerModule`) that makes one session's allocation fail AFTER its first owned effect
// completed and before any success receipt reaches the controller: the real `start` runs (the provider effect is created and journaled), then
// the command throws, as a failed journal write or a core fault would. Only the session whose service port is named in
// `throw-after-start` in the route home (a file holding the port) is cut (the controller's environment is only PATH, HOME and LANG); every other session on the same module runs unchanged.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SessionAllocation } from '../../packages/gozar-node/session-allocation.mjs';

export default async function controllerRuntime() {
  const command = SessionAllocation.prototype.command;
  SessionAllocation.prototype.command = async function cutAfterStart(next) {
    const result = await command.call(this, next);
    const cut = () => { try { return readFileSync(join(dirname(this.journal.directory), 'throw-after-start'), 'utf8').trim(); } catch { return null; } };
    if (next.type === 'start' && next.consent === true && String(this.servicePort ?? this.targetPort) === cut())
      throw new Error('simulated fault after the owned effect was created');
    return result;
  };
  return {};
}
