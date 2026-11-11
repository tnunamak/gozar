# Public implementation slices

**Shared baseline:** `c4c1981`. Private-file materialization, exact scoped transport mapping, public-relay proof and controller handover are landed. JSON-record parsing, safe output projection and policy inspection remain R3b dependencies. See [plan.md](plan.md) for the four waves and other pieces.

`scope_paths` lists existing public files needed as read inputs. `change_paths` lists exact existing files an owner may edit. `output_paths` lists exact new files only. Wildcard or directory ownership is not implied. Empty outputs are intentional for work already present or blocked on external repository scope.

Dalan is the Node/WASM embedding target; PDP-Connect/data-connect is the native Rust target. Their external source paths require exact integrator-assigned scopes. Public conformance fixtures can be added here now. Client identity remains data-only; host branches and route selection never depend on a named client product.

**Common read scope:** Include `README.md`, `docs/architecture.md`, `docs/contracts/private-files-and-transports.md`, `runtime/core-protocol.json`, `adapters/plan-contract.json`, `packages/gozar-node/driver.mjs`, `packages/gozar-node/plan.mjs`, `packages/gozar-node/bindings.mjs`, `packages/gozar-node/core.mjs`, `packages/gozar-node/host.mjs`, `packages/gozar-node/materialization.mjs`, `packages/gozar-node/private-files.mjs`, `packages/gozar-node/transport.mjs`, `packages/gozar-node/journal.mjs`, `packages/gozar-node/controller.mjs`, `crates/gozar-core/src/lib.rs`, `crates/gozar-core/src/operational.rs`, `test/adapters/plan.test.mjs`, `test/node/materialization.test.mjs`, `test/node/helpers.mjs`, `package.json`, `Cargo.toml`, `crates/gozar-core/Cargo.toml` and `scripts/build-wasm.sh`, plus the piece-specific reads below. Read scope grants no edit ownership. Put every new test/spec/module below in `output_paths` so it survives assignment pruning. Build generated WASM before actual-core tests.

## Eight route slices

Seven adapters are represented by nine mode definitions; their listed slice acceptance tests are new outputs. Each leaf may propose shared feature/interface deltas to R3; it must not edit shared core, protocol, driver, catalog or manifest files. `test/e2e` acceptance that uses providers is run by the integrator’s authorized live harness, one route at a time.

### S1 — ngrok transport modes

- **State:** route definitions are present; this slice adds deterministic planning and live route acceptance.
- **scope_paths:** `adapters/ngrok-https-edge.definition.json`; `adapters/ngrok-tls-passthrough.definition.json`; `adapters/ngrok-tcp-passthrough.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/driver.mjs`; `test/adapters/plan-schema.test.mjs`.
- **change_paths:** `adapters/ngrok-https-edge.definition.json`; `adapters/ngrok-tls-passthrough.definition.json`; `adapters/ngrok-tcp-passthrough.definition.json`.
- **output_paths:** `test/adapters/ngrok-plans.test.mjs`; `test/e2e/ngrok-public-relay.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** R3a opaque credential/file handles, embedded `materialize` declarations, exact transport mappings, immutable process cleanup and public-relay proof. **Pending R3b:** bounded exact JSON-record parsing, safe output projection/readback and policy inspection. Normalize `privateConfigTemplate` into the published embedded materialization schema and retire its old private-config feature requirement only after equivalent tests. Data/blocked-contract work is buildable now; operational promotion waits for those shared hooks.
- **Acceptance:** Feature denial before effects; exact endpoint/transport and upstream checks; private credentials never in argv/state/logs; HTTPS edge remains HTTPS only, while TLS/TCP passthrough retain their transport and endpoint semantics. Live acceptance uses pinned public DoH/IP with original SNI, actual tool call and timed SSE, then exact owned cleanup and foreign-route preservation. Do not apply an HTTPS mapping to opaque TLS.
- **Expect it to work because:** Each declared mode can be checked against its own transport and endpoint receipt while generic admission prevents missing private-config or policy hooks from executing.

### S2 — Cloudflare named tunnel

- **State:** the route definition is present; acceptance depends on generic private-file materialization, not a provider-specific host module.
- **scope_paths:** `adapters/cloudflare-named.definition.json`; `adapters/localhost-run.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/driver.mjs`; `test/adapters/plan-schema.test.mjs`.
- **change_paths:** `adapters/cloudflare-named.definition.json`.
- **output_paths:** `test/adapters/cloudflare-named-plan.test.mjs`; `test/e2e/cloudflare-named-public-relay.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** R3a embedded private token materialization, exact credential/tunnel/hostname scope facts, generation-bound handles, suppressed secret-child output, owned process cleanup and public-relay `remote:false` proof. **Leaf work now:** normalize the token binding to this schema, use the configured endpoint template and finite identity/readback evidence, and test exact tunnel/hostname authority. No new generic materializer is needed; no admission change before acceptance.
- **Acceptance:** Missing feature or stale/mismatched identity rejects before spawn; token bytes never enter argv, journal or events; create starts only the owner-configured named connector; stop removes only its process/private artifacts. Live proof exercises actual tool call/timed SSE then confirms tunnel, DNS, certificate and unrelated connectors remain.
- **Expect it to work because:** A named connector can be started from an existing owner-configured tunnel with a host-materialized secret, and its stop path is scoped to one owned process.

### S3 — LAN route

- **State:** the route definition is present; new specification, fixtures and tests will establish address and cleanup acceptance.
- **scope_paths:** `adapters/lan.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/driver.mjs`; `test/adapters/plan.test.mjs`; `test/adapters/fixtures/lan.json`.
- **change_paths:** `adapters/lan.definition.json`.
- **output_paths:** `adapters/specs/lan.md`; `test/adapters/fixtures/lan-plan-cases.json`; `test/adapters/lan-plan.test.mjs`; `test/e2e/lan-client-vantage.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** exact interface binding/observation, firewall consent, owned local-forwarder and intended-vantage receipts. **Pending R3b hardening:** align Node address validation with the core’s full loopback/multicast/link-local exclusions. The adapter/tests can build now; activation needs that hardening and a real LAN-peer receipt. A host-side probe or hostname alone is insufficient.
- **Acceptance:** Deterministic cases cover invalid/loopback address variants, removed interface, missing firewall receipt, stale binding, occupied listener, stop ownership and honest HTTP/TLS labels. R3 must validate the full interface-address contract before effect dispatch, including loopback variants and multicast addresses. Live acceptance is from a genuine LAN peer and verifies only the owned listener and scoped firewall change. Existing `plan.mjs` alone is not evidence of safe driver cleanup.
- **Expect it to work because:** The adapter already describes exact interface and peer-vantage prerequisites; tests and R3's generic validation can enforce them without adding a provider branch to the host.

### S4 — Owner-supplied address/domain

- **State:** the route definition is present; new tests establish owner-origin proof and cleanup behavior.
- **scope_paths:** `adapters/own-address.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/public-relay.mjs`; `packages/gozar-node/driver.mjs`; `test/adapters/fixtures/own-address.json`.
- **change_paths:** `adapters/own-address.definition.json`.
- **output_paths:** `adapters/specs/own-address.md`; `test/adapters/fixtures/own-address-plan-cases.json`; `test/adapters/own-address-plan.test.mjs`; `test/e2e/own-address-public-relay.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** external-owned HTTPS binding, health/update-origin/expiry, generation fencing and public-relay proof. **Leaf work now:** validate-only configuration, action wiring proposals and acceptance tests. Gozar provisions and deletes no external DNS/proxy route.
- **Acceptance:** Reject non-HTTPS/credential-bearing origins and stale generation; publish only exact fresh proof; health refresh does not broaden authority; stop has no external route mutation. Live test pins public resolution/IP, preserves SNI, exercises list/call/timed SSE and proves the owner route is unchanged.
- **Expect it to work because:** This adapter has no create/delete authority; its only result is a fresh proof bound to the explicit owner-supplied origin.

### S5 — Tailnet-private Serve

- **State:** the route definition is present; new tests establish private audience, eligible listener selection, tailnet-vantage proof and cleanup behavior.
- **scope_paths:** `adapters/tailscale-private.definition.json`; `adapters/tailscale-funnel.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/driver.mjs`; `packages/gozar-node/journal.mjs`; `test/adapters/plan.test.mjs`; `test/adapters/fixtures/tailscale-cleanup.json`; `test/adapters/fixtures/tailscale-detection.json`.
- **change_paths:** `adapters/tailscale-private.definition.json`.
- **output_paths:** `adapters/specs/tailscale-private.md`; `test/adapters/fixtures/tailscale-private-plan-cases.json`; `test/adapters/tailscale-private-plan.test.mjs`; `test/e2e/tailscale-private-client-vantage.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** typed bindings, full port-map captures, guarded root mounts and immutable owned-process/readback machinery. **Leaf work now:** current profile/node authority, exact free 9444/9445 selection, ownership continuity and genuine tailnet-peer proof. No public-relay receipt satisfies tailnet vantage; no read/compare/off claim of atomic compare-and-swap.
- **Acceptance:** Prerequisite, account/profile, occupied-port and continuity failures deny mutation or preserve cleanup debt. Live tailnet client verifies TLS/nonce and requested transport; exact owned route removal leaves all unrelated handlers and protected 443/10000 untouched.
- **Expect it to work because:** Current node/profile identity, exact route readback and a continuous ownership receipt constrain both allocation and cleanup to one listener.

### S6 — localhost.run trial lifecycle

- **State:** live public-relay path is supported by existing tool-call, timed-SSE and cleanup evidence. The remaining work is rotation/lifetime capture and correctness, not a claimed broken relay.
- **scope_paths:** `adapters/localhost-run.definition.json`; `adapters/plan-contract.json`; `runtime/core-protocol.json`; `packages/gozar-node/plan.mjs`; `packages/gozar-node/driver.mjs`; `packages/gozar-node/journal.mjs`; `harness/drop1a.mjs`; `test/adapters/plan.test.mjs`; `test/adapters/fixtures/localhost-run.json`.
- **change_paths:** `adapters/localhost-run.definition.json`.
- **output_paths:** `adapters/specs/localhost-run-trial.md`; `test/adapters/fixtures/localhost-run-trial-cases.json`; `test/adapters/localhost-run-trial-plan.test.mjs`; `test/e2e/localhost-run-trial-lifecycle.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** isolated SSH state, owned child identity, finite lifetime, public-relay proof, process-lifetime endpoint absence and old-controller handover. **Pending R3b wiring:** a generic ongoing-output/candidate-change event seam for URL rotation and lifetime reporting. Leaf data/spec/test work is buildable now; no provider-specific host module.
- **Acceptance:** Deterministically simulate rotation, expiry, child exit, cancellation and changed host key; stale candidates never publish and uncertain ownership remains reconcilable. The integrator’s live check repeats DoH/pinned-IP/SNI, tool-call, timed-SSE, status/stop and zero-owned-residue acceptance while capturing rotation/lifetime behavior.
- **Expect it to work because:** The existing route already passes public-relay tool, stream and cleanup proof; lifecycle checks add bounded candidate refresh and expiry handling around that same path.

### S7 — Status and stop presentation

- **State:** generic views/tests are new; shared renderer and CLI wiring remain with their respective owners.
- **scope_paths:** `packages/gozar-node/render.mjs`; `packages/gozar-node/controller.mjs`; `packages/gozar-node/daemon.mjs`; `packages/gozar-node/journal.mjs`; `bin/gozar.mjs`; `test/node/cli.test.mjs`; `test/node/recovery.test.mjs`.
- **change_paths:** none; modules are new.
- **output_paths:** `packages/gozar-node/status-view.mjs`; `packages/gozar-node/stop-view.mjs`; `test/node/status-view.test.mjs`; `test/node/stop-view.test.mjs`; `test/e2e/status-stop-journey.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** candidate/published/expired/cleanup-pending/stopped states, validation receipts, old-controller handover and exact cleanup results. **Pending:** R1/R3 imports the new views after they merge. The generic view modules/tests are independently buildable now.
- **Acceptance:** Actual CLI/view boundary renders stable secret-free status for ready, expired, stale generation, stopping, debt and stopped. Stop withdraws publication first, signals only exact owned handles and reports proved removal or reconciliation. Live status-stop-status verifies foreign resources survive.
- **Expect it to work because:** The views consume the same session and ownership receipts that gate publication and cleanup, so they report the actual lifecycle state.

### S8 — Client profile data pack

- **State:** generic data pack, schema and tests are new. Do not hard-code client names or capability claims in core/host code.
- **scope_paths:** `docs/architecture.md`; `runtime/core-protocol.json`; `crates/gozar-core/PLAN-PROTOCOL.md`; `adapters/plan-contract.json`; `packages/gozar-node/catalog.mjs`; `packages/gozar-node/plan.mjs`.
- **change_paths:** none; files are new data/schema/tests.
- **output_paths:** `adapters/client-profiles/manifest.json`; `adapters/client-profiles/mcp-client-profile.schema.json`; `adapters/client-profiles/profiles/local-desktop.json`; `adapters/client-profiles/profiles/remote-protected.json`; `adapters/client-profiles/profiles/remote-open.json`; `adapters/client-profiles/profiles/tailnet-client.json`; `adapters/client-profiles/profiles/lan-client.json`; `test/adapters/client-profile-pack.test.mjs`.
- **Dependency/shared-hook readiness:** **Landed:** generic reach/protocol requirements and HTTPS install-link rendering. **Pending:** catalog/profile loader wiring owned by R3/R1. Schema/data/tests are independently buildable now; a profile never proves readiness or selects a code branch.
- **Acceptance:** Schema-valid profiles have unique IDs, no unknown fields and traceable capability statements. Optional host-supplied client records may add sourced requirements and install links; the default pack remains generic. Deterministic tests reject profile-only promotion. Live evidence is recorded only for exact profile version plus route/client receipt; never rewrite third-party settings automatically.
- **Expect it to work because:** Versioned profile data can describe generic needs without selecting code paths, and only a matching route receipt can establish readiness.

## Activation rule

Every leaf edits only its `change_paths` and creates only its **new** `output_paths`; paths named only in `scope_paths` are read-only. Shared schemas, protocol, feature lists, driver, catalog and manifest stay with R3. Missing generic behavior produces a proposed interface delta, not a provider branch or a weakened feature check. Deterministic tests use fake effects/local fixtures; only the integrator runs authorized live provider acceptance, one route at a time. A passing data test never promotes an adapter by itself.
