import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Extraction-only: no daemon, broker, listener, provider, or filesystem effects.
const source = await readFile(new URL('../../packages/gozar-node/attached-route.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  const consentObservation =');
const end = source.indexOf('  async function enforceConsent(', start);
assert.ok(start >= 0 && end > start);
const make = Function('lease', 'handle', 'proofAuthorityLost', 'identity',
  'currentRouteReview', 'bootstrap', 'adapter', 'runtime', 'resolver',
  `let {attempt, receipt}=identity; ${source.slice(start, end)}
  return {consentObservation, currentConsent, commitConsentEvidence,
    replaceAttempt: () => { attempt = {}; }};`);

for (const scenario of ['current','revoked','superseded','no approved review']) {
  test('consent facts are staged: ' + scenario, async () => {
    const old = [{id:'old'}], fresh = [{id:'fresh'}];
    const approvedReview = {canonicalInput:{scope:{query:{}}}};
    const lease = {facts:old, approvedReview: scenario === 'no approved review' ? null : approvedReview};
    let revoked = false, deliver;
    const read = new Promise(resolve => { deliver=resolve; });
    const h = make(lease,{generation:1},()=>revoked,{attempt:{},receipt:null},()=>read,
      {request:{}},{},{},null);
    const identity = h.consentObservation();
    const pending = h.currentConsent();
    if (scenario === 'revoked') revoked=true;
    if (scenario === 'superseded') h.replaceAttempt();
    const review = {consentFactsDigest:'synthetic'};
    deliver({review,facts:fresh});
    const staged = await pending;
    assert.equal(lease.facts,old,'reading cannot mutate held evidence');
    if (scenario === 'no approved review') assert.equal(staged,null);
    else assert.deepEqual(staged,{review,facts:fresh});
    assert.equal(h.commitConsentEvidence(identity,staged), !['revoked','superseded'].includes(scenario));
    assert.equal(lease.facts,scenario === 'current' ? fresh : old);
  });
}
