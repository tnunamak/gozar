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

test('generic connection block leaves authentication with the service and limits no-auth guidance to the demo', () => {
  const output = render({ snapshot: { phase: 'published-ready', published: 'https://service.example:8443' } }, []);
  assert.match(output, /^URL: https:\/\/service\.example:8443\/mcp$/m);
  assert.match(output, /^Authentication: use your service's configured method\.$/m);
  assert.match(output, /^For gozar demo-server only, select no authentication\.$/m);
  assert.doesNotMatch(output, /^Authentication: none/m);
});
