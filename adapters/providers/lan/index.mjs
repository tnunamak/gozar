// lan: one adapter, wrapped over its existing recipe definition. See ../../../packages/gozar-node/adapter-runtime.mjs.
import { recipeAdapter } from '../../../packages/gozar-node/adapter-runtime.mjs';

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
});
