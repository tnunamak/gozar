import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { expose, status, stop, addService, statusServices, removeService, createServiceVerifier } from '@tnunamak/gozar';

test('host API returns CLI failure JSON without changing the host exit code', async t => {
  const { directory } = await fixture(t, {});
  const exitCode = process.exitCode;
  await assert.rejects(status({ home: directory, port: 19873 }), error => {
    assert.equal(error.code, 1);
    assert.equal(error.reply.snapshot.phase, 'unknown');
    assert.match(error.reply.journalPath, /port-19873/);
    return true;
  });
  await assert.rejects(stop({ home: directory, port: 19873 }), error => error.reply.snapshot.phase === 'unknown');
  assert.equal(process.exitCode, exitCode);
  assert.throws(() => expose({ lifetimeMs: '1500000' }), /lifetimeMs/);
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
