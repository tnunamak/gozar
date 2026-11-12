import { addService, statusServices, removeService } from './service.mjs';

export function parseServiceArgs(argv) {
  const [action, ...args] = argv;
  if (!['add', 'status', 'remove'].includes(action)) throw new Error('Use gozar service add|status|remove');
  const options = { action, json: false };
  const fields = { '--origin': 'origin', '--target': 'target', '--verify-cmd': 'verifyCmd' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--json' && !options.json) { options.json = true; continue; }
    const field = fields[flag];
    if (!field || options[field] !== undefined) throw new Error(`Unknown or duplicate service option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[field] = value;
  }
  if (action !== 'status' && !options.origin) throw new Error(`${action} requires --origin URL`);
  if (action === 'add' && !options.target) throw new Error('add requires --target HOST:PORT');
  if (action !== 'add' && (options.target !== undefined || options.verifyCmd !== undefined)) throw new Error('--target and --verify-cmd are add options');
  return options;
}

export async function serviceMain(argv) {
  const options = parseServiceArgs(argv);
  const reply = await ({ add: addService, status: statusServices, remove: removeService }[options.action])(options);
  console.log(options.json ? JSON.stringify(reply) : JSON.stringify(reply, null, 2));
  const routes = reply.routes ?? (reply.route ? [reply.route] : []);
  if (routes.some(route => route.verification.status !== 'verified')) process.exitCode = 1;
  return reply;
}
