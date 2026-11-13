// Runs one operation of the package root API in a fresh process and prints one JSON reply.
// Every step rehydrates from the home directory and provider state alone, so a journey proves the
// public surface and not an in-process object graph.
import * as root from '../../packages/gozar-node/api.mjs';
import { createRouteApi } from '../../packages/gozar-node/route-api.mjs';

// GOZAR_TEST_REGISTRY swaps the adapter registry for a test manifest (and the controller module an attached route
// loads). It is the only difference from the package root, which is how "no core edit" is proven.
const registry = process.env.GOZAR_TEST_REGISTRY ? JSON.parse(process.env.GOZAR_TEST_REGISTRY) : null;
const api = registry
  ? createRouteApi({ manifest: registry.manifest, root: registry.root, expose: { controllerModule: registry.controllerModule } })
  : root;

const [operation, input] = process.argv.slice(2);
const request = JSON.parse(input);
const printable = error => ({ code: error.code ?? null, message: error.message, nextAction: error.nextAction ?? null });
try {
  if (operation === 'watchRoutes') {
    // Collect `events` events, then stop the stream and print them.
    const controller = new AbortController();
    const seen = [];
    const { events = 1, ...rest } = request;
    for await (const event of api.watchRoutes({ ...rest, signal: controller.signal, intervalMs: 50 })) {
      seen.push(event);
      if (seen.length >= events || event.type === 'terminal') controller.abort();
    }
    console.log(JSON.stringify({ result: seen }));
  } else if (typeof api[operation] === 'function') {
    console.log(JSON.stringify({ result: await api[operation](request) }));
  } else throw Object.assign(new Error(`${operation} is not exported`), { code: 'not_implemented' });
} catch (error) {
  console.log(JSON.stringify({ error: printable(error) }));
}
process.exit(0);
