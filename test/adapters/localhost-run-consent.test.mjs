// The localhost.run consent names the requested lifetime and no default number of minutes. Consent text is bound by
// its revision, so changing the words must refuse approvals made against the old revision.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadAdapters } from '../../packages/gozar-node/adapter-runtime.mjs';
import { consentDisclosureRevision, catalogRoutes } from '../../packages/gozar-node/route-catalog.mjs';
import { redeemApproval } from '../../packages/gozar-node/attached-route.mjs';
import { query, scratch, tokenStubs } from '../node/route-schema-check.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OLD_REVISION = 'disc-e68dce2053c0';
const readContext = { now: () => 0, platform: 'linux', configuration: async () => null, probe: async () => ({ ok: true }), verifyChallenge: async () => ({ status: 'verified' }) };
const adapters = await loadAdapters({ manifest: join(root, 'adapters/manifest.json'), root: join(root, 'adapters') });
const adapter = adapters.find(item => item.id === 'localhost-run');
const hourRequest = home => query({ home, providerId: 'localhost-run', usage: { kind: 'session', lifetimeMs: 3_600_000 } });

test('consent copy names the requested lifetime and states no default number of minutes', async () => {
  const plan = JSON.parse(await readFile(join(root, 'adapters/localhost-run.definition.json'), 'utf8'));
  const claims = [adapter.definition.disclosure.text, plan.definition.copy.consent];
  for (const claim of claims) {
    assert.match(claim, /for the requested lifetime\./);
    assert.doesNotMatch(claim, /\d+\s*minutes?|by default/i);
  }
});

test('localhost.run definitions and generated provider row do not declare a fixed provider cap', async () => {
  const { adapter: declared } = JSON.parse(await readFile(join(root, 'adapters/providers/localhost-run/definition.json'), 'utf8'));
  const { definition: plan } = JSON.parse(await readFile(join(root, 'adapters/localhost-run.definition.json'), 'utf8'));
  const docs = await readFile(join(root, 'docs/providers.md'), 'utf8');
  const row = docs.split('\n').find(line => line.startsWith('| `localhost-run` |'));
  assert.ok(row, 'the generated localhost.run row is present');
  const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
  assert.equal(cells[1], declared.label);
  assert.equal(cells[5], declared.capabilities.address.stability);
  assert.equal(plan.label, declared.label);

  const clocks = declared.facts.filter(fact => fact.id === 'provider-clocks');
  assert.equal(clocks.length, 1, 'provider expiry has one stable fact identity');
  assert.equal(clocks[0].known, false, 'the provider expiry has not been observed');
  assert.equal(clocks[0].value, null, 'no numeric vendor expiry is asserted');
  assert.equal(clocks[0].group, 'limits');

  const unsupportedCap = /the plan limits a session to 15 minutes/i;
  for (const [source, value] of [['normalized', declared], ['wrapped', plan], ['generated row', row]]) {
    assert.doesNotMatch(JSON.stringify(value), unsupportedCap, `${source} repeats the removed provider cap`);
  }

  const trialUncertainty = 'uptime and URL lifetime are not guaranteed';
  assert.ok(declared.capabilities.address.conditions.includes(`trial: ${trialUncertainty}`));
  assert.ok(declared.facts.some(fact => fact.known && fact.group === 'address' &&
    fact.value === `trial: ${trialUncertainty}`));
  assert.ok(plan.unknowns.includes(`Trial ${trialUncertainty}.`));
  assert.match(declared.disclosure.text, /for the requested lifetime\./);
  assert.match(plan.copy.consent, /for the requested lifetime\./);
  // The plan's owned-process duration is not a statement about the remote provider's limit.
  assert.equal(plan.recipes.create.process.lifetimeMs, 900000);
});

test('a one-hour request is offered consent with no conflicting 15-minute default and a refreshed revision', async t => {
  const tokens = tokenStubs();
  const catalog = await catalogRoutes(hourRequest(await scratch(t)), { adapters, platform: 'linux', readContext, issue: tokens.issue, consentBinding: tokens.consentBinding, now: () => 0 });
  const candidate = catalog.candidates.find(item => item.providerId === 'localhost-run');
  assert.ok(candidate, 'localhost-run is offered');
  assert.doesNotMatch(candidate.disclosure.text, /15 minutes|by default/i);
  assert.notEqual(candidate.disclosure.revision, OLD_REVISION);
  assert.equal(candidate.disclosure.revision, consentDisclosureRevision(adapter.definition));
});

test('an approval made against the old consent revision is refused as stale', async t => {
  const home = await scratch(t), q = hourRequest(home);
  const tokens = tokenStubs();
  const redeem = async revision => {
    const { token } = await tokens.issue({ home, binding: tokens.consentBinding(q, home, revision), grant: { adapterId: 'localhost-run', planDigest: 'unused', observedResource: 'unused' } });
    return redeemApproval({ ...q, approval: { candidateToken: token, disclosureRevision: revision }, wait: 'allocated' },
      { adapters, redeem: tokens.redeem, consentBinding: tokens.consentBinding, platform: 'linux', readContext });
  };
  const stale = revision => assert.rejects(redeem(revision), { code: 'candidate_stale', message: /Consent-relevant facts changed/ });
  await stale(consentDisclosureRevision({ ...adapter.definition, disclosure: { ...adapter.definition.disclosure, revision: OLD_REVISION } }));
  await stale(OLD_REVISION);
  // The current revision passes the revision check; any later refusal is about the provider, not stale consent.
  await redeem(consentDisclosureRevision(adapter.definition)).catch(error => assert.doesNotMatch(error.message, /Consent-relevant facts changed/));
});
