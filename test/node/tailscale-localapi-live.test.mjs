// 26. Live, read-only LocalAPI contract test against this host's tailscaled.
// It sends exactly one request, GET /localapi/v0/serve-config, and asserts shape only.
// It never prints or stores config values or the ETag. Skipped when no tailscaled
// socket is present or access is denied. Never writes, never calls any other endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getServeConfig } from '../../packages/gozar-node/tailscale-localapi.mjs';

test('26. live: GET serve-config returns a parseable config and a non-empty Etag', async t => {
  if (process.env.GOZAR_TAILSCALED_SOCKET) { t.skip('socket override is set'); return; }
  let reply;
  try { reply = await getServeConfig(); }
  catch (error) {
    if (['tailscale_localapi_unavailable', 'tailscale_localapi_denied'].includes(error.code)) { t.skip(error.code); return; }
    // Only the typed code, never a body or header value.
    assert.fail(`serve-config read failed with ${error.code ?? 'an untyped error'}`);
  }
  assert.ok(reply.config !== null && typeof reply.config === 'object' && !Array.isArray(reply.config), 'config is an object');
  assert.ok(typeof reply.etag === 'string' && reply.etag.length > 0, 'Etag is a non-empty string');
  for (const key of ['TCP', 'Web', 'AllowFunnel', 'Foreground'])
    assert.ok(reply.config[key] === undefined || (typeof reply.config[key] === 'object' && reply.config[key] !== null), `${key} has map shape`);
});
