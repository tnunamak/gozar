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
