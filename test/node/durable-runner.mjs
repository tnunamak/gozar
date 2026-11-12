// Runs one durable-route operation in a fresh process and prints one JSON reply.
// Each call rehydrates from the record and provider state alone.
import * as durable from '../../packages/gozar-node/durable-route.mjs';
import * as service from '../../packages/gozar-node/service.mjs';

const [operation, input] = process.argv.slice(2);
const operations = { ensure: durable.ensureRoute, release: durable.releaseRoute, stop: durable.stopRoute, status: durable.statusRoutes,
  adopt: durable.adoptRoute, confirmHandBack: durable.confirmHandBack, cancelHandBack: durable.cancelHandBack,
  removeService: service.removeService, statusServices: service.statusServices };
try {
  if (typeof operations[operation] !== 'function') throw Object.assign(new Error(`${operation} is not implemented`), { code: 'not_implemented' });
  console.log(JSON.stringify({ result: await operations[operation](JSON.parse(input)) }));
} catch (error) {
  console.log(JSON.stringify({ error: { code: error.code ?? null, message: error.message } }));
}
