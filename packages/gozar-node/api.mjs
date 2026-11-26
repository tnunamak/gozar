import { isAbsolute } from 'node:path';
import { canonicalHome } from './service-state.mjs';
import { defaultHome } from './default-home.mjs';
import { gozarError } from './error-normalizer.mjs';

import { createRouteApi } from './route-api.mjs';

// The route API: by requirement, never by provider. See route-contract.d.ts.
const routes = createRouteApi();
// `forward` is bound to one configured route API, so its registry, secret backend, host capabilities, identity and
// origin-acknowledgment hook are the ones every other call on that API uses. The managed-forward engine loads and is
// constructed on the first call: importing this module or creating a factory starts no provider and touches no disk.
function bindForward(api, forwardHome) {
  return async (...request) => {
    const { createForward } = await import('./forward.mjs');
    return createForward(api, { home: forwardHome ?? defaultHome() })(...request);
  };
}
/**
 * Load a trusted provider registry. Modules execute with the host process authority. `forwardHome` is where `forward` keeps its
 * managed state (an absolute path); without it `forward` uses the default Gozar home. Every other call keeps taking `home` itself.
 */
export function createGozar({ forwardHome, manifest, root, secretBackend, hostCapabilities, identity, acknowledgeOrigin, originAckTimeoutMs, runtimeModules, detectionTtlMs, registryLineage } = {}) {
  if (forwardHome !== undefined && (typeof forwardHome !== 'string' || !isAbsolute(forwardHome)))
    throw gozarError('invalid_input', 'forwardHome must be an absolute path');
  const api = createRouteApi({ manifest, root, secretBackend, hostCapabilities, identity, acknowledgeOrigin, originAckTimeoutMs, runtimeModules, detectionTtlMs, registryLineage });
  return { ...api, forward: bindForward(api, forwardHome) };
}
/** Publish an existing loopback listener as a managed public HTTPS route, using the bundled providers and the default Gozar home. */
export const forward = bindForward(routes, undefined);
export const { catalogRoutes, inspectLegacyRoute, ensureRoute, adoptRoute, routeStatus, closeRoute, suspendRoute, watchRoutes,
  getRoutePreferences, setRoutePreferences, runSetupAction, readSetupOperation, cancelSetupOperation, resolveClientAddress, listProviders, storeSecret, discardSecret,
  beginConfigurationDraft,commitConfigurationDraft,discardConfigurationDraft,discardEarlierConfigurationDraft,readConfigurationDraft,clearConfigurationInput,reviewRouteConsent,approveRouteConsent,listRoutes } = routes;
/** Alias of catalogRoutes. */
export const detect = catalogRoutes;

// Kept service and hand-back exports (also at @tnunamak/gozar/service).
export { addService, statusServices, removeService, createServiceVerifier, releaseRoute, confirmHandBack, cancelHandBack } from './service.mjs';

/**
 * `expose` is the route request (schemaVersion 1). The earlier port-and-flags call started the earlier session controller, which no
 * longer exists: every provider's session now runs through the route API, where approval is a consent token for the exact route.
 */
export function expose(options) {
  if (options?.schemaVersion === 1) return routes.expose(options);
  return Promise.reject(gozarError('invalid_input', 'expose takes a route request with schemaVersion: 1 (catalogRoutes, then expose with the candidate approval). The earlier port-and-flags call was removed in 0.5.2.'));
}
/** Sessions recorded in one Gozar home, by port. A read only: a recorded earlier-version session is history, never a current route. */
export async function status(options = {}) {
  const { sessionInventory } = await import('./session-directory.mjs');
  const home = await canonicalHome(options.home ?? defaultHome(), false);
  const sessions = await sessionInventory(home);
  return { schemaVersion: 1, sessions: options.port === undefined ? sessions : sessions.filter(item => item.port === options.port) };
}
/** Closes the one session recorded for `port`, through the runtime that owns its record. */
export async function stop(options = {}) {
  if (!Number.isInteger(options.port)) return Promise.reject(gozarError('invalid_input', 'stop needs the session port'));
  const { stopSessionByPort } = await import('./session-directory.mjs');
  return { schemaVersion: 1, session: await stopSessionByPort(options.home ?? defaultHome(), options.port) };
}
