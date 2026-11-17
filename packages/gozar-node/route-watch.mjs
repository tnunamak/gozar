// watchRoutes: a polling AsyncIterable of snapshot, changed and terminal events for one handle. It is not an
// audit log: states that come and go between two polls are missed. Abort ends it at once and leaves no timer.
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { routeStatus as defaultStatus, checkRef, releasedView } from './route-view.mjs';

const MIN_INTERVAL_MS = 250;

// Everything a person would act on. Proof timestamps move on every poll and are not a change.
const fingerprint = view => JSON.stringify([view.handle, view.origin, view.published, view.state, view.ownership, view.properties,
  view.ingress && { ...view.ingress, verifiedAt: undefined, validUntil: undefined }, view.verification.status, view.limits, view.cleanup,
  view.routeState, view.hostConfiguration, view.facts, view.actions]);

function abortable(promise, signal) {
  if (signal.aborted) return Promise.resolve({ aborted: true });
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve({ aborted: true });
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve({ value }); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}
function sleep(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export function watchRoutes(request, deps = {}) {
  const handle = checkRef(request);
  const { signal } = request;
  if (!(signal instanceof AbortSignal)) throw gozarError('invalid_input', 'watchRoutes needs an AbortSignal');
  if (request.intervalMs !== undefined && !(Number.isFinite(request.intervalMs) && request.intervalMs > 0)) throw gozarError('invalid_input', 'intervalMs must be a positive number');
  const status = deps.routeStatus ?? defaultStatus;
  const floor = deps.minIntervalMs ?? MIN_INTERVAL_MS;
  return (async function* watch() {
    let sequence = 0, last = null, key = null, intervalMs = null,consentDigest=null;
    while (!signal.aborted) {
      let view, terminal = false;
      try {
        const polled = await abortable(status({ home: request.home, handle }), signal);
        if (polled.aborted) return;
        view = polled.value;
      } catch (cause) {
        const error = normalizeError(cause);
        if (error.code === 'route_not_found') { view = releasedView(last, handle); terminal = true; }
        else if (error.code === 'provider_unavailable' && last) view = { ...last, state: 'unknown', routeState: 'unknown', published: null,
          verification: { ...last.verification, status: 'unverified', checks: [], results: [] } };
        else if (error.code !== 'busy') throw error;
      }
      if (view) {
        terminal ||= view.state === 'released';
        const next = fingerprint(view);
        if (terminal) { yield { schemaVersion: 1, sequence: sequence++, type: 'terminal', route: view }; return; }
        if (last === null) yield { schemaVersion: 1, sequence: sequence++, type: 'snapshot', route: view };
        else if (next !== key) yield { schemaVersion: 1, sequence: sequence++, type: 'changed', route: view };
        if(view.consentChange&&view.consentChange.newDigest!==consentDigest){consentDigest=view.consentChange.newDigest;yield {schemaVersion:1,sequence:sequence++,type:'consent_changed',route:view,...view.consentChange};}
        last = view; key = next;
        intervalMs ??= request.intervalMs ?? view.limits.recommendedPollIntervalMs ?? 1000;
      }
      await sleep(Math.max(intervalMs ?? request.intervalMs ?? 1000, floor), signal);
    }
  })();
}
