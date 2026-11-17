// lan: one adapter, wrapped over its existing recipe definition. See ../../../packages/gozar-node/adapter-runtime.mjs.
// The owner chooses the interface and confirms the firewall scope through two declared `provide-value` inputs, so a
// host that knows nothing about this provider can render and drive them:
//   interface  the unicast address of a non-loopback interface observed on this computer;
//   firewall   the same address again: the owner's approval of exactly that listener scope (no wildcard, no rule change).
// Both are persisted adapter configuration. The adapter re-observes the interface inventory at catalog, plan and start,
// and hands the exact choice to the session engine through `hostChoices`; nothing is inferred from the host or the target.
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
    const action = (id, label, valueLabel, valuePlaceholder, detail) => {
      const body = { id, kind: 'provide-value', label, valueLabel, valuePlaceholder, valueFormat: 'text', required: true, disclosure: definition.disclosure };
      // The digest covers what the owner approves, not the observation text, so a changing inventory does not stale a decision.
      return { ...body, digest: sha(body), ...(detail ? { help: detail } : {}) };
    };
    const interfaceAction = detail => action('interface', 'Choose a local network interface', 'Interface address', '192.168.1.20', detail);
    const firewallAction = detail => action('firewall', 'Approve the firewall scope for that interface', 'Interface address to approve', '192.168.1.20', detail);

    const choice = async ctx => {
      const configured = await ctx.configuration(null).catch(() => null);
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
        return { needs: ['interface'], why: `The chosen interface ${chosen.interface.slice(0, 64)} is not a usable address observed on this computer. Choose another.` };
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
          interfaceNeeded: pending.needs.includes('interface'), firewallNeeded: pending.needs.includes('firewall'), reason: pending.why };
        return { state: pending.needs.length || result.state !== 'ready' ? 'action-required' : 'ready', facts };
      },

      configurationActions: () => [interfaceAction(), firewallAction()],

      setupActions(facts) {
        if (!facts?.setupNeeded) return [];
        const detail = [facts.reason, listed(facts.observedInterfaces ?? [])].filter(Boolean).join(' ');
        if (facts.interfaceNeeded === undefined) return [interfaceAction(detail), firewallAction(detail)];
        return [...(facts.interfaceNeeded ? [interfaceAction(detail)] : []), ...(facts.firewallNeeded ? [firewallAction(detail)] : [])];
      },

      async setup(ctx, actionId) {
        const offered = { interface: interfaceAction(), firewall: firewallAction() }[actionId];
        if (!offered) return base.setup(ctx, actionId);
        return { state: 'pending', nextAction: structuredClone(offered) };
      },

      async plan(ctx, request) {
        platformOf(ctx);
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
