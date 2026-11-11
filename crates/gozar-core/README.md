# Rust transition core

`step(inputJson)` returns JSON state, events, typed effects, a snapshot, and an optional action. The library performs no IO and reads no clock or random source. A separate native JSONL runner and the wasm-bindgen Node export execute the same machine. IP parsing in binding validation uses value types only and opens no socket.

The wire format is in `runtime/core-protocol.json`. Adapter and client identities are opaque. Operational definitions opt in with `planVersion:1`; the whole declared feature set must be supported by both core and host. Unknown guards, captures, bindings, or executable fields reject the entire plan before execution. Existing non-plan recipes retain the initial conservative admission rules.

The trusted private `host` input supplies monotonic time, typed binding authorities, prerequisite receipts and probe authorization. It is not user-answer data. The host must admit secret-free definitions, persist returned state, and validate every effect against its exact adapter recipe reference. Private files remain scoped handles; file contents and private paths do not enter state. Only explicit typed nonsecret captures survive provider observations.

## Check

From the repository root:

```sh
nice -n 19 ionice -c 3 env CARGO_BUILD_JOBS=2 cargo test -p gozar-core
nice -n 19 ionice -c 3 env CARGO_BUILD_JOBS=2 cargo build -p gozar-core --bin gozar-core-json
scripts/build-wasm.sh
nice -n 19 ionice -c 3 node crates/gozar-core/tests/golden.cjs
nice -n 19 ionice -c 3 node crates/gozar-core/tests/public-relay-golden.mjs
nice -n 19 ionice -c 3 node crates/gozar-core/tests/operational-golden.mjs
```

Native golden tests use `GOZAR_NATIVE` when set; otherwise they resolve `debug/gozar-core-json` under `CARGO_TARGET_DIR` or the repository’s `target` directory. The build script also honors `CARGO_TARGET_DIR`.

The build script requires wasm32-unknown-unknown and wasm-bindgen CLI 0.2.105. Set `WASM_BINDGEN`, put the binary on PATH, or use `~/.cache/gozar/wasm-bindgen/0.2.105/wasm-bindgen`. The generated bindings have their own CommonJS package boundary.

The original golden executes actual `ssh -V` from fixture data and compares native/WASM transitions. The operational golden compares both compiled targets through normalized adapter plans using synthetic outcomes. It executes no provider command. Native tests retain the lifecycle counterexamples and cover fresh preflight, durable intent, late allocations, port occupancy, exact cleanup continuity, identity changes, local handle inspection and health revocation. The adapter-owned WASM tests exercise the actual normalized definitions.

## Operational boundary

Plans serialize bounded before steps, prerequisite checks, a durable exact intent, execution, and after readbacks. An expired observation or changed authority blocks mutation after persistence as well. Original resource bindings survive stop: cleanup never selects a replacement port or replaces saved identity with current identity. Raw record assertions run before whitelist capture, preserving checks for extra administrator fields. Local process and forwarder cleanup first requests intrinsic immutable-handle inspection. Unknown continuity or changed current records leave cleanup debt. A stopped owned process can retire already absent allocation debt with `reconcile-absent` only when a fresh trusted `host.cleanupAbsent[resourceId]` receipt matches its original session, handle and continuity reference and proves both process and provider mapping absent. This transition emits no effects and preserves uncertain creates and other resource debt.

Probe readiness requires a fresh exact nonce, verifier, origin, network vantage and requested protocol receipt. Nonlocal reach requires a remote verifier receipt, or an explicitly authorized public-relay receipt with a pinned public DNS address for public vantage. Local execution remains `remote:false`; LAN and tailnet still require remote proof. Expiry and health failures revoke publication; external-owned health/rotation never emits provider create/remove. This core does not implement the external verifier service.

Private config/file materialization, JSON-record streams and transport-origin remapping remain unsupported features, so plans that need them remain blocked. Synthetic receipts prove interpreter behavior, not live ownership, provider parity or actual outside reach. The host owns real process birth identity, private-file permissions, continuity proof, provider concurrency controls and disk durability. Uncertain creates retain their request and cannot be retried blindly.
