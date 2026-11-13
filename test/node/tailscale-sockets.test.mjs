import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSocketCandidates } from '../../adapters/providers/_shared/tailscale-localapi.mjs';

test('tailscaled socket candidates: the macOS path is tried on darwin only', () => {
  assert.deepEqual(defaultSocketCandidates('linux'), ['/var/run/tailscale/tailscaled.sock', '/run/tailscale/tailscaled.sock']);
  assert.equal(defaultSocketCandidates('darwin')[0], '/var/run/tailscaled.socket');
  assert.ok(!defaultSocketCandidates('linux').includes('/var/run/tailscaled.socket'));
});
