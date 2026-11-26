// The internal selector behind the proposed `forward` contract (docs/library-ux.md). It is one pure
// function over catalog-shaped candidates: no I/O, no provider effects, no tokens minted here, no
// mutation of its input, no provider-name branches. The public `forward` API will hide catalog data;
// this module only expresses the account and lifetime policy over what the catalog already observed.
//
// --- Input ---------------------------------------------------------------------------
// selectForwardCandidate({ candidates, policy })
//   policy (optional, whole-object default { accounts: 'existing-only', lifetime: 'prefer-lasting' }):
//     accounts  'existing-only'  only candidates that need no account, or whose existing account
//                               Gozar actually observed, may be selected or offered (default).
//                 'allow-setup'  the caller explicitly accepts provider setup: candidates whose
//                               account standing is unknown become selectable, and their real
//                               offered setup actions may be returned. Never a claim that sign-in
//                               already succeeded.
//     lifetime  'prefer-lasting'  a ready durable-kind route first, then a ready session (default).
//                 'lasting'        only a durable-kind route.
//                 'session'        a session or attached route, not a persistent provider rule.
//   candidates: an array built by flattening catalogRoutes/buildCatalog output over the supported
//     forward usage kinds. Each entry is either
//       - a typed envelope { kind: 'durable' | 'session' | 'attached', candidate }, or
//       - a bare catalog candidate, whose kind is read from candidate.consent.scope.query.usage.kind.
//     The kind is never guessed from address stability, `lifetimes` or any other display fact: an
//     entry without a typed kind lands in diagnostics as 'usage'.
//   A candidate is the object route-catalog.mjs `collect()` returns: providerId, ownership, rank,
//     eligible, unmet, properties (reach/transport/traffic/address/needsAccount/...), availability
//     (per-kind state), setup { state, actions }, candidateToken, and optionally consent.
//
// --- Account evidence (the exact seam) ------------------------------------------------
// The catalog issues candidateToken for an eligible, ready candidate only after its read-only grant
// path succeeded. For a Gozar-owned durable candidate that path is durablePlanFacts -> the adapter's
// durable facet observe -> for the current durable adapters the provider LocalAPI: a node status
// whose BackendState is 'Running' with the node's DNS name (a signed-in node identity), a serve
// config readable with an ETag, and the node's capability ports. A token on such a candidate is
// therefore genuine evidence that an authenticated provider session exists on this machine now
// (account standing 'existing'). It does not establish a specific account email, tailnet
// entitlement, or anything about any other candidate shape: a session-kind grant is computed
// locally (the adapter's plan and observe make no provider call), and a session candidate whose
// setup state is 'ready' with needsAccount true - for example an SSH trial with the client and key
// generator detected - proves only local prerequisites, never a registered account. That standing
// is 'unknown': not eligible under 'existing-only', never relabeled 'account-free'.
//
// --- Result ---------------------------------------------------------------------------
//   { outcome: 'selected', kind, lifetime: 'lasting' | 'session',
//     candidate }
//     The best catalog-ranked candidate usable now: eligible, setup.state 'ready', an issued
//     candidateToken, public internet reach over HTTPS, known traffic readability, and an account
//     standing the policy admits. `candidate` is the input object by reference, unmodified.
//   { outcome: 'action', kind, lifetime, candidate, action }
//     The best catalog-ranked candidate whose own setup.actions are currently offered
//     (setup.state 'action-required' with a non-empty list); `action` is the first offered action.
//     Offered for account-free candidates under any accounts policy, and for all others only after
//     the caller explicitly set accounts: 'allow-setup'. A candidate that offers nothing real is
//     never turned into a fictional step.
//   { outcome: 'requirements_unsatisfied', code: 'requirements_unsatisfied', message, unmet, nextAction: null }
//     One row per considered entry, in input order: { provider, kind, missing, policyChanges }.
//     `missing` is a closed vocabulary of observed facts: 'usage' (no typed forward kind, or the
//     kind is unsupported), 'detect-only' (never executed), 'public-internet-https', 'traffic-
//     readability' (payload visibility unknown), 'account' (account required, no existing-account
//     evidence, existing-only policy), 'ready route' (not usable now), 'lasting route' / 'session
//     route' (cannot serve the requested lifetime). `policyChanges` names the minimal explicit
//     alternative the caller may retry with, only when that alternative would admit THIS candidate
//     as a selection or a real offered action given the current data; otherwise null. It is never
//     applied, and never suggested when the change still cannot admit the provider.
//   Anything structurally invalid (invented policy values, non-array candidates, malformed
//     envelopes) throws the typed { code: 'invalid_input' } error; unknown data values inside an
//     otherwise valid candidate stay conservative and land in diagnostics.
import { gozarError } from './error-normalizer.mjs';

const ACCOUNT_POLICIES = ['existing-only', 'allow-setup'];
const LIFETIME_POLICIES = ['prefer-lasting', 'lasting', 'session'];
const FORWARD_KINDS = ['durable', 'session', 'attached'];
const bad = why => { throw gozarError('invalid_input', `Invalid forward policy request: ${why}`); };

/** The typed kind of one entry: the envelope's kind, or the candidate's consent scope. Never guessed. */
function entryOf(item, index) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) bad(`candidate ${index} must be an object`);
  if (typeof item.kind === 'string' && item.candidate !== undefined) {
    if (item.candidate === null || typeof item.candidate !== 'object' || Array.isArray(item.candidate))
      bad(`envelope ${index} must carry a candidate object`);
    return { kind: item.kind, candidate: item.candidate };
  }
  const scoped = item.consent?.scope?.query?.usage?.kind;
  return { kind: typeof scoped === 'string' ? scoped : null, candidate: item };
}

/** Account standing from observed data only: the durable grant receipt, or the declared account-free mode. */
function standingOf({ kind, candidate }) {
  if (candidate.properties?.needsAccount === false) return 'account-free';
  if (candidate.properties?.needsAccount === true && kind === 'durable' && candidate.ownership === 'gozar-owned' && candidate.eligible === true &&
      candidate.setup?.state === 'ready' && typeof candidate.candidateToken === 'string' && candidate.candidateToken) return 'existing';
  return 'unknown';
}

const usableNow = candidate => candidate.eligible === true && candidate.setup?.state === 'ready' &&
  typeof candidate.candidateToken === 'string' && candidate.candidateToken;
const trafficKnown = candidate => { const t = candidate.properties?.traffic ?? {};
  return typeof t.providerCanReadPayload === 'boolean' && ['endpoint', 'provider'].includes(t.tlsTermination); };

/** The observed facts that keep one entry from serving this policy. Closed vocabulary, fixed order. */
function missingFacts({ kind, candidate, standing }, { accounts, lifetime }) {
  if (!FORWARD_KINDS.includes(kind)) return ['usage'];
  const available = candidate.availability?.[kind]?.state;
  if (available === 'detect-only') return ['detect-only'];
  if (available !== 'available') return ['usage'];
  const missing = [];
  if (candidate.properties?.reach !== 'internet' || candidate.properties?.transport !== 'https') missing.push('public-internet-https');
  if (!trafficKnown(candidate)) missing.push('traffic-readability');
  if (standing === 'unknown' && accounts === 'existing-only') missing.push('account');
  if (!usableNow(candidate)) missing.push('ready route');
  if (kind !== 'durable' && lifetime === 'lasting') missing.push('lasting route');
  if (kind === 'durable' && lifetime === 'session') missing.push('session route');
  return missing;
}

/** Does this entry currently offer a real setup step this policy may return? */
function actionable({ kind, candidate, standing }, { accounts, lifetime }) {
  if (!FORWARD_KINDS.includes(kind) || missingFacts({ kind, candidate, standing }, { accounts, lifetime }).some(
    fact => ['usage', 'detect-only', 'public-internet-https', 'traffic-readability', 'lasting route', 'session route'].includes(fact))) return false;
  if (accounts === 'existing-only' && standing !== 'account-free') return false;
  return candidate.setup?.state === 'action-required' && Array.isArray(candidate.setup.actions) && candidate.setup.actions.length > 0;
}

/** The minimal explicit alternative that would admit this candidate (as a selection or a real action). */
function policyChangesFor(entry, policy) {
  const admits = alternative => missingFacts(entry, { ...policy, ...alternative }).length === 0 ||
    actionable(entry, { ...policy, ...alternative });
  const accountChange = policy.accounts === 'existing-only' ? { accounts: 'allow-setup' } : null;
  const lifetimeChange = { lifetime: policy.lifetime === 'session' ? 'prefer-lasting' : 'session' };
  const singles = [accountChange, lifetimeChange].filter(Boolean);
  for (const change of singles) if (admits(change)) return change;
  const pair = accountChange ? { ...accountChange, ...lifetimeChange } : null;
  return pair && admits(pair) ? pair : null;
}

const byRank = (a, b) => (rankKey(a) - rankKey(b)) || a.index - b.index;
const rankKey = ({ entry }) => Number.isSafeInteger(entry.candidate?.rank) && entry.candidate.rank > 0 ? entry.candidate.rank : Infinity;

export function selectForwardCandidate({ candidates, policy = {} } = {}) {
  if (arguments.length === 0 || arguments[0] === undefined) bad('a request object is required');
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) bad('policy must be an object');
  for (const key of Object.keys(policy)) if (!['accounts', 'lifetime'].includes(key)) bad(`unknown policy field ${key}`);
  const accounts = policy.accounts ?? 'existing-only';
  const lifetime = policy.lifetime ?? 'prefer-lasting';
  if (!ACCOUNT_POLICIES.includes(accounts)) bad('accounts must be existing-only or allow-setup');
  if (!LIFETIME_POLICIES.includes(lifetime)) bad('lifetime must be prefer-lasting, lasting or session');
  if (!Array.isArray(candidates)) bad('candidates must be an array of catalog candidates or typed envelopes');

  const entries = candidates.map((item, index) => {
    const entry = entryOf(item, index);
    entry.standing = standingOf(entry);
    return { entry, index };
  });
  const activePolicy = { accounts, lifetime };
  const tiers = lifetime === 'session' ? [['session', 'attached']] : lifetime === 'lasting' ? [['durable']] : [['durable'], ['session', 'attached']];
  const qualified = kinds => entries.filter(({ entry }) => kinds.includes(entry.kind) &&
    missingFacts(entry, activePolicy).length === 0).sort(byRank);

  for (const kinds of tiers) {
    const [best] = qualified(kinds);
    if (best) return { outcome: 'selected', kind: best.entry.kind, lifetime: best.entry.kind === 'durable' ? 'lasting' : 'session',
      candidate: best.entry.candidate };
  }
  for (const kinds of tiers) {
    const [best] = entries.filter(({ entry }) => kinds.includes(entry.kind) && actionable(entry, activePolicy)).sort(byRank);
    if (best) return { outcome: 'action', kind: best.entry.kind, lifetime: best.entry.kind === 'durable' ? 'lasting' : 'session',
      candidate: best.entry.candidate, action: best.entry.candidate.setup.actions[0] };
  }
  return { outcome: 'requirements_unsatisfied', code: 'requirements_unsatisfied',
    message: 'No public HTTPS provider meets the requested account and address policy.', nextAction: null,
    unmet: entries.map(({ entry }) => ({ provider: typeof entry.candidate.providerId === 'string' ? entry.candidate.providerId : null,
      kind: entry.kind, missing: missingFacts(entry, activePolicy), policyChanges: policyChangesFor(entry, activePolicy) })) };
}
