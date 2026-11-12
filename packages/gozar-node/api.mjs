import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLifetimeMs } from './gate.mjs';

export { addService, statusServices, removeService, createServiceVerifier } from './service.mjs';

const cli = fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url));
const fields = {
  port: '--port', clientReach: '--client-reach', adapterId: '--adapter', origin: '--origin',
  lifetimeMs: '--lifetime-ms', bindAddress: '--bind-address', firewallAck: '--firewall-ack',
  transport: '--transport', clientProfileId: '--client-profile', probeWaitMs: '--probe-wait-ms',
  probeDirectory: '--probe-directory', probeRequest: '--probe-request', probeReceipt: '--probe-receipt',
  probeExecutorId: '--probe-executor-id', installLinkTemplate: '--install-link-template',
};
const flags = { yes: '--yes', sse: '--sse', streamableHttp: '--streamable-http', oauthDcr: '--oauth-dcr', operational: '--operational' };

function invoke(command, options = {}) {
  const args = [cli, command, '--json'];
  for (const [key, value] of Object.entries(options)) {
    if (key === 'home') continue;
    if (fields[key] && value !== undefined) args.push(fields[key], String(value));
    else if (flags[key] && typeof value === 'boolean') { if (value) args.push(flags[key]); }
    else throw new Error(`Unknown or invalid Gozar option: ${key}`);
  }
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, {
      env: { ...process.env, ...(options.home === undefined ? {} : { GOZAR_HOME: options.home }) },
      timeout: 750_000, maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      let reply;
      try { reply = JSON.parse(stdout.trim()); }
      catch { reject(new Error(`Invalid Gozar JSON response: ${stderr || error?.message || stdout}`)); return; }
      if (error) {
        reject(Object.assign(new Error(reply.error ?? `Gozar ${command} failed (${reply.snapshot?.phase ?? error.message})`), { reply, code: error.code }));
      } else resolve(reply);
    });
  });
}

export function expose(options) {
  if (options?.lifetimeMs !== undefined) validateLifetimeMs(options.lifetimeMs);
  return invoke('expose', options);
}
export function status(options) { return invoke('status', options); }
export function stop(options) { return invoke('stop', options); }
