// The `durable` facet of the Tailscale adapters, built over the LocalAPI client (tailscale-localapi.mjs).
// Core keeps the route state (records, reservation lock, intent, receipt, fences, debt). This file owns provider
// I/O and the listener arithmetic: which ports a listener may take, what a rule is, and how it is written.
// A listener is the TCP handler for the port, the Web handler for `dnsName:port` and, for Funnel, its AllowFunnel flag.
// Writes are conditional on the ETag of the read; a 412 is a `conflict`, never a retry of the write.
import { isDeepStrictEqual } from 'node:util';
import * as localapi from './tailscale-localapi.mjs';
import { validateBinding } from '../../../packages/gozar-node/plan.mjs';

const { ruleAt, absent, occupied, withListener, without, foreground } = localapi.serveListener;

export const originOf = (dnsName, port) => port === 443 ? `https://${dnsName}` : `https://${dnsName}:${port}`;

// Does this rule forward to target? Any web handler proxying to http://target counts.
const forwardsTo = (rule, target) => Object.values(rule?.web?.Handlers ?? {})
  .some(handler => typeof handler?.Proxy === 'string' && (handler.Proxy === `http://${target}` || handler.Proxy.startsWith(`http://${target}/`)));

const expandRule = (recipe, target) => JSON.parse(JSON.stringify(recipe.listener).replaceAll('{target}', target));

/**
 * `definition` is the adapter's durable recipe definition: { id, addressStability, durableLifetime, providerResource,
 * idleTimeoutMs, durableRecipe: { mode, candidatePorts, portsFromCapability, listener } }.
 * `transport` replaces the LocalAPI module (tests).
 */
export function tailscaleDurable(definition, { transport = localapi } = {}) {
  const recipe = definition.durableRecipe;
  const read = (snapshot, slot) => {
    const rule = ruleAt(snapshot.config, snapshot.dnsName, slot);
    return absent(rule) ? null : rule;
  };
  const checkName = dnsName => { if (!validateBinding('dns-name', dnsName)) throw new Error('Durable DNS name is invalid'); };
  return {
    family: 'tailscale',
    definition,

    async observe() {
      const node = await transport.getNode();
      const { config, etag } = await transport.getServeConfig();
      return { identity: node.dnsName, snapshot: { dnsName: node.dnsName, funnelPorts: node.funnelPorts, config }, version: etag };
    },
    slots(snapshot, { target } = {}) {
      return recipe.candidatePorts.map(port => ({
        slot: port, origin: originOf(snapshot.dnsName, port),
        permitted: recipe.portsFromCapability ? snapshot.funnelPorts.includes(port) : true,
        forwards: target !== undefined && forwardsTo(read(snapshot, port), target) }));
    },
    read,
    foreign: (snapshot, slot) => Boolean(foreground(snapshot.config, snapshot.dnsName, slot)),
    occupied: (snapshot, slot) => occupied(snapshot.config, snapshot.dnsName, slot),
    expand: target => expandRule(recipe, target),
    async put(ctx, { snapshot, slot, rule, version }) {
      checkName(snapshot.dnsName);
      return await transport.setServeConfig(withListener(snapshot.config, snapshot.dnsName, slot, rule), version) ? 'written' : 'conflict';
    },
    async delete(ctx, { snapshot, slot, version }) {
      return await transport.setServeConfig(without(snapshot.config, snapshot.dnsName, slot), version) ? 'written' : 'conflict';
    },

    // Read-only state of the listener at `origin`, for the adapter's own plan and observe (one config read).
    async inspect(request, { transport: override } = {}) {
      const { getServeConfig } = override ?? transport;
      const { config, etag } = await getServeConfig();
      if (!request.origin) return { present: false, resourceKey: definition.providerResource, identity: null, revision: etag };
      const url = new URL(request.origin), port = url.port || '443', hostPort = `${url.hostname}:${port}`;
      const live = { tcp: config.TCP?.[port] ?? null, web: config.Web?.[hostPort] ?? null, funnel: config.AllowFunnel?.[hostPort] ?? null };
      const wanted = expandRule(recipe, request.target);
      const present = isDeepStrictEqual(live, { tcp: wanted.tcp, web: wanted.web, funnel: wanted.funnel ?? null });
      const held = Object.values(live).some(value => value !== null);
      return { present, resourceKey: `${definition.providerResource}:${port}`, identity: { hostPort, occupied: held, matches: present }, revision: etag };
    },
  };
}
