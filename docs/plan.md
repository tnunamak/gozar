# Gozar: remaining implementation and release plan

**Status:** implementation backlog. The supported runtime remains the Linux source build with trial and public Funnel routes; other release goals below have explicit acceptance gates.

**Baseline:** `c4c1981` (11 November 2026). R3a is landed: opaque credential/private-file materialization, exact typed transport mapping, controller handover and owned-process cleanup. Validation: 50 native tests, 134 native/WASM comparisons and 364 Node/adapter/e2e tests. JSON-record parsing, policy inspection and old private-config declaration normalization remain integration dependencies; no additional provider is admitted by this checkpoint.

## What the current build already demonstrates

- `gozar expose --port N` asks one client-location question when reach is unknown and gives a concrete non-interactive next command. The no-route-flag journey has now passed tool call, timed SSE, status and stop through an existing public route. `test/node/entrypoint.test.mjs` covers the no-flag CLI path. The CLI still needs the local service port; interactive launch still shows the selected route and exact target for approval.
- `gozar demo-server` is available. The committed demo test exercises initialization, tool listing and calling, fresh identity/echo data, timed SSE at both supported paths, and orderly SIGINT/SIGTERM shutdown. Do not create a second demo server.
- Recovery can clear recorded cleanup debt when a dead owned process and its provider route are both freshly proved absent. Existing tests also preserve debt for a present or changed mapping, malformed readback, expired observations, unsupported removal prerequisites, and a live process identity. The actual stale session repro and three running older controllers were reconciled to stopped with empty ownership records and unchanged foreign routes. Broader reboot/interruption matrix coverage remains with R4.
- `docs/architecture.md`, `docs/slices.md`, the CLI and client-reach tests already describe and exercise generic client-location filtering. Reuse them; do not add client-name branches or restate the architecture in a new guide.
- A separate actual-client attestation returned the expected echo result. That attestation did not exercise SSE. The public-relay harness continues to label host-side execution `remote:false` and `networkPath:"public-relay"`; it does not turn the echo attestation into remote SSE evidence.

Route definitions are data only. Each route needs its own deterministic and live acceptance evidence before promotion; a shared-hook proposal or adapter definition alone does not establish operational support.

## Requirement coverage and release meaning

Trace the normative requirements R01–R19 and journeys J01–J20. R0 creates a public coverage ledger with one owner, one evidence/acceptance reference, and one of four states for each item: evidenced in the baseline, owned by a route slice, assigned to a remaining piece below, or explicitly deferred by a product decision.

The 16 top-level pieces include explicit owners for provider-free source/artifact checks, signed extensions, legacy-configuration import and backend parity. R0 records acceptance or an accountable deferral for each. R8/R9 own public conformance fixtures now; external source edits require exact integrator-granted repository scope.

“Ready” requires current origin, application identity, required protocol checks, expiry and consent to match. “Live” requires an actual client result from the recorded vantage. A successful host-side probe is not a client observation. No private production service is exposed through an explicitly public demo exception.

## Remaining pieces

For each piece, `scope_paths` in [slices.md](slices.md) and the dispatch rules below are existing read inputs; `change_paths` are exact existing files permitted for edits; `output_paths` are exact new files. An empty `output_paths` means baseline behavior is already implemented and evidenced. No directory-wide ownership is implied.

### R0 — Requirement closure and release ledger

**State:** The planning basis defines the requirement set, design choices and adoption/parity contract. This piece publishes the coverage and release ledgers as new deliverables.

**Coverage:** R01–R19; J01–J20; all eight route slices; release evidence, platform/package rows, and product decisions.

**Change/output paths:** new `docs/roadmap/requirement-coverage.md`; new `docs/roadmap/release-acceptance.md`.

**Dependencies:** Public baseline docs and tests; owner decisions listed under “Decisions and gaps” below. R0 does not edit runtime code or invent the two embedding repositories' paths.

**Deterministic acceptance:** Every normative requirement and journey is accounted for with a source identifier, one accountable owner, an acceptance reference and a status. The ledger has no overlapping output paths and no “unknown” silently counted as success. List exclusions and deferred decisions explicitly.

**Live acceptance:** None. The ledger consumes release receipts from R6.

**Expect it to work because:** A trace ledger makes omissions and unowned obligations visible before implementation is dispatched, without inferring behavior from filenames or product aspirations.

### R1 — Complete the guided expose journey

**State:** The no-flag route journey has passing tool/SSE/status/stop evidence. Complete the remaining prerequisite/failure-path coverage; do not replace the prompt or build another wizard.

**Coverage:** R01–R02, R08, R13; J01–J05, J11–J17, J19.

**Change paths:** Existing `bin/gozar.mjs`; existing `test/node/entrypoint.test.mjs` only where the existing case needs extension.

**Output paths:** new `test/e2e/guided-expose-prerequisite.test.mjs`.

**Dependencies:** R3 admission/receipt hooks; existing status/stop views and generic profile data; R2 demo-server; exact-target consent remains mandatory. The selected route must not be inferred from a client product name.

**Deterministic acceptance:** Exercise the actual CLI with fake effects and TTY input for internet, tailnet, LAN and this-device; Enter, EOF and invalid choices; eligible/ineligible recommendation; exact port and target display; missing prerequisites; declined consent; JSON needs-action with a meaningful exit code; restart/timeout; and unsupported modes remaining blocked. Verify no mutation occurs before consent.

**Live acceptance:** The existing no-route-flag tool/SSE/status/stop run is baseline evidence. Close R1 by capturing a concrete prerequisite failure on the demo, while R6 separately closes actual-client streaming/vantage proof. Record route and client receipts separately.

**Expect it to work because:** The existing CLI already owns detection, recommendation, reach selection and exact-target approval; this piece proves their composition at the command boundary rather than duplicating their logic.

### R2 — One-command demonstration service

**State:** Complete in the baseline. Do not create a second server or re-register the command.

**Coverage:** J01, J03 and the demo acceptance slice of R6; R07 protocol evidence.

**Evidence paths:** `bin/gozar.mjs`, `harness/dummy-server.mjs`, `test/e2e/demo-server.test.mjs`, `README.md`.

**Remaining acceptance:** R6 uses this existing service in the public real-client journey. Existing local test source covers initialize/list/call, nonce/echo, timed SSE and signal cleanup. An internet-hosted client echo attestation exists; remote streaming/reconnect coverage remains with R6.

**Expect it to work because:** The current demo exercises the same identity, tool-call and streaming observations used by route verification, so it separates exposure failures from application failures.

### R3 — Shared integration and admission owner

**State:** R3a landed at `c4c1981`. R3b owns remaining parser/policy/platform hooks and serial runtime wiring. R3c–R3f are independently scoped modules; they do not edit shared runtime files.

**Coverage:** R02, R05–R14, R16–R18; all eight route slices; cross-target consistency. R3c owns the provider-free oracle, R3d signed extension admission, and R3e the generic legacy-import envelope.

**Change paths:** Existing `adapters/manifest.json`, `adapters/plan-contract.json`, `runtime/core-protocol.json`, `crates/gozar-core/src/lib.rs`, `crates/gozar-core/src/operational.rs`, `crates/gozar-core/src/bin/gozar-core-json.rs`, `packages/gozar-node/driver.mjs`, `packages/gozar-node/plan.mjs`, `packages/gozar-node/catalog.mjs`, `packages/gozar-node/controller.mjs`, `packages/gozar-node/daemon.mjs`, `packages/gozar-node/journal.mjs`, `packages/gozar-node/core.mjs`, `packages/gozar-node/render.mjs`, `packages/gozar-node/host.mjs`, `packages/gozar-node/private-files.mjs`, `packages/gozar-node/materialization.mjs`, `packages/gozar-node/transport.mjs`, `packages/gozar-node/bindings.mjs`, root `Cargo.toml` and `Cargo.lock`.

**Output paths:** new `test/integration/core-host-admission.test.mjs`; new `test/integration/cross-target-traces.test.mjs`; new `test/integration/secret-and-ownership-vectors.test.mjs`.

**Dependencies:** R3a supplies the landed materialization, transport, binding and receipt interfaces. R3b integrates R4 recovery policy, R5 auth composition, R7 session seam, R12/R13 host ports and each route slice only after its required hook and evidence are ready. R3c–R3f own the oracle, extension, importer and network-policy modules; R1 owns CLI wiring; R10 owns package registration. No other piece edits shared runtime files.

**Deterministic acceptance:** Unsupported feature on either core or host emits no effect; unknown fields reject; native and WASM traces agree; intent is durable before mutation; stale generation/cancelled completion/uncertain ownership fail closed; endpoint and transport mismatches reject; secret values do not enter state/events/argv; host-origin, client-vantage and public-relay proof remain distinct. R3c–R3f acceptance is defined below. Existing leaf tests remain green.

**Live acceptance:** Promote one route at a time after its slice acceptance and R6 receipt. Preserve provider baselines and protected/occupied routes. No route promotion follows from adapter data alone.

**Expect it to work because:** One owner controls the shared protocol and generic effects, preserving the decision/effect boundary and preventing incompatible feature or ownership semantics from being wired by separate leaves.

### R3b — Remaining shared hooks and serial integration

**Owned existing paths:** The shared runtime files reserved by R3 above. Only the integrator edits these files; leaf proposals and modules merge through this owner.

**New outputs:** `crates/gozar-core/src/json_records.rs`; `crates/gozar-core/tests/json_records.rs`; `packages/gozar-node/output-projection.mjs`; `test/integration/output-projection.test.mjs`; `test/integration/transport-policy.test.mjs`; `runtime/platform-port.schema.json`; `packages/gozar-node/platform-contract.mjs`; `test/integration/platform-port.test.mjs`; `docs/contracts/platform-port.md`; `packages/gozar-node/candidate-events.mjs`; `test/node/candidate-events.test.mjs`; `docs/contracts/candidate-events.md`.

**Interface/dependencies:** R3a is the base. Define bounded exact endpoint-record parsing (scheme, hostname, port and endpoint name, rejecting multiple distinct candidates), safe projection for credential-bearing process/API output, scoped policy/upstream evidence, the generic process/file/IPC platform port consumed by R12/R13, and required intent constraints for permitted public ports, address continuity, lifetime and TLS termination. Unknown required constraints must produce an unsupported action, never be silently ignored. Normalize old private-config declarations to the embedded materialization contract; do not add a second credential engine. The materialized child currently suppresses raw output, so an adapter cannot rely on its log parser until this projection/readback seam lands.

**Acceptance:** Actual core/driver tests reject wrong endpoints, malformed or excessive JSON records, output containing credentials, stale policy/target receipts and absent features before mutation. Positive and negative native/WASM traces agree. OS modules receive exact birth-identity, durable state and scoped termination contracts. Promote each adapter only after its live acceptance. R3b alone wires module imports, schemas, feature lists and catalog admission. The JSON-record parser, output projection, platform contract and candidate-event modules are separate build assignments with disjoint new files; they change no existing shared runtime files. Candidate events can request a fenced stop on rotation/exit/lease expiry, but cannot silently replace an origin or extend its lease.

**Expect it to work because:** The current exact receipt and durable-intent boundaries already isolate these checks; parser/projection tests can exercise finite records without opening real tunnels.

### R3c — Provider-free host oracle

**Coverage:** R16 and the unchanged-host acceptance gate.

**Output paths:** new `scripts/provider-free-check.mjs`; new `test/provider-free-check.test.mjs`; new `test/fixtures/provider-free/synthetic-adapter.json`; new `docs/contracts/provider-free-oracle.md`.

**Dependencies:** R3a/b catalog and package metadata; synthetic package fixture (signed-path integration after R3d); R8/R9 application artifact scopes later. The check accepts explicit host/runtime/adapter roots, scans source, schemas, manifests, resources and generated bundles, and distinguishes runtime-owned code using build provenance. No hard-coded host product or client name is needed in the checker.

**Deterministic acceptance:** With host artifact hashes fixed, install two synthetic adapters with different IDs, field names and copy but the same approved capabilities; exercise discovery→recommend→typed action→start→progress→origin acknowledgement→stop/reconcile. Mutation tests add a provider identifier, URL, SDK import, copy string and disguised branch; each fails the lint. Unknown runner/action versions return one generic unsupported action.

**Live acceptance:** Run the oracle on each granted host checkout and shipped artifact; adding an installed compatible adapter changes neither host source nor host build. Results are release evidence, not merely lexical scan output.

**Expect it to work because:** The source scan catches obvious leakage while the unchanged-artifact behavioral test catches provider assumptions that syntax scans cannot see.

### R3d — Signed third-party extension admission

**Coverage:** R17 and the safe extension portion of R11.

**Output paths:** new `adapters/package-manifest.schema.json`; new `packages/gozar-node/adapter-packages.mjs`; new `test/adapters/package-admission.test.mjs`; new `test/adapters/package-update.test.mjs`; new `test/adapters/fixtures/signed-synthetic-package/manifest.json`.

**Dependencies:** R3a versioned runner/action/protocol contract; established signed update metadata with pinned trust roots, expiry, delegation and rollback protection; R3c supplies the integration oracle after both independent modules build. Use an established TUF-style verifier; do not hand-write signature verification. Package identity/digest is not permission to expose a target or access a credential.

**Deterministic acceptance:** Reject changed digest, unsupported runner/schema, stale/revoked trust metadata, update racing an active session, shell/interpreter arguments, credential in argv/display, traversal/symlink, origin/network scope escape, oversized output and false TLS/stream claims. Positive signed packages using existing runners install without changing host source or shipping a new host release. Active sessions stay pinned; revocation closes new publication and allows only narrow authorized cleanup.

**Live acceptance:** Install a signed synthetic package from an approved test registry; verify trust expiry/revocation and rollback behavior, then run its tool/stream route and remove only owned resources. No provider account is required.

**Expect it to work because:** Signed immutable metadata establishes publisher and package identity, while the fixed runner and effect grants independently constrain what the package can do.

### R3e — Generic legacy-import envelope

**Coverage:** R18 migration transport and credential custody.

**Output paths:** new `runtime/legacy-import-schema.json`; new `packages/gozar-node/legacy-import.mjs`; new `test/import/legacy-import-contract.test.mjs`; new `test/import/legacy-import-idempotency.test.mjs`.

**Dependencies:** R3a opaque configuration and secure-input handles; R3d package/importer version admission; R8/R9 sanitized config fixtures and scoped current-backend reads. The importer runs in the constrained adapter environment; it receives an opaque config document and product-format ID, never branches in host code on vendor fields.

**Deterministic acceptance:** Import is idempotent; requests only exact ingress credential-purpose handles; produces a provenance-bearing review plan without starting a route; preserves the old config/receipt until explicit commit; interruption retries safely; unrelated app token/OAuth stores are unreachable. The importer validates source-shaped sanitized fixtures from both hosts.

**Live acceptance:** For each host, import the existing route/config without a new account or token prompt when the existing credential reference remains valid; preserve custody policy and do not start a route until consent/current-state checks pass.

**Expect it to work because:** A versioned import boundary converts opaque legacy records into a reviewable plan while the generic broker limits credential access to declared ingress purposes.

### R3f — Network policy and corporate-network diagnosis

**New outputs:** `packages/gozar-node/network-policy.mjs`; `test/node/network-policy.test.mjs`; `docs/contracts/network-policy.md`.

**Interface/dependencies:** R3a and R3b's effect seam. Accept an explicit, host-approved egress/proxy policy with opaque credential references. Diagnose policy refusal, DNS, TCP, TLS, relay and application failures as separate typed results. Do not silently bypass a required proxy, alter global DNS or weaken certificate checks. R3b owns runtime wiring.

**Acceptance:** Synthetic direct/proxy/policy-denied paths preserve hostname validation, bounded timeouts and secret custody; denied egress yields a concrete generic action. A real policy-approved environment must pass its advertised path before support is listed.

**Expect it to work because:** Explicit egress policy separates network authorization from route choice and lets the same bounded transport tests cover refusal and permitted access.

### R4 — Close remaining dead-resource recovery cases

**State:** Proved-absence recovery and old-controller handover are implemented and exercised on actual sessions. Extend remaining reboot/interruption coverage; reuse the current recovery implementation.

**Coverage:** R09–R10, R14; J04, J13–J16, J20.

**Change paths:** Existing `test/node/recovery.test.mjs` and `test/node/handover.test.mjs` only where coverage needs extension; runtime changes go to R3.

**Output paths:** new `test/e2e/recovery-dead-controller.test.mjs`.

**Dependencies:** R3 current recovery and receipt hooks; existing `recoverStop` fallback; R1 CLI.

**Deterministic acceptance:** Exercise failed stop control through the actual CLI fallback. Cover recorded child already gone, reused/replaced identity, stale controller endpoint, interrupted create/stop, route left after child exit, repeated stop and crash during retirement. Fresh proof of absence clears only the matching debt; unavailable/expired observations remain reconcilable; foreign processes/routes are untouched.

**Live acceptance:** On a disposable owned route, terminate only the owned controller/child, restart stop, inspect cleanup debt and prove a separate child and baseline route survive.

**Expect it to work because:** Existing recovery already distinguishes process absence from provider-route absence and refuses deletion when current route evidence conflicts; the new test closes the CLI/restart path around those proven rules.

### R5 — Preserve the application's authentication boundary

**State:** Proposed generic composition. Keep application identity and work authorization with the host. Do not add a second auth system unless product decisions require it.

**Coverage:** R05–R06, R11, R15, R19; J01–J03, J10–J13, J17–J20.

**Output paths:** new `packages/gozar-access/policy.mjs`; new `packages/gozar-access/guard.mjs`; new `test/access/access-boundary.test.mjs`; new `test/e2e/public-access-boundary.test.mjs`.

**Dependencies:** R0 confirms the policy boundary; R3a provides scoped private handles; R5 defines the application exposure policy; R3 wires publication; R1 and the existing status/stop views display non-secret state. Synthetic demo may be explicitly public; private workloads remain blocked until their existing host/application auth is preserved.

**Deterministic acceptance:** Protected mode denies unauthenticated, expired and wrong-audience requests; authorized calls and streams work; discovery/callback paths remain usable; upstream auth is not bypassed; secrets never appear in outputs; stop/restart cannot reopen an unguarded route.

**Live acceptance:** On the same disposable public endpoint, one authorized client succeeds and an independent unauthenticated client fails, including the streaming path. Verify the host's existing identity and auth remain authoritative.

**Expect it to work because:** The design composes route reachability with the application's current caller policy instead of mistaking TLS, nonce or OAuth-capability detection for authorization.

### R6 — Release journey and actual-client evidence

**State:** Existing harness proves host-side public-relay behavior; cross-client evidence is new. Do not relabel relay evidence as remote-client proof.

**Coverage:** R07–R08, R14–R15, R19; J01–J20 release-critical paths.

**Change paths:** Existing `harness/README.md`.

**Output paths:** new `harness/acceptance-matrix.mjs`; new `harness/real-client-receipt.mjs`; new `test/harness/acceptance-matrix.test.mjs`; new `test/harness/real-client-receipt.test.mjs`; new `test/e2e/real-client-journey.test.mjs`.

**Dependencies:** R2 existing demo; R1 CLI; R3 receipt/version hooks; route-slice tests; generic client-profile data. A supported client is selected by a data profile and observed version, never by a host code branch.

**Deterministic acceptance:** Validate receipt origin, session, generation and expiry; distinguish `remote:false` public-relay from actual client observation; fail a degraded route even when cleanup succeeds; require tool call and measured SSE spacing; redact metadata; verify baseline preservation.

**Live acceptance:** Capture the exact route, client/version, protection mode, platform and network vantage for list/call/stream, status, stop and reconnect/expiry. Run one route at a time; include successful and failed receipts.

**Expect it to work because:** Existing transport probes already measure route and stream behavior, while a separate actual-client receipt supplies the missing vantage and application result without changing the meaning of the relay proof.

### R7 — Stable embedding seam

**State:** Proposed dual-language API: Node/WASM for Dalan and a native Rust runtime/effect shim for PDP-Connect/data-connect. R3a is landed; R3b owns the remaining integration seam. R7a owns generic action rendering; R7b native Rust host runtime; R7c session SDK bindings; R7d authenticated remote control.

**Coverage:** R12–R13, R16; J04, J10, J13, J18, J20.

**Output ownership:** R7a owns the action schema and renderer; R7b owns the native Rust runtime; R7c owns the Node/WASM session SDK; R7d owns authenticated remote control. Their exact, disjoint new paths are listed in the subpiece sections below.

**Dependencies:** R3 versioned lifecycle events and durable-session hooks; R5 auth handles; R1/CLI action contract. The Rust runtime uses generic typed effects; no mandatory sidecar. The wrapper must not implement route logic or parse terminal prose.

**Deterministic acceptance:** Isolated concurrent sessions; abort during detect/create/probe; reconnect to persisted state; protocol-version mismatch; late events; no secret serialization; native Rust effect-shim conformance; status and stop without parsing stdout. CLI, desktop and web renderers consume the same bounded Action schema, with no custom provider widget or executable content.

**Live acceptance:** A small non-product fixture runs the demo through one supported route, resumes status, and stops it.

**Expect it to work because:** The seam wraps the existing controller and receipt model, allowing an app to request lifecycle operations without forking provider behavior.

### R7a — Generic action model and renderer

**Coverage:** R08 and R13 across CLI, desktop and web renderers.

**Output paths:** new `runtime/action-schema.json`; new `packages/gozar-sdk/action-renderer.mjs`; new `test/sdk/action-renderer.test.mjs`.

**Dependencies:** R3a action/receipt versioning; R1 CLI; R8/R9 renderer contract tests. Actions are bounded data: confirm, choose, form/secure-input, browser/device authorization, external task and progress/wait. No custom adapter UI component or executable markdown.

**Deterministic acceptance:** Same action and snapshot produce equivalent pending choice/validation/expiry in CLI, desktop and web test renderers. Answers bind to revision/session/generation; unknown action versions become a generic upgrade/manual action; secrets use write-only handles, never normal answers.

**Live acceptance:** A user completes the same consent and recovery action through each advertised renderer for the demo journey; unsupported browser effects fall back to manual copy/open.

**Expect it to work because:** One validated action schema and renderer contract keep the user decision identical even when each host supplies its own styling.

### R7b — Native Rust generic host runtime

**Coverage:** R12 and the native runtime requirement for PDP-Connect/data-connect.

**Output paths:** new `crates/gozar-host/Cargo.toml`; new `crates/gozar-host/src/lib.rs`; new `crates/gozar-host/src/platform/mod.rs`; new `crates/gozar-host/src/platform/linux.rs`; new `crates/gozar-host/tests/effect-contract.rs`.

**Dependencies:** R3 typed JSON protocol and durable-intent receipts; R3a feature negotiation; R4 recovery. This is a generic effect shim/runtime crate, not a Node wrapper or mandatory sidecar. It supplies native process, filesystem, keychain-reference, HTTPS, timer, entropy and durability boundaries under typed scope.

**Deterministic acceptance:** Native runner enforces bounded argv/output, secret-safe references, exact process ownership and durable-before-effect ordering; it rejects unsupported UI effects with a typed action and matches core golden traces. It contains no ingress provider names/commands/SDKs.

**Live acceptance:** A native fixture runs the demo route through the generic effect API, captures status and stops/reconciles with credentials in the app-scoped secure store.

**Expect it to work because:** The Rust crate calls the same sans-IO core and supplies only typed host capabilities, so native adoption does not fork provider semantics or require a sidecar.

### R7c — Node/WASM embedding SDK

**Coverage:** R12–R13, R16 and resumable lifecycle for the Node host.

**Output paths:** new `packages/gozar-sdk/index.mjs`; new `packages/gozar-sdk/session.mjs`; new `packages/gozar-sdk/browser.mjs`; new `packages/gozar-sdk/types.d.ts`; new `test/sdk/session-contract.test.mjs`.

**Dependencies:** R3 JSON lifecycle/events and durable-session hooks; R5 app-auth handles; R7a action contract; R3b CLI/host wiring. The Node entry wraps the controller; the browser entry loads browser WASM for planning/rendering and sends authorized effects through an injected authenticated host bridge. Browser code has no process, filesystem or keychain access. R10 owns generated browser asset registration.

**Deterministic acceptance:** Concurrent isolated sessions; abort through detect/create/probe; resume from persisted state; version mismatch and late events; no secret serialization; status/stop without stdout parsing. WASM and Node traces match native Rust fixtures.

**Live acceptance:** A small Node/WASM embedder fixture runs demo, status/resume and stop over one supported route.

**Expect it to work because:** A thin binding exposes the existing controller and the same versioned JSON contract without moving route decisions into TypeScript.

### R7d — Authenticated remote-control transport

**New outputs:** `packages/gozar-sdk/bridge.mjs`; `test/sdk/bridge.test.mjs`; `docs/contracts/host-bridge.md`.

**Interface/dependencies:** R7a action schema and R7c session API. Use an injected, authenticated product transport or a separately paired host; no unauthenticated localhost server. Bind commands and answers to host identity, user authorization, session, generation and action revision. A browser cannot acquire ambient host capabilities.

**Acceptance:** Reject wrong host/user/session, replayed or expired answers, unpaired controllers and unsupported effects; reconnect resumes only authorized state. A phone/browser completes a synthetic host action through the authenticated transport while an unauthorized peer cannot act.

**Expect it to work because:** The effect shim stays on the authorized host and the bridge carries the existing bounded command/action protocol instead of remote shell access.

### R8 — First embedding-application adoption

**State:** Dalan is the Node/WASM embedding target. Public integration-fixture paths are assigned below. External checkout edits require an exact integrator-assigned scope and must wait until PR 6 is merged.

**Coverage:** R05–R06, R08–R13, R16, R18–R19; the applicable product-specific journeys.

**Scope/change paths:** No Dalan source paths assigned here; integrator grants the repository-specific scope.

**Output paths:** new `test/integrations/dalan/legacy-config.fixture.json`; new `test/integrations/dalan/legacy-import.test.mjs`; new `test/integrations/dalan/provider-free-contract.test.mjs`; new `test/integrations/dalan/parity.test.mjs`. These are public conformance fixtures, not permission to edit Dalan source.

**Dependencies:** PR 6 merged before any Dalan checkout edit; R5 and R7; R3 shared contract; R6 evidence. Preserve Dalan’s own origin, identity, permissions and access policy. Its supported client paths must retain required public-port compatibility; a passing :8443 demo does not waive a host requirement for :443.

**Deterministic acceptance:** Dalan boundary tests for start, consent, action-needed, readiness, restart, cancel and stop; retain its trial and lasting-route behavior and origin/identity acknowledgments. The production host contains no provider names, commands, URLs, credential fields, SDK imports or setup copy. Generic Actions render installed compatible adapters without a host rebuild; unrelated settings remain unchanged.

**Live acceptance:** That application’s real local service completes an actual client call/stream through a supported route, resumes and cleans up without weakening existing auth or recovery.

**Expect it to work because:** A thin consumer can delegate generic route lifecycle to the shared seam while retaining its existing application authority and user data.

### R9 — Second embedding-application adoption

**State:** PDP-Connect/data-connect is the native Rust embedding target. Its external repository scope remains separate from Dalan.

**Coverage:** Same provider-free and parity requirements as R8, for the second consumer.

**Scope/change paths:** No data-connect source paths assigned here; integrator grants the repository-specific scope.

**Output paths:** new `test/integrations/data-connect/legacy-config.fixture.json`; new `test/integrations/data-connect/legacy-import.test.mjs`; new `test/integrations/data-connect/provider-free-contract.test.mjs`; new `test/integrations/data-connect/native-runtime.test.rs`; new `test/integrations/data-connect/parity.test.mjs`. These are public conformance fixtures, not permission to edit data-connect source.

**Dependencies:** R5 and R7; R3 shared contract; R6 evidence. R8 does not gate this consumer’s implementation.

**Deterministic acceptance:** Native Rust lifecycle/auth and shared effect-contract tests; no dependency on R8 UI/configuration. Replay existing ngrok HTTPS, TLS passthrough and TCP configurations plus named Cloudflare configurations against the selected real backend. Preserve stored domain/address behavior, credential custody and headless fallback, binary verification, cancellation/restart and owner-disconnect protection. Import unchanged valid settings without requesting another account or token. Never substitute a quick tunnel for named mode.

**Live acceptance:** The second application completes its own service/client journey and preserves its existing configuration on stop/recovery.

**Expect it to work because:** An independent consumer tests whether the embedding contract is truly generic without importing another application’s assumptions.

### R10 — Installable Node package

**State:** New distribution work. Current package is private and requires a source build.

**Coverage:** R12, R15, R19; J01–J20 packageable supported subset.

**Change paths:** Existing `package.json`; existing `scripts/build-wasm.sh` only if needed for reproducible asset generation.

**Output paths:** new `packages/gozar-release/manifest.json`; new `scripts/package-node.mjs`; new `test/packaging/npm-release.test.mjs`.

**Dependencies:** R3 versioned core/catalog assets; R1 CLI; R2 demo command; R7 export if approved; R6 support matrix. The name/registry is a separate release decision; no availability claim.

**Deterministic acceptance:** Pack to an isolated archive; inspect exact files, licenses, entrypoints and relative-import closure; install in a clean directory; run help/demo and fake-effect expose offline; verify runtime minimum, asset/version consistency and absence of secrets/test residue.

**Live acceptance:** Approved staging install on a clean supported Linux host completes the R6 journey without Rust or build tools.

**Expect it to work because:** The current host already runs on Node; packaging its compatible generated core and catalog removes a user build prerequisite without changing lifecycle behavior.

### R11 — Single-download executable

**State:** Proposed distribution goal pending a packaging feasibility spike. A core-only binary is not the full application.

**Coverage:** R12, R15, R19.

**Output paths:** new `distribution/manifest.schema.json`; new `scripts/package-binary.mjs`; new `test/distribution/binary-package.test.mjs`.

**Dependencies:** R10 release manifest and R3 protocol; R12/R13 native host support. Select an implementation only after proving the whole host, catalog and generated assets can ship together. Provider executables/accounts remain separate prerequisites unless an approved policy says otherwise.

**Deterministic acceptance:** On a clean machine without Node/Rust, launch from a read-only install location and outside the working directory; verify assets, version/protocol equality, upgrade/rollback, checksum/signature and missing-provider messages.

**Live acceptance:** Per advertised OS/architecture, run demo → expose → actual client → stop from the downloadable artifact.

**Expect it to work because:** A shared release manifest can bind the executable to the same core/catalog versions accepted by the Node package; a compatibility spike settles the unresolved bundling method before claims are made.

### R12 — macOS host port

**State:** New native-host support. Native Rust or WASM compilation alone is not host support.

**Coverage:** R09–R12, R14, R18–R19; supported journeys on macOS.

**Output paths:** new `packages/gozar-node/platform/darwin.mjs`; new `crates/gozar-host/src/platform/darwin.rs`; new `test/platform/darwin/process-ownership.test.mjs`; new `test/platform/darwin/private-state.test.mjs`; new `test/platform/darwin/recovery.test.mjs`.

**Dependencies:** R3 provider-neutral host-port contract; R4 recovery rules; R10/R11 packaging. Keep OS-specific effects generic and platform-owned, not provider-owned. Exercise both the CLI Node host and the native Rust shim; one does not establish portability of the other.

**Tailscale LocalAPI transport:** durable Tailscale routes use the LocalAPI (see `docs/design/durable-routes.md`). On Linux that is the tailscaled unix socket. On macOS the Mac App Store and standalone Tailscale apps reach the LocalAPI on loopback with a token instead; do not assume the Linux transport carries over. R12 must discover and test that transport.

**Deterministic acceptance:** Birth-identity and scoped termination; PID reuse; private journal permissions and durable writes; stale socket/restart; signal/cancel behavior; listener collisions and foreign-resource preservation.

**Live acceptance:** On supported macOS versions, complete supported route/client flows and recovery; confirm unrelated processes/routes survive stop.

**Expect it to work because:** A platform port can implement the same typed host effects and ownership receipts with native primitives, while separate platform tests verify those semantics.

### R13 — Windows host port and explicit WSL row

**State:** New native Windows support; WSL is a separate optional support row, not proof of native parity.

**Coverage:** R09–R12, R14, R18–R19; supported journeys on each advertised Windows target.

**Output paths:** new `packages/gozar-node/platform/win32.mjs`; new `crates/gozar-host/src/platform/win32.rs`; new `test/platform/win32/process-ownership.test.mjs`; new `test/platform/win32/private-state.test.mjs`; new `test/platform/win32/recovery.test.mjs`.

**Dependencies:** R3 host-port contract; R4 recovery; R10/R11 distribution. Publish a platform matrix that labels native Windows and WSL separately. Exercise both Node and Rust host shims; WSL does not prove native Windows support.

**Deterministic acceptance:** Exact process-handle ownership and child-tree termination; PID reuse; ACL-protected state; path and argv handling without a shell; locked-file/restart behavior; port collision and unavailable-provider handling.

**Live acceptance:** Native Windows supported route/client and cleanup. Run WSL separately only if it is advertised.

**Expect it to work because:** The shared core can stay unchanged while a native host port supplies Windows process, filesystem and IPC effects with its own ownership and persistence evidence.

### R14 — Define the this-device outcome

**State:** Decision/coverage item. The CLI accepts `this-device` reach, but no direct loopback-only adapter is listed in the current catalog. Do not assert global absence until R0 checks the full core contract.

**Coverage:** R01–R02, R06–R07, R12–R14; J17.

**Output paths if R0 confirms a missing mode:** new `adapters/this-device.definition.json`; new `test/adapters/this-device-plan.test.mjs`; new `test/e2e/this-device-client.test.mjs`.

**Dependencies:** R0 contract check; R3 admission/manifest hook; R1 choice wiring. Reuse an existing loopback-only path if one exists. A public provider fallback is not an acceptable substitute.

**Deterministic acceptance:** Selection emits no public/provider mutation; exact loopback target and honest auth/transport label; remote reach cannot be inferred from host-local success; unrelated listeners stay untouched.

**Live acceptance:** A local MCP client calls the demo without relay, provider login or public listener.

**Expect it to work because:** A local client can use a local-only path when one is selected, and the acceptance proof explicitly excludes external reach claims.

### R15 — User guide and support matrix

**State:** Generic architecture and route-slice docs exist. Complete the newcomer guide and release support matrix without copying provider implementation details into host code.

**Coverage:** R01–R08, R13–R15, R19; all 20 journeys at the documented supported scope.

**Change paths:** Existing `README.md`.

**Output paths:** new `docs/user/quickstart.md`; new `docs/user/supported-capabilities.md`; new `docs/user/recovery-and-removal.md`.

**Dependencies:** R1 CLI help; R2 demo; R5 auth policy; R6 receipts; R7 embedding seam; R10/R11 install paths; R12/R13 platform matrix; completed route slices. Do not replace `docs/architecture.md` or rewrite slice contracts.

**Deterministic acceptance:** Commands match the packaged CLI; links resolve; capability claims cite a versioned receipt or say planned; failures map to actual typed actions; action totals separate known and unknown terms; no secrets/private paths or named-client dispatch instructions.

**Live acceptance:** A newcomer follows install/quickstart only to an actual client call/stream, status, stop and safe removal on each advertised platform; repeat recovery and uninstall.

**Expect it to work because:** One user guide can join the already-separated build, route and verification steps while keeping generic architecture and adapter contracts in their existing documents.

## Four waves

### Wave 1 — A person can test the current route loop

Run the remaining R1 journey test, R4 CLI fallback coverage, R6 real-client receipt and R15 quickstart. R2 is already complete and is the demo input. R0 creates the requirement ledger in parallel. R3a is landed; R3b is not a Wave 1 prerequisite for the two already operational routes if existing hooks suffice. R10 may begin a clean-package spike but does not gate the source-build demo.

Keep the reach question and separate exact-target approval. Treat “no route flags” as no `--adapter` or `--client-reach`; continue to pass the required local port. The synthetic demo can be explicitly public with its relay disclosure and current local expiry. Do not expose private services until R5 confirms the host auth policy.

**Exit:** from a pinned development build, start the existing demo, run the CLI without route/client-mode flags, approve the displayed target/route, use a real client for a tool call and timed stream, inspect status, stop twice, then exercise recovery and preserve a foreign resource. Record success and failure receipts. Relay and client-vantage claims stay separate.

### Wave 2 — Shared contracts and production boundaries

R3a is landed; complete R3b next. R3b integrates the eight existing route slices one at a time after their needed hooks exist and their acceptance passes. Complete R4, decide and implement R5, define R7, and ship R10. R6 expands route/client evidence; R15 documents only the verified subset. R14 can proceed after its direct-path check.

**Exit:** supported routes reject unsupported features before effects; an authenticated existing application uses the verified route subset; interruption recovery works; a clean Node install can run the demo and lifecycle without source compilation. New adapter data does not become executable authority without admission.

### Wave 3 — Embedding and additional platforms

Assign R8/R9 only after each host repository and exact file scope is granted. They may proceed independently against the frozen R7/R5 contract. R12/R13 can proceed in parallel after R3's native host-port contract is stable. R11 develops against R10's manifest but publishes only platform variants with native tests. R6 gathers actual-application/client/platform receipts; R15 updates the support matrix.

**Exit:** each advertised app/platform/distribution cell has route, client/version, protection mode, vantage, proof, expiry and cleanup evidence. Not every combination must ship, but the supported subset is explicit.

### Wave 4 — Requirement closure and release maintenance

R0 closes all requirements to evidence or an explicit product decision; any requirement R16/R17/R18 implementation without an owner remains a release blocker. R6 runs the advertised matrix against release candidates. R10/R11 verify archive contents, checksums, upgrade and rollback. R15 checks onboarding, support, recovery and uninstall. Include expired proof, changed origin, cancel during startup, provider outage, controller loss, account/profile change, credential handoff interruption and safe retry.

**Exit:** no “complete” claim while provider-free host oracle, compatible extension admission, legacy import/parity, adoption scope, distribution budgets or advertised-cell evidence remain unknown.

## Decisions and requirement gaps

| Issue | Current evidence and plan treatment |
|---|---|
| One question versus approval | The location question is separate from exact target/route consent. Keep both until a product decision explicitly defines a combined action without weakening consent. |
| Trial cap | Current CLI/docs describe a 15-minute gate; the design proposes a 30-minute maximum subject to approval. Preserve current 15-minute behavior until approved; do not silently change it. |
| Application auth | The host owns caller identity, origin, callback and work authorization. Keep existing auth; a generic guard is conditional, not an excuse to replace it. Explicitly label the synthetic demo public. |
| Host adoption | R8/R9 public conformance fixtures are assigned here; external repository edits wait for exact integrator-granted scopes. Dalan edits additionally wait for PR 6 to merge. |
| Extension package trust (R17) | R3d owns signed declarative package admission, pinned trust metadata, revocation/update races and malicious recipe vectors. No arbitrary code or command strings. |
| Provider-free oracle (R16) | R3c owns source/AST/artifact checks and unchanged-host synthetic-adapter tests; R8/R9 run them against their separately scoped application artifacts. |
| Legacy import and parity (R18) | R3e owns the generic importer envelope; R8/R9 own sanitized product fixtures and backend-parity tests. Host cutover remains blocked until both pass against the real backends. |
| Mobile-only controller (J10), corporate network (J12) | R7d owns authenticated remote-control transport; R3f owns policy-approved network configuration and diagnosis. Neither permits unauthenticated local execution or bypass of network policy. |
| This-device (J17) | CLI reach filtering exists; a local-only route is not listed. R14 reuses one if present or proposes a data plan after contract inspection. |
| Action count and setup branches | Use the atomic reference ledger below, adding acquisition/setup branches: J01 `17 + A + U + P + D`, J03 `16 + H + A + U + P`; kit subcounts are not whole-journey totals. Keep auth/MFA, client UI, app switch, OS grant and unknown work visible. |
| Windows and WSL | Publish independent support rows. Linux evidence, WASM builds and WSL execution do not establish native Windows/macOS host parity. |
| Existing provider modes | Preserve current saved configs, credential custody, routes, TLS modes and ownership semantics; require mode-by-mode parity before cutover. Do not infer it from a passing new adapter fixture. |

Runtime support changes only after the owned implementation and its acceptance merge. External application edits and registry publication remain separate release actions.

## Dispatch and current build readiness

Existing files listed under each piece are editable only by that owner; all other dependency reads are read-only. Add each **new** output to `output_paths`, never solely to `scope_paths`. Include these existing common read inputs in every runtime/adapter assignment: `README.md`, `docs/architecture.md`, `docs/contracts/private-files-and-transports.md`, `runtime/core-protocol.json`, `adapters/plan-contract.json`, `packages/gozar-node/driver.mjs`, `packages/gozar-node/plan.mjs`, `packages/gozar-node/host.mjs`, `packages/gozar-node/materialization.mjs`, `packages/gozar-node/private-files.mjs`, `packages/gozar-node/transport.mjs`, `packages/gozar-node/journal.mjs`, `packages/gozar-node/controller.mjs`, `crates/gozar-core/src/lib.rs`, `crates/gozar-core/src/operational.rs`, and the relevant existing tests. Add dependency outputs as read inputs only after they exist. Generated WASM is built with the documented script, not assumed to exist in a clean checkout.

- **Build now:** S1 data/blocked-contract tests, S2 normalization/tests, S3–S8 bounded modules/data/tests, R0 ledger, R1/R4 remaining acceptance, R3b shared hooks, R3c oracle, R3d extension verifier/schema, R3e importer envelope, R3f network policy, R5 auth policy, R6 receipt validator, R7a action schema, R10 package spike and R15 current quickstart. A module can build against the published JSON contract; cross-module execution waits for its dependency and R3b wiring.
- **Build after interface merge:** R7b native runtime after the effect/platform port, R7c SDK after action/session seams, R7d bridge after action/session API, R11 executable after the package manifest, R12/R13 native ports after the platform-port schema. R14 can prepare the loopback-only data plan now; the integrator admits it after local-vantage tests.
- **Adopt after parity:** R8/R9 conformance fixtures may be prepared from sanitized current-backend records now. Actual external checkout changes wait for scoped repository assignments; Dalan also waits for PR 6 merge. Neither host cuts over until its provider-free oracle, importer, credential custody and current-mode parity pass.
- **Serial live acceptance:** Only the integrator allocates live routes, one provider test at a time. Leaf fixtures use fake effects or disposable local resources. Preserve unrelated processes, shared listeners and owner-managed DNS/tunnels.

Shared-file edits remain serial under R3; R1 owns `bin/gozar.mjs`, R10 owns `package.json` and build/package registration, R15 owns `README.md`. No other piece owns those files. R7 is an umbrella; R7a–R7d have disjoint output paths. R3 is an umbrella; R3b owns existing runtime wiring while R3c–R3f own only their named new outputs.

## Requirement and journey ownership

| Requirement | Primary pieces | Current coverage/gap |
|---|---|---|
| R01 minimum questions | R0, R1, S8 | Reach prompt exists; complete eligibility and failure journey still needs end-to-end evidence. |
| R02 eligibility | R1, R3, S1–S8 | Generic reach filtering exists; R3a materialization/mapping are landed; remaining route hooks belong to R3b. |
| R03 trial boundary | R0, R3, S6, R15 | Existing trial bound is 15 minutes; proposed 30-minute default is unresolved. |
| R04 continuity | R3, R6, R7, R8/R9 | Host origin/issuer handoff and real client migration need parity evidence. |
| R05 traffic trust | S1/S2/S6, R3, R15 | Existing relay disclosure remains; expand per verified route and termination mode. |
| R06 app security | R5, R8/R9 | Host-owned auth is normative; generic guard is conditional; host integration remains scoped later. |
| R07 protocol proof | R3, R6, S1–S8 | Host public relay probes exist; actual client, OAuth, forwarded auth and optional WebSocket proof are not universal yet. |
| R08 progress/errors | R1, S7, R6 | Status views are proposed, not implemented. |
| R09 cancel/restart | R3, R4, S6/S7 | Baseline lifecycle and dead-resource recovery exist; route-specific hook coverage remains. |
| R10 route ownership | R3, R4, S1–S7 | Baseline ownership ledger exists; each new adapter needs real exact-readback acceptance. |
| R11 automation bounds | R3, R5, S1–S8 | R3a secret/effect hooks are landed; R3b owns remaining parser/policy hooks. |
| R12 portability | R3, R7, R10, R12/R13 | Current host is Linux/Node; cross-target host support is new. |
| R13 UI parity | R1, R7, S7 | CLI reach exists; embedding/UI contract and status/stop views remain. |
| R14 availability | R1, R3, R4, R6 | Recovery and existing relay tests exist; outage/expiry matrix remains. |
| R15 privacy/terms | R1, R5, R6, R15 | Redaction baseline exists; route cost/terms and retained metadata need support-versioned docs. |
| R16 provider-free host | R3c, R7, R8/R9 | R3c owns the oracle; R8/R9 apply it to their scoped artifacts. |
| R17 compatible extensions | R3d, R10 | R3d owns signed metadata admission, update and revocation checks; package delivery remains with R10. |
| R18 backend parity | R3e, R8/R9 | R3e owns the generic importer; each host owns sanitized fixtures and parity evidence. Cutover requires both host suites. |
| R19 honest drawbacks | R0, R6, R10/R11, R15 | Budgets for runtime size/startup, migration and platform matrix must be named before release. |

| Journey | Pieces | Remaining decision/evidence |
|---|---|---|
| J01 trial | R1–R6, R15, S6/S8 | Preserve exact target consent; real client proof; 15 vs proposed 30-minute cap. |
| J02 first real setup | R0, R3, R5, R6, R15, S1/S2 | Provider authority, terms/cost and protected app readiness. |
| J03 trial to lasting route | R1, R3–R8, R15 | New origin/issuer/client reconnection; do not retire trial before destination proof. |
| J04 returning user | R3/R4/R6 | Consent/account fingerprint, expiry and safe restart. |
| J05 existing provider setup | R1/R3/R6, S5 | Fresh eligibility and exact mapping; no silent enablement. |
| J06 named tunnel | R3/R6, S2 | Private token materialization and current hostname/tunnel authority. |
| J07 stored token | R3/R5/R6, S1 | Opaque secret reference and entitlement proof, no secret echo. |
| J08 own domain | R3/R6, S4 | Ownership/route authority and no external deletion on stop. |
| J09 existing SSH key | R3/R4/R6, S6 | Only scoped local permission; no unrelated agent mutation. |
| J10 mobile controller | R7/R8/R9 | R7d owns authenticated paired-host control; no web-only local execution claim. |
| J11 headless setup | R3/R5/R7, S1/S2/S6 | Only verified provider auth flows; no password/stdout or fabricated device flow. |
| J12 corporate network | R1/R3/R15 | R3f owns policy-approved network configuration and failure classes. |
| J13 rotation | R3/R4/R6/R7, S4/S6 | Generation fencing, consent scope and client re-registration. |
| J14 provider outage | R1/R3/R6 | Bounded retry and explicit switch consent; no security downgrade. |
| J15 stop/uninstall | R4/R6/R15, S7 | Proved removal vs visible debt; separate stop from broader forget/revoke. |
| J16 shared accounts/routes | R3/R4, S1/S2/S5 | Exact identity/ownership; no ranking tie or global reset. |
| J17 local/LAN/private | R1/R3/R14, S3/S5/S8 | `this-device` direct path unresolved; LAN/tailnet proof remains mode-specific. |
| J18 remote owner route change | R5/R7/R8/R9 | Recovery channel and impact acknowledgement are app-specific. |
| J19 wrong console | R3/R6, S4/S8 | Fresh host identity challenge; HTTP success is insufficient. |
| J20 credential handoff interrupted | R3/R4/R5/R8/R9 | Durable write-once acknowledgement and host secure-store custody. |

## Counting the complete user journey

Reference counts start with the service running, required binaries installed and an eligible signed-in client account. They end at the first approved tool result. Count commands, answers, clicks, field entries, copy/paste, app switches and approvals individually; reading and waiting count zero. Add acquisition/enrollment/provider setup as **P**, and starting the demo as **D**, rather than silently treating them as free.

- J01 remote-client reference: **17 + A + U + P + D**. Known reach removes one answer; no-auth removes two authorization actions. **A** counts extra credentials/MFA/auth screens; **U** counts additional client controls/navigation. Conditional rows are removed only when an observed path proves they were absent.
- J03 trial-to-lasting-route reference: **16 + H + A + U + P** with an eligible existing lasting provider. **H** is the application's separate origin/identity acknowledgment. Preserve the trial until the replacement client connection succeeds within the original lease. New-provider setup and optional removal of the old client entry are additional work.
- These are explicit reference paths, not measured universal counts. The current no-flag CLI removes provider-selection flags and manual validation commands. R6 must publish comparable before/after atomic receipts for the actual generic remote-client journeys, including its authentication selector, before claiming a numeric end-to-end reduction. Optional install-link templates are data and must still count link opening, confirmation and remaining sign-in steps.

The J01 base of 17 consists of these reference actions; conditional actions are marked:

1. Focus the terminal.
2. Submit the exposure command.
3. Answer client location (omit when the host supplies it).
4. Approve the exact target and route.
5. Copy the printed MCP URL.
6. Switch to the MCP client.
7. Open connection settings.
8. Choose Add connection.
9. Enter a connection name.
10. Paste the URL.
11. Save the connection.
12. Start sign-in (when required).
13. Approve application authorization (when required).
14. Select the connection for a tool request.
15. Enter the request or tool arguments.
16. Submit the request.
17. Approve the tool call (when required).

An authentication-mode selector adds an action under U even when the chosen mode is none. Result arrival is not an action. The J03 base is three migration actions (switch to the existing console, submit setup, approve the new route) followed by J01 actions 5–17 for a replacement connection.
