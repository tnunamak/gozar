// Adoption selection over a raw serve-config observation: { dnsName, config }. Adapters are
// [{ adapterId, capability: { candidatePorts, recipe: { listener } } }]. The generic selection lives in the durable
// engine (selectAdoptableRule); this builds one facet per entry and hands it the observation.
import { selectAdoptableRule } from '../../../packages/gozar-node/durable-route.mjs';
import { tailscaleDurable } from './tailscale-serve.mjs';

export function selectAdoptable(adapters, observed, { origin, target }) {
  const snapshot = { dnsName: observed.dnsName, funnelPorts: observed.funnelPorts ?? [], config: observed.config };
  return selectAdoptableRule(adapters.map(({ adapterId, capability }) => ({
    adapterId, durable: tailscaleDurable({ durableRecipe: { candidatePorts: capability.candidatePorts, listener: capability.recipe.listener } }), snapshot })),
  { origin, target });
}
