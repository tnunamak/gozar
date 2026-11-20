#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { plainCaveat } from '../packages/gozar-node/plain-copy.mjs';
import { cliCommand } from '../packages/gozar-node/cli-command.mjs';
import { defaultHome } from '../packages/gozar-node/default-home.mjs';

// Session routes are opened, observed and closed through the route-contract commands (ensure, expose --query-file,
// route-status, close): every provider runs the generic session runtime. The port-form commands below were the
// earlier session controller's command line and are removed, not redirected.
const REMOVED = { expose: 'expose --port', detect: 'detect', health: 'health', 'update-origin': 'update-origin' };
const REMOVED_MESSAGE = command => `\`gozar ${command}\` was removed: every provider now runs the generic session runtime. Use \`gozar ensure --query-file FILE\` or \`gozar expose --query-file FILE --approval-file FILE\`; see \`gozar --help\`.`;
export function parseArgs(argv) {
  if (Object.hasOwn(REMOVED, argv[0] ?? '')) throw new Error(REMOVED_MESSAGE(REMOVED[argv[0]]));
  const options = { command: argv[0] ?? 'help' };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (['--yes', '--json', '--verbose'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--port', '--route'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!['status', 'stop', 'allow', 'demo-server', 'help', '--help'].includes(options.command)) throw new Error('Use status, stop, allow or demo-server; route commands are listed in --help');
  if (options.port !== undefined) {
    if (!/^\d+$/.test(options.port) || Number(options.port) < (options.command === 'demo-server' ? 0 : 1) || Number(options.port) > 65535) throw new Error('--port must be 1..65535');
    options.port = Number(options.port);
  }
  if (options.route !== undefined && (!['status', 'stop', 'allow'].includes(options.command) || options.port !== undefined || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.route))) throw new Error('--route is for status, stop and allow, takes a route ID and excludes --port');
  if (options.command === 'allow' && options.route === undefined) throw new Error('allow requires --route ID');
  return options;
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(question)).trim(); } finally { prompt.close(); }
}

// Every session, service route and durable route in one home. Each entry is a fresh observation.
async function inventory(home, routeId) {
  const { statusRoutes } = await import('../packages/gozar-node/durable-route.mjs');
  const { routes: durableRoutes, stoppedRoutes } = await statusRoutes({ routeId, home });
  if (routeId !== undefined) return { schemaVersion: 1, durableRoutes, stoppedRoutes };
  const { statusServices } = await import('../packages/gozar-node/service.mjs');
  const { sessionInventory } = await import('../packages/gozar-node/session-directory.mjs');
  const sessions = await sessionInventory(home);
  const serviceRoutes = (await statusServices({ home })).routes.filter(route => route.ownership === 'external-owned');
  return { schemaVersion: 1, sessions, serviceRoutes, durableRoutes, stoppedRoutes };
}
function renderInventory(reply) {
  if (reply.error) return `Routes: unavailable (${reply.error})`;
  const lines = [];
  if (reply.sessions) {
    lines.push('Sessions:', ...(reply.sessions.length ? reply.sessions.map(item => `  port ${item.port}  ${item.state}${item.origin ? '  ' + item.origin : ''}${item.earlierVersion ? '  (recorded by an earlier Gozar version)' : ''}${item.cleanup === 'unconfirmed' ? '  cleanup unconfirmed' : ''}${item.targetCheck ? `  target: ${item.targetCheck}` : ''}${item.error ? `  (${item.error})` : ''}`) : ['  none']));
    lines.push('Service routes:', ...(reply.serviceRoutes.length ? reply.serviceRoutes.map(item => `  ${item.origin} -> ${item.target}  ${item.verification.status}`) : ['  none']));
  }
  lines.push('Durable routes:', ...(reply.durableRoutes.length ? reply.durableRoutes.map(item =>
    `  ${item.routeId}  provider ${item.adapterId}  origin ${item.origin ?? '(none yet)'}  owner ${item.owner}  created ${item.createdAt}  state ${item.state}` +
    (item.cleanupDebt ? `  cleanup debt: ${item.cleanupDebt.reason}` : '') +
    `\n    ${item.exposure}: ${item.forwards}` + (item.targetCheck ? `\n    target: ${item.targetCheck}` : '') +
    (item.warning ? `\n    WARNING: ${item.warning}` : '') + `\n    stop: gozar stop --route ${item.routeId}`) : ['  none']));
  if (reply.stoppedRoutes?.length) lines.push('Stopped by you (the app cannot re-create these):', ...reply.stoppedRoutes.map(item => `  ${item.routeId}  stopped ${item.stoppedAt}  allow again: ${item.allow}`));
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  // The route-contract commands take their whole request from files. `expose --port N` stays the session command.
  const { ROUTE_COMMANDS, routeMain } = await import('../packages/gozar-node/route-cli.mjs');
  if (ROUTE_COMMANDS.includes(argv[0]) || (argv[0] === 'expose' && argv.includes('--query-file'))) {
    process.exitCode = await routeMain(argv);
    return;
  }
  if (argv[0] === 'service') {
    const { serviceMain } = await import('../packages/gozar-node/service-cli.mjs');
    await serviceMain(argv.slice(1));
    return;
  }
  let options;
  try { options = parseArgs(argv); } catch (error) { error.userInput = true; throw error; }
  if (options.command === 'demo-server') {
    const { startDummy } = await import('../harness/dummy-server.mjs');
    const server = await startDummy({ port: options.port ?? 18765, toolName: 'echo' });
    const stop = async () => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      await server.close();
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log(`Echo MCP server listening on port ${server.port}: ${server.origin}`);
    return;
  }
  if (['help', '--help'].includes(options.command)) {
    console.log('Service routes (existing owner-managed ingress):\n  gozar service add --origin URL --target HOST:PORT [--verify-cmd COMMAND] --json\n  gozar service status [--origin URL] --json\n  gozar service remove --origin URL --json\n');
    console.log('Routes by requirement (requests are JSON files; --json prints one envelope, progress goes to stderr):\n  gozar catalog --query-file FILE [--route NAME] --json\n  gozar ensure --query-file FILE [--approval-file FILE] [--reconsent] --json\n  gozar adopt --query-file FILE --approval-file FILE --handover-file FILE --json\n  gozar expose --query-file FILE --approval-file FILE [--wait allocated|verified] --json   (attached: close stdin to end it)\n  gozar configure --query-file FILE --provider-id ID --json   (descriptor prompts; stores credentials)\n  gozar setup ACTION_ID --query-file FILE --provider-id ID --approval-file FILE [--secret-file FILE | --value VALUE | --prompt] --json\n  gozar setup-operation reserve|read|run|cancel --request-file FILE [--secret-file FILE | --browser-handoff] --json\n  gozar preference show|set [--profile-home DIR] [--expected-revision N] [--prefer REF ...]\n  gozar suspend --route ID --json\n  gozar suspend --handle-file FILE --json\n  gozar routes --home DIR [--owner OWNER] --json   (owned recovery records)\n  gozar route-status --handle-file FILE --json\n  gozar close --handle-file FILE --json\n  gozar review-consent --handle-file FILE --json\n  gozar approve-consent --handle-file FILE --approval-file FILE --json\n  gozar watch --handle-file FILE --json   (one event per line)\nApproval and secret files must be private (mode 0600). Exit codes: 0 ok; 2 requirements, setup or unsupported; 3 missing or stale approval, or no such route; 1 other errors.\n');
    console.log('Gozar\n  gozar demo-server [--port N]\n  gozar status [--port N | --route ID]   (sessions, service routes and durable routes in this home)\n  gozar stop [--port N | --route ID]   (closes the recorded session on a port, or a durable route)\n  gozar allow --route ID [--yes]\n\nA session is opened with `ensure`/`expose --query-file`; every provider runs the same generic session runtime.\n--json returns machine-readable output. --verbose prints full engineering detail.');
    return;
  }
  const home = defaultHome();
  if (options.command === 'stop' && options.route) {
    const { stopRoute } = await import('../packages/gozar-node/durable-route.mjs');
    const reply = await stopRoute({ routeId: options.route, home });
    console.log(options.json ? JSON.stringify(reply) : reply.removed ? `Stopped durable route ${reply.routeId}.${reply.providerRemoved ? ' Provider rule removed.' : ''}` +
      (reply.cleanupDebt ? ` Cleanup debt: ${reply.cleanupDebt.reason} on port ${reply.cleanupDebt.port}; the rule was left in place.` : '') :
      `Durable route ${reply.routeId} was not removed.` + (reply.cleanupDebt ? ` Cleanup debt: ${reply.cleanupDebt.reason} on port ${reply.cleanupDebt.port}; the provider rule changed and was left in place.` : ' No record exists.'));
    if (!reply.removed || reply.cleanupDebt) process.exitCode = 1;
    return;
  }
  if (options.command === 'allow') {
    const { allowRoute, durableConsentText, statusRoutes } = await import('../packages/gozar-node/durable-route.mjs');
    const known = (await statusRoutes({ routeId: options.route, home })).routes[0];
    const consent = durableConsentText({ routeId: options.route, origin: known?.origin ?? null, owner: known?.owner ?? 'the app that owns it' });
    if (!options.json) console.log(consent);
    if (!options.yes) {
      if (!process.stdin.isTTY) throw new Error('Allowing a durable route again requires approval. Review the text above and run again with --yes.');
      if (!['y', 'yes'].includes((await ask(`Allow the owner app to create route ${options.route} again? [y/N] `)).toLowerCase())) return;
    }
    const reply = await allowRoute({ routeId: options.route, home });
    console.log(options.json ? JSON.stringify({ ...reply, consent }) : `Route ${options.route} may be created again by its owner app.`);
    return;
  }
  if (options.command === 'status' && options.route) {
    const reply = await inventory(home, options.route);
    console.log(options.json ? JSON.stringify(reply) : renderInventory(reply));
    return;
  }
  if (options.command === 'status') {
    // An unreadable home is reported inside the inventory, with a failing exit; it is never read as "no routes".
    const reply = await inventory(home).catch(error => ({ schemaVersion: 1, error: error.message }));
    if (reply.error) process.exitCode = 1;
    else if (options.port) reply.sessions = reply.sessions.filter(item => item.port === options.port);
    console.log(options.json ? JSON.stringify(reply) : renderInventory(reply));
    return;
  }
  // `stop --port N` closes the one session recorded for that port. Durable routes use `stop --route`.
  if (!options.port) throw new Error('Supply the exact local service port with --port N, or a durable route with --route ID');
  const { stopSessionByPort } = await import('../packages/gozar-node/session-directory.mjs');
  const view = await stopSessionByPort(home, options.port);
  const confirmed = view.cleanup?.state === 'confirmed';
  console.log(options.json ? JSON.stringify(view) : confirmed ? `Stopped the session on port ${options.port}.` :
    `The session on port ${options.port} is not confirmed stopped: ${view.cleanup?.message ?? 'cleanup remains recorded'}. Run ${cliCommand('stop', options.port)} again.`);
  if (!confirmed) process.exitCode = 1;
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const argv = process.argv.slice(2);
    if (argv[0] === 'service') {
      if (argv.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, error: { code: 'SERVICE_ERROR', message: error.message } }));
      else console.error(`Gozar service: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (argv.includes('--json')) console.log(JSON.stringify({ error: error.message }));
    else console.error(`Gozar: ${error.userInput ? error.message : plainCaveat(error.message).plain ?? 'The command could not finish. The cause was not recorded. Use --verbose for details.'}${argv.includes('--verbose') ? `\nFull detail: ${error.message}` : ''}`);
    process.exitCode = 1;
  });
}
