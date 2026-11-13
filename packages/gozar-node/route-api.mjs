// The consumer API (route-contract.d.ts), wired from the modules that own each part. Apps call these by
// requirement and never name a provider: the catalog picks candidates from the adapter registry, a single-use
// consent token carries the user's approval, and every reply is a RouteView or a GozarThrownError.
//
// `createRouteApi(deps)` exists so a test can replace the adapter registry, platform or state loaders; the
// package root exports the instance with real dependencies. Nothing here names a provider.
import { catalogRoutes as buildCatalog } from './route-catalog.mjs';
import { routeStatus as viewStatus, closeRoute as viewClose, projectDurable, propertiesFor } from './route-view.mjs';
import { watchRoutes as pollRoutes } from './route-watch.mjs';
import { getRoutePreferences, setRoutePreferences } from './route-preferences.mjs';
import { runSetupAction as runSetup } from './route-setup.mjs';
import { openAttachedRoute, openSessionRoute } from './attached-route.mjs';
import { resolveClientAddress } from './ingress.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';

const lazy = loader => { let loaded; return () => (loaded ??= loader()); };
const engine = lazy(() => import('./durable-route.mjs'));
const legacy = lazy(() => import('./legacy-import.mjs'));
const runtime = lazy(() => import('./adapter-runtime.mjs'));

export function createRouteApi(deps = {}) {
  const platform = () => deps.platform ?? process.platform;
  let loaded;
  const adapters = async () => deps.adapters ?? (loaded ??= runtime().then(module => module.loadAdapters(deps.manifest ? { manifest: deps.manifest, root: deps.root } : undefined)).catch(error => { loaded = undefined; throw error; }));
  const shared = async () => ({ adapters: await adapters(), platform: platform(), ...(deps.readContext ? { readContext: deps.readContext } : {}) });
  const guard = async action => { try { return await action(); } catch (error) { throw normalizeError(error); } };

  /** A durable engine reply is a record view; its RouteView needs the adapter's declared properties. */
  async function durableView(reply) {
    const handle = { kind: 'durable', id: reply.routeId, generation: reply.generation };
    return projectDurable(reply, { handle, ...await propertiesFor(reply.adapterId, { adapters: await adapters() }) });
  }

  const api = {
    catalogRoutes: query => guard(async () => buildCatalog(query, { ...await shared(), profileHome: deps.profileHome,
      pinnedAdapterId: async q => q.usage.kind === 'durable' ? (await engine()).durablePin({ home: q.home, routeId: q.usage.routeId }) : null })),

    inspectLegacyRoute: request => guard(async () => (await legacy()).inspectLegacyRoute(request)),

    // The loaded adapters go to every durable engine call as an optional second argument; an engine that does not use it ignores it.
    ensureRoute: request => guard(async () => durableView((await (await engine()).ensureRoute(request, { adapters: await adapters() })).route)),
    adoptRoute: request => guard(async () => durableView((await (await engine()).adoptRoute(request, { adapters: await adapters() })).route)),

    /** A request with schemaVersion 1 is the route API; anything else is the legacy session call (handled by the caller). */
    expose: request => guard(async () => {
      const options = { ...await shared(), ...deps.expose };
      if (request?.usage?.kind === 'attached') return openAttachedRoute(request, options);
      if (request?.usage?.kind === 'session') return openSessionRoute(request, options);
      throw gozarError('invalid_input', "expose needs usage 'session' or 'attached'");
    }),

    routeStatus: request => guard(async () => viewStatus(request, { adapters: await adapters(), ...deps.view })),
    closeRoute: request => guard(async () => viewClose(request, { adapters: await adapters(), ...deps.view })),
    watchRoutes: request => pollRoutes(request, { routeStatus: async r => viewStatus(r, { adapters: await adapters(), ...deps.view }), ...deps.watch }),
    getRoutePreferences, setRoutePreferences,
    runSetupAction: request => guard(async () => runSetup(request, { ...deps.setup, ...await shared() })),
    resolveClientAddress,
  };
  return api;
}
