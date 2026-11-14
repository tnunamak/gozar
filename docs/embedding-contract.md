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
The decisive release check is an installed host integration using public APIs.
Helper tests alone do not establish that integration.

## Focused verification

The broker test spawns a real Node child and gives it only the resolver descriptor
and trusted host identity. It checks a digest of the returned canary, backend lock,
wrong boot, and shutdown. The installed controller and host acceptance
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


## Public-consumer recovery boundary

Save the following block as `host-route-example.mjs` beside an installed,
release-matched `@tnunamak/gozar@0.4.0`. Import its functions from your host;
importing this module does not start a route. This is a library plus CLI, not
a hosted control plane. The host supplies its own input requirements UI,
durable journal and explicit selection/confirmation callbacks.

`journal.saveIntent` must atomically and durably commit before resolving.
Allocate `operationId` once when the user's intent is created, persist it with
that intent, and reuse it after ambiguous results. Do not mint another ID merely
because an await failed. Journal query/handle state privately, never approvals,
candidate bearer values, backend bytes or raw provider errors.

<!-- public-consumer -->
```js
import { createGozar } from '@tnunamak/gozar';

// Supply implementations conforming to the release's public host types.
// Keep this configured factory alive while its controllers use the backend.
export const createHost = options => createGozar(options);

export async function openApproved({
  api, query, operationId, choose, confirm, journal,
}) {
  if (!query.owner || !operationId) throw new Error('owner and operationId required');
  if (!['attached', 'session', 'durable'].includes(query.usage.kind))
    throw new Error('unsupported usage');
  const catalog = await api.catalogRoutes(query);
  const candidate = await choose(catalog.candidates);
  if (!catalog.candidates.includes(candidate) || !candidate.eligible
      || candidate.setup.state !== 'ready' || !candidate.candidateToken)
    throw new Error('select an eligible ready candidate');
  if (candidate.consentFactsDigest !== candidate.consent.consentFactsDigest)
    throw new Error('inconsistent consent snapshot');
  // Present the COMPLETE snapshot: scope, all facts (including unknown),
  // typed disclosures, terms/privacy links and all affectsConsent rows.
  // confirm must return true only after the user approves this exact card.
  if (await confirm(structuredClone(candidate.consent)) !== true) return null;
  await journal.saveIntent({
    operationId, query: structuredClone(query), providerId: candidate.providerId,
  });
  const request = { ...query, operationId, approval: {
    kind: 'route', consentFactsDigest: candidate.consentFactsDigest,
    candidateToken: candidate.candidateToken,
    disclosureRevision: candidate.disclosure.revision,
  } };
  try {
    const route = query.usage.kind === 'durable'
      ? await api.ensureRoute(request)
      : await api.expose({ ...request, wait: 'verified' });
    await journal.saveHandle(route);
    return route; // Advertise only its published value, never origin.
  } catch (error) {
    if (error.route?.handle) await journal.saveHandle(error.route);
    throw error; // Host renders normalized code/nextAction, not raw diagnostics.
  }
}

export const recover = ({ api, home, owner }) => api.listRoutes({ home, owner });

export async function closeRetained({ api, journal, home, handle }) {
  const route = await api.closeRoute({ home, handle, mode: 'remove' });
  await journal.saveHandle(route);
  return route; // unconfirmed means retain the handle and retry close, not create.
}
```

Recovery is not recreation. `listRoutes({home,owner})` returns historical retained
snapshots, including uncertain allocations; it neither renews proof nor makes a
cached URL publishable. Use `routeStatus({home,handle})` for current proof.
Unreadable state must remain an error, not an empty list. Preserve handles from
both successful results and `error.route`, including stopped/error outcomes.
A replay of a stopped operation remains terminal; changing intent under the
same operation ID is `operation_conflict`. A genuinely new user intent needs
new review and a new durable intent record. Keep cleanup debt visible until
confirmed absence; a Stop acknowledgement is not absence.

### Setup, reload and visible consent

Use one explicit owner consistently for inventory/catalog, intake, setup,
draft creation/read/commit and route operations. Select providers by returned
IDs, not provider-specific branches. Read `configuration.inputRequirements`;
use each requirement's `actionId` to locate its current offered action. Render
the full setup consent snapshot and typed action disclosure, including effects,
installation artifact identity and links. Do not reconstruct or shorten its
digest. Route consent does not authorize setup, and setup consent does not
authorize route publication.

For a plain-value action, `runSetupAction` receives `home`, the same `owner`,
returned `providerId`, `expectedConfigurationRevision`, optional `draftId`,
the offered `actionId`, `value`, and approval
`{kind:'setup',consentFactsDigest,digest,disclosureRevision}` copied from that
exact action. Secret input uses the host's typed intake API and only its returned
opaque handle, not a plain value. Follow pending/blocked results and recatalog;
never assume a revision advanced. For each next action use the returned
configuration, or reload it using `readConfigurationDraft` with the same owner.
Never reuse an approval from before a revision/configuration change.

Begin a draft at the applied revision; stage changes under its returned revision.
After an application restart, read that same draft ID and use its fresh offered
actions. Stop affected runtimes before commit. A failed setup/CAS preserves the
old binding; a failed start after successful commit does not undo the commit.
Retain unbound intake handles for explicit discard. Closing a route retains
credentials; neither discard nor close revokes the provider's credential.
Owner-managed DNS, domains, tunnels and other provider-owned resources remain
the owner's responsibility unless an offered action explicitly says otherwise.

### Host backend and supervisor boundary

Supply `secretBackend`, `hostCapabilities` and `identity` to `createHost`
using the matching release's exported host types. Backend callbacks stay in the
trusted host; there is no file-store fallback for custom backends. Locked backend
presence is unknown, not absent. Keep the resolver available for every detached
controller; resolver loss withdraws availability.

On the first supervisor boot, establish the stable host instance and a fresh
controller boot before bootstrap. On every replacement, call the trusted broker's
`registerController({identity})` before starting it. An explicit replacement
identity must use the same instance and a fresh boot; invalidate old descriptors
and tokens first. Use the returned incarnation in proof subjects. A long-lived
factory is not evidence of a fresh controller boot. Never reuse a prior boot,
credential bytes or proof snapshot to make recovery look successful.

The broker constructor and complete backend/identity interfaces are not declared
inline in the route contract excerpt. This guide intentionally does not invent
their signatures; use the installed public embedding types. The executable
sample above exercises route consent/journaling/recovery, not supervisor or
credential-backend integration.

### Release and validation limits

Keep CLI, library, WASM/core, runtime contracts and host bindings from the same
0.4.0 release. A 0.3.4 host must follow the migration guide rather than copying
old approval tuples. 0.1.x descriptions explain historical behavior; they are
not a current support or publication inventory. The 0.4 boundary is broader,
but does not imply every provider/account/OS combination has live validation.

Optional SDKs are installed by the owner when the chosen candidate's current
prerequisite/remedy requests it. Detection does not install them or prove account
permission. Never auto-run arbitrary remedy instructions. The shipped execution
release is HTTP(S)-only: visible raw TCP/TLS profiles remain detect-only, not an
alternative execution path. Expiry belongs to session lifetime/proof state;
there is no expiring usage kind.

Offline example tests check public package import and injected host sequencing
with negative controls. They are not live provider, installed-host, supervisor,
account, remote-absence or end-to-end publication evidence.
