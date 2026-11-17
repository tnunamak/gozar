// The two SSH trial recipes use the same OpenSSH prerequisite and trust policy.
// The route controller owns the SSH process and its private session files.
import { createHash } from 'node:crypto';
import { effectError, recipeAdapter } from '../../../packages/gozar-node/adapter-runtime.mjs';

const keygenProbe = {
  kind: 'spawn', program: 'ssh-keygen', args: ['-?'], timeoutMs: 5000, maxOutputBytes: 16384,
  parser: { kind: 'contains', stream: 'combined', value: 'usage: ssh-keygen ' },
};

export function sshTrialAdapter({ definition: location, relay, warning = '', keyBound = false }) {
  return recipeAdapter({
    definition: location,
    extend: ({ base, definition }) => {
      const recipe = base.operationalDefinition.recipes.create;
      const endpoint = recipe.args.find(arg => arg.includes('@')).split('@')[1];
      const validHost = new RegExp(recipe.parser.constraints.hostnamePattern);
      const trialOrigin = value => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && url.origin === value && !url.port && validHost.test(url.hostname) ? value : null;
        } catch { return null; }
      };
      const action = (id, label, actor, verification, purpose, instructions) => {
        const body = { id, kind: 'instructions', label, instructions, disclosure: definition.disclosure,
          step: { actor, verification, purpose, permission: { id, label } } };
        return { ...body, digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
      };
      const install = action('ssh-install', 'Install the OpenSSH client', 'administrator', 'host', 'configure',
        'Approve installation of the OpenSSH client with your operating system’s trusted software manager. On Linux, select the client package or ask the system administrator to install it. On macOS, restore the system OpenSSH tools if they are missing. ' +
        `Gozar checks ssh -V again${keyBound ? ' and requires ssh-keygen for the installation key' : ''}. Gozar needs no SSH server or account on this computer.`);
      const start = action('trial-consent', 'Review the public HTTPS trial', 'owner', 'host', 'authorize',
        `Allow this computer to connect to ${endpoint} on outbound TCP port 22 for the approved trial lifetime. ${relay} terminates HTTPS and can read application payloads. No provider account is needed. ` +
        `${keyBound ? 'The route uses a Gozar installation key for its stable address.' : 'The anonymous connection uses no user SSH key and receives a temporary address.'} ` +
        'OpenSSH uses accept-new with a private session known-hosts file. Route approval includes first-use trust for that connection. A changed known key is refused. If you cannot trust a first-seen key, decline the trial. If SSH reports a changed key, stop and investigate with the provider before approving a new session. ' +
        'Gozar does not use your SSH agent or your personal known-hosts file. Start the route through the Gozar route approval to open the connection.');
      const stopText = 'Stop the route in Gozar to withdraw the address and close its exact SSH process. Gozar removes the session’s private known-hosts file and any session key copy after confirming exit.';
      const retained = keyBound
        ? ' The shared Gozar installation key is retained for a later approved reconnect. Remote key or hostname revocation is unverified.'
        : ' Remote hostname or DNS retirement remains unverified.';
      const unknown = reason => ({ known: false, reason });
      const observed = (stepId, summary, observedAt, source = 'host') => ({
        known: true, value: { stepId, source, observedAt, summary },
      });

      return {
        setupActions(facts) {
          if (!facts?.setupNeeded) return [];
          return [structuredClone(facts.detected === true ? start : install)];
        },

        async setup(ctx, id) {
          if (id === install.id || id === start.id) {
            return { state: 'pending', nextAction: structuredClone(id === install.id ? install : start) };
          }
          return base.setup(ctx, id);
        },

        async observeSetup(ctx, operation) {
          const route = ctx.route;
          const cancelled = operation.cancelled;
          if (route?.cleanup?.state === 'unconfirmed') {
            return { state: 'reconciling', evidence: unknown('owned-process-cleanup-unconfirmed'),
              nextAction: action('reconcile-trial', 'Check the stopped trial', 'owner', 'host', 'reconcile',
                `${stopText} Retry the route stop in Gozar. If process or file identity cannot be verified, preserve the cleanup record.${retained}`) };
          }
          if (cancelled || route?.state === 'released') {
            return { state: cancelled ? 'cancelled' : 'pending',
              evidence: unknown(route?.cleanup?.state === 'confirmed' ? 'provider-retirement-not-observed' : 'route-stop-not-observed'),
              nextAction: route && route.state !== 'released'
                ? action('stop-trial', 'Stop the public HTTPS trial', 'owner', 'host', 'stop-connector', stopText + retained)
                : cancelled ? null : structuredClone(start) };
          }
          if (route) {
            const origin = trialOrigin(route.origin);
            if (route.routeState === 'expired' || ['lost', 'address_changed'].includes(route.state)) {
              return { state: 'blocked', evidence: unknown('ssh-trial-needs-reconnect'),
                nextAction: action('reconnect-trial', 'Review and reconnect the public HTTPS trial', 'owner', 'host', 'reconcile',
                  `Check outbound TCP port 22 to ${endpoint}. If OpenSSH reported a changed host key, stop and verify the new key with the provider before approving another trial. ${stopText}${retained} Approve a new route and verify the announced address again.`) };
            }
            const proof = route.verification;
            const target = route.hostConfiguration?.target;
            if (origin && route.published === origin && proof?.status === 'verified' &&
                proof.vantage === 'public' && proof.subject?.origin === origin &&
                target?.known === true && proof.subject.target === target.value &&
                proof.subject.handleGeneration === route.handle?.generation && proof.checks?.includes('nonce') &&
                proof.checks.includes('tls') &&
                Number.isFinite(Date.parse(proof.observedAt))) {
              return { state: 'complete', nextAction: null,
                evidence: observed('verify-trial', 'The published HTTPS address passed the public application challenge.', proof.observedAt, 'trusted-client') };
            }
            return { state: 'pending', evidence: unknown('public-client-proof-pending'),
              nextAction: action('verify-trial', 'Verify the public HTTPS trial', 'trusted-client', 'trusted-client', 'reconcile',
                `From the intended client network, open the exact address ${origin ?? 'Gozar announces for the active trial'} and check the actual app through the route. ${warning}` +
                ` Gozar requires an independent challenge and any requested stream checks. A TLS connection, warning-page dismissal or browser return does not complete verification. ${stopText}${retained} ` +
                'If the trial has expired or its address changes, stop it and approve a new connection. Verify the current address again.') };
          }
          const result = await base.detect(ctx);
          if (result.state !== 'ready') return {
            state: 'blocked', nextAction: structuredClone(install),
            evidence: unknown(result.facts?.detected === false ? 'openssh-not-detected' : 'openssh-check-unavailable'),
          };
          if (keyBound && (await ctx.probe(keygenProbe).catch(() => null))?.ok !== true) return {
            state: 'blocked', nextAction: structuredClone(install), evidence: unknown('ssh-keygen-not-detected'),
          };
          return { state: 'complete', nextAction: null,
            evidence: observed(install.id, `The OpenSSH client${keyBound ? ' and key generator were' : ' was'} detected. Approve a route separately to start the trial.`, new Date(ctx.now()).toISOString()) };
        },

        async executeSetup(ctx, { action: id }) {
          if (id === install.id || id === start.id) return { state: 'pending' };
          throw effectError('invalid_input', 'Use Gozar route controls for this instruction');
        },
      };
    },
  });
}
