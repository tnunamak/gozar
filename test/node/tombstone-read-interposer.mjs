// Shared by consumer-proof-boundary.test.mjs and durable-status-fence.test.mjs. Not a test file.
//
// The cut: `statusEligible` (durable-route.mjs) ends with a read of the route's stop tombstone (`<hash>.stopped`). When that read
// finds nothing, the unlocked status path goes on to start a challenge or a lease renewal. This replaces fs.promises.open so
// that, once armed, the first such "not stopped" answer first awaits `onAbsent`: the point where a cancelling call from another
// owner of the home can commit. The test process is its own node:test child, and the replacement is undone after the test.
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

//
// The witness: `state.contention()` returns a promise that settles the first time an acquirer of the home's reservation lock
// loses the link race, that is, `link(candidate, '.locks/reservation.owner')` fails with EEXIST (process-lock.mjs `attempt`).
// That is the concrete event "a competing acquirer reached the lock and is blocked behind a live holder". It is NOT the same
// as an open of the owner record: a holder also opens it to sweep and to release. The event never occurs while the lock is
// free, so a test can await it instead of sleeping, and a fixture where it never occurs fails by its own bound.
//
// process-lock.mjs binds `fs.link` when it is first evaluated, so this module must be imported BEFORE anything that loads
// the library (it is the first import of each test file that uses it). The wrapper stays installed and passes every call
// through unchanged; if it was installed too late the witness never fires and the awaiting test fails loudly.
import fs from 'node:fs';
const LOCK_RECORD = '.locks/reservation.owner';
let lockWatchers = [];
const realLink = fs.link;
fs.link = function link(existing, target, callback) {
  return realLink.call(this, existing, target, function (error, ...rest) {
    if (error?.code === 'EEXIST' && String(target).endsWith(LOCK_RECORD)) { const ready = lockWatchers; lockWatchers = []; for (const resolve of ready) resolve('blocked-at-lock'); }
    return callback.call(this, error, ...rest);
  });
};
syncBuiltinESMExports();
export const reservationContention = () => new Promise(resolve => { lockWatchers.push(resolve); });

export function interposeTombstoneRead(t) {
  const original = fsp.open;
  const state = { armed: false, fired: 0, onAbsent: async () => {}, contention: reservationContention };
  fsp.open = async function open(path, ...rest) {
    try { return await original.call(this, path, ...rest); }
    catch (error) {
      if (state.armed && error?.code === 'ENOENT' && String(path).endsWith('.stopped')) { state.armed = false; state.fired++; await state.onAbsent(); }
      throw error;
    }
  };
  syncBuiltinESMExports();
  t.after(() => { fsp.open = original; syncBuiltinESMExports(); });
  return state;
}
