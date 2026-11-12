import assert from 'node:assert/strict';
import { stat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defaultProfileHome, getRoutePreferences, setRoutePreferences } from '../../packages/gozar-node/route-preferences.mjs';
import { catalogRoutes, preferenceRefFor } from '../../packages/gozar-node/route-catalog.mjs';
import { assertShape, codeOf, query, scratch, stubAdapter, tokenStubs } from './route-schema-check.mjs';

const env = (t, name, value) => { const was = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; t.after(() => { if (was === undefined) delete process.env[name]; else process.env[name] = was; }); };

test('a fresh profile reads as an empty revision-0 record that validates', async t => {
  const profileHome = await scratch(t);
  const record = await getRoutePreferences({ profileHome });
  assertShape('PreferenceRecord', record);
  assert.deepEqual([record.revision, record.adapterPreference, record.onUnavailable], [0, [], 'ask']);
});

test('red: two app homes (two $HOME values) see one preference, because the profile is the real user\'s', async t => {
  const profile = await scratch(t), appA = await scratch(t), appB = await scratch(t);
  env(t, 'GOZAR_HOME', undefined);
  env(t, 'HOME', appA);
  const fromA = defaultProfileHome();
  env(t, 'HOME', appB);
  assert.equal(defaultProfileHome(), fromA, 'the default profile home must not follow $HOME');
  assert.ok(!fromA.startsWith(appA) && !fromA.startsWith(appB));
  // Writes through one app home are read through the other: both resolve to the same profile directory.
  env(t, 'GOZAR_HOME', profile);
  env(t, 'HOME', appA);
  const written = await setRoutePreferences({ expectedRevision: 0, adapterPreference: [preferenceRefFor('alpha')], onUnavailable: 'ask' });
  env(t, 'HOME', appB);
  assert.deepEqual(await getRoutePreferences(), written);
  assert.equal(written.revision, 1);
  assertShape('PreferenceRecord', written);
});

test('red: a stale revision is a preference_conflict and changes nothing', async t => {
  const profileHome = await scratch(t);
  const first = await setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: ['pref_a'], onUnavailable: 'ask' });
  assert.equal(first.revision, 1);
  const code = await codeOf(setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: ['pref_b'], onUnavailable: 'ask' }));
  assert.equal(code, 'preference_conflict');
  assert.deepEqual((await getRoutePreferences({ profileHome })).adapterPreference, ['pref_a']);
});

test('concurrent writers on one revision: exactly one wins', async t => {
  const profileHome = await scratch(t);
  const results = await Promise.allSettled([1, 2, 3, 4].map(n => setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: [`pref_${n}`], onUnavailable: 'ask' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'preference_conflict'));
  assert.equal((await getRoutePreferences({ profileHome })).revision, 1);
});

test('the file is private and holds only opaque refs', async t => {
  const profileHome = await scratch(t);
  await setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: [preferenceRefFor('alpha')], onUnavailable: 'ask' });
  const file = join(profileHome, 'preferences', 'user.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(profileHome, 'preferences'))).mode & 0o777, 0o700);
  const text = await readFile(file, 'utf8');
  assert.match(text, /pref_[0-9a-f]{24}/);
  assert.doesNotMatch(text, /alpha/);
});

test('invalid preference lists fail closed with invalid_input', async t => {
  const profileHome = await scratch(t);
  const bad = list => codeOf(setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: list, onUnavailable: 'ask' }));
  assert.equal(await bad(['pref_a', 'pref_a']), 'invalid_input');
  assert.equal(await bad(['has space']), 'invalid_input');
  assert.equal(await bad(Array.from({ length: 65 }, (_, i) => `pref_${i}`)), 'invalid_input');
  assert.equal(await codeOf(setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: [], onUnavailable: 'guess' })), 'invalid_input');
});

test('red: a durable pin does not move when the preference changes', async t => {
  const profileHome = await scratch(t), home = await scratch(t);
  const tokens = tokenStubs();
  const adapters = [stubAdapter('alpha'), stubAdapter('bravo')];
  const pin = { adapterId: 'bravo' };           // what the durable engine recorded when the route was created
  const ask = async () => {
    const record = await getRoutePreferences({ profileHome });
    return catalogRoutes(query({ home, usage: { kind: 'durable', routeId: 'route-1' } }), { adapters, platform: 'linux', preferenceRecord: record, issue: tokens.issue, consentBinding: tokens.consentBinding,
      durablePlanFacts: async ({ adapterId }) => ({ planDigest: `d-${adapterId}`, observedResource: `r-${adapterId}` }), pinnedAdapterId: async () => pin.adapterId,
      readContext: { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } });
  };
  const before = await ask();
  const appHomeBefore = JSON.stringify(await readdir(home, { recursive: true }));
  assert.equal(before.candidates[0].preferenceRef, preferenceRefFor('bravo'));
  await setRoutePreferences({ profileHome, expectedRevision: 0, adapterPreference: [preferenceRefFor('alpha')], onUnavailable: 'ask' });
  const after = await ask();
  assert.equal(JSON.stringify(await readdir(home, { recursive: true })), appHomeBefore, 'changing the preference writes nothing into the app home where durable pins live');
  assertShape('Catalog', after);
  assert.equal(after.preferenceRevision, 1);
  assert.equal(after.candidates[0].preferenceRef, preferenceRefFor('bravo'), 'the pinned adapter stays first');
  assert.equal(pin.adapterId, 'bravo');
  // A new (non-durable) ask follows the new preference.
  const fresh = await catalogRoutes(query({ home }), { adapters, platform: 'linux', preferenceRecord: await getRoutePreferences({ profileHome }), issue: tokens.issue, consentBinding: tokens.consentBinding,
    durablePlanFacts: async () => ({}), readContext: { now: () => 0, configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) } });
  assert.equal(fresh.candidates[0].preferenceRef, preferenceRefFor('alpha'));
});
