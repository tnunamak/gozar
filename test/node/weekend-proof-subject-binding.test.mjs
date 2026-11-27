import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {proofObservedDuring, proofSubjectAfterObservation} from '../../packages/gozar-node/attached-route.mjs';

test('verification history binds only successful observations', () => {
  const seen = {origin: 'https://fixture.invalid', target: 'fixture-target',
    instanceId: 'fixture-instance', bootId: 'fixture-boot', handleGeneration: 1};
  assert.equal(proofSubjectAfterObservation(null, 'unverified', seen), null);
  assert.deepEqual(proofSubjectAfterObservation(null, 'verified', seen), seen);
  const newer = {...seen, handleGeneration: 2};
  assert.deepEqual(proofSubjectAfterObservation(seen, 'unverified', newer), seen);
  assert.deepEqual(proofSubjectAfterObservation(seen, 'verified', newer), newer);
});

// Pure negative controls for the shared initial/refresh timestamp boundary. The public proof mutation matrix below
// now carries the subject cells; this control remains the direct evidence for the observation-window predicate.
test('proof observation must belong to the current verification interval', () => {
  const start=1000,end=2000;
  for(const checkedAt of [undefined,null,'invalid',new Date(999).toISOString(),new Date(2001).toISOString()]){
    assert.equal(proofObservedDuring({checkedAt},start,end),false);
  }
  assert.equal(proofObservedDuring({checkedAt:new Date(start).toISOString()},start,end),true);
  assert.equal(proofObservedDuring({checkedAt:new Date(end).toISOString()},start,end),true);
  assert.equal(proofObservedDuring({checkedAt:new Date(1500).toISOString()},start,end),true);
});

// The public initial-proof subject matrix, on the current runtime: one owned echo app behind the fakeRegistry echo
// provider, driven only through createGozar/catalogRoutes/expose/closeRoute. The fault wrapper is the owned provider
// fixture beside the fake module, never controller state. A wrong nonce is sent through the real verifier, so the
// echo protocol itself must answer it; a mutated endpoint or attempt id in the returned observation is an
// adversarial provider answer and must never create usable publication.
//
// Cells that already have a real public-path test are not duplicated here: attached wrong-endpoint and
// stale-attempt are provider-lifecycle.test.mjs's "core rejects another endpoint/attempt and cleans up the owned
// fixture"; the observation-window cells are the control above plus session-proof-staging.test.mjs; retained-handle
// custody on a failed expose is weekend-initial-proof and ngrok-bundled-runtime. Still missing were the wrong-nonce
// rejection for both kinds and the wrong-endpoint/stale-attempt rejections for sessions.
const WRAPPER = fault => `
import provider from './index.mjs';
const fault=${JSON.stringify(fault)};
export default {...provider,
  async prepareProof(ctx, request, attempt) {
    const proof = await provider.prepareProof(ctx, request, attempt);
    return {...proof, async verify(input) {
      const asked = fault === 'wrong-nonce'
        ? {...input, attempt: {...input.attempt, nonce: (input.attempt.nonce[0] === '0' ? '1' : '0') + input.attempt.nonce.slice(1)}}
        : input;
      const checked = await proof.verify(asked);
      return fault === 'wrong-endpoint' ? {...checked, endpoint: 'tcp://127.0.0.1:1'}
        : fault === 'stale-attempt' ? {...checked, attemptId: 'previous-' + checked.attemptId}
        : checked;
    }};
  },
};
`;

async function subjectWorld(t, kind, fault) {
  const home = await mkdtemp(join(tmpdir(), 'gozar-proof-subject-'));
  let registry, api, request;
  const sockets = new Set();
  const app = net.createServer({allowHalfOpen: true}, socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.pipe(socket);
  });
  // Retain custody even if an assertion fails or expose omits its partial handle.
  // Confirm owned cleanup before deleting the private evidence; never chmod its parent.
  t.after(async () => {
    let confirmed = false;
    try {
      if (api && request) {
        const {routes} = await api.listRoutes({home, owner: request.owner});
        for (const retained of routes.filter(row => row.operationId === request.operationId)) {
          assert.ok(retained.handle, 'retained operation must have a cleanup handle');
          const closed = await api.closeRoute({home, handle: retained.handle, mode: 'remove'});
          assert.equal(closed.cleanup.state, 'confirmed', 'fixture must retire its owned operation');
        }
      }
      confirmed = true;
    } finally {
      for (const socket of sockets) socket.destroy();
      if (app.listening) await new Promise(resolve => app.close(resolve));
      if (confirmed) {
        try { await registry?.cleanup(); }
        finally { await rm(home, {recursive: true, force: true}); }
      }
    }
  });
  await new Promise((resolve, reject) => { app.once('error', reject); app.listen(0, '127.0.0.1', resolve); });
  const target = '127.0.0.1:' + app.address().port;
  const id = 'subject-' + randomUUID().slice(0, 8);
  registry = await fakeRegistry({id, dir: join(home, 'registry'), kinds: ['attached', 'session'],
    reach: 'this-device', transport: 'tcp', protocols: [], proofProtocol: 'echo'});
  const folder = join(registry.root, 'providers', id);
  await writeFile(join(folder, 'observed.mjs'), WRAPPER(fault));
  const manifest = structuredClone(registry.manifest);
  manifest.providers[0].module = 'providers/' + id + '/observed.mjs';
  const identity = {instanceId: randomUUID(), bootId: randomUUID()};
  api = createGozar({manifest, root: registry.root, identity});
  const query = {schemaVersion: 1, home, owner: 'subject-owner', providerId: id, target,
    usage: kind === 'session' ? {kind, lifetimeMs: 300000} : {kind},
    requirements: {reach: 'this-device', transport: 'any', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: []}};
  const candidate = (await api.catalogRoutes(query)).candidates.find(row => row.providerId === id);
  assert.ok(candidate?.candidateToken, 'the real catalog must issue approval');
  request = {...query, operationId: randomUUID(), wait: 'verified',
    approval: {kind: 'route', candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision, consentFactsDigest: candidate.consentFactsDigest}};
  return {
    api, home, target, identity, folder,
    request,
    exchange: (origin, bytes) => new Promise((resolve, reject) => {
      const endpoint = new URL(origin);
      const socket = net.connect(Number(endpoint.port), endpoint.hostname);
      const chunks = [];
      const timer = setTimeout(() => socket.destroy(new Error('fixture exchange timeout')), 5000);
      socket.once('connect', () => socket.end(bytes));
      socket.on('data', chunk => chunks.push(chunk));
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    }),
    events: async () => (await readFile(join(folder, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line).event),
  };
}

async function settle(f) {
  try { return {route: await f.api.expose(f.request)}; }
  catch (error) { return {failure: error, route: error.route}; }
}

for (const kind of ['attached', 'session']) {
  test(`an honest ${kind} initial proof publishes the route bound to its exact subject`, {timeout: 60000}, async t => {
    const f = await subjectWorld(t, kind, null);
    const payload = randomBytes(96);
    const exposedAt = Date.now();
    const {failure, route} = await settle(f);
    try {
      assert.ifError(failure);
      assert.equal(route.handle.kind, kind); assert.equal(route.handle.generation, 1);
      assert.equal(route.verification.status, 'verified');
      assert.equal(route.published, route.origin);
      assert.deepEqual(route.verification.subject, {origin: route.origin, target: f.target, ...f.identity, handleGeneration: 1});
      assert.deepEqual(await f.exchange(route.origin, payload), payload, 'the published route forwards real bytes');
      assert.deepEqual(await f.events(), ['start', 'proof'], 'exactly one allocation and one proof observation');
      const sameRequest = structuredClone(f.request);
      if (kind === 'session') {
        assert.equal(route.expiresAt?.known, true, 'a successful session has a real expiry');
        assert.ok(Number.isFinite(Date.parse(route.expiresAt.value)), 'expiry is a date');
        const expiry = Date.parse(route.expiresAt.value);
        assert.ok(expiry > Date.now(), 'the issued lease is still live');
        assert.ok(expiry >= exposedAt + sameRequest.usage.lifetimeMs - 2000);
        assert.ok(expiry <= Date.now() + sameRequest.usage.lifetimeMs + 2000);
        const replay = await f.api.expose(sameRequest);
        assert.deepEqual(replay.handle, route.handle);
        assert.equal(replay.published, route.origin);
        assert.deepEqual(replay.expiresAt, route.expiresAt, 'a replay does not extend the lease');
        const current = await f.api.routeStatus({home: f.home, owner: sameRequest.owner, handle: route.handle});
        assert.deepEqual(current.expiresAt, route.expiresAt, 'status reports the originally issued lease');
        assert.deepEqual(await f.events(), ['start', 'proof'], 'a replay starts no new allocation or proof');

        const otherApp = net.createServer();
        t.after(() => otherApp.listening ? new Promise(resolve => otherApp.close(resolve)) : undefined);
        await new Promise((resolve, reject) => { otherApp.once('error', reject); otherApp.listen(0, '127.0.0.1', resolve); });
        const changedTarget = '127.0.0.1:' + otherApp.address().port;
        assert.notEqual(changedTarget, f.target);
        await assert.rejects(f.api.expose({...sameRequest, target: changedTarget}), {code: 'operation_conflict'});
        assert.deepEqual(await f.events(), ['start', 'proof'], 'a conflicting intent starts nothing');
        const retained = await f.api.routeStatus({home: f.home, owner: sameRequest.owner, handle: route.handle});
        assert.deepEqual(retained.handle, route.handle);
        assert.deepEqual(retained.expiresAt, route.expiresAt);
        assert.equal(retained.verification.subject.target, f.target);
        assert.equal(retained.published, route.origin);
      }
      const closed = await f.api.closeRoute({home: f.home, handle: route.handle, mode: 'remove'});
      assert.equal(closed.cleanup.state, 'confirmed');
      assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'owned cleanup ran exactly once');
      if (kind === 'session') {
        const terminal = await f.api.expose(sameRequest);
        assert.deepEqual(terminal.handle, route.handle);
        assert.equal(terminal.state, 'released');
        assert.equal(terminal.published, null);
        assert.equal(terminal.cleanup.state, 'confirmed');
        assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'terminal replay neither reallocates nor cleans up again');
      }
      assert.deepEqual(await f.exchange('tcp://' + f.target, payload), payload, 'the foreign app survives owned cleanup');
    } finally {
      if (route?.handle) await f.api.closeRoute({home: f.home, handle: route.handle, mode: 'remove'}).catch(() => {});
    }
  });

  test(`a ${kind} initial proof with the wrong nonce is rejected without publication`, {timeout: 60000}, async t => {
    const f = await subjectWorld(t, kind, 'wrong-nonce');
    const payload = randomBytes(96);
    const {failure, route} = await settle(f);
    try {
      assert.equal(failure?.code, 'verification_failed');
      assert.ok(route?.handle, 'the failed expose retains the exact cleanup handle');
      assert.equal(route.handle.kind, kind); assert.equal(route.handle.generation, 1);
      assert.equal(route.published, null);
      assert.equal(route.verification.status, 'unverified');
      assert.equal(route.verification.subject, null, 'a rejected proof never binds a publication subject');
      assert.ok(Number.isFinite(Date.parse(route.verification.checkedAt)), 'the real nonce check answered and failed');
      assert.equal(route.cleanup.state, 'confirmed', 'the withdrawn route already confirmed its owned cleanup');
      assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'one allocation, one failed proof, one withdrawal');
      const closed = await f.api.closeRoute({home: f.home, handle: route.handle, mode: 'remove'});
      assert.equal(closed.cleanup.state, 'confirmed', 'the retained handle still closes idempotently');
      assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'closing the retained handle starts nothing');
      assert.deepEqual(await f.exchange('tcp://' + f.target, payload), payload, 'the foreign app survives owned cleanup');
    } finally {
      await f.api.closeRoute({home: f.home, handle: route?.handle, mode: 'remove'}).catch(() => {});
    }
  });
}

for (const [fault, claim] of [['wrong-endpoint', 'naming another endpoint'], ['stale-attempt', 'naming a stale attempt']]) {
  test(`a session initial proof ${claim} is rejected without publication`, {timeout: 60000}, async t => {
    const f = await subjectWorld(t, 'session', fault);
    const payload = randomBytes(96);
    const {failure, route} = await settle(f);
    try {
      assert.equal(failure?.code, 'verification_failed');
      assert.ok(route?.handle, 'the failed expose retains the exact cleanup handle');
      assert.equal(route.handle.kind, 'session'); assert.equal(route.handle.generation, 1);
      assert.equal(route.published, null);
      assert.equal(route.verification.status, 'unverified');
      assert.equal(route.verification.subject, null, 'a rejected proof never binds a publication subject');
      assert.equal(route.verification.checkedAt, null, 'the mutated observation was discarded before any staging');
      assert.equal(route.cleanup.state, 'confirmed', 'the withdrawn route already confirmed its owned cleanup');
      assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'one allocation, one rejected observation, one withdrawal');
      const closed = await f.api.closeRoute({home: f.home, handle: route.handle, mode: 'remove'});
      assert.equal(closed.cleanup.state, 'confirmed', 'the retained handle still closes idempotently');
      assert.deepEqual(await f.events(), ['start', 'proof', 'stop', 'cleanup'], 'closing the retained handle starts nothing');
      assert.deepEqual(await f.exchange('tcp://' + f.target, payload), payload, 'the foreign app survives owned cleanup');
    } finally {
      await f.api.closeRoute({home: f.home, handle: route?.handle, mode: 'remove'}).catch(() => {});
    }
  });
}
