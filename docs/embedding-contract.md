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
