import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGozar } from '@tnunamak/gozar';
import { assertShape, query, scratch } from '../node/route-schema-check.mjs';

test('route guidance uses the current exact route and leaves the setup journal out of proof and cleanup', async t => {
  const { fakeRegistry } = await import('@tnunamak/gozar/testing');
  const { readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  let handle, api;
  t.after(async () => { if (handle) await api.closeRoute({ home, handle, mode: 'remove' }).catch(() => {}); });
  const home = await scratch(t), providerId = 'guidance-' + randomUUID();
  const registry = await fakeRegistry({ id: providerId, dir: join(home, 'registry'), kinds: ['attached'],
    reach: 'this-device', transport: 'tcp', proofProtocol: 'echo' });
  const provider = join(registry.root, 'providers', providerId, 'index.mjs');
  const source = await readFile(provider, 'utf8');
  await writeFile(provider, source.replace('export default {', `export default {
    async routeGuidance({ route, localPort }) {
      const bind = route.hostConfiguration.bindTarget;
      return {
        id: 'guidance-fixture', kind: 'instructions', label: 'Current route guidance', digest: 'fixture-guidance',
        disclosure: { revision: 'fixture-guidance', text: 'Fixture only', links: [] },
        instructions: JSON.stringify([route.handle, route.operationId, route.verification.status, route.cleanup.state, bind, localPort]),
      };
    },`));
  api = createGozar({ manifest: registry.manifest, root: registry.root });
  const q = query({ home, providerId, operationId: randomUUID(), usage: { kind: 'attached' },
    requirements: { reach: 'this-device', transport: 'tcp', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } });
  const [candidate] = (await api.catalogRoutes(q)).candidates;
  const opened = await api.expose({ ...q, wait: 'verified', approval: {
    kind: 'route', candidateToken: candidate.candidateToken, consentFactsDigest: candidate.consentFactsDigest,
    disclosureRevision: candidate.disclosure.revision,
  } });
  handle = opened.handle;
  const resumed = createGozar({ manifest: registry.manifest, root: registry.root });
  const route = await resumed.routeStatus({ home, handle });
  assertShape('RouteView', route);
  assert.equal(route.verification.status, 'verified');
  const [observedHandle, observedOperation, proof, cleanup, bind, observedPort] = JSON.parse(route.binding.remedy.instructions);
  assert.deepEqual(observedHandle, handle);
  assert.equal(observedOperation, q.operationId);
  assert.equal(proof, 'verified');
  assert.equal(cleanup, 'none');
  assert.equal(bind.known, true);
  assert.notEqual(bind.value, q.target);
  assert.deepEqual(bind, route.hostConfiguration.bindTarget);
  assert.equal(observedPort, Number(new URL(route.origin).port));
  const other = await resumed.routeStatus({ home, handle, owner: 'foreign-owner' });
  assert.equal(other.binding.remedy, null);
  await assert.rejects(resumed.routeStatus({ home, handle: { ...handle, generation: handle.generation + 1 } }), { code: 'route_conflict' });
  const closed = await resumed.closeRoute({ home, handle, mode: 'remove' });
  assert.equal(closed.cleanup.state, 'confirmed');
  assert.equal(JSON.parse(closed.binding.remedy.instructions)[3], 'confirmed');
  handle = null;
});
