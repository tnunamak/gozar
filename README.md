# Gozar

One interface for tunnel and route providers.

Gozar is one standard interface over tunnel and route providers, from Tailscale to an address you own. It detects what's available, recommends a route by who must reach your service, sets it up with your approval, verifies it, and removes only what it created.

For developers sharing local services and host applications that arrange reachable addresses for their users. Exposing an MCP server is one use case, not a requirement for using Gozar.

## Install

Use Linux and Node 24 or newer:

```sh
npm install @tnunamak/gozar
npx gozar expose --port 3000 --client-reach internet
```

The package contains the compiled WASM core and JavaScript bindings. Installation and execution do not need Rust or wasm-bindgen. Provider prerequisites still apply: localhost.run needs OpenSSH; Tailscale needs a signed-in client and permission for the route. Service registration and removal need `flock` from util-linux. Linux is the tested host platform.

## 30-second example

With your local service already listening on port 3000:

```sh
gozar detect --port 3000
gozar expose --port 3000 --client-reach internet
```

Review the recommendation and approve the route. Gozar checks HTTPS and the required delivery behavior before publishing a URL; follow any setup instructions it prints rather than treating an unverified address as ready. Provider setup and verification may take longer than 30 seconds.

```sh
gozar status --port 3000
gozar stop --port 3000
```

Gozar does not add application authentication. Expose only a service you intend to share, with its own access controls.

## Providers

| Provider or route | Who can reach it | Availability in this release |
| --- | --- | --- |
| Tailscale Funnel | Internet clients | Enabled; requires Tailscale HTTPS and Funnel permission. Leaves existing listeners alone. |
| Tailscale Serve | Clients on your private tailnet | Enabled; requires a trusted verifier on the client network. |
| localhost.run | Internet clients | Enabled trial; no provider account. The relay terminates TLS and can read forwarded traffic. |
| LAN | Clients on the selected local network | Enabled HTTP route; requires explicit interface/firewall approval and a trusted peer verifier. Not suitable for HTTPS-required clients. |
| Your own HTTPS address | Clients that can reach your reverse proxy | Enabled validation of owner-managed ingress; Gozar does not create or delete your DNS or proxy configuration. |
| ngrok | Depends on the selected mode | Detection only; not enabled for route creation in this release. |
| Cloudflare named Tunnel | Internet clients | Detection only; not enabled for route creation in this release. |

Detection is not proof of login, permission or client reachability. The [adapter guide](adapters/INTEGRATION.md) explains the verification and cleanup boundaries.

## Keep an existing service address

For a long-running service already listening behind your own reverse proxy, replace the example origin and target with your real HTTPS origin and backend:

```sh
gozar service add --origin https://service.example --target 127.0.0.1:3000 --json
gozar service status --origin https://service.example --json
gozar service remove --origin https://service.example --json
```

This records and verifies the existing route without adding a local proxy or an expiry. Removal deletes only Gozar's record, not your service, reverse proxy or DNS. The backend must support the service challenge, or the host must supply the trusted check described in [service routes](docs/service-routes.md). Recording a route is not a substitute for successful verification.

## Embed Gozar in a host

Host applications can invoke the CLI with `--json` to consume status and actions, then present choices and consent in their own interface. For example:

```sh
gozar detect --port 3000 --json
gozar expose --port 3000 --client-reach internet --json
```

Handle requested inputs and approvals; JSON output does not grant permission to create a route. Only pass `--yes` after the user approves the selected route and exact local target. Keep application authentication in the host, and use `health` and `stop` for the session lifecycle. For a persistent service, see the [service-route JavaScript API](docs/service-routes.md).

## JavaScript API

```js
import { expose, status, stop } from '@tnunamak/gozar';

const route = await expose({ port: 18765, clientReach: 'internet', adapterId: 'localhost-run',
  lifetimeMs: 1_500_000, yes: true });
console.log(route.snapshot);
await status({ port: 18765 });
await stop({ port: 18765 });
```

These asynchronous functions run the packaged CLI with JSON output and return its reply. `yes: true` approves the selected route and exact loopback target; omission does not grant approval. `home` selects an isolated state directory. Failures reject with an Error whose `reply` contains the CLI JSON and whose `code` contains the process exit code. The functions accept the CLI's named fields in camel case (including `probeDirectory`, `probeWaitMs`, `streamableHttp` and `oauthDcr`).

The root API also exports `addService`, `statusServices`, `removeService` and `createServiceVerifier`. These are available directly from `@tnunamak/gozar/service`; see [service routes](docs/service-routes.md). Hosts that need CLI control can resolve `@tnunamak/gozar/bin/gozar.mjs` without relying on a global installation.

## Try the echo server

Start the demo in one terminal:

```sh
gozar demo-server --port 18765
```

In another terminal:

```sh
gozar expose --port 18765
```

Choose `internet` when the client is hosted elsewhere, then approve the route. Add the printed URL to your client; in this demo it is the MCP server's `/mcp` URL. For this demo, select **no authentication** and call `echo` with `{"echo":"hello"}`. The result includes your text and this server's instance nonce. The demo serves the MCP protocol over HTTP.

Inspect and stop the route:

```sh
gozar status
gozar stop
```

Stop the demo server with Ctrl+C. For multiple services, add `--port N` to `status` and `stop` to select the exact session.

## Choose a route

```sh
gozar detect --port 3000
gozar expose --port 3000 --client-reach internet
```

Detection lists the available routes and what it found about each one. Finding a command does not establish login state or permission. `--alternatives` expands the route list; `--adapter ID` selects one. `--json` returns states and actions for automation. `--yes` approves the selected route and exact local target.

Public routes include the localhost.run trial and Tailscale Funnel. Funnel runs its own process and leaves your existing listeners alone. The trial uses isolated SSH state; the relay terminates TLS and can read forwarded traffic.

An owner-managed HTTPS address stays under its owner's control. Supply `--origin https://service.example`; Gozar prints the local proxy target. Point your existing proxy at it, then run `gozar health --port N` to validate the route. Stop closes Gozar's local proxy without deleting your ingress or DNS.

Private tailnet and LAN routes require a trusted verifier on the intended client network before publication. LAN uses an explicitly selected interface and firewall approval; its HTTP route cannot satisfy an HTTPS requirement. Ngrok and named Cloudflare tunnels appear in detection for the next drop.

## Connection and lifetime

Gozar adds no application authentication. Keep the authentication your own service requires. A successful route check does not authorize callers or prove that your MCP client has connected.

For public routes, Gozar resolves the hostname through public DNS, pins a public IP, checks the original TLS hostname and a fresh instance nonce, and measures streamed delivery. This proof crosses the provider's public relay from the host; it is recorded as `remote:false`.

The instance proxy defaults to **15 minutes**. Set `--lifetime-ms` to supply a different lifetime, for example `gozar expose --port 18765 --client-reach internet --lifetime-ms 1500000` for 25 minutes. The value must be an integer in `1..2147483647`. JSON expose/status replies include `lifetimeMs` and `expiresAtMs` (Unix milliseconds). Keep the device and service awake. After sleep or network loss, run `gozar health --port N`. After expiry, stop the session and expose it again. A provider can expire or change a trial URL earlier. Service routes have no Gozar lifetime or proxy.

## Contributing

To build from source, install Rust and wasm-bindgen 0.2.105:

```sh
git clone https://github.com/tnunamak/gozar.git
cd gozar
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
bash scripts/build-wasm.sh
```

The build creates the WASM bindings used by the CLI. `WASM_BINDGEN` and `CARGO_TARGET_DIR` can select existing tools and build caches. Run `npm link` to use `gozar` without typing `node bin/gozar.mjs`.

### Develop

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
