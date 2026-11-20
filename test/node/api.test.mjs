import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { expose, status, stop, addService, statusServices, removeService, createServiceVerifier } from '@tnunamak/gozar';

test('the host session helpers read and close recorded sessions in process, report failures as errors, and leave the host exit code alone', async t => {
  const { directory } = await fixture(t, {});
  const exitCode = process.exitCode;
  // A home with no session records is an empty answer, not a failure.
  assert.deepEqual(await status({ home: directory, port: 19873 }), { schemaVersion: 1, sessions: [] });
  // A port with no record cannot be stopped, and that is said, not read as stopped.
  await assert.rejects(stop({ home: directory, port: 19873 }), { code: 'route_not_found' });
  await assert.rejects(stop({ home: directory }), { code: 'invalid_input' });
  assert.equal(process.exitCode, exitCode);
  // The earlier port-and-flags call started the removed controller; only a route request is accepted.
  await assert.rejects(expose({ port: 19873, lifetimeMs: 1_500_000 }), { code: 'invalid_input', message: /schemaVersion: 1/ });
});

test('root API exports service routes and preserves their persisted lifecycle', async t => {
  const { directory } = await fixture(t, {});
  const options = { home: directory, origin: 'https://service.example', target: '127.0.0.1:3000', verifyCmd: 'exit 0' };
  assert.equal(typeof createServiceVerifier(), 'function');
  assert.equal((await addService(options)).route.verification.status, 'verified');
  assert.equal((await statusServices({ home: directory })).routes.length, 1);
  assert.equal((await removeService(options)).removed, true);
  assert.deepEqual((await statusServices({ home: directory })).routes, []);
});
