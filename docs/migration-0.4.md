# Migrating from 0.3.4 to 0.4

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
- Historical 0.3 root/factory storeSecret({home,value}) is replaced by
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

The default backend imports checked ownerless 0.3 setup references on first read
ONLY when owner is omitted. It never silently assigns them to a named owner:
a named-owner import returns configuration_migration_required. Custom backends
never import or mirror file-backed bytes. Registry identity includes trusted
code/data and excludes installation paths; changed registries have different scopes.

### Move an ownerless installation to a named app by re-intake

There is no migration API or import command for assigning legacy bindings to a
named owner. Do not copy or manually edit private configuration/binding files.

1. Retain the old private home and its credential bytes. Through the recorded
   original owner/installation, close or reconcile the old exact runtimes and
   confirm owned resource removal. An unconfirmed cleanup is an explicit refusal
   to proceed: retain its handle/state and retry its public cleanup action.
2. Create a NEW private Gozar home for the named app. In a new query file, set
   `home` to that directory and `owner` to the app's stable name. Use that same
   named owner in every new query, setup request and configuration draft.
3. Select the provider from a fresh catalog and configure/re-enter its credential
   through the current public input requirements. For a local installation:
   `./node_modules/.bin/gozar configure --query-file new-query.json --provider-id PROVIDER --json`.
   Here `new-query.json` selects the NEW home and named owner; PROVIDER is the
   selected catalog ID. The configured factory's trusted host may instead perform
   scoped secret intake and approve the offered setup action with its fresh revision.
4. Obtain fresh route approval for that exact query, then start the new route.
   An old credential reference or old proof is not new-owner authority.

Keep old state and bytes until both cleanup and deletion authority are established.
Use public discard only for an owned, unreferenced handle; never erase evidence to
force migration. Closing or discarding does not automatically revoke a provider
credential, remove owner-managed DNS/tunnels, or migrate a custom backend.

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

## Upgrade and qualification checklist

Ship the library, CLI, types and host integration as one qualified 0.4 boundary;
do not pair a 0.3.4 approval producer with a 0.4 consumer. Update request mocks
and catalog/RouteView response mocks together. Keep the existing public draft
journey as a regression oracle for reload, same-scope consent and fresh revision
results; it is not evidence of live account acceptance.

The host capability vocabulary starts with `installer.execute`,
`privilege.elevate`, `secrets.backend`, `runtime.attached` and
`runtime.durable`. Preserve additional IDs as open data. A denied capability is
not an absent executable; an undeclared capability cannot grant authority.
Never branch UI behavior on a literal provider ID. Use typed properties for
computation and open facts for display, not a second provider-specific schema.

For a project-local installation, invoke the owned local executable rather than
assuming a global command. Here FILE, ID and HANDLE are your existing request,
selected catalog ID and retained handle file; these commands are examples, not
an instruction to start a route:

```sh
./node_modules/.bin/gozar catalog --query-file FILE --provider-id ID --json
./node_modules/.bin/gozar configure --query-file FILE --provider-id ID --json
./node_modules/.bin/gozar routes --home DIR --owner OWNER --json
./node_modules/.bin/gozar route-status --handle-file HANDLE --json
./node_modules/.bin/gozar close --handle-file HANDLE --json
```

Configure collects descriptor inputs; it does not expose a route. Explicit setup
uses the current setup approval, while expose/ensure use route approval. Keep
provider credentials out of argv/env/logs; private approval files contain issued
authority, not provider credential values. Library callers keep custom backend
custody in their configured factory rather than assuming CLI file-store custody.

Linux and macOS require Node.js 22.13 or newer. Support is not a blanket live
qualification for all providers, architectures or accounts. Offline Node/Rust
gates, installed host integration, secret-terminal behavior and live provider
journeys are separate evidence. Detection cannot establish account entitlement,
DNS correctness, client reachability or cleanup. Ngrok HTTPS is attached-only;
Cloudflare named retains the owner's remote tunnel/DNS/token on stop. Raw ngrok
TLS/TCP execution remains detect-only in this release. Do not promote it to
executable based on a successful detect or fixture run.
