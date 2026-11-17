# 0.4 interface coverage against the round-4 survey

Survey revision: `ae83f3d71954d4220da77b80e62ddb0f859ef323` in the
`divan` repository. This map uses that revision's five provider profiles,
failure-evidence survey, non-tunnel posture extension and descriptor-schema
extension. It does not substitute the older 72-row review for those inputs.
The release report binds this map to an integrated Gozar commit and tarball.

These are semantic coverage claims, not live-provider results. A documented
provider feature is not proof that the selected account enables it. The survey
does not establish saturation. The primary-review counts supplied for this map
are 329 unknown of 441 failure-survey cells (7 items × 63 dimensions), with 112
evidenced and 0 not applicable. The 319 listed sources include 306 unique
historical issue openers and 13 non-issue sources; bodies were inspected unevenly.
These issue openers are not confirmed current regressions.

The six posture rows are only a bounded zero-new tail, not population saturation;
five further candidates remain unexamined. The descriptor matrix has 468 cells
(12 × 39): 92 sourced and 376 unknown. Nine NEW candidates are proposed, not
certified; Nango remains unresolved, not zero, and 89 S entries await atomic
review. There is no certified three-item-zero tail and no exhaustive or saturated
schema claim.

## Public representations

| Survey concern | Public API representation and evidence | Limit or gap |
| --- | --- | --- |
| Audience, payload readers, stable address, cost category | `Candidate.properties` typed reach/traffic/address/cost; `consent.disclosures` contains the exact approved typed values | A reach label is a declared posture, not proof of every visitor's route or identity |
| Conditions, detailed price/terms, browser warning, account restrictions | Open `facts`; `cost-detail`, `address-condition-*`, `terms-*`, `browser-warning`, `entitlement`, `quota` | Numeric plan quotas, selected-account entitlements and private contracts are not inferred; provider-call facts stay unknown |
| Local prerequisites and host authority | `prerequisites` with observed state, observation/version and remedy; `inputRequirements`; required host capability absent → unsupported with `host-capability-undeclared` | Existing provider definitions do not yet declare every possible host capability; the generic path is checked by `public-artifact-capabilities.test.mjs` |
| Newly discovered property | Adapter definition `facts` rows; optional `local-observation:/pointer` resolves an existing scalar observation | No closed property ontology. New rows require data changes; no new core field, renderer branch or schema shape |
| Secret custody, setup, edits and rotation | Factory backend callbacks, scoped intake, redacted credential observations, persisted drafts and fresh action consent snapshots | Presence means stored bytes, not validity. Local replacement/discard does not revoke a remote credential |
| Consent drift and authority | Full action/route snapshots; canonical consent-v1 digest; same-generation review/redeem | Every consent row must be shown. Caller-supplied display facts do not grant authority; drift withdraws publication |
| Target, incarnation and proof freshness | `verification.subject`, `observedAt`, `checkedAt`, `validUntil`, vantage and check results; `binding` separates observed target from requested intent | Transport proof does not prove login, upstream application identity or an application journey. Disk enumeration never renews proof |
| Failure after partial effects | `error.route`, stable handles, operation reservation before effects, retained receipts/intents, cleanup unconfirmed and exact retry | Unknown create/late results remain uncertain. There is no universal provider rollback guarantee |
| Restart/crash recovery | `operationId`, `listRoutes({home,owner})`, idempotent replay, terminal key replay | Records must be readable; unreadable state is an error, not empty success. Listing is historical recovery evidence |
| Cleanup authority and absence | Ownership-scoped removal plus exact runtime/config read-back; `cleanup.state` and `nextAction` | A close RPC/exit 0 alone is not confirmed absence. Account registrations, names, DNS and credential revocation may remain owner-owned |

## Execution authority and observation boundaries

The manifest's `activeDrop1a`, `nextDrop` and `operationalCatalog` are historical
projection groupings, not the authoritative current executable inventory. Keep
them as historical groups. Execution authority comes from the registered adapter
definition, runtime admission and the current public catalog for the requested
usage, host capabilities, configuration and audience. Manifest inclusion alone
does not grant admission; its warning explicitly requires feature negotiation.

For example, `adapters/manifest.json` registers Cloudflare named's definition and
runtime even though `nextDrop` still names it. The registered definition declares
attached availability as available/admitted, while session and durable usage are
unsupported. Its runtime implements attached planning, owned connector start,
proof preparation and cleanup. `named-lifecycle.test.mjs` exercises owned start,
incomplete-input refusal and unconfirmed cleanup with injected local fixtures.
Those facts establish implemented attached behavior, not live success or admission
for every audience/usage. Named protocol metadata correction is separately queued;
this map does not claim that correction shipped on this base. Raw ngrok TLS/TCP
remain detect-only.

Static definition prerequisites are shorthand lookup descriptors. Runtime
`prerequisitesFor` projects detected facts into present/missing/denied/unknown
with observation time, version and remedy; runtime observation fields should not
be duplicated into static data. A displayed per-dimension fact row and implemented
runtime behavior are different evidence. Missing individual fact IDs remain gaps,
but do not disprove target bindings, SSH process identities or SDK error mapping
outside that row review. `known: true` is not a blanket claim of runtime
observation: documented features and valid not-applicable classifications retain
their own provenance. A true not-applicable classification need not become unknown
merely to match an unrelated provider-call fact.

## Provider profiles

| Profile at the pinned survey revision | Shipped mapping | Open coverage gaps |
| --- | --- | --- |
| Tailscale Funnel and Serve | Separate internet/tailnet properties; address conditions, public names/certificate-log facts; source-shaped local API observations and exact conditional rule ownership; nonce/stream proof and service challenge paths | Admin/all-interface overrides, current ACLs, live key revocation/drain, sleep/roaming continuity, numerical bandwidth/stream/body/time limits and retention are not certified. Config presence is not public DNS/TLS/app proof |
| Cloudflare named | Attached owned connector; token/origin/gate-port descriptors; DNS/tunnel prerequisites stay owner-managed; edge payload readers; cleanup-ownership, connector-redundancy, connector-pq-policy, access-policy-boundary and quick-tunnel-limits facts | Actual transport/PQ policy, replicas, Access policy, account capacity, DNS/zone state and token rotation impact are unknown. No Quick Tunnel concurrency/SSE limits are copied to named tunnels. Gozar does not create/delete remote tunnel or DNS registration |
| ngrok HTTPS/TLS/TCP | HTTPS SDK lifecycle, assigned development-domain help, conditional free HTML interstitial, safe 105/108/8013 diagnostics; raw profiles are detect-only with public-plan-requirement facts | No raw TCP/TLS execution admitted in 0.4. Live account/legacy plan grants, drain/half-close/multiplexing, credential cutoff and account agent capacity remain unknown. Agent count is not endpoint count |
| localhost.run and tunnl.gg | Separate session/address conditions and payload readers; source parser, SSH process identity, key lease and rotation evidence; unsupported execution exposed as detect-only where appropriate | Hosted versus self-hosted policy is not merged. Free quota basis and paid name-retention conflicts remain unresolved; exact speed, retention, stream/body limits and account selection are not universally represented as individual sourced rows |
| LAN and own address | Separate local reach and owner-kept ingress; local bind/port observations, target binding with authority/remedy, subject-bound service challenge and owner-only record withdrawal | IPv4 versus IPv6, firewall runtime/persistence, discovery withdrawal, certificate renewal/retirement and upstream/application authorization are separate host responsibilities. The contract does not yet carry an individual observed row for each of these dimensions |

HTTP(S)-only executable admission is Lead's 0.4 decision to ship the embedding
contract together. Raw profiles remain visible as detect-only; the independent
fixture still declares non-HTTP proof through the protocol-neutral extension seam.
The operator may revisit scope in the owner walk. No production account was used
to settle these rows.

The Funnel and Serve cost categories must be read separately, not as one shared
price or selected-account entitlement. Their private/public audience distinction
does not remove certificate-transparency name disclosure: the primary profile
review records it for both Funnel and Serve. Cloudflare's documented connector-link
count is distinct from an unobserved deployed replica count; those are not
contradictory observations. Stable/documented features do not prove deployment in
the selected account.

On this base, localhost.run execution is available while tunnl.gg is detect-only.
Their shared profile row above describes representation and evidence, not equal
execution admission; queued tunnl execution is not shipped behavior. Individual
unrepresented limits remain gaps even where the underlying runtime is implemented.

## Cross-profile extensions and negative evidence

The six additional non-tunnel postures are survey evidence, not six newly admitted
providers. Their partial-configuration-failure dimension remains an explicit gap:
Gozar proves local configuration transactions and retains a known partial remote
write, not atomic rollback for all upstream systems.

The descriptor extension's proposed dimensions map as follows: input array order
is preserved; hosts own presentation and synchronization; syntax validation is
local; provider/registry/owner configuration scope is explicit; the configuration
CAS is tested. Cross-package schema federation, arbitrary normalization pipelines,
resource identity migration and runtime parameterized specialization are not
implemented. Registry content identity and wrapped/no-wrap data authority are
implemented; they do not imply a schema ecosystem or saturated vocabulary.

Failure evidence is exercised by `public-consent-drift`, `operation-recovery`,
`real-adapter-testing-effects`, `real-session-testing-effects`,
`real-durable-testing-effects`, `host-controller-configuration`, `sdk-lifecycle`
and the protocol proof tests. These checks cover specific synthetic failures and
real local sockets. They do not reproduce all 306 historical issue openers or
verify a public provider's present behavior.

Release acceptance still requires DataConnect's public installed-package journey
and the final integrated gate. This document records the available mapping and
gaps; it does not declare either acceptance result.
