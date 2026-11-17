# Provider setup contract draft

A host can guide an owner through setup and remove what Gozar created using only public Gozar data. The trusted adapter supplies the provider knowledge. Gozar binds each offer to its authority and retains enough evidence to recover from interrupted writes. This draft specifies the upcoming public API. The 0.4 runtime does not implement setup operations.

## Render the current action

Use `Candidate.setup.actions` or the current draft configuration to find the first setup action. An action with a `step` descriptor opts into the setup operation API. An adapter derives its current offer from observed state and the operation's confirmed outcomes. Trusted adapter observation and execution stay distinct. Gozar projects status and ownership from readback and the private journal. Gozar verifies prerequisites before admitting an effect. An app displays the next action, collects its input, and sends back the exact IDs, revisions and digest that Gozar supplied. Action IDs and option values are opaque.

| Offer | Host behavior |
| --- | --- |
| `provide-value` with `step.options` | Show the supplied labels. Send the selected opaque value. Gozar checks membership against the current offer. |
| `open-url` with `step.browser` | Request the transient URL with `readSetupOperation({ ...ref, includeBrowserHandoff: true })` and open it in the system browser. Respect the poll interval and expiry. Browser return can prompt an immediate status read subject to the interval. |
| `provide-secret` | Use `storeSecret` for the same input, owner, scope and configuration revision. Send only the resulting handle through `runSetupAction`. |
| `gozar-runs` or `install-artifact` | Render the redacted disclosure and exact consent facts, including capabilities and effects. Return approval only after authorization. |
| `instructions` | Show the actor, permission, instructions and verification source. External work might require a provider administrator, OS permission, or a trusted client. Re-read for evidence. |

`Action.kind` chooses the control. `step.actor`, `permission` and `verification` identify who can do the work, which permission is needed and where completion can be verified. These fields are descriptive. Host capability observations alone confer no authority. A machine driver can execute only with an already granted exact authorization. If human authority is needed, the response is `authorization-required` with the current offer. A known unmet prerequisite is `blocked`. Instructions are rendered as text and never interpreted as commands.

Gozar returns `pending` while authoritative evidence is outstanding, `denied` after authoritative rejection, and `expired` when the grant attempt has expired. `evidence` identifies the most recent observed outcome and its source. A browser callback, a successful process exit, or the user's acknowledgement of instructions is insufficient unless the required verification has been observed. `complete` means setup's required evidence is present. A route becomes published only through the existing route consent and proof flow.

## Open, read and advance

1. Save a caller-chosen `operationId` before the first call. Call `runSetupAction` with that ID, `expectedSetupRevision: 0`, the initial `actionId`, and the configuration or draft revision. Start reserves the operation and returns its first scoped offer. It accepts no approval or input at revision zero and performs no external mutation. The legacy call returns `setup_required` for an operation-only action.
2. Advance with `runSetupAction` using the current setup revision, action ID and configuration revision. Pass the existing setup approval and input where requested. The setup consent scope adds the operation ID and revision. Gozar recomputes the disclosure and current consent facts under that scope before running an effect. Changed facts, stale configuration, an approval copied across operations or scopes, and altered replay input all refuse before effects.
3. Call `readSetupOperation` with home, owner, provider ID and operation ID on restart or while waiting. It reads the persisted operation and may refresh observations. It never allocates, deletes or grants access. An authorization exchange that needs a write runs as a separately admitted machine action. Pending browser handoffs may expire while the host is absent. Denial and expiry carry no grant. A retry is a fresh offer, with a new setup revision and handoff.
4. Call `cancelSetupOperation` with the same reference. Cancel is idempotent and prevents further setup effects. It preserves exact recovery state and offers reconciliation or removal for any partial effects. A completion reported after cancellation can update the cleanup evidence and cannot advance provisioning.

The private journal binds the canonical home, owner, registry, provider and applied configuration or draft scope. A setup revision changes when the authority or actionable state changes, including when setup itself commits a new configuration revision. Display-only timestamps do not change it. The current action carries the current consent snapshot. Historical approvals remain tied to their admitted command. A successful replay of the same command returns the latest safe view of its operation, including cancellation or cleanup, and cannot run the command again. A different action, approval or input for the same admitted revision is an operation conflict. Reading and cleaning up a partial operation still use its retained scope when its draft is stale or unavailable.

## Keep provider authority separate

Provider authorization grants provider permissions. Gozar setup approval grants an exact setup effect. The route approval binds the exact application exposure. Every effect needs authority from its controller. One ceremony can cover multiple grants only when one controller can enforce the complete known grant and the review names all effects. Discovery after a login can change the account, resource, cost or target and requires a fresh review before provisioning.

The management grant stays in the host secret backend and is accessible only to the admitted setup and cleanup paths. The connector receives only its exact, scoped connector credential. Public configuration reports credential presence. Status, evidence, errors, events and receipts carry no raw credentials, private provider IDs for cleanup, or secret handles. A live browser handoff can carry a transient URL for navigation. The trusted interactive host explicitly requests the handoff. Gozar omits the URL from default results and commits only the safe handoff subject and authority facts to consent. Inventory, logs, events, persisted receipts and machine summaries omit that material and all grant codes and bearer data. On recovery Gozar exposes a still-valid handoff or a fresh offer according to the provider's rules.

## Reconcile and remove exact resources

Before each external write, durably journal the admitted action and a private intent that identifies the desired resource and the provider's reconciliation key. Mark the write as in flight before issuing it, then read the result back against the intended subject. A lost response or local persistence failure leaves the intent in `reconciling`. Replaying the admitted command can reconcile that intent. A new create requires reliable evidence that the first effect never took place and can no longer take place, then a fresh offer. An inconclusive lookup keeps debt and offers reconciliation. A provider without sufficient reconciliation guarantees stays blocked for manual verification.

Public `resources` rows carry opaque handles, the last observed presence and removal state. Ownership comes from the journal and exact readback. Matching a name or seeing an existing remote resource supplies no deletion authority. `adopted` and `foreign` rows are retained, including shared prerequisites. `unknown` rows retain unconfirmed removal debt. An owned resource can move to confirmed only when Gozar verifies exact absence, including inactivity for a revoked credential. The handle identifies the exact journal row across restarts.

Stopping the connector, removing owned provisioning resources such as the tunnel and DNS record, and revoking owned credentials are distinct actions. Removal offers use `step.resourceHandle` and bind the exact mutation into consent. Gozar rechecks ownership and identity before the conditional remove, and records readback afterward. Where the provider couples effects, the review lists every affected owned resource and requires authority for all consequences. Disconnecting a local reference is separate from revocation. Keep a recovery path for missing management authority as long as debt remains. A discarded draft or cancelled setup never clears debt.

## Provider capability decisions still open

- Cloudflare documents separate Tunnel and DNS endpoint permissions. The probes observed public OAuth metadata and a CLI login handoff. An approved browser grant's account/zone discovery, runner enrollment and exact lifecycle authority remain unverified. The CLI certificate carries account-wide tunnel authority. Its DNS DELETE authority remains unproven.
- Ngrok's management API documents agent authtoken creation. The public MCP metadata lists `credentials:write`, and its docs say tools do not return secrets. Authenticated MCP tool support, token audience and one-time secret delivery remain unverified. Secure intake remains available where the management grant cannot deliver the connector credential.
- Tailscale's isolated CLI reported `NeedsLogin` and a browser handoff. Exact node and tailnet identity, admin completion, Serve/Funnel mapping readback and independent client proof remain unverified.

These results select the adapter's offered steps and evidence source. Management and connector credentials remain distinct in all three cases.

Existing raw ngrok TCP/TLS are detect-only. Own-address is adopt-only. These profiles do not get a managed create offer.

## Topic-branch acceptance

Run `node --test test/acceptance/provider-setup.red.test.mjs` explicitly. These specifications are expected to fail against the current runtime and sit outside its normal test glob. The fixture uses a randomized provider ID and local synthetic state. Its readback format is fixture data for the forthcoming adapter integration. The tests exercise the consumer contract through the package root, and the integration can wire fixture observations through the same adapter seam as production.
