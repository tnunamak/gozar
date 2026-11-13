# Architecture

Gozar separates decisions from effects. The Rust core accepts JSON state, a command, adapter records, generic client requirements and trusted host observations. It returns the next state, events, typed effects, a UI snapshot and an optional action. Native and WASM builds use the same transition function.

The Node host supplies process execution, scoped files, durable journal writes, HTTPS, interface observations and timers. Provider commands and copy live in adapter data. The host admits each effect against its exact recipe, session, generation, binding authorities and acknowledged durable intent.

An operational `planVersion:1` adapter follows this sequence:

1. Read fresh prerequisite and configuration observations.
2. Check predicates and capture typed facts.
3. Persist the exact mutation intent durably.
4. Execute the admitted effect and record immutable ownership.
5. Compare the resulting configuration and validate the candidate address.

Publication requires a matching current proof and exact-origin approval. Public relay proofs use a pinned public DNS result, original-hostname TLS checks, an instance nonce and timed SSE. The proof records `networkPath:"public-relay"` and `remote:false`. An injected remote executor can supply a distinct remote-execution proof class.

Stop withdraws publication before cleanup. Cleanup uses the original bindings and a fresh ownership-continuity check. Administrator changes and uncertain ownership remain visible as cleanup debt; the runtime preserves resources it cannot attribute to the session. Late allocation completions also enter reconciliation.

The automatic operational catalog enables localhost.run and Funnel. Other records supply detection inventory and extension plans. A whole-plan feature check precedes execution, so each host negotiates the effects it supports before admitting a plan.

## Client requirements

Client identity is optional host-supplied data. The core filters on `clientReach`, `httpsRequired`, `oauthDcr`, `sse` and `streamableHttp`.

| Client reach | Eligible route audiences |
|---|---|
| `internet` | Public HTTPS |
| `tailnet` | Tailnet and public HTTPS |
| `lan` | LAN and public HTTPS |
| `this-device` | Local, tailnet, LAN and public HTTPS |
| `unknown` | Public HTTPS first, with a one-line client-network limit |

A host passes requirements it already knows. Otherwise the CLI asks, “Where does the app that will use this run?”. An optional profile can supply requirements and an HTTPS `installLinkTemplate` containing `{url}`. The renderer encodes the endpoint into the template; profile names never choose code paths or relax proof requirements.

The machine-readable contract is [core-protocol.json](../runtime/core-protocol.json). [PLAN-PROTOCOL.md](../crates/gozar-core/PLAN-PROTOCOL.md) describes ordered steps, typed captures and ownership records.

## Route API layers

The route API sits on top of the engine described above. An app states requirements and never names a provider.

1. **Registry.** `adapters/manifest.json` lists each provider as `{id, module, definition}`. `loadAdapters` validates the definition and the module against `packages/gozar-node/adapter-contract.d.ts` and rejects a half-built adapter.
2. **Catalog.** `catalogRoutes` filters the registry by hard requirements (reach, transport, payload access, address stability, setup, protocols, usage kind, platform), ranks by the user's preference order, and reads provider state without changing it. For an eligible, ready candidate it issues a consent token.
3. **Consent token.** A token is single-use bearer data bound to owner, home, target, usage, intent, requirements, route name, origin, disclosure revision, plan digest and the observed provider resource. The engine redeems it under the reservation lock and re-observes before any effect. Drift fails with `candidate_stale` and no provider write.
4. **Engines.** Durable routes use the Tailscale LocalAPI engine (ETag compare-and-set). Session routes use the controller and core described above. Attached routes use a detached controller that the calling process keeps alive with heartbeats (5 s beat, 20 s expiry). Before an attached route reports an origin, the controller runs the same timed-SSE validation as a recipe route through a gate in front of the app, and withdraws the route if it fails.
5. **Views.** `routeStatus`, `closeRoute` and `watchRoutes` dispatch by handle kind (durable, session, attached or external) and always return the same `RouteView`.
6. **Errors.** One normaliser (`packages/gozar-node/error-normalizer.mjs`, table in `runtime/error-normalization.json`) maps every internal error to the frozen set of codes at each public export and in the CLI envelope. A code the table does not know becomes `internal_error`; the original error stays on `cause` and is never in the message.
7. **Platform.** `packages/gozar-node/platform.mjs` is the one place that decides which operating systems Gozar supports: Linux and macOS. Any other value makes every candidate `unsupported`. Each adapter may still answer `unsupported` through `ctx.platform`.

The CLI commands in the [README](../README.md#route-by-requirement) read the same requests from files and print the same results as the root exports.

## Session presentation

`expose --port`, `status`, `health` and `stop` share the human renderer. The selected adapter's `copy.human` holds address wording, a short selection name, an alternative summary and a setup step. These fields extend the legacy normalized plan definitions; they do not change the provider-definition schema or the public reply. `runtime/plain-copy.json` maps engineering caveats to plain copy, a decision flag and a note/setup/failure kind. Its schema is `runtime/plain-copy.schema.json`; the catalog test checks coverage of adapter caveats, core errors and host errors. Unexpected runtime error text stays in verbose and JSON output.

`--alternatives` lists usable session plans from the recommendations and their detection status (`available` means detected, with checks still required after approval). The heading names the requested audience, and the plan does not repeat the alternatives summary. It continues to the compact plan and existing approval flow. `--via` accepts the printed selection name or the adapter ID. `--verbose` appends the former full engineering view, including every provider's limitations. The plan states the background lifetime, address pattern, sign-in boundary and selected ownership disclosure. The published view starts with the URL, then reports only checks present in the final receipt, followed by the target, lifetime, stop command and health command. MCP instructions appear only in verbose output because a session request does not identify the application protocol. No demo-only authentication advice is inferred from a port. Failures distinguish confirmed cleanup from public access that may remain, name a known cause or say it was not recorded, and suggest inspection before retrying. JSON serialization uses the original reply and does not run the human renderer.
