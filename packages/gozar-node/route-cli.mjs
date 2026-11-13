// The route-contract commands of the `gozar` CLI. Each one reads the same request an app passes to the matching
// root export, from files, and prints one JSON envelope on stdout (`watch` prints one event per line). Progress and
// prompts go to stderr. A success envelope is the export's own reply; a failure is `{schemaVersion:1,error:{code,
// message,nextAction}}` from the central normaliser. There is no `--yes`: an approval is a private file holding the
// candidate token the app got from the catalog, and the CLI never invents one.
//
// Exit codes: 0 success; 2 requirements, setup or unsupported; 3 missing, stale or unknown approval, or no such route;
// 1 everything else (operational, schema, usage).
import { lstat, readFile } from 'node:fs/promises';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { defaultHome } from './default-home.mjs';
import { promptInputRequirement } from './input-requirements.mjs';

export const ROUTE_COMMANDS = ['catalog', 'ensure', 'adopt', 'setup', 'configure', 'preference', 'watch', 'suspend'];
const MAX_FILE_BYTES = 1 << 20;
const REQUIREMENT_CODES = new Set(['requirements_unsatisfied', 'setup_required', 'unsupported']);
const APPROVAL_CODES = new Set(['consent_required', 'consent_unknown', 'consent_expired', 'consent_mismatch', 'candidate_stale', 'route_not_found']);
export const exitCodeFor = code => REQUIREMENT_CODES.has(code) ? 2 : APPROVAL_CODES.has(code) ? 3 : 1;


// What each command accepts. Anything else is invalid_input: unknown flags never fall back to a bypass.
const specs = {
  catalog: { values: ['query-file', 'route', 'provider-id', 'home'], flags: ['json'] },
  ensure: { values: ['query-file', 'approval-file', 'route', 'provider-id', 'home'], flags: ['json', 'reconsent'] },
  adopt: { values: ['query-file', 'approval-file', 'handover-file', 'route', 'provider-id', 'home'], flags: ['json', 'reconsent'] },
  expose: { values: ['query-file', 'approval-file', 'wait', 'route', 'provider-id', 'home'], flags: ['json'] },
  setup: { values: ['approval-file', 'secret-file', 'value', 'home', 'query-file', 'provider-id'], flags: ['json', 'prompt'], positional: 'action id' },
  configure: { values: ['query-file', 'provider-id', 'home'], flags: ['json'] },
  preference: { values: ['profile-home', 'expected-revision', 'on-unavailable'], multi: ['prefer'], flags: ['json'], positional: 'show or set' },
  suspend: { values: ['handle-file', 'route', 'home'], flags: ['json'] },
  watch: { values: ['handle-file', 'home', 'interval-ms'], flags: ['json'] },
};

function parse(command, argv) {
  const spec = specs[command];
  const options = {}, positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const name = token.slice(2);
    if (spec.flags.includes(name)) options[name] = true;
    else if (spec.values.includes(name) || spec.multi?.includes(name) || ['registry-file', 'registry-root'].includes(name)) {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('--')) throw gozarError('invalid_input', `Missing value for ${token}`);
      if (spec.multi?.includes(name)) (options[name] ??= []).push(value);
      else if (Object.hasOwn(options, name)) throw gozarError('invalid_input', `${token} was given twice`);
      else options[name] = value;
    } else throw gozarError('invalid_input', `Unknown option ${token} for gozar ${command}`);
  }
  if (positional.length !== (spec.positional ? 1 : 0)) throw gozarError('invalid_input', spec.positional ? `gozar ${command} takes one argument: ${spec.positional}` : `gozar ${command} takes no positional arguments`);
  return { options, positional: positional[0] };
}

async function readFileChecked(path, label, { privateFile }) {
  let info;
  try { info = await lstat(path); } catch { throw gozarError('invalid_input', `${label} is not readable`); }
  if (!info.isFile()) throw gozarError('invalid_input', `${label} must be a regular file`);
  if (info.size > MAX_FILE_BYTES) throw gozarError('invalid_input', `${label} is too large`);
  // Approvals and secrets are bearer data: a file other users can read is refused, not warned about.
  if (privateFile && ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) {
    throw gozarError('invalid_input', `${label} must be owned by you and readable only by you (mode 0600)`);
  }
  return readFile(path, 'utf8');
}
async function readJson(path, label, { privateFile = false } = {}) {
  const text = await readFileChecked(path, label, { privateFile });
  try { return JSON.parse(text); } catch { throw gozarError('invalid_input', `${label} is not valid JSON`); }
}
const required = (options, name) => { if (!options[name]) throw gozarError('invalid_input', `--${name} is required`); return options[name]; };

async function readQuery(options) {
  const query = await readJson(required(options, 'query-file'), 'The query file');
  if (query === null || typeof query !== 'object' || Array.isArray(query)) throw gozarError('invalid_input', 'The query file must hold one JSON object');
  return { ...query, home: query.home ?? options.home ?? defaultHome(), ...(options.route === undefined ? {} : { route: options.route }),
    ...(options['provider-id'] === undefined ? {} : { providerId: options['provider-id'] }) };
}
async function readApproval(options, { needed }) {
  if (!options['approval-file']) {
    if (needed) throw gozarError('consent_required', 'No approval. Ask the catalog for a candidate, show its disclosure to the user, and pass the approval in --approval-file');
    return undefined;
  }
  return readJson(options['approval-file'], 'The approval file', { privateFile: true });
}

/** Resolves when the lease holder (stdin) ends or the process is asked to stop. */
function untilReleased(stdin) {
  return new Promise(resolve => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const done = () => {
      stdin.off('end', done); stdin.off('close', done); stdin.off('error', done);
      for (const signal of signals) process.off(signal, done);
      resolve();
    };
    stdin.once('end', done); stdin.once('close', done); stdin.once('error', done);
    for (const signal of signals) process.once(signal, done);
    stdin.resume();
  });
}

const commandsRun = {
  async configure({ options, api, out, err, prompt, storeSecret }) {
    const query = await readQuery(options), home = options.home ?? query.home ?? defaultHome();
    const catalog = await api.catalogRoutes({ ...query, home });
    if (catalog.candidates.length !== 1) throw gozarError('invalid_input', 'Select one catalog choice with --provider-id before configuring inputs');
    const candidate = catalog.candidates[0];
    err(`Input requirements: ${candidate.display.label}`);
    for (const fact of candidate.facts) if (fact.affectsConsent) err(`${fact.label}: ${fact.known ? JSON.stringify(fact.value) : `unknown (${fact.reason})`}`);
    for (const descriptor of candidate.configuration.inputRequirements) {
      const action = candidate.configuration.actions.find(action => action.id === descriptor.id);
      if (!action) throw gozarError('internal_error', 'An input requirement has no approved intake action');
      err(action.disclosure.text);
      const input = await prompt(descriptor);
      if (!input.trim() && !descriptor.required) continue;
      if (!input.trim()) throw gozarError('invalid_input', `Required input is missing: ${descriptor.id}`);
      const approval = { digest: action.digest, disclosureRevision: action.disclosure.revision };
      const request = descriptor.secret ? { secretHandle: (await storeSecret({ home, value: input })).handle } : { value: input };
      await api.runSetupAction({ home, actionId: descriptor.id, approval, ...request });
    }
    const current = await api.catalogRoutes({ ...query, home }), selected = current.candidates[0];
    const complete = selected.setup.state === 'ready';
    out({ schemaVersion: 1, state: complete ? 'complete' : 'pending', nextAction: selected.setup.actions[0] ?? null, catalogRevision: current.catalogRevision });
    return complete ? 0 : 2;
  },
  async catalog({ options, api, out, err }) {
    err('Asking the catalog (read-only; nothing is exposed)');
    const catalog = await api.catalogRoutes(await readQuery(options));
    out(catalog);
    return catalog.noMatch ? 2 : 0;
  },

  async ensure({ options, api, out, err }) {
    const request = { ...await readQuery(options), ...(options.reconsent ? { reconsent: true } : {}) };
    const approval = await readApproval(options, { needed: false });
    err('Ensuring the durable route');
    out(await api.ensureRoute({ ...request, ...(approval ? { approval } : {}) }));
    return 0;
  },

  async adopt({ options, api, out, err }) {
    const request = { ...await readQuery(options), ...(options.reconsent ? { reconsent: true } : {}) };
    const approval = await readApproval(options, { needed: true });
    const handover = await readJson(required(options, 'handover-file'), 'The handover file');
    err('Adopting the existing route');
    out(await api.adoptRoute({ ...request, approval, handover }));
    return 0;
  },

  async expose({ options, api, out, err, stdin }) {
    const wait = options.wait ?? 'verified';
    if (!['allocated', 'verified'].includes(wait)) throw gozarError('invalid_input', '--wait must be allocated or verified');
    const request = await readQuery(options);
    const approval = await readApproval(options, { needed: true });
    err('Opening the route');
    const view = await api.expose({ ...request, approval, wait });
    out(view);
    if (view.handle.kind !== 'attached') return 0;
    // An attached route lives only while this process does: closing stdin (or a signal) ends it.
    err('The route is held by this process. Close stdin to end it.');
    await untilReleased(stdin);
    try { await api.closeRoute({ home: request.home, handle: view.handle, mode: 'remove' }); }
    catch (error) { const normalized = normalizeError(error); err(`Closing the route failed: ${normalized.code}`); return exitCodeFor(normalized.code); }
    return 0;
  },

  async setup({ options, positional, api, out, err, storeSecret, prompt }) {
    if (options.value !== undefined && options['secret-file'] !== undefined) throw gozarError('invalid_input', '--value and --secret-file cannot be used together');
    const home = options.home ?? defaultHome();
    const approval = await readApproval(options, { needed: true });
    let secretHandle;
    let value = options.value;
    if (options.prompt) {
      if (options.value !== undefined || options['secret-file']) throw gozarError('invalid_input', 'Prompt takes input interactively; omit --value and --secret-file');
      const catalog = await api.catalogRoutes(await readQuery({ ...options, home }));
      const configuration = catalog.candidates.map(candidate => candidate.configuration).find(config =>
        config.actions.some(action => action.id === positional && action.digest === approval.digest && action.disclosure.revision === approval.disclosureRevision));
      const descriptor = configuration?.inputRequirements.find(input => input.id === positional);
      if (!descriptor) throw gozarError('candidate_stale', 'No input requirement matches that approved action');
      const input = await prompt(descriptor);
      if (descriptor.required && !input.trim()) throw gozarError('invalid_input', `Required input is missing: ${descriptor.id}`);
      if (descriptor.secret) secretHandle = (await storeSecret({ home, value: input })).handle;
      else value = input;
    }
    if (options['secret-file']) {
      const text = await readFileChecked(options['secret-file'], 'The secret file', { privateFile: true });
      secretHandle = (await storeSecret({ home, value: text.replace(/\r?\n$/, '') })).handle;
      err('The secret is in Gozar\'s private store');
    }
    const result = await api.runSetupAction({ home, actionId: positional, approval, ...(secretHandle ? { secretHandle } : {}), ...(value === undefined ? {} : { value }) });
    out(result);
    return result.state === 'complete' ? 0 : 2;
  },

  async preference({ options, positional, api, out }) {
    if (!['show', 'set'].includes(positional)) throw gozarError('invalid_input', 'Use gozar preference show or gozar preference set');
    const profileHome = options['profile-home'] ?? defaultHome();
    if (positional === 'show') { out(await api.getRoutePreferences({ profileHome })); return 0; }
    const revision = options['expected-revision'];
    if (!/^\d+$/.test(revision ?? '')) throw gozarError('invalid_input', '--expected-revision must be the revision you read, a whole number');
    out(await api.setRoutePreferences({ profileHome, expectedRevision: Number(revision), adapterPreference: options.prefer ?? [], onUnavailable: options['on-unavailable'] ?? 'ask' }));
    return 0;
  },

  async suspend({ options, api, out, err }) {
    if (Boolean(options.route) === Boolean(options['handle-file'])) throw gozarError('invalid_input', 'Supply exactly one of --route or --handle-file');
    const home = options.home ?? defaultHome();
    let ref;
    if (options['handle-file']) {
      const file = await readJson(options['handle-file'], 'The handle file');
      ref = file?.handle ? { home: file.home ?? home, handle: file.handle } : { home, handle: file };
    } else {
      const { statusRoutes } = await import('./durable-route.mjs');
      const route = (await statusRoutes({ home, routeId: options.route })).routes[0];
      if (!route) throw gozarError('route_not_found', 'No durable route has this ID');
      ref = { home, handle: { kind: 'durable', id: route.routeId, generation: route.generation } };
    }
    err('Suspending the durable route');
    out(await api.suspendRoute(ref));
    return 0;
  },

  async watch({ options, api, outLine, err }) {
    const file = await readJson(required(options, 'handle-file'), 'The handle file');
    const ref = file?.handle ? { home: file.home ?? options.home ?? defaultHome(), handle: file.handle } : { home: options.home ?? defaultHome(), handle: file };
    const intervalMs = options['interval-ms'] === undefined ? {} : { intervalMs: Number(options['interval-ms']) };
    if ('intervalMs' in intervalMs && !(Number.isFinite(intervalMs.intervalMs) && intervalMs.intervalMs > 0)) throw gozarError('invalid_input', '--interval-ms must be a positive number');
    const controller = new AbortController();
    const stop = () => controller.abort();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
    try {
      err('Watching the route (one JSON event per line)');
      for await (const event of api.watchRoutes({ ...ref, ...intervalMs, signal: controller.signal })) outLine(event);
    } finally { for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop); }
    return 0;
  },
};

/**
 * Runs one route-contract command and returns its exit code. `deps` replaces the API, the output streams and the
 * lease holder for tests; the binary passes nothing.
 */
export async function routeMain(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout, stderr = deps.stderr ?? process.stderr;
  const json = argv.includes('--json');
  const outLine = value => { stdout.write(`${JSON.stringify(value)}\n`); };
  const out = value => (json ? outLine(value) : stdout.write(`${JSON.stringify(value, null, 2)}\n`));
  const err = message => { stderr.write(`${message}\n`); };
  const [command, ...rest] = argv;
  try {
    if (!Object.hasOwn(commandsRun, command)) throw gozarError('invalid_input', `Unknown command ${command}`);
    const { options, positional } = parse(command, rest);
    const rootApi = deps.api ?? await import('./api.mjs');
    const api = options['registry-file'] ? rootApi.createGozar({ manifest: options['registry-file'], root: options['registry-root'] }) : rootApi;
    const storeSecret = deps.storeSecret ?? (await import('./route-setup.mjs')).storeSecret;
    const stdin = deps.stdin ?? process.stdin;
    const prompt = deps.prompt ?? (descriptor => promptInputRequirement(descriptor, { stdin, stderr }));
    return await commandsRun[command]({ options, positional, api, out, outLine, err, stdin, storeSecret, prompt });
  } catch (cause) {
    const error = normalizeError(cause);
    const envelope = { schemaVersion: 1, error: { code: error.code, message: error.message, nextAction: error.nextAction ?? null } };
    if (json) outLine(envelope);
    else err(`Gozar: ${error.message}${error.nextAction?.instructions ? `\nNext: ${error.nextAction.instructions}` : ''}`);
    return exitCodeFor(error.code);
  }
}
