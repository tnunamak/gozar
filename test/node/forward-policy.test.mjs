// The forward contract's internal selector (docs/library-ux.md): pure policy over catalog-shaped
// candidates. Every fixture below mirrors the construction route-catalog.mjs `collect()` performs,
// with capability values copied from the real adapters/providers/*/definition.json files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectForwardCandidate } from '../../packages/gozar-node/forward-policy.mjs';

const traffic = (tlsTermination, providerCanReadPayload) => ({ tlsTermination, providerCanReadPayload,
  readers: [providerCanReadPayload ? 'provider' : 'app'], metadataVisibleTo: ['provider'], evidenceRef: 'fixture' });
const properties = (over = {}) => ({ reach: 'internet', transport: 'https', traffic: traffic('provider', true),
  address: { stability: 'ephemeral', scope: 'fixture', conditions: [], ports: null },
  cost: { kind: 'free', summary: 'Fixture cost.' }, needsAccount: false, lifetimes: ['session'], supervision: 'controller',
  protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'public', checks: ['tls', 'nonce'] }, ...over });
const availability = (over = {}) => ({ session: { state: 'unsupported', reason: 'usage-not-supported' },
  attached: { state: 'unsupported', reason: 'usage-not-supported' },
  durable: { state: 'unsupported', reason: 'usage-not-supported' }, ...over });
const sessionAvailable = availability({ session: { state: 'available', reason: 'admitted' } });
const base = { providerId: 'fixture', ownership: 'gozar-owned', name: 'cand_fixture', preferenceRef: 'pref_fixture',
  rank: 1, eligible: true, unmet: [], display: { label: 'Fixture', description: 'Fixture candidate.', needs: 'Needs fixture prerequisites.' },
  properties: properties(), availability: sessionAvailable, prerequisites: [], facts: [],
  configuration: { values: {}, credentials: {}, actions: [], inputRequirements: [] },
  setup: { state: 'ready', actions: [] }, disclosure: { revision: 'disc-fixture', text: 'Fixture disclosure.', links: [] },
  candidateToken: 'tok_fixture', expiresAt: '2026-11-26T12:00:00.000Z' };
const deepMerge = (baseValue, over) => {
  if (over === undefined) return baseValue;
  if (baseValue === undefined || baseValue === null || Array.isArray(baseValue) || Array.isArray(over) ||
      over === null || typeof over !== 'object' || typeof baseValue !== 'object') return over;
  const out = { ...baseValue };
  for (const key of Object.keys(over)) out[key] = deepMerge(baseValue[key], over[key]);
  return out;
};
const candidate = (over = {}) => deepMerge(base, over);
const envelope = (kind, over) => ({ kind, candidate: candidate(over) });

// tailscale-funnel durable candidate, signed in: the catalog issued a token only after the
// read-only durablePlanFacts observation of the LocalAPI (a Running node with a DNS name).
const funnelDurableReady = (over = {}) => envelope('durable', deepMerge({
  providerId: 'tailscale-funnel', rank: 4, availability: availability({ durable: { state: 'available', reason: 'admitted' } }),
  properties: properties({ traffic: traffic('endpoint', false), needsAccount: true, lifetimes: ['session', 'durable'],
    address: { stability: 'stable', scope: 'tailnet node', conditions: [], ports: null } }) }, over));
// localhost.run anonymous session: needsAccount false, ephemeral address, provider reads the payload.
const localSessionReady = (over = {}) => envelope('session', deepMerge({ providerId: 'localhost.run', rank: 2 }, over));
// tunnl.gg trial: needsAccount true; catalog readiness only proves the local SSH client and key generator.
const tunnlSessionReady = (over = {}) => envelope('session', deepMerge({ providerId: 'tunnl.gg', rank: 3,
  properties: properties({ needsAccount: true,
    address: { stability: 'stable', scope: 'registered installation key', conditions: [], ports: null } }) }, over));
// tailscale-funnel on a machine where setup is still offered: real declared actions exist in setup.actions.
const funnelDurableActionable = (over = {}) => funnelDurableReady(deepMerge({
  eligible: false, setup: { state: 'action-required', actions: [{ id: 'tailscale-setup', kind: 'gozar-runs',
    label: 'Set up Tailscale', help: 'Check the installed CLI, local sign-in, tailnet privileges and available ports.',
    disclosure: { revision: 'disc-fixture', text: 'Fixture disclosure.', links: [] },
    step: { actor: 'machine', permission: { id: 'tailscale-setup', label: 'Set up Tailscale' }, verification: 'host', purpose: 'authorize' },
    digest: 'a6b6e5' }] } }, over));

const row = (provider, kind, missing, policyChanges) => ({ provider, kind, missing, policyChanges });
const unmetRows = result => result.unmet;

test('an already usable lasting route wins over an account-free session, with typed existing-account evidence', () => {
  const result = selectForwardCandidate({ candidates: [localSessionReady(), funnelDurableReady()], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(result.outcome, 'selected');
  assert.equal(result.kind, 'durable');
  assert.equal(result.lifetime, 'lasting');
  assert.equal(result.account, 'existing');
  assert.match(result.accountEvidence, /durablePlanFacts/);
  assert.match(result.accountEvidence, /Running/);
  assert.equal(result.candidate.providerId, 'tailscale-funnel');
});
test('without a lasting route the default falls back to an eligible account-free session', () => {
  const result = selectForwardCandidate({ candidates: [localSessionReady()], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(result.outcome, 'selected');
  assert.equal(result.kind, 'session');
  assert.equal(result.lifetime, 'session');
  assert.equal(result.account, 'account-free');
  assert.equal(result.candidate.properties.needsAccount, false);
});
test('a ready registered-SSH trial is not account evidence and cannot masquerade as anonymous', () => {
  const refused = selectForwardCandidate({ candidates: [tunnlSessionReady()], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(refused.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(refused), [row('tunnl.gg', 'session', ['account'], { accounts: 'allow-setup' })]);
  const allowed = selectForwardCandidate({ candidates: [tunnlSessionReady()], policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
  assert.equal(allowed.outcome, 'selected');
  assert.equal(allowed.account, 'unknown');
  assert.notEqual(allowed.account, 'account-free');
  assert.match(allowed.accountEvidence, /No authenticated-account evidence/i);
});
test('setup readiness without the durable grant receipt is not generic account evidence', () => {
  const grantless = funnelDurableReady({ candidateToken: null });
  const result = selectForwardCandidate({ candidates: [grantless], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(result.outcome, 'requirements_unsatisfied');
  // Allowing setup cannot admit a candidate with no grant receipt and no offered action, so no
  // policy change is suggested for it.
  assert.deepEqual(unmetRows(result), [row('tailscale-funnel', 'durable', ['account', 'ready route'], null)]);
});
test('the developer contract diagnostics example reproduces exactly for a strict lasting request', () => {
  const result = selectForwardCandidate({ candidates: [tunnlSessionReady(), localSessionReady()], policy: { accounts: 'existing-only', lifetime: 'lasting' } });
  assert.equal(result.outcome, 'requirements_unsatisfied');
  assert.equal(result.code, 'requirements_unsatisfied');
  assert.equal(result.nextAction, null);
  assert.equal(result.message, 'No public HTTPS provider meets the requested account and address policy.');
  assert.deepEqual(unmetRows(result), [
    row('tunnl.gg', 'session', ['account', 'lasting route'], { accounts: 'allow-setup', lifetime: 'session' }),
    row('localhost.run', 'session', ['lasting route'], { lifetime: 'session' }),
  ]);
});
test('one real offered setup action is returned; a fictional one never is', () => {
  const real = selectForwardCandidate({ candidates: [localSessionReady({
    eligible: false, setup: { state: 'action-required', actions: [{ id: 'ssh-install', kind: 'instructions',
      label: 'Install the OpenSSH client', instructions: 'Install the OpenSSH client.', disclosure: { revision: 'disc-fixture', text: 'Fixture disclosure.', links: [] },
      step: { actor: 'administrator', permission: { id: 'ssh-install', label: 'Install the OpenSSH client' }, verification: 'host', purpose: 'configure' }, digest: 'b1c2d3' }] } })],
    policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(real.outcome, 'action');
  assert.equal(real.kind, 'session');
  assert.equal(real.account, 'account-free');
  assert.equal(real.action.id, 'ssh-install');
  assert.equal(real.candidate.providerId, 'localhost.run');
  // No offered action in the candidate data: the policy change that would permit setup still cannot
  // admit the provider, so no remedy is invented.
  const fictional = selectForwardCandidate({ candidates: [localSessionReady({ eligible: false, setup: { state: 'action-required', actions: [] } })],
    policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(fictional.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(fictional), [row('localhost.run', 'session', ['ready route'], null)]);
});
test('an account-required setup action is offered only after the caller explicitly allows setup', () => {
  const refused = selectForwardCandidate({ candidates: [funnelDurableActionable()], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(refused.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(refused), [row('tailscale-funnel', 'durable', ['account', 'ready route'], { accounts: 'allow-setup' })]);
  const offered = selectForwardCandidate({ candidates: [funnelDurableActionable()], policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
  assert.equal(offered.outcome, 'action');
  assert.equal(offered.action.id, 'tailscale-setup');
  assert.equal(offered.account, 'unknown');
});
test('detect-only availability is never selected, offered or executed', () => {
  const result = selectForwardCandidate({ candidates: [funnelDurableReady({ availability: { durable: { state: 'detect-only', reason: 'fixture' } } })],
    policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
  assert.equal(result.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(result), [row('tailscale-funnel', 'durable', ['detect-only'], null)]);
});
test('public internet reach, HTTPS transport and known traffic readability are guarded from data', () => {
  const table = [
    ['tailnet reach is not public', funnelDurableReady({ properties: { reach: 'tailnet' } }), ['public-internet-https']],
    ['tcp transport is not the forward contract', funnelDurableReady({ properties: { transport: 'tcp' } }), ['public-internet-https']],
    ['unknown payload visibility blocks selection', localSessionReady({ properties: { traffic: traffic('unknown', null) } }), ['traffic-readability']],
    ['unknown TLS termination blocks selection', localSessionReady({ properties: { traffic: traffic('unknown', false) } }), ['traffic-readability']],
  ];
  for (const [name, entry, missing] of table) {
    const result = selectForwardCandidate({ candidates: [entry], policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
    assert.equal(result.outcome, 'requirements_unsatisfied', name);
    assert.deepEqual(unmetRows(result), [row(entry.candidate.providerId, entry.kind, missing, null)], name);
  }
});
test('the usage kind comes from the typed envelope or the consent scope, never from address stability', () => {
  const consentScoped = candidate({ providerId: 'localhost-run', consent: { scope: { kind: 'route', providerId: 'localhost-run',
    query: { usage: { kind: 'session' }, reach: 'internet', transport: 'https', target: '127.0.0.1:8080', expectedOrigin: null } } } });
  const fromScope = selectForwardCandidate({ candidates: [consentScoped], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(fromScope.outcome, 'selected');
  assert.equal(fromScope.kind, 'session');
  // A stable address with no typed kind is not a lasting route; no lifetime is guessed.
  const stableNoKind = candidate({ providerId: 'mystery-stable', properties: properties({ needsAccount: false,
    address: { stability: 'stable', scope: 'fixture', conditions: [], ports: null } }) });
  const guessed = selectForwardCandidate({ candidates: [stableNoKind], policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
  assert.equal(guessed.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(guessed), [row('mystery-stable', null, ['usage'], null)]);
  const attached = selectForwardCandidate({ candidates: [envelope('attached', candidate({ providerId: 'ngrok-https-edge', properties: properties({ needsAccount: true }) }))],
    policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
  assert.equal(attached.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(attached), [row('ngrok-https-edge', 'attached', ['usage'], null)]);
});
test('ranking inside a policy tier follows the catalog rank and the tier order follows the lifetime policy', () => {
  const late = localSessionReady({ rank: 2 }), early = localSessionReady({ rank: 1, candidateToken: 'tok_early' });
  assert.equal(selectForwardCandidate({ candidates: [late, early] }).candidate.candidateToken, 'tok_early');
  // A lasting route outranks a better-ranked session under prefer-lasting.
  const prefer = selectForwardCandidate({ candidates: [localSessionReady({ rank: 1 }), funnelDurableReady({ rank: 7 })] });
  assert.equal(prefer.candidate.providerId, 'tailscale-funnel');
  // An explicit session policy ignores the ready durable route.
  const sessionOnly = selectForwardCandidate({ candidates: [localSessionReady({ rank: 5 }), funnelDurableReady({ rank: 1 })], policy: { lifetime: 'session' } });
  assert.equal(sessionOnly.candidate.providerId, 'localhost.run');
  // A strict lasting policy refuses the session and explains every provider.
  const lasting = selectForwardCandidate({ candidates: [localSessionReady({ rank: 1 })], policy: { lifetime: 'lasting' } });
  assert.equal(lasting.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(lasting), [row('localhost.run', 'session', ['lasting route'], { lifetime: 'session' })]);
});
test('unknown and unavailable observations stay unknown and never count as eligible', () => {
  const table = [
    ['a failed probe leaves the state unknown', localSessionReady({ eligible: false, setup: { state: 'unknown', actions: [] }, unmet: [{ requirement: 'setup', actual: { known: false, reason: 'observation_unavailable' }, reasonCode: 'unknown' }] }), ['ready route']],
    ['host-denied setup is not ready', localSessionReady({ eligible: false, setup: { state: 'unsupported', actions: [] } }), ['ready route']],
    ['an eligible candidate without its issued token is not usable now', localSessionReady({ candidateToken: null }), ['ready route']],
  ];
  for (const [name, entry, missing] of table) {
    const result = selectForwardCandidate({ candidates: [entry], policy: { accounts: 'allow-setup', lifetime: 'prefer-lasting' } });
    assert.equal(result.outcome, 'requirements_unsatisfied', name);
    assert.deepEqual(unmetRows(result), [row('localhost.run', 'session', missing, null)], name);
  }
});
test('the why-not list covers every considered provider, including unsupported and unknown ones', () => {
  const result = selectForwardCandidate({ candidates: [
    funnelDurableReady({ properties: { reach: 'tailnet' } }),               // tailscale-private shape: not public
    tunnlSessionReady(),                                                   // account-required, no evidence
    envelope('attached', candidate({ providerId: 'ngrok-https-edge', properties: properties({ needsAccount: true }) })),
    candidate({ providerId: 'lan-relay', properties: properties({ reach: 'lan', transport: 'http' }) }),
    candidate({ providerId: 'own-address', ownership: 'external-owned', properties: properties({ needsAccount: null, traffic: traffic('unknown', null) }) }),
  ], policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
  assert.equal(result.outcome, 'requirements_unsatisfied');
  assert.deepEqual(unmetRows(result), [
    row('tailscale-funnel', 'durable', ['public-internet-https'], null),
    row('tunnl.gg', 'session', ['account'], { accounts: 'allow-setup' }),
    row('ngrok-https-edge', 'attached', ['usage'], null),
    row('lan-relay', null, ['usage'], null),
    row('own-address', null, ['usage'], null),
  ]);
});
test('the selector is effect-free: inputs are never mutated and repeated calls agree', () => {
  const candidates = [funnelDurableReady(), localSessionReady(), tunnlSessionReady()];
  const policy = { accounts: 'existing-only', lifetime: 'prefer-lasting' };
  const before = structuredClone({ candidates, policy });
  const first = selectForwardCandidate({ candidates, policy });
  assert.deepEqual({ candidates, policy }, before);
  const second = selectForwardCandidate({ candidates, policy });
  assert.deepEqual(first, second);
  assert.equal(first.candidate, candidates[0].candidate);
});
test('invented policy values and malformed input fail closed with the typed input error', () => {
  for (const [name, request] of [
    ['unknown accounts policy', { candidates: [], policy: { accounts: 'anyone' } }],
    ['unknown lifetime policy', { candidates: [], policy: { lifetime: 'forever' } }],
    ['non-array candidates', { candidates: 'catalog', policy: {} }],
    ['envelope without a candidate object', { candidates: [{ kind: 'session', candidate: null }] }],
    ['primitive candidate entry', { candidates: ['tok'] }],
    ['missing request', undefined],
  ]) assert.throws(() => selectForwardCandidate(request), { code: 'invalid_input' }, name);
});
test('an empty catalog is a complete requirements_unsatisfied answer, not a crash or a default route', () => {
  const result = selectForwardCandidate({ candidates: [] });
  assert.equal(result.outcome, 'requirements_unsatisfied');
  assert.deepEqual(result.unmet, []);
  assert.equal(result.nextAction, null);
});
