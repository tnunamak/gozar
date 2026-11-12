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

Use Linux with Node.js 24 or newer.

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
| tunnl.gg stable | Public internet | Opt-in trial with an installation identity; the relay can read traffic and may show a browser warning. Quiet streams can close after two minutes. |
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

Install the package in your project:

```sh
npm install @tnunamak/gozar@0.1.0
```

Start a service on port 18765 first. The example below uses localhost.run, which requires OpenSSH and sends traffic through a relay that can read it. Run this ES module only after the user approves that provider and the exact target, `http://127.0.0.1:18765`.

This short example checks status six times, then stops its session. It is not a background monitor.

```js
import { setTimeout as delay } from 'node:timers/promises';
import { expose, status, stop } from '@tnunamak/gozar';

const session = { port: 18765 };

function show(reply) {
  // Replace the displayed address every time, including clearing it.
  console.log(reply.snapshot?.published ?? null);
}

try {
  show(await expose({
    ...session,
    clientReach: 'internet',
    adapterId: 'localhost-run',
    lifetimeMs: 1_500_000,
    yes: true, // The user has already approved this provider and target.
  }));

  for (let i = 0; i < 6; i++) {
    await delay(5_000);
    show(await status(session));
  }
} catch (error) {
  console.error(error.message);
  if (error.reply) console.error(error.reply);
} finally {
  // Also try cleanup when exposure only partly succeeded.
  try {
    const cleanup = await stop(session);
    console.log(cleanup);
  } catch (error) {
    console.error('Cleanup needs attention:', error.reply ?? error.message);
  }
}
```

For an application, keep checking status for as long as the route is in use, and stop it when the session ends. If status fails or `snapshot.published` is `null`, stop advertising the previous address. A URL can change before the requested session lifetime ends. Inspect cleanup results; a returned reply alone does not prove every resource was removed. This example assumes the port belongs to the session it creates; do not use it to take over someone else's existing session.

`expose`, `status` and `stop` invoke the packaged CLI with JSON output. `home` selects a separate state directory; use the same `home` and port for every call in a session.

Use supported camel-case options such as `probeDirectory`, `probeWaitMs`, `streamableHttp` and `oauthDcr`. Unknown options fail. Invalid options can throw before a promise is returned, so put the call itself inside `try`. Subprocess failures with valid JSON carry `error.reply` and `error.code`; other failures may provide only a message.

The root API also exports `addService`, `statusServices`, `removeService` and `createServiceVerifier`. These are also available from `@tnunamak/gozar/service`; see [service routes](docs/service-routes.md).

There are no root `health` or `detect` functions in 0.1.0. Use the CLI for those commands. An embedded host can resolve `@tnunamak/gozar/bin/gozar.mjs` and run it with its Node executable rather than relying on a global command.

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

Inspect routes without creating one:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar detect --port 3000 --alternatives
```

Use `--client-reach internet` for a hosted client, `tailnet` for a private Tailscale client, or `lan` for a client on your selected local network. Add `--adapter ID` to choose a route shown by detection. Detection alone does not prove login, permission or reachability.

To select tunnl.gg explicitly, run `npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --adapter tunnl-gg`. Gozar creates an Ed25519 identity under its home directory (`GOZAR_HOME`, or `~/.local/state/gozar`) on first approved use and reuses it for later sessions. A changed address withdraws the route. The relay may show a browser warning and closes a quiet stream after about two minutes. The default trial selection is unchanged.

Public routes include the localhost.run trial and Tailscale Funnel. Funnel runs its own process and leaves your existing listeners alone. The trial uses isolated SSH state; the relay terminates TLS and can read forwarded traffic.

For temporary exposure through your own HTTPS proxy:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --origin https://service.example
```

Replace the example origin with yours. Point your existing HTTPS proxy at the local proxy target Gozar prints, then recheck:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 3000
```

Stopping this session closes Gozar's local proxy, not your DNS or HTTPS proxy. For a backend and proxy that should keep running independently, use [a service route](#keep-an-existing-service-address) instead. A service route starts no Gozar proxy.

Private tailnet and LAN routes require a trusted check from the intended client network. LAN also requires an explicit interface and firewall approval; it provides HTTP, not HTTPS.

## Security and privacy

Gozar makes a service reachable; it does not add application authentication. Keep your service's access controls enabled and share only the intended service.

The localhost.run relay terminates TLS and can read requests and responses. Public HTTPS does not hide traffic from that relay operator. Choose a provider you trust with your service's data.

Route verification and application testing are different. A route check does not prove that every external client can connect, that a caller is authorized, or that an MCP client completed a tool call. Test your application's authentication and client flow separately.

Temporary sessions forward requests to the selected loopback port and replace the request's Host header with `127.0.0.1:PORT`. If your app checks hostnames or generates public links and redirects, test that behavior before sharing it. This differs from a service route through your own proxy, where the backend must receive the expected public Host; see [service routes](docs/service-routes.md).

Gozar cleans up resources it owns. Your own proxy and DNS remain your responsibility. If cleanup is pending, retry stopping the session and inspect the result before assuming the route is gone.

## Session lifetime

Temporary sessions default to 15 minutes. To request 25 minutes:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 18765 --client-reach internet --lifetime-ms 1500000
```

`--lifetime-ms` accepts an integer from 1 to 2147483647. JSON expose/status replies include `lifetimeMs` and `expiresAtMs`, a Unix timestamp in milliseconds.

Keep the service and host awake. After sleep or a network change, recheck:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 18765
```

After expiry, stop the old session before starting another:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar stop --port 18765
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 18765 --client-reach internet
```

A provider may expire or rename a trial URL sooner. A longer lifetime does not make an anonymous address stable: hosts must continue reading status and update clients when the verified address changes.

Service routes have no Gozar expiry. Their availability still depends on your service, proxy and network.

## Troubleshooting

Use the same port for the whole session. These commands target port 3000; change every occurrence if your service uses another port.

**Command not found:** use the full npx command below. A local npm install does not put `gozar` on your normal shell PATH.

**No eligible route or missing prerequisites:**

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar detect --port 3000 --alternatives
```

Resolve the reported prerequisites, then retry exposure. Detection alone does not confirm provider login or permission.

**No verified address, a changed address, or a route that stopped working:**

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar status --port 3000 --json
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 3000 --json
```

Use the current verified address. If `snapshot.published` is `null`, do not keep sharing the old one. Anonymous relay addresses can change within minutes; increasing the lifetime will not prevent it.

**Automation asks for a choice or approval:** set the intended `--client-reach`, show the selected provider and exact target to the user, and add `--yes` only after approval. JSON output is not approval.

**Session expired or cleanup is pending:**

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar stop --port 3000 --json
```

Inspect the result and retry if cleanup remains pending. Once cleanup is complete, start a new session:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet
```

**Service-route verification failed:** check the challenge helper, the public Host header your proxy forwards, and the backend's exact listener port. See [service routes](docs/service-routes.md). A saved record is not proof of a working route.

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
