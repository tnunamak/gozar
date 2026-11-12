// A brand-new synthetic provider: this directory plus one registry entry is all it takes.
import { recipeAdapter } from '../../../../../packages/gozar-node/adapter-runtime.mjs';

export default recipeAdapter({ definition: new URL('./definition.json', import.meta.url) });
