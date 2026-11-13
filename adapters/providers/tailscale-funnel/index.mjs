// tailscale-funnel: one adapter, wrapped over its existing recipe definition, with a durable facet built from the shared
// Tailscale serve code. See ../../../packages/gozar-node/adapter-runtime.mjs.
import { recipeAdapter } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { tailscaleDurable } from '../_shared/tailscale-serve.mjs';

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
  extend: ({ wrapped }) => ({ durable: tailscaleDurable(wrapped) }),
});
