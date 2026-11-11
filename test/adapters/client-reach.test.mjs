import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCore } from '../../packages/gozar-node/core.mjs';

const step = await loadCore();
const modes = ['public', 'tailnet', 'lan', 'local'].map(audience => ({
  id: audience, audience, ownership: 'external-owned',
  capabilities: { https: true, sse: true, streamableHttp: true, oauthDcr: true }, recipes: {},
}));
const ids = output => output.snapshot.recommendations.map(item => typeof item === 'string' ? item : item.adapterId).sort();
for (const [clientReach, expected] of [
  ['internet', ['public']], ['unknown', ['public']], ['tailnet', ['public', 'tailnet']],
  ['lan', ['lan', 'public']], ['this-device', ['lan', 'local', 'public', 'tailnet']],
]) {
  test(`generic client reach ${clientReach} filters route audiences`, () => {
    const output = step({ command: { type: 'recommend', sessionId: 'reach-test' }, adapters: [...modes, { id: 'public-http', audience: 'public', ownership: 'external-owned', capabilities: { https: false }, recipes: {} }], requirements: { clientReach } });
    assert.deepEqual(ids(output), expected);
    if (clientReach === 'unknown') assert.ok(output.snapshot.limitations.some(line => /Client reach unknown; public HTTPS first/.test(line)));
  });
}

test('generic protocol needs apply independently of optional client-profile data', () => {
  const adapters = [
    { ...modes[0], id: 'complete', clientProfile: { id: 'opaque-profile', displayName: 'Example remote client' } },
    { ...modes[0], id: 'basic', capabilities: { https: true, sse: false, streamableHttp: false, oauthDcr: false } },
  ];
  for (const key of ['sse', 'streamableHttp', 'oauthDcr']) {
    const output = step({ command: { type: 'recommend', sessionId: 'protocol-test' }, adapters, requirements: { clientReach: 'internet', [key]: true } });
    assert.deepEqual(ids(output), ['complete']);
  }
});
