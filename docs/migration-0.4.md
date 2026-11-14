# Migrating from 0.3 to 0.4

Depend on `^0.4.0`. Query/request schemaVersion stays 1. Catalog and RouteView
responses use 2, including routes nested in watch events. Update checks/mocks.

## Approval and configuration

- Candidate.consent is the complete redacted
  {scope,consentFactsDigest,facts,disclosures} snapshot; its top-level digest agrees.
  Show consent facts and typed disclosures. Route approval now requires
  kind:'route' and consentFactsDigest alongside candidateToken/disclosureRevision.
- Offered setup actions carry their own setup-scoped snapshot. Setup approval
  requires kind:'setup', consentFactsDigest, digest and disclosureRevision.
  A candidate token does not authorize setup. Old approval tuples are refused.
- runSetupAction requires providerId and expectedConfigurationRevision; use the
  same owner as the catalog. Optional draftId selects a staged configuration.
  Configuration adds opaque revision/scopeId; InputRequirement adds actionId.
  An input ID can differ from its action ID. Descriptors use kind, secret,
  required, help and obtainUrl; there is no fields API. Hosts choose their UI.
- Root/factory storeSecret({home,value}) is replaced by
  {home,owner?,providerId,inputId,scopeId,expectedConfigurationRevision,draftId?,bytes}.
  It returns {handle,configurationRevision,scopeId} only to the trusted host.
  Intake does not advance configuration. Presence is not token validity.
- Setup results add configurationRevision, scopeId and the actual fresh
  configuration. Pending/blocked results do not claim a revision advance.
  Unbound staged credentials need explicit discardSecret; do not depend on the
  older implicit deletion behavior.
- Applied setup and draft commit return configuration_in_use while a starting,
  live or uncertain runtime retains that scope. Use beginConfigurationDraft,
  approved draft setup, stop, then commitConfigurationDraft. Old bindings survive
  failed drafts/CAS. readConfigurationDraft restores current actions/snapshots
  after a restart without advancing revision.
- clearConfigurationInput redeems an offered clear-input action for a draft.
  After commit, discardSecret deletes only an owned, unreferenced local secret.
  Neither close nor discard revokes provider credentials.

The default backend imports checked ownerless 0.3 setup references on first read.
Named-owner import returns configuration_migration_required; choose an explicit
migration instead of claiming an old ownerless credential. Custom backends never
import or mirror file-backed bytes. Registry identity includes trusted code/data
and excludes installation paths; changed registries have different scopes.

## Routes and proof

- availability[usage.kind] separates available, detect-only and unsupported.
  setup.state adds detect-only. Installation does not admit execution; detect-only
  choices receive no token. Shipped 0.4 execution is HTTP(S) only. Raw TCP/TLS
  profiles stay visible/detect-only; protocol-neutral trusted extensions remain.
  Update exhaustive transport switches for tcp/tls.
- cleanup.state:'debt' becomes 'unconfirmed'; successful removal is 'confirmed'.
  cleanup_debt remains an error code. Follow cleanup.nextAction and retry the same
  closeRoute handle. An acknowledgement/missing map does not prove remote absence.
  Stop never removes owner DNS/domains or automatically destroys credentials.
- RouteView adds facts, routeState, expiresAt, hostConfiguration, binding,
  operationId, verification.observedAt/subject/validUntil and per-check results.
  Update constructed mocks. Unknown subject cannot publish; old unbound proof
  stays historical. Expiry withdraws publication; unknown expiry is not permanence.
- Proof subject binds origin, target, instanceId, handleGeneration and the actual
  controller bootId. checkedAt/observedAt are proof times, never render times.
  Replacement controllers obtain fresh boots even when their factory survives.
- Runtime consent drift withdraws publication and emits consent_changed.
  reviewRouteConsent returns current facts/disclosures/subject plus a short-lived
  token; approveRouteConsent safely reproves that same generation. Changed
  facts/config/subject require new review. Initial-only proof returns
  proof_refresh_unsupported; stop stays available.
- Minimal legacy Rust recipe publication is excluded from public host/CLI paths.
  Stop/reconcile old resources, then start an admitted operational plan. A service
  host-command check is not nonce-bound transport proof and cannot publish through
  RouteView. The stronger operational checks remain.

Journal operationId before expose/ensureRoute for crash recovery. Reservation and
stable handle precede effects. Same intent/key returns its original current
handle/recovery view; changed intent gives operation_conflict. Uncertainty never
reissues create; stopped-key replay is terminal. Legacy operationId is null.
listRoutes({home,owner?}) includes partial allocations and retained cleanup.
Its read-only historical snapshots do not renew publication; ask routeStatus for
current proof. Unreadable state is an error, not an empty success.

## Host integration and CLI

Use one configured createGozar factory for setup/runtime. Its secretBackend stays
in the host; authenticated scoped IPC serves detached controllers. Resolver loss
withdraws availability; host bytes never enter Gozar files, argv, env or bootstrap.
listProviders discovers every audience without minting tokens. Recatalog an exact
query before approval. Required host capability IDs are open strings. Absent means
unknown (host-capability-undeclared) and unsupported, not missing software.
install-artifact needs host authority, setup consent and matching bytes before
execution. binding reports observed forwarding; a requested target is not evidence.

Render facts by group; show every affectsConsent:true row. Never branch on fact
IDs or parse display, disclosure.text or message. A local-observation:/json/pointer
source fills a row from existing detection data. Missing is unknown; false, zero,
empty string and null remain values. Provider-call facts say
known:false,reason:'needs-provider-call'. Legacy nullable traffic members remain
compatibility projections; null is unknown. New display details belong in facts.

CLI setup now needs --query-file and a selected --provider-id, with current setup
approval metadata in its private approval file. configure prompts from descriptors.
Recovery commands are routes, route-status, close, review-consent, approve-consent.
Approval and secret files remain private.

The shipped screen takes exactly --fakes or --detect; the latter is real read-only
detection and creates no route. Both remove a private home under ~/.tmp.
Use the explicit @tnunamak/gozar/testing effects factory for real-adapter fixtures:
no ambient flag or real-provider fallback. See [embedding API](embedding-contract.md)
and [effect contracts](testing-effects.md).


## 0.3.4 upgrade checklist and release coupling

1. Upgrade the CLI/library/core/contracts and host bindings together to 0.4.0;
   do not mix installed components across releases. Keep a private recoverable
   copy of the old state and record existing route handles before cutover.
2. Stop/reconcile owned old routes before replacing controllers. Preserve
   owner-managed resources and unconfirmed cleanup; do not infer absence from
   process exit or a missing local map.
3. Keep old approvals/proofs as history only. Recatalog with the exact owner,
   target, usage and current configuration; show the full typed consent snapshot
   and obtain new setup/route approvals. Never upgrade an old tuple silently.
4. Import ownerless legacy references only through the documented default-backend
   path above. Named ownership requires explicit migration; custom backends do
   not import those credentials.
5. Persist intent and operationId before allocation, then retain every returned
   or error handle. Recover with listRoutes and current routeStatus; do not
   generate a fresh operation ID merely to retry an ambiguous create.
6. Verify the installed host against current public types before exposing real
   traffic. See the public-consumer sample in [embedding guide](embedding-contract.md).

The historical 0.1.x notes describe the legacy session interface and unpublished
durable experiments at that time. They are not a statement that only 0.1.x is
currently available, nor proof of 0.4 live maturity. Offline fixtures do not
validate real accounts, provider limits, network reach or remote cleanup.
Route close retains credentials and does not remove provider-owned DNS/domains.
