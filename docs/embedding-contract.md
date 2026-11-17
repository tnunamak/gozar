# Host embedding in 0.4.0

Create one configured factory for each trusted registry. Pass `secretBackend`,
`hostCapabilities`, and supervisor `identity` to `createGozar`. Keep this factory
alive while its controllers need the backend. The custom backend never falls
back to the CLI file store. Backend locking produces unknown credential presence;
it does not mean that the credential is absent.

Read configuration from a fresh catalog or inventory. Use its provider ID,
scope ID, and revision when storing a secret and approving its exact setup action.
Input `id` identifies the field; `actionId` identifies the action. Pass
`providerId` and `expectedConfigurationRevision` to `runSetupAction`. Keep all
these operations in the same owner scope. Configuration revisions support equality
only. Stale requests run no approved effect.

For rotation, begin a configuration draft at the applied revision. Store and bind
new values in that draft using its own revision. The old configuration stays
usable. Stop the old route before committing the draft, then obtain a fresh exact
catalog and consent before starting the replacement. Failed setup or conflicting
commit preserves the old configuration. A failed replacement start does not roll
back a committed configuration. Discarding a draft removes only its unreferenced
staged secrets; it does not revoke a vendor credential.

`discardSecret({home,handle})` removes an owned unbound intake handle. Repeating
it is safe. Applied configuration and retained draft references prevent deletion
with `secret_in_use`. Unknown handles authorize no deletion. Backend deletion
failure remains explicit and must be retried.

`listProviders` lists the whole trusted registry, including unavailable providers
and audiences. It grants no authorization. Select an entry, then recatalog the
exact target, audience, transport and usage before approval. Host capabilities
are observations keyed by adapter-declared capability IDs. Artifact installation
requires the host executor, current approval and a matching SHA-256 before any
execution. Detection never installs software.

`binding.target` is the observed forwarding target. A requested target cannot
supply missing observation. Unknown mappings remain unknown. Unconfirmed cleanup
has a next action that asks the host to call `closeRoute` again with the retained
handle. The existing controller owns cleanup receipts and retries. Do not edit
private recovery files or infer remote absence from a missing local map.

The resolver broker carries a private socket descriptor and control token across
the controller boundary. The host keeps backend callbacks; the child resolves
configuration over this authenticated, boot-bound channel. The trusted bootstrap
must pin registry identity and host identity separately. Resolver loss must
withdraw publication through the controller's loss callback. Credentials never
belong in bootstrap, environment variables, arguments, events or errors.

Legacy direct setup calls retain their file-backed path. Migrate embedded callers
to a configured factory and explicit provider/configuration revision requests.
The decisive release check is the installed DataConnect integration using public
APIs. Helper tests alone do not establish that integration.

## Focused verification

The broker test spawns a real Node child and gives it only the resolver descriptor
and trusted host identity. It checks a digest of the returned canary, backend lock,
wrong boot, and shutdown. The installed controller and DataConnect acceptance
remain separate checks owned by the integration lane.

A bounded TLA+ draft model checks shared-secret preservation and retaining the
live-use reference until close confirmation. The unsafe rule that deletes a
shared secret on discard fails along `Initial -> Begin -> Discard`. The safe
rule deletes only staged unreferenced secrets: 38 generated states, 12 distinct
states, no invariant violations. The configuration test replays the discard path
and checks that the applied credential still resolves. The model abstracts
backend crashes, filesystem durability and multiple controllers; tests cover
those concrete boundaries separately where stated.

The initial capability vocabulary is `installer.execute`, `privilege.elevate`,
`secrets.backend`, `runtime.attached` and `runtime.durable`; additional IDs are
open strings. An undeclared required capability is unknown with reason
`host-capability-undeclared` and cannot authorize execution. An explicit false
capability is denied, which is distinct from missing software.

For the default file backend only, the first ownerless configuration read imports
legacy private setup references and text without copying credential bytes. Legacy
records have no owner field: assigning them to a named owner requires explicit
migration and returns `configuration_migration_required`. Custom backends never
import or fall back to legacy files. After import, use the configured factory for
subsequent edits; mixing legacy setup writers with the new revision API is not a
supported synchronization mechanism.

The broker optionally accepts a host `dispatchEffect` callback and exposes
`proxy.dispatchEffect({kind,operation,input})` for the public testing factory's
exact fixture handlers. Without an explicitly supplied handler it returns
`unsupported`. Awaiting connection includes a token/boot authentication handshake.

## Draft input removal and controller incarnations

`clearConfigurationInput({home,providerId,draftId,inputId,
expectedConfigurationRevision,approval})` accepts the offered generic `clear-input`
action's setup approval. It advances only the draft revision and removes only
that input's reference. Commit after affected runtimes close, then discard the
previously retained handle. Clearing never deletes backend bytes. Applied config
and other draft references continue to block secret deletion.

Handle intake provenance stays immutable in the private state. Each current
configuration/draft binding authorizes that reference at its current revision;
setup carries unchanged references forward and commit promotes draft references.
`storeSecret` returns `handle`, `configurationRevision` and `scopeId` without
advancing the revision. Read-only setup and approved artifact installation do not
advance configuration. Other applied mutations refuse live/starting/uncertain use.

The trusted supervisor registers each replacement controller through the broker's
`registerController({identity})` before bootstrap. It revokes prior connections
and control tokens before returning the new descriptor. Omitting identity creates
a fresh boot ID for the stable host instance. Explicit identity must name that
same instance and a new boot. The controller must use this returned boot for its
proof subject; factory lifetime does not establish controller incarnation.

`readConfigurationDraft({home,providerId,draftId})` restores a persisted draft
with its current revision, base revision, redacted observations and freshly
reviewable actions. Preserve the same optional owner scope after reload. Unknown
or foreign draft IDs fail explicitly. This read neither advances revision nor
rewrites the state file. Every setup result also includes `configuration` for
the actual applied or draft scope; its revision and scope ID agree with the
result's `configurationRevision` and `scopeId`. Use its offered actions for the
next step, or call the draft reader after restart. Do not reconstruct digests.

## Declared route pricing in consent

Route consent reserves `gozar.route-cost.amount`, `gozar.route-cost.currency`
and `gozar.route-cost.period`. Supplied facts colliding with these IDs refuse
with `invalid_input`, including non-consent rows. The shared encoder adds
visible affectsConsent facts labeled Declared amount, Declared currency and
Declared billing period, group cost, source declared-route-properties.
Their consentSnapshot shows the same rows covered by its digest; hosts do not
compute the digest. Other provider facts remain unchanged.

Declared non-null values are known, including amount zero. Missing/null values
are unknown, with null value and reason cost-not-disclosed. Amount is finite
numeric data; currency and billing period are strings, never coerced.
These are declared properties, not live account entitlement, quota or actual bills.

The consent-v1 envelope, canonicalization, hash and typed cost.kind stay unchanged.
These are new open fact data, not a new schema or setup consent requirement.
Refresh current offers before approval; old authority does not grandfather
changed pricing. Catalog, redemption and runtime review share the route encoder.
Pure canonical tests do not establish public zero-effect refusal or proof/cleanup.

## Public draft workflow (same owner and revision)

Use the current configuration returned by inventory or catalog. This example is
an integration fragment: `api` is your configured factory, `home` and `owner`
are your unchanged scope, and `providerId` is selected catalog data. It binds a
non-secret value only after your UI has reviewed the offered setup snapshot and
the user has approved that exact action. Do not substitute a route approval.

```js
const scope = { home, owner, providerId };
const draft = await api.beginConfigurationDraft({
  ...scope, expectedConfigurationRevision: configuration.revision,
});
// Persist draft.draftId; after restart, reload rather than reconstructing actions.
const restored = await api.readConfigurationDraft({ ...scope, draftId: draft.draftId });
const action = restored.configuration.actions.find(a => a.kind === 'provide-value');
if (!action) throw new Error('No value action is currently offered');
// Display action.consent.facts and action.consent.disclosures; obtain approval.
const result = await api.runSetupAction({
  ...scope, draftId: draft.draftId,
  expectedConfigurationRevision: restored.configuration.revision,
  actionId: action.id, value: approvedValue,
  approval: { kind: 'setup', digest: action.digest,
    disclosureRevision: action.disclosure.revision,
    consentFactsDigest: action.consent.consentFactsDigest },
});
configuration = result.configuration; // use this scope's fresh revision/actions
```

The public draft regression in `test/node/public-draft-configuration.test.mjs`
checks fresh consent after reload, result/revision agreement, an approved
`clear-input` action and rejection of a foreign provider's draft. It does not
certify a real provider account or the installed host integration. Keep the same
optional owner on every call. Treat revisions as opaque equality/CAS values;
a conflict requires a fresh read and review, not a forced retry with old consent.
For secret descriptors, intake stays in the trusted host: bind the returned opaque
handle to that same draft and revision, never expose bytes to the renderer.

## Display, recovery and qualification boundaries

Render all open fact rows and every consent-affecting row, including unknown
reasons. Compute eligibility and policy from typed properties, availability,
prerequisites and proof. Do not parse labels/messages, branch on provider IDs,
or turn fact IDs into a second provider-specific form schema. Descriptor IDs and
action IDs are distinct; the host chooses controls for the generic descriptors.

Persist an operation ID before start. Same-intent replay recovers the original
handle; a changed intent conflicts and a stopped operation stays terminal.
`listRoutes({home,owner})` is recovery enumeration, not proof renewal. Retain
partial allocations and cleanup debt. Use `routeStatus` for current proof and
advertise only `published`, never a historical origin. Proof binds origin,
target, instance, handle generation and controller boot, not just a factory.

Rotation is not complete at stop acknowledgement: wait for confirmed owned
cleanup before committing a replacement draft. Follow an unconfirmed cleanup's
next action and retry the retained handle. Do not discard credentials still
referenced by applied configuration or another draft. Local discard/close never
promises remote credential revocation, nor deletion of owner-managed DNS/tunnels.

The library, CLI, public types and installed host must be qualified together for
0.4. Linux/macOS support is not proof that every provider/account, architecture,
GUI environment or installed artifact passed a live journey. Offline fixtures,
read-only detection, presence checks and secret-prompt checks each establish only
their stated boundary. Keep installed host acceptance and real-provider checks
separate. Shipped execution is HTTP(S); ngrok TLS/TCP profiles remain detect-only.
Ngrok HTTPS needs its optional SDK and account/domain prerequisites; Cloudflare
named uses an existing owner-managed tunnel/DNS route. Neither is implied ready
by saved inputs. No future release or provider expansion is promised here.
