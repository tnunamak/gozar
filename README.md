# Gozar

Gozar exposes a local service through a provider chosen from a shared adapter catalog. A Rust sans-IO core makes the lifecycle decisions, while a small Node host executes typed process, file, network and timer effects. The same core compiles to native Rust and WebAssembly.

The current Linux host supports **localhost.run trials** and **Tailscale Funnel on an unused port 8443**. Detection also inventories Tailscale private Serve, ngrok, Cloudflare named tunnels, LAN and owner-managed HTTPS addresses. These additional modes appear as `NEXT DROP` in the CLI.

## Build

Use Node 22+, a Rust toolchain, OpenSSH and the pinned wasm-bindgen CLI. Funnel also needs an installed, signed-in Tailscale client with HTTPS, MagicDNS and Funnel permission.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
bash scripts/build-wasm.sh
```

The generated WASM bindings stay in `packages/gozar-core/generated/`. `CARGO_TARGET_DIR` and `WASM_BINDGEN` can select existing build tools and caches.

## Expose a service

Start your service on a loopback port, then run:

```sh
node bin/gozar.mjs detect --port 3000
node bin/gozar.mjs expose --port 3000
node bin/gozar.mjs status --port 3000
node bin/gozar.mjs stop --port 3000
```

`expose` asks where the client runs, recommends an eligible route and requests approval for the exact local target. Choose a route explicitly with `--adapter localhost-run` or `--adapter tailscale-funnel`. `--json` returns machine-readable states and actions. `--yes` records consent for the selected route and target.

Before publication, Gozar resolves the public hostname through DNS over HTTPS, pins a public IP, validates the original TLS hostname, checks a fresh instance nonce and measures incremental SSE delivery. The receipt identifies this as a public relay path with `remote:false`; it describes the network path traversed from the host.

The current controller gate has a 15-minute lifetime. A localhost.run trial uses isolated SSH state; its relay terminates TLS and can read the forwarded traffic. Funnel uses a dedicated, freshly checked 8443 listener and an owned foreground process. Stop removes only resources recorded for that session and preserves existing listeners and configuration.

## Verify

```sh
cargo test -p gozar-core
cargo build -p gozar-core --bin gozar-core-json
node --test --test-concurrency=2 test/adapters/*.test.mjs test/e2e/*.test.mjs test/node/*.test.mjs
node crates/gozar-core/tests/golden.cjs
node crates/gozar-core/tests/operational-golden.mjs
node crates/gozar-core/tests/public-relay-golden.mjs
```

The tests cover ordered observations, durable intent, exact ownership, cancellation, stale completions, guarded cleanup, public-IP pinning and streamed delivery. The [live harness](harness/README.md) creates a disposable MCP service, checks an actual tool call and SSE stream, then verifies cleanup against the full provider baseline.

See the [architecture](docs/architecture.md), [wire contract](runtime/core-protocol.json) and [adapter authoring guide](adapters/INTEGRATION.md). Source is hosted at [github.com/tnunamak/gozar](https://github.com/tnunamak/gozar).
