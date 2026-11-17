// The two persisted inputs select an observed address and approve its HTTP listener scope.
// The session engine owns the forwarder, and the intended LAN client provides independent proof.
import { createHash } from 'node:crypto';
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { selectedInterfaceAddress } from '../../../packages/gozar-node/interfaces.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The unicast, non-internal addresses an inventory (os.networkInterfaces() shape) holds, with their interface names. */
export function observedInterfaces(inventory) {
  const seen = [];
  for (const [name, rows] of Object.entries(inventory?.interfaces ?? {})) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.internal === false && selectedInterfaceAddress(row.address)) seen.push({ name, address: row.address });
    }
  }
  return seen;
}

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
  extend: ({ base, definition, platformOf }) => {
    const action = (id, kind, label, actor, verification, purpose, fields, options) => {
      const body = { id, kind, label, disclosure: definition.disclosure, ...fields,
        step: { actor, permission: { id, label }, verification, purpose, ...(options ? { options } : {}) } };
      return { ...body, digest: sha(body) };
    };
    const textInput = (valueLabel, help) => ({ valueLabel, valueFormat: 'text', required: true, ...(help ? { help } : {}) });
    const interfaceAction = (seen, help) => action('interface', 'provide-value', 'Choose a local network interface',
      'owner', 'host', 'configure', textInput('Interface address', help),
      seen && [...new Map(seen.map(({ name, address }) => [address, { value: address, label: `${name} (${address})` }])).values()]);
    const scopeText = (address, port) => `Inbound HTTP over TCP on ${address ?? 'the selected interface'}${Number.isInteger(port) && port > 0 && port <= 65535 ? `, TCP port ${port}` : ', restricted to the single TCP port assigned to this route at start'}`;
    const firewallAction = (address, port) => action('firewall', 'provide-value', 'Approve the firewall scope for that interface',
      'owner', 'host', 'authorize', textInput('Interface address to approve',
        `${scopeText(address, port)}. This approves the listener scope. If network policy requires a rule, ask the administrator to allow the intended LAN client or its local subnet on that exact address and port. Gozar applies no firewall changes.`),
      address ? [{ value: address, label: `Approve HTTP on ${address}` }] : undefined);
    const guidance = (id, label, actor, verification, purpose, instructions) =>
      action(id, 'instructions', label, actor, verification, purpose, { instructions });
    const unknown = reason => ({ known: false, reason });

    const choice = async ctx => {
      const configured = await ctx.configuration().catch(() => null);
      const text = key => (typeof configured?.[key] === 'string' && configured[key].trim() ? configured[key].trim() : null);
      return { interface: text('interface'), firewall: text('firewall') };
    };
    const inventory = async ctx => {
      if (typeof ctx.observeInterfaces !== 'function') throw effectError('unsupported', 'The interface observation is not available');
      return observedInterfaces(await ctx.observeInterfaces());
    };
    const listed = seen => seen.length ? `Observed interface addresses: ${seen.map(item => `${item.address} (${item.name})`).join(', ')}.`
      : 'No usable non-loopback interface address was observed on this computer.';
    // What the owner still has to decide, from the persisted choice and the live inventory. Never "unknown" without a remedy.
    const review = (chosen, seen) => {
      if (!chosen.interface) return { needs: ['interface'], why: 'Choose the interface to expose this service on.' };
      if (!selectedInterfaceAddress(chosen.interface) || !seen.some(item => item.address === chosen.interface)) {
        return { needs: ['interface'], why: 'The chosen interface is no longer observed as a usable address on this computer. Choose another.' };
      }
      if (chosen.firewall !== chosen.interface) {
        return { needs: ['firewall'], why: `Approve the firewall scope by entering exactly ${chosen.interface}. Gozar changes no firewall rule.` };
      }
      return { needs: [], why: null };
    };

    return {
      async detect(ctx) {
        const result = await base.detect(ctx);
        if (result.state !== 'ready' && result.state !== 'action-required') return result;
        const seen = await inventory(ctx), chosen = await choice(ctx), pending = review(chosen, seen);
        const facts = { ...result.facts, observedInterfaces: seen, setupNeeded: pending.needs.length > 0 || result.state === 'action-required',
          selectedInterface: selectedInterfaceAddress(chosen.interface) ? chosen.interface : null,
          interfaceNeeded: pending.needs.includes('interface'), firewallNeeded: pending.needs.includes('firewall'), reason: pending.why };
        return { state: pending.needs.length || result.state !== 'ready' ? 'action-required' : 'ready', facts };
      },

      configurationActions: () => [interfaceAction(), firewallAction()],

      setupActions(facts) {
        if (!facts?.setupNeeded) return [];
        const detail = [facts.reason, listed(facts.observedInterfaces ?? [])].filter(Boolean).join(' ');
        if (!facts.interfaceNeeded && !facts.firewallNeeded) {
          return [interfaceAction(facts.observedInterfaces, detail), firewallAction(facts.selectedInterface)];
        }
        return [
          ...(facts.interfaceNeeded ? [interfaceAction(facts.observedInterfaces, detail)] : []),
          ...(facts.firewallNeeded ? [firewallAction(facts.selectedInterface)] : []),
        ];
      },

      async setup(ctx, actionId) {
        const offered = { interface: interfaceAction(), firewall: firewallAction() }[actionId];
        if (!offered) return base.setup(ctx, actionId);
        return { state: 'pending', nextAction: structuredClone(offered) };
      },

      async observeSetup(ctx, operation) {
        const route = ctx.route;
        if (route?.cleanup?.state === 'unconfirmed') {
          return { state: 'reconciling', evidence: unknown('lan-listener-cleanup-unconfirmed'),
            nextAction: guidance('reconcile-lan', 'Check the stopped LAN route', 'owner', 'host', 'reconcile',
              'Retry stop for this exact route in Gozar. Keep the cleanup record until Gozar confirms the owned listener is closed. Ask the administrator to remove only a firewall rule created specifically for this route. Shared rules remain in place.') };
        }
        if (operation.cancelled) {
          return { state: 'cancelled', evidence: unknown('firewall-rules-outside-gozar-custody'),
            nextAction: route && route.state !== 'released'
              ? guidance('stop-lan', 'Stop the LAN route', 'owner', 'host', 'stop-connector',
                'Stop the exact route in Gozar. This closes the owned HTTP listener. Ask the administrator to remove any rule added solely for this route. Shared firewall rules remain in place.')
              : null };
        }
        const chosen = await choice(ctx);
        let seen;
        try { seen = await inventory(ctx); }
        catch {
          return { state: 'blocked', evidence: unknown('interface-inventory-unavailable'),
            nextAction: guidance('observe-interface', 'Check this computer’s network interfaces', 'owner', 'host', 'reconcile',
              'Connect this computer to the intended LAN and grant the app permission to inspect network interfaces if the OS asks. Recheck the Gozar interface list.') };
        }
        const pending = review(chosen, seen);
        if (pending.needs.includes('interface')) {
          return {
            state: !seen.length || chosen.interface ? 'blocked' : 'authorization-required',
            nextAction: interfaceAction(seen, [pending.why, listed(seen)].join(' ')),
            evidence: unknown(!seen.length ? 'no-usable-interface' : chosen.interface ? 'selected-interface-changed' : 'interface-not-selected'),
          };
        }
        if (pending.needs.includes('firewall')) return {
          state: 'authorization-required', nextAction: firewallAction(chosen.interface, ctx.localPort),
          evidence: unknown('listener-scope-approval-pending'),
        };
        if (route && route.state !== 'released') {
          let endpoint;
          try { endpoint = new URL(route.origin); } catch { /* Listener may be starting. */ }
          const configuredHost = chosen.interface.includes(':') ? `[${chosen.interface}]` : chosen.interface;
          let chosenHost = configuredHost;
          try { chosenHost = new URL(`http://${configuredHost}`).hostname; } catch { /* Scoped IPv6 cannot be a web origin. */ }
          if (endpoint && (endpoint.protocol !== 'http:' || endpoint.origin !== route.origin || endpoint.hostname !== chosenHost)) {
            return { state: 'blocked', evidence: unknown('listener-scope-changed'),
              nextAction: guidance('review-lan', 'Review the LAN listener', 'owner', 'host', 'reconcile',
                'The current route does not match the selected HTTP listener. Stop it in Gozar and approve a new route on the selected interface.') };
          }
          const port = endpoint ? Number(endpoint.port || 80) : ctx.localPort;
          const proof = route.verification;
          const target = route.hostConfiguration?.target;
          if (endpoint && route.published === route.origin && proof?.status === 'verified' && proof.vantage === 'lan' &&
              proof.subject?.origin === route.origin && target?.known === true && proof.subject.target === target.value &&
              proof.subject.handleGeneration === route.handle?.generation && proof.checks?.includes('nonce') &&
              Number.isFinite(Date.parse(proof.observedAt))) {
            return { state: 'complete', nextAction: null, evidence: { operationId: operation.id,
              stepId: 'verify-lan', source: 'trusted-client', observedAt: proof.observedAt,
              summary: 'An independent LAN client passed the application challenge for the selected listener.',
            } };
          }
          if (route.state === 'lost') {
            return { state: 'blocked', evidence: unknown('lan-listener-unavailable'),
              nextAction: guidance('allow-lan', 'Check operating-system and firewall permission', 'administrator', 'host', 'configure',
                `${scopeText(chosen.interface, port)}. Check the OS local network permission for this application and whether this address and port are free. If policy blocks the intended LAN client, allow only that client or local subnet to reach this scope. Retry the approved Gozar route after checking permission.`) };
          }
          return { state: 'pending', evidence: unknown('independent-lan-challenge-pending'),
            nextAction: guidance('verify-lan', 'Verify from a trusted LAN client', 'trusted-client', 'trusted-client', 'reconcile',
              `From another trusted device on this LAN, use ${endpoint?.origin ?? 'the exact HTTP address Gozar assigns'} to reach the actual app. Use the trusted LAN verifier connected to Gozar to return the route challenge from that device. Without a receipt from that verifier, verification stays pending. If blocked, ask the administrator to review ${scopeText(chosen.interface, port)} for that client.`) };
        }
        return { state: 'complete', nextAction: null, evidence: { operationId: operation.id,
          stepId: 'firewall', source: 'host', observedAt: new Date(ctx.now()).toISOString(),
          summary: 'The selected interface is present and its HTTP listener scope is approved. Firewall permission and client reach are still unverified.',
        } };
      },

      async routeGuidance(ctx) {
        return (await this.observeSetup(ctx, { id: ctx.route.operationId,
          cancelled: ctx.route.state === 'released', resources: [] })).nextAction;
      },

      async executeSetup(ctx, { action: { id }, value }) {
        if (id !== 'interface' && id !== 'firewall') throw effectError('invalid_input', 'Unknown LAN choice');
        const seen = await inventory(ctx);
        if (!seen.some(row => row.address === value) ||
            (id === 'firewall' && (await choice(ctx)).interface !== value)) {
          throw effectError('candidate_stale', 'Recheck the observed LAN interfaces and approve the current listener scope');
        }
        return { state: 'complete', nextAction: null };
      },

      async plan(ctx, request) {
        platformOf(ctx);
        if (!definition.supportedKinds.includes(request?.usage?.kind)) return base.plan(ctx, request); // an undeclared kind is unsupported before any setup is asked for
        const chosen = await choice(ctx), pending = review(chosen, await inventory(ctx));
        if (pending.needs.length) throw effectError('setup_required', `${pending.why} Provide the ${pending.needs[0]} input, then ask the catalog again.`);
        const planned = await base.plan(ctx, request);
        // The exact choice is part of what is approved: another interface or confirmation is another plan.
        return { ...planned, digest: sha({ plan: planned.digest, interface: chosen.interface, firewall: chosen.firewall }) };
      },

      /** What the session engine needs from this adapter's configuration: the exact listener scope the owner approved. */
      async hostChoices(ctx) {
        const chosen = await choice(ctx), pending = review(chosen, await inventory(ctx));
        if (pending.needs.length) throw effectError('setup_required', `${pending.why} Provide the ${pending.needs[0]} input, then ask the catalog again.`);
        return { bindAddresses: [chosen.interface], firewallApproved: true };
      },
    };
  },
});
