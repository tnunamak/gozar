import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRouteApi} from '../../packages/gozar-node/route-api.mjs';

// Observe recovery through the public inventory, never by scanning its private files.
test('ensureRoute rejects wrong usage before allocating an operation', async t => {
  const home = await mkdtemp(join(tmpdir(), 'gozar-terminal-close-'));
  t.after(() => rm(home, {recursive:true, force:true}));
  const api = createRouteApi({adapters:[], embeddingServices:{}});
  for (const kind of ['attached', 'not-a-route-kind']) {
    await assert.rejects(api.ensureRoute({
      schemaVersion:1, home, owner:'consumer-test', operationId:'invalid-' + kind,
      target:'127.0.0.1:43123', usage:{kind, routeId:'terminal-test'}
    }), {code:'invalid_input'});
  }
  assert.deepEqual(await api.listRoutes({home, owner:'consumer-test'}), {routes:[]});
});
