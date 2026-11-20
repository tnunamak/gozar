// Shared by consumer-proof-boundary.test.mjs and durable-status-fence.test.mjs. Not a test file.
//
// The cut: `statusEligible` (durable-route.mjs) ends with a read of the route's stop tombstone (`<hash>.stopped`). When that read
// finds nothing, the unlocked status path goes on to start a challenge or a lease renewal. This replaces fs.promises.open so
// that, once armed, the first such "not stopped" answer first awaits `onAbsent`: the point where a cancelling call from another
// owner of the home can commit. The test process is its own node:test child, and the replacement is undone after the test.
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

export function interposeTombstoneRead(t) {
  const original = fsp.open;
  const state = { armed: false, fired: 0, onAbsent: async () => {} };
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
