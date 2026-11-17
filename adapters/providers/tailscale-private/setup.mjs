// Serve and Funnel use the same daemon and account. Setup observes that shared
// identity and its permissions. The route lifecycle owns the mappings.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EffectDriver } from '../../../packages/gozar-node/driver.mjs';
import { effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';
import { createProgramResolver } from '../_shared/tailscale-program.mjs';

const statusArgs = ['status', '--json', '--peers=false'];
const loginArgs = ['up', '--timeout=12s', '--json'];
const configArgs = ['serve', 'status', '--json'];
const adminMachines = 'https://login.tailscale.com/admin/machines';
const adminDns = 'https://login.tailscale.com/admin/dns';
const artifacts = JSON.parse(readFileSync(new URL('./install-artifacts.json', import.meta.url), 'utf8'));
const displayLifetimeMs = 10 * 60_000;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const domain = value => typeof value === 'string' && /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(value);
const loginName = value => typeof value === 'string' && /^[^\s\u0000-\u001f@]{1,150}@[^\s\u0000-\u001f@]{1,100}$/.test(value);
const readJson = stdout => {
  try { const value = JSON.parse(stdout); return object(value) ? value : null; } catch { return null; }
};
const statusFailure = value => {
  if (/\b(?:access denied|permission denied|not an operator)\b/i.test(value)) return 'operator';
  if (/\b(?:failed to connect to local tailscaled|tailscaled (?:is not running|does not appear to be running))\b/i.test(value)) return 'daemon';
  return 'unavailable';
};
const authFailure = value => {
  if (/\b(?:auth(?:entication|orization)? (?:URL|link|request) (?:has )?expired|login (?:link|request) (?:has )?expired)\b/i.test(value)) return 'expired';
  if (/\b(?:login|authentication|authorization) (?:was )?(?:denied|rejected)\b/i.test(value)) return 'denied';
  return null;
};

async function run(ctx, args, timeoutMs = 5000) {
  const socket = process.env.GOZAR_TAILSCALED_SOCKET;
  const options = { program: 'tailscale', args: socket ? ['--socket=' + socket, ...args] : args, timeoutMs, maxOutputBytes: 65536 };
  try {
    const result = ctx.dispatchEffect
      ? await ctx.dispatchEffect(args === loginArgs
        ? { kind: 'spawn', operation: 'run', input: { program: options.program, args, longRunning: false } }
        : { kind: 'recipe', operation: 'probe', input: { recipe: { kind: 'spawn', ...options, parser: { kind: 'exit-code' } } } })
      : await new EffectDriver({ adapters: [], journal: {}, sessionId: 'tailscale-setup', resolveProgram: createProgramResolver({ platform: ctx.platform }) }).runProcess(options);
    if (typeof result?.stdout !== 'string' || typeof result?.stderr !== 'string' ||
        !Number.isInteger(result.exitCode) || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > options.maxOutputBytes)
      return { problem: 'unavailable' };
    const parsed = readJson(result.stdout);
    return {
      doc: parsed, exitCode: result.exitCode,
      problem: result.exitCode === 0 ? null : statusFailure(result.stderr),
      authorization: authFailure(result.stderr),
    };
  } catch (error) {
    return { problem: error?.code === 'ENOENT' ? 'install' : error?.code === 'EACCES' ? 'operator' : 'unavailable' };
  }
}

// AuthURL is a transient provider handoff. Compare a fingerprint and never use
// stdout, stderr or a browser return as proof of authorization.
function handoffOf(document) {
  if (typeof document?.AuthURL !== 'string' || document.AuthURL.length > 2048) return null;
  try {
    const url = new URL(document.AuthURL);
    if (url.origin === 'https://login.tailscale.com' && url.pathname.startsWith('/a/') &&
        !url.username && !url.password && !url.hash) return url.href;
  } catch { /* Invalid provider handoff. */ }
  return null;
}

function joinedIdentity(status) {
  const self = status.Self;
  const user = status.User?.[self?.UserID];
  const host = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '').toLowerCase() : null;
  const tailnet = status.CurrentTailnet?.MagicDNSSuffix?.toLowerCase?.();
  if (typeof self?.ID !== 'string' || !/^[\w-]{1,128}$/.test(self.ID) ||
      !Number.isSafeInteger(self.UserID) || user?.ID !== self.UserID || !loginName(user.LoginName) ||
      !domain(tailnet) || !domain(host) || !host.endsWith('.' + tailnet)) return null;
  return { node: self.ID, user: self.UserID, account: user.LoginName, tailnet, host };
}

function portInUse(config, port) {
  return [config, ...Object.values(config.Foreground ?? {}), ...Object.values(config.Services ?? {})].some(entry =>
    Object.hasOwn(entry?.TCP ?? {}, port) ||
    [...Object.keys(entry?.Web ?? {}), ...Object.keys(entry?.AllowFunnel ?? {})].some(name => name.endsWith(':' + port)));
}

// Both adapters drive the one local daemon. Avoid overlapping login subprocesses
// within this runtime. Each approved dispatch also re-reads the daemon state.
let loginRunning = false;
let handoffWindow;

export function tailscaleSetup(definition, wrapped, base) {
  const funnel = definition.id === 'tailscale-funnel';
  const action = (id, label, fields, actor, permission, verification, purpose = 'configure', subject = null) => {
    const { href, browser, ...safe } = fields;
    const stable = { id, label, disclosure: definition.disclosure, ...safe,
      step: { actor, permission: { id, label: permission }, verification, purpose } };
    return { ...stable, digest: sha([stable, browser ? null : href ?? null, subject]),
      ...(href ? { href } : {}), ...(browser ? { step: { ...stable.step, browser } } : {}) };
  };
  const instructions = (id, label, text, actor = 'owner', verification = 'host') =>
    action(id, label, { kind: 'instructions', instructions: text }, actor, label, verification);
  const input = (id, label, help, valueFormat = 'text') => action(id, label,
    { kind: 'provide-value', valueLabel: label, valueFormat, help, required: true }, 'owner', label, 'provider', 'authorize');
  const account = input('tailscale-account', 'Enter the intended Tailscale sign-in email', 'Use the email shown for your intended user in Tailscale.');
  const tailnet = input('tailscale-tailnet', 'Enter the intended tailnet DNS suffix', 'Find the MagicDNS suffix for your tailnet in ' + adminDns, 'domain');
  const install = ctx => {
    const architecture = ctx.architecture ?? process.arch;
    const artifact = ['x64', 'arm64'].includes(architecture)
      ? (ctx.platform === 'darwin' ? artifacts.darwin : artifacts[ctx.platform]?.[architecture])
      : null;
    const instructionsText = 'Install the signed Tailscale app or operating-system package from https://tailscale.com/download. If this host cannot install the artifact, use the platform installer. Reopen setup to check the CLI.';
    if (!artifact) return instructions('tailscale-install', 'Install Tailscale', instructionsText);
    return action('tailscale-install', 'Install the Tailscale CLI and daemon', {
      kind: 'install-artifact', instructions: instructionsText, artifact: { ...artifact, platform: ctx.platform, architecture },
      effects: { writes: [ctx.platform === 'darwin' ? '/Applications/Tailscale.app and system extension' : 'Tailscale executables and service files'],
        networkOrigins: ['https://pkgs.tailscale.com'], requiresPrivilege: true, restartRequired: ctx.platform === 'darwin' },
    }, 'administrator', 'Install the signed Tailscale distribution for this platform', 'host');
  };
  const operator = instructions('tailscale-operator', 'Allow the local user to operate Tailscale',
    'Ask the local administrator to allow the account running Gozar to access tailscaled. On Linux, the administrator can run sudo tailscale set --operator=<local-user>. On macOS, open the Tailscale app in the same user session and check access.', 'administrator');
  const daemon = instructions('tailscale-daemon', 'Start tailscaled',
    'Open the Tailscale app on macOS. On Linux, ask the local administrator to start the installed service with sudo systemctl start tailscaled, or use your distribution’s service manager.', 'administrator');
  const unavailable = instructions('tailscale-status', 'Recheck the Tailscale daemon', 'Check whether tailscaled is responding, then refresh setup. Provider status is unavailable.');

  const outcome = (ctx, state, nextAction, summary, stepId = nextAction?.id ?? 'tailscale-ready', source = nextAction?.step.verification ?? 'provider') =>
    ({ state, nextAction, evidence: { known: true, value: { stepId, source, observedAt: new Date(ctx.now()).toISOString(), summary } } });
  const blocked = (ctx, nextAction, summary = nextAction.instructions) => outcome(ctx, 'blocked', nextAction, summary);
  const admin = (id, label, href, help) => action(id, label, { kind: 'open-url', href, help },
    'administrator', label, 'provider');
  const startLogin = (values, fingerprint, operationId) => action('tailscale-login', 'Start Tailscale sign-in', {
    kind: 'gozar-runs',
    help: `Start interactive sign-in for ${values[account.id]} in ${values[tailnet.id]}. Browser approval can enroll this node. Gozar retains the node when setup is cancelled.`,
    effects: { writes: ['Local Tailscale sign-in state'], networkOrigins: ['https://login.tailscale.com'], requiresPrivilege: false, restartRequired: false },
  }, 'machine', 'Start an interactive sign-in for the intended user and tailnet', 'provider', 'authorize',
  [values[account.id], values[tailnet.id], fingerprint, operationId]);

  async function observeSetup(ctx, operation) {
    if (operation.cancelled) return outcome(ctx, 'cancelled', null, 'Setup paused. Tailscale membership and shared settings are retained.');
    if (!supportedPlatform(ctx.platform)) return outcome(ctx, 'blocked', null, 'Tailscale route setup is unavailable on this platform.', 'tailscale-platform', 'host');
    const result = await run(ctx, statusArgs);
    const status = result.doc;
    if (!status?.BackendState) {
      const next = result.problem === 'install' ? install(ctx) : { operator, daemon }[result.problem] ?? unavailable;
      return blocked(ctx, next);
    }

    if (status.BackendState === 'Running' && result.exitCode !== 0) return blocked(ctx, unavailable);
    const values = await ctx.configuration();
    if (!loginName(values?.[account.id])) return outcome(ctx, 'authorization-required', account, account.help);
    if (!domain(values?.[tailnet.id])) return outcome(ctx, 'authorization-required', tailnet, tailnet.help);

    if (status.BackendState === 'NeedsLogin') {
      const href = handoffOf(status);
      const fingerprint = href ? sha(href) : null;
      const next = startLogin(values, fingerprint, operation.id);
      const rejection = result.authorization ?? (Array.isArray(status.Health) ? authFailure(status.Health.filter(item => typeof item === 'string').join(' ')) : null);
      if (rejection) return outcome(ctx, rejection, next, rejection === 'denied' ? 'Tailscale reported that authorization was denied.' : 'Tailscale reported that the sign-in link expired.');
      if (loginRunning) return outcome(ctx, 'pending', null, 'The local sign-in command is still running.');
      if (!href) return outcome(ctx, 'authorization-required', next, 'The local daemon requires sign-in.');
      if (handoffWindow?.fingerprint !== fingerprint || handoffWindow.operationId !== operation.id ||
          handoffWindow.home !== ctx.home || handoffWindow.account !== values[account.id] || handoffWindow.tailnet !== values[tailnet.id])
        return outcome(ctx, 'pending', instructions('tailscale-existing-sign-in', 'Finish the current sign-in in the Tailscale app',
          'Tailscale already has a sign-in in progress. Continue from its original browser window or the Tailscale app, then refresh here to verify the joined node.', 'owner', 'provider'),
        'This setup cannot verify that it initiated the current sign-in.');
      if (ctx.now() >= handoffWindow.expiresAt)
        return outcome(ctx, 'expired', next, 'Gozar’s display window for this sign-in link elapsed. Ask the daemon for a new link.');
      const browser = { expiresAt: new Date(handoffWindow.expiresAt).toISOString(), pollAfterMs: 2000 };
      const open = action('tailscale-browser', 'Approve Tailscale sign-in in your browser', {
        kind: 'open-url', href, browser, help: 'Choose the intended user and tailnet. Gozar checks the daemon independently after browser approval.',
      }, 'owner', 'Authorize this node in the intended tailnet', 'provider', 'authorize', [fingerprint, values[account.id], values[tailnet.id]]);
      return outcome(ctx, 'pending', open, 'Tailscale is waiting for sign-in.');
    }
    if (status.BackendState === 'NeedsMachineAuth') return outcome(ctx, 'pending',
      admin('tailscale-node-approval', 'Ask a tailnet administrator to approve this node', adminMachines,
        'In Machines, verify that this device belongs to the intended user and tailnet before approving. Refresh here to verify the node status.'),
      'Tailscale is waiting for machine approval.');
    if (status.BackendState !== 'Running') return blocked(ctx, daemon, 'Tailscale is stopped or starting. Check the service and refresh setup.');

    const identity = joinedIdentity(status);
    if (!identity || identity.account !== values[account.id] || identity.tailnet !== values[tailnet.id].toLowerCase()) {
      return blocked(ctx, instructions('tailscale-identity-mismatch', 'Check the Tailscale account, tailnet and node',
        'Compare this device’s Tailscale app account with the intended sign-in email and MagicDNS suffix. Connect the intended profile in the Tailscale app or correct the setup inputs. Gozar needs a current node ID and its matching user record.', 'owner', 'provider'));
    }
    const choice = sha(identity);
    if (values['tailscale-node'] !== choice) {
      const next = action('tailscale-node', 'Confirm the observed Tailscale node', { kind: 'provide-value', valueFormat: 'text',
        valueLabel: 'Tailscale node', required: true }, 'owner', 'Select the exact observed node', 'provider', 'authorize', choice);
      next.step.options = [{ label: `${identity.host} (${identity.account})`, value: choice }];
      return outcome(ctx, 'authorization-required', next, 'The daemon reports a running node with the intended user and tailnet.');
    }
    if (status.CurrentTailnet.MagicDNSEnabled !== true) return blocked(ctx,
      admin('tailscale-magicdns', 'Enable MagicDNS in the intended tailnet', adminDns,
        'A tailnet administrator can enable MagicDNS on the DNS page. Refresh setup to check the daemon’s DNS settings.'), 'MagicDNS is disabled for the current tailnet.');
    const caps = status.Self.CapMap ?? {};
    if (!Object.hasOwn(caps, 'https') || !status.CertDomains?.includes?.(identity.host)) return blocked(ctx,
      admin('tailscale-https', 'Enable HTTPS certificates for the intended tailnet', adminDns,
        'A tailnet administrator can enable HTTPS Certificates on the DNS page. Certificate hostnames are published in transparency logs. Refresh setup to check this node’s certificate eligibility.'), 'The daemon has not reported HTTPS permission and the node’s exact certificate domain.');
    const allowed = Object.keys(caps).flatMap(key => /^https:\/\/tailscale\.com\/cap\/funnel-ports\?ports=([0-9,]+)$/.exec(key)?.[1].split(',').map(Number) ?? []);
    const candidates = [...new Set([...wrapped.bindings.port.candidates, ...wrapped.durableRecipe.candidatePorts])];
    const ports = funnel ? candidates.filter(port => allowed.includes(port)) : candidates;
    if (funnel && (!Object.hasOwn(caps, 'funnel') || !ports.length)) return blocked(ctx,
      admin('tailscale-funnel-policy', 'Ask an administrator to allow Funnel on this exact node', 'https://login.tailscale.com/admin/acls',
        'In Access controls, grant the funnel node attribute to a selector for this node. Review HTTPS and the supported Funnel ports 443, 8443 and 10000. Refresh here to read current node policy.'), 'The daemon reports no usable Funnel capability for this node.');

    const config = await run(ctx, configArgs);
    if (config.exitCode !== 0 || !config.doc) return blocked(ctx, config.problem === 'operator' ? operator : unavailable);
    if (ports.every(port => portInUse(config.doc, port))) return blocked(ctx,
      instructions('tailscale-allowed-port', 'Make a permitted Tailscale HTTPS port available',
        `All eligible ports are occupied (${ports.join(', ')}). Ask the owner of an existing mapping to release a port or choose another provider. Refresh setup after the owner acts.`, 'administrator', 'provider'));
    const client = funnel ? 'independent public internet client' : 'independent tailnet client';
    return outcome(ctx, 'complete', null,
      `The intended node and prerequisites were observed. After route approval, verify the exact HTTPS origin and app challenge from an ${client}.`);
  }

  const entry = action('tailscale-setup', 'Set up Tailscale', {
    kind: 'instructions', instructions: 'Open guided setup to check the CLI, sign-in, tailnet privileges and available ports.',
  }, 'owner', 'Review Tailscale prerequisites', 'host', 'authorize');
  const proof = instructions('tailscale-client-proof', 'Verify the application from another device',
    funnel
      ? 'After route approval, use an independent public internet client to verify the exact HTTPS origin against the app challenge. Supply the result through Gozar’s trusted verifier.'
      : 'After route approval, use an independent client signed in to the intended tailnet to verify the exact HTTPS origin against the app challenge. Supply the result through Gozar’s trusted verifier.',
    'trusted-client', 'trusted-client');

  return {
    configurationActions: () => [entry, proof, ...base.setupActions({ setupNeeded: true })],
    setupActions: facts => facts?.setupNeeded ? [entry, ...base.setupActions(facts)] : [],
    observeSetup,
    async executeSetup(ctx, { action: approved }) {
      if (approved.id !== 'tailscale-login') return;
      const operationId = approved.consent?.scope?.operation?.id;
      if (!operationId) throw effectError('setup_required', 'Tailscale sign-in needs an approved setup operation.');
      const operation = { id: operationId, cancelled: false };
      const values = await ctx.configuration();
      const current = await observeSetup(ctx, operation);
      if (current.nextAction?.digest !== approved.digest || loginRunning) throw effectError('setup_required', 'Tailscale sign-in changed. Refresh and approve the current setup action.');
      loginRunning = true;
      try {
        const result = await run(ctx, loginArgs, 15_000);
        if (result.problem === 'operator') return blocked(ctx, operator);
        const href = handoffOf(result.doc);
        const fingerprint = href ? sha(href) : null;
        if (fingerprint && handoffWindow?.fingerprint !== fingerprint) handoffWindow = {
          fingerprint, operationId, home: ctx.home, expiresAt: ctx.now() + displayLifetimeMs,
          account: values[account.id], tailnet: values[tailnet.id],
        };
        if (result.authorization) return outcome(ctx, result.authorization, null, result.authorization === 'denied'
          ? 'Tailscale reported that authorization was denied.' : 'Tailscale reported that the sign-in link expired.', approved.id);
      } finally { loginRunning = false; }
      return observeSetup(ctx, operation);
    },
  };
}
