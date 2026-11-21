import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, chmod, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAttachedRoute, openSessionRoute } from '../../packages/gozar-node/attached-route.mjs';

test('detect-only metadata refuses before consent, configuration, SDK or allocation; executable TCP still needs consent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'detect-only-'));
  await chmod(home, 0o700);
  let effects = 0;
  const forbidden = async () => { effects++; throw new Error('unexpected provider/effect call'); };
  const id = 'fixture-' + randomUUID();
  const definition = { supportedKinds: ['attached', 'session'], availability: {
    attached: { state: 'detect-only', reason: 'fixture' },
    session: { state: 'detect-only', reason: 'fixture' },
  }};
  const adapter = { id, definition, detect: forbidden, plan: forbidden, observe: forbidden, create: forbidden, close: forbidden };
  const deps = { adapters: [adapter], platform: 'linux', redeem: forbidden, dispatchEffect: forbidden,
    readContext: { configuration: forbidden },
    embeddingServices: { resolveConfiguration: forbidden, readConfiguration: forbidden } };
  try {
    for (const transport of ['tcp', 'tls']) for (const kind of ['attached', 'session']) {
      const query = { schemaVersion: 1, owner: 'fixture-owner', home, target: '127.0.0.1:32123',
        providerId: id, usage: kind === 'session' ? { kind, lifetimeMs: 60000 } : { kind },
        requirements: { reach: 'internet', transport, payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] },
        wait: 'allocated' };
      const open = kind === 'attached' ? openAttachedRoute : openSessionRoute;
      // No SDK or configuration is consulted, even when no approval exists.
      await assert.rejects(open(query, deps), { code: 'unsupported' });
      await assert.rejects(open({ ...query, approval: null }, deps), { code: 'unsupported' });
      await assert.rejects(open({ ...query, wait: 'invalid' }, deps), { code: 'invalid_input' });
      await assert.rejects(open({ ...query, owner: '' }, deps), { code: 'invalid_input' });
      definition.availability[kind].state = 'available';
      await assert.rejects(open(query, deps), { code: 'consent_required' });
      definition.availability[kind].state = 'detect-only';
      assert.equal(effects, 0);
      assert.deepEqual(await readdir(home), []);
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});
