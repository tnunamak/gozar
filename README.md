# Gozar

Give a local MCP server an address your client can reach. Gozar detects available routes, recommends one, checks the connection, and removes only what it created.

```sh
node bin/gozar.mjs expose --port 18765
```

It asks where the client runs, shows the recommended route and asks for approval. For an internet client, HTTPS and streaming checks run automatically. The output includes the full `/mcp` URL to paste into your client.

## Build from source

Use Linux, Node 22+, Rust and OpenSSH. Tailscale Funnel also needs a signed-in Tailscale client with MagicDNS, HTTPS and Funnel permission. The localhost.run trial needs no tunnel-provider account.

```sh
git clone https://github.com/tnunamak/gozar.git
cd gozar
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
bash scripts/build-wasm.sh
```

The build creates the WASM bindings used by the CLI. `WASM_BINDGEN` and `CARGO_TARGET_DIR` can select existing tools and build caches. Run `npm link` if you want to type `gozar` instead of `node bin/gozar.mjs`.

## Try the echo server

Start the demo in one terminal:

```sh
node bin/gozar.mjs demo-server --port 18765
```

In another terminal:

```sh
node bin/gozar.mjs expose --port 18765
```

Choose `internet` for an internet-hosted MCP client, then approve the route. Add the printed `/mcp` URL to your client. For this demo, select **no authentication** and call `echo` with `{"echo":"hello"}`. The result includes your text and this server's instance nonce. The demo serves Streamable HTTP and SSE.

Inspect and stop the route:

```sh
node bin/gozar.mjs status
node bin/gozar.mjs stop
```

Stop the demo server with Ctrl+C. For multiple services, add `--port N` to `status` and `stop` to select the exact session.

## Choose a route

```sh
node bin/gozar.mjs detect --port 3000
node bin/gozar.mjs expose --port 3000 --client-reach internet
```

Detection lists the catalog's modes and their current observations. Finding a command does not establish login state or permission. `--alternatives` expands the route list; `--adapter ID` selects one. `--json` returns states and actions for automation. `--yes` approves the selected route and exact local target.

Public routes include the localhost.run trial and Tailscale Funnel on an unused `8443` listener. Funnel uses an owned foreground process and preserves existing listeners. The trial uses isolated SSH state; the relay terminates TLS and can read forwarded traffic.

An owner-managed HTTPS address stays under its owner's control. Supply `--origin https://service.example`; Gozar prints the local proxy target. Point your existing proxy at it, then run `gozar health --port N` to validate the route. Stop closes Gozar's local proxy without deleting your ingress or DNS.

Private tailnet and LAN routes require a trusted verifier on the intended client network before publication. LAN uses an explicitly selected interface and firewall approval; its HTTP route cannot satisfy an HTTPS requirement. Ngrok and named Cloudflare tunnels appear in detection for the next drop.

## Connection and lifetime

Gozar adds no application authentication. Keep the authentication your own service requires. A successful route check does not authorize callers or prove that your MCP client has connected.

For public routes, Gozar resolves the hostname through public DNS, pins a public IP, checks the original TLS hostname and a fresh instance nonce, and measures streamed delivery. This proof crosses the provider's public relay from the host; it is recorded as `remote:false`.

The current instance proxy lasts up to **15 minutes**. Keep the device and service awake. After sleep or network loss, run `gozar health --port N`. After expiry, stop the session and expose it again. A trial URL can change or expire earlier.

## Develop

A Rust core makes decisions without performing I/O. It compiles to native Rust and WASM; a Node host executes typed effects. Provider behavior lives in adapter data. See the [architecture](docs/architecture.md), [wire contract](runtime/core-protocol.json) and [adapter guide](adapters/INTEGRATION.md).

```sh
cargo test -p gozar-core
cargo build -p gozar-core --bin gozar-core-json
node --test --test-concurrency=2 test/adapters/*.test.mjs test/e2e/*.test.mjs test/node/*.test.mjs
node crates/gozar-core/tests/golden.cjs
node crates/gozar-core/tests/operational-golden.mjs
node crates/gozar-core/tests/public-relay-golden.mjs
```

The [live harness](harness/README.md) checks a real MCP tool call, streamed delivery and cleanup against the provider's original configuration.

## Keep an existing service address

For a service already listening behind your reverse proxy, use `gozar service add --origin https://service.example --target HOST:PORT --json`. This records and verifies the existing route without a local proxy or expiry. `gozar service status --json` checks it again; `gozar service remove --origin https://service.example --json` deletes only its record. See [service routes](docs/service-routes.md) for the service challenge, trusted host check command and JavaScript API.
