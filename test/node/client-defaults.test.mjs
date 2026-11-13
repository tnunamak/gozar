import assert from 'node:assert/strict';
import test from 'node:test';
import { clientRequirements, parseArgs } from '../../bin/gozar.mjs';
import { loadDropRequirements } from '../../packages/gozar-node/catalog.mjs';
import { render } from '../../packages/gozar-node/render.mjs';
import { fileURLToPath } from 'node:url';

test('internet expose selects HTTPS and SSE without transport or streaming flags', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const defaults = await loadDropRequirements(root);
  const argv = ['expose', '--port', '18765', '--client-reach', 'internet', '--adapter', 'localhost-run', '--operational', '--yes'];
  const minimal = clientRequirements(parseArgs(argv), defaults);
  const explicit = clientRequirements(parseArgs([...argv, '--transport', 'https', '--sse']), defaults);
  assert.deepEqual(minimal, explicit);
  assert.deepEqual(minimal, { clientReach: 'internet', httpsRequired: true, sse: true, streamableHttp: false, oauthDcr: false });
});

test('optional profiles cannot weaken selected checks or change client reach', () => {
  const requirements = clientRequirements({ clientReach: 'internet', sse: true }, { httpsRequired: true, oauthDcr: true }, { clientReach: 'lan', httpsRequired: false, sse: false, streamableHttp: true });
  assert.deepEqual(requirements, { clientReach: 'internet', httpsRequired: true, sse: true, streamableHttp: true, oauthDcr: true });
});

test('the MCP connection block needs a client profile or --verbose and leaves authentication with the service', () => {
  const published = { snapshot: { phase: 'published-ready', published: 'https://service.example:8443' } };
  assert.doesNotMatch(render(published, []), /mcp|Authentication|demo-server/i);
  const profiled = render({ ...published, connectionProfile: {} }, []);
  assert.match(profiled, /^MCP client URL: https:\/\/service\.example:8443\/mcp$/m);
  assert.match(profiled, /^Authentication: use your service's configured method\./m);
  const verbose = render(published, [], { verbose: true });
  assert.match(verbose, /^URL: https:\/\/service\.example:8443\/mcp$/m);
  for (const output of [profiled, verbose]) { assert.doesNotMatch(output, /demo-server/); assert.doesNotMatch(output, /^Authentication: none/m); }
});
