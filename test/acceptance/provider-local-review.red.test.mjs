import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGozar } from '@tnunamak/gozar';
import { query, scratch } from '../node/route-schema-check.mjs';

test('catalog consent review never echoes authentication material in a rejected owner origin', async t => {
  const api = await createGozar();
  const home = await scratch(t);
  const canary = 'owner-origin-secret-canary';
  const origin = `https://user:${canary}@owner.example.test/${canary}?token=${canary}`;
  const { candidates: [candidate] } = await api.catalogRoutes(query({ home, providerId: 'own-address', origin }));
  assert.equal(candidate.candidateToken, null);
  assert.equal(candidate.eligible, false);
  assert.equal(candidate.unmet.find(item => item.requirement === 'setup').actual.origin, null);
  assert.equal(JSON.stringify(candidate).includes(canary), false, 'the rejected input is still present in public catalog data');
});
