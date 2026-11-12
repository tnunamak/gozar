# Gozar

Give a local service a public HTTPS address or a route on your private network.

Gozar checks the available providers, asks before creating a route, and verifies it before sharing an address. Use the same commands across providers instead of wiring each one into your app.

With a service listening on port 3000, on Linux with Node.js 24+:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet
```

Review and approve the proposed route. Provider setup may be required. Gozar does not add authentication to your service.

For temporary sharing, use a tunnel. For a long-running service behind your own HTTPS proxy, use a [service route](#keep-an-existing-service-address). MCP servers are supported; they are not the only use case.

## Install

Linux with Node.js 24 or newer is the tested setup.

For a one-off command, use the scoped package explicitly:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar --help
```

For a project or an embedded integration:

```sh
npm install @tnunamak/gozar@0.1.0
```

The examples below use npx with an explicit package, so they do not require a global installation. Installing locally does not add a bare `gozar` command to your normal shell PATH.

The npm package includes the compiled WASM core and JavaScript bindings. You do not need Rust or wasm-bindgen to use it.

Providers have their own prerequisites: localhost.run needs OpenSSH; Tailscale needs a signed-in client and permission for the selected route. Adding or removing service-route records also needs `flock` from util-linux.

## Share a local service

Start your service on port 3000, then run:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet
```

Review the recommendation, approve the exact target, and follow any setup instructions. Use the verified address, not an address still awaiting checks. Setup time depends on the provider.

Check the session or stop it:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar status --port 3000
npx --package=@tnunamak/gozar@0.1.0 gozar stop --port 3000
```

Temporary sessions default to 15 minutes. A provider may change or expire an address sooner. In particular, anonymous localhost.run addresses can change within minutes: recheck status and use the replacement address.

## Providers

| Route | Reach | What to know |
| --- | --- | --- |
| Tailscale Funnel | Public internet | Requires a signed-in Tailscale client, HTTPS and Funnel permission. Gozar leaves existing listeners alone. |
| Tailscale Serve | Your private tailnet | Requires a trusted check from the intended client network before sharing an address. |
| localhost.run | Public internet | Anonymous trial; requires OpenSSH. The address can change within minutes. Hosts must follow status changes. The relay terminates TLS and can read traffic. |
| LAN | Selected local network | HTTP, not HTTPS. Requires an explicit interface, firewall approval and a trusted check from that network. |
| Your own HTTPS address | Clients able to reach your proxy | You manage DNS, TLS and the proxy. Gozar verifies the route without taking ownership of that configuration. |
| ngrok | Provider-dependent | Detection only in 0.1.0; Gozar cannot create this route. |
| Cloudflare named Tunnel | Public internet | Detection only in 0.1.0; Gozar cannot create this route. |

Detection does not prove login, permission or reachability. A requested session length is not a promise of provider uptime or a stable address.

See the [adapter guide](adapters/INTEGRATION.md) for verification and cleanup boundaries.

## Keep an existing service address

Already have a service behind your own HTTPS reverse proxy? Register that route without starting a Gozar proxy or adding a Gozar expiry.

First, add the service challenge helper to your backend, or supply a trusted verification command. See [service routes](docs/service-routes.md). Replace the example origin and target with your own:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar service add --origin https://service.example --target 127.0.0.1:3000 --json
npx --package=@tnunamak/gozar@0.1.0 gozar service status --origin https://service.example --json
npx --package=@tnunamak/gozar@0.1.0 gozar service remove --origin https://service.example --json
```

A saved record is not proof that verification passed. Check the returned verification status; status checks the route again. Removal deletes only Gozar's record, not your service, proxy or DNS. Your own service supervisor remains responsible for uptime.

## Embed Gozar in a host

Use the JavaScript API below, or invoke the CLI with `--json`:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar detect --port 3000 --json
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --json
```

Present requested choices and approvals in your own interface. Pass `--yes` only after the user approves the selected route and exact local target. JSON output is not approval.

Treat route status as changing state, not a permanent URL:

- `snapshot.published` is the current verified address. If it is `null`, stop advertising the old address and show that the route is unavailable.
- `snapshot.lastRouteChange` contains `oldOrigin`, `newOrigin` and `generation`. Tell clients to adopt the current verified address when it changes.
- Anonymous localhost.run addresses can change within minutes. Gozar checks a replacement before publishing it; your host must keep reading status.
- Keep authentication in your application. Use the CLI's `health` command to recheck a route and `stop` to clean up when finished.

A successful route check is not proof that the user's client connected. For an existing long-running route, use the [service API](docs/service-routes.md).

## JavaScript API

Install `@tnunamak/gozar` in your project, then use an ES module:

```js
import { expose, status, stop } from '@tnunamak/gozar';

// Call only after the user approves localhost.run and http://127.0.0.1:18765.
const session = { port: 18765 };
try {
  const reply = await expose({
    ...session,
    clientReach: 'internet',
    adapterId: 'localhost-run',
    lifetimeMs: 1_500_000,
    yes: true,
  });
  console.log(reply.snapshot?.published ?? null);

  // Read status again while your application uses the route.
  const current = await status(session);
  console.log(current.snapshot?.published ?? null);
} catch (error) {
  console.error(error.message);
  if (error.reply) console.error(error.reply);
  // Inspect status and perform cleanup if exposure partially succeeded.
}

// When the user ends the session:
// await stop(session);
```

`expose`, `status` and `stop` invoke the packaged CLI with JSON output. Keep polling status while the route is in use; the two reads above are not a monitor. Do not keep displaying an old URL when `published` becomes `null`.

`yes: true` records approval for the selected route and exact target. Do not set it automatically in response to an unapproved request. `home` selects a separate state directory; use the same `home` and port for the session's later calls.

Options use the supported camel-case names, including `probeDirectory`, `probeWaitMs`, `streamableHttp` and `oauthDcr`. Unknown options fail. Invalid options can throw before a promise is returned. Subprocess failures with valid JSON carry `error.reply` and `error.code`; other failures may provide only an error message.

The root API also exports `addService`, `statusServices`, `removeService` and `createServiceVerifier`. They are available from `@tnunamak/gozar/service` as well. See [service routes](docs/service-routes.md).

There are no root `health` or `detect` functions in 0.1.0; use the CLI for those commands. Hosts can resolve `@tnunamak/gozar/bin/gozar.mjs` and run it with their Node executable instead of depending on a global `gozar` command.

## Try the echo server

Start the demo in one terminal:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar demo-server --port 18765
```

In another terminal:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 18765 --client-reach internet
```

Approve the proposed route. Add the verified MCP `/mcp` URL to your client. For this demo only, choose no authentication and call `echo` with `{"echo":"hello"}`. The reply includes your text and a server-instance nonce.

When finished:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar stop --port 18765
```

Stop the demo server with Ctrl+C in its terminal. Do not use the demo's no-authentication setup as a security model for a real service.

## Choose a route

Inspect available routes without creating one:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar detect --port 3000 --alternatives
```

Use `--client-reach internet` for a hosted client, `tailnet` for a private Tailscale client, or `lan` for a client on the selected local network. Use `--adapter ID` to select a route from detection. Provider prerequisites and verification still apply.

For temporary exposure through your own HTTPS proxy, pass `--origin https://service.example` to `expose`. Gozar prints a local proxy target: point your existing proxy at it, then run `health --port 3000`. Stopping closes Gozar's local proxy, not your DNS or ingress.

This differs from `service add`, which records an existing route and starts no local proxy. Use a [service route](#keep-an-existing-service-address) when your existing backend and proxy should keep running independently.

Private tailnet and LAN routes need a trusted check from the intended client network. LAN requires explicit interface and firewall approval and cannot satisfy an HTTPS requirement.

## Security and privacy

Gozar creates reachability, not application authentication. Keep your service's access controls enabled and expose only the service you intend to share.

The localhost.run relay terminates TLS and can read forwarded requests and responses. Do not assume a public HTTPS URL hides traffic from the relay operator. Use a route and provider you trust for the data your service handles.

For public routes, Gozar checks public DNS, a pinned public IP, the TLS hostname, a fresh instance nonce and streamed delivery. The check travels through the public relay from the host and is recorded as `remote:false`. It does not prove that every external client can connect, that a caller is authorized, or that an MCP client completed a tool call.

Gozar removes the resources it owns. For owner-managed ingress, your proxy and DNS remain yours.

## Session lifetime

Temporary sessions default to 15 minutes. To request 25 minutes:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 18765 --client-reach internet --lifetime-ms 1500000
```

`--lifetime-ms` accepts an integer from 1 to 2147483647. JSON expose/status replies include `lifetimeMs` and `expiresAtMs`, a Unix timestamp in milliseconds.

Keep the host and service awake. After sleep or a network change, run `health --port 18765`. After expiry, stop the session and expose it again.

A provider may expire or rename a trial URL earlier than the requested lifetime. Longer lifetime settings do not make an anonymous address stable. Service routes have no Gozar expiry, but still depend on your service, proxy and network.

## Troubleshooting

Use the same port for every command. The examples below target port 3000.

| Symptom | Next step |
| --- | --- |
| `gozar: command not found` | Use `npx --package=@tnunamak/gozar@0.1.0 gozar` instead of a bare `gozar` command. A local npm install is not a global install. |
| No eligible route or missing prerequisites | Run `detect --port 3000 --alternatives`. Resolve the listed provider prerequisites, then retry `expose`. |
| Automation asks for a choice or approval | Set the intended `--client-reach` and present the selected route to the user. Add `--yes` only after approval. |
| No verified URL, or a previously working address stopped working | Read `status --port 3000`, then `health --port 3000`. If `snapshot.published` is `null`, do not reuse the old address. |
| Anonymous relay address changed | Read the current verified address from `status` and update your client. A longer `--lifetime-ms` does not prevent provider address changes. |
| Session expired | Run `stop --port 3000`, then `expose` again. Keep the service and device awake. |
| Cleanup remains pending | Retry `stop --port 3000` and inspect its result. Do not claim cleanup is complete while owned resources remain. |
| Service-route verification failed | Check the challenge helper, proxy Host handling and exact backend port in [service routes](docs/service-routes.md). A saved record alone is not verified readiness. |

For example:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 3000
```

Add `--json` when your host needs structured status and next actions.

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
