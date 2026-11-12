# Gozar

Give a local service an address its client can reach: public HTTPS, a private Tailscale route, or HTTP on a selected LAN interface. Gozar discovers routes, asks before exposing your service, verifies the result, and tracks cleanup. MCP is supported, not required.

## Choose your route

**Start with a service listening on port 3000, Linux, and Node.js 24+.** Inspect the candidates without creating a route:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar detect --port 3000 --alternatives
```

Choose for the client that will connect, not just the tools installed on your machine:

| Route | Reach and trust boundary | Setup and lifecycle |
| --- | --- | --- |
| Tailscale Funnel | Public internet | Signed-in client, Funnel/HTTPS permission and a verified unused listener. Gozar does not take over existing routes. |
| Tailscale Serve | Your tailnet | Signed-in client and a trusted check from the intended tailnet. |
| localhost.run | Public internet; relay terminates TLS and can read traffic | OpenSSH. Anonymous HTTPS URLs can change within minutes. |
| tunnl.gg stable | Public internet; relay can read traffic | Explicit opt-in, OpenSSH and Linux `flock`. **One active route per installation key.** Gozar refuses a second same-home start until the holder ends and owned-process cleanup is confirmed; it does not queue it. Browser warnings and roughly two-minute quiet-stream limits are possible. |
| LAN | Selected local network; **HTTP, not HTTPS** | Explicit interface, exact firewall approval and a trusted check. |
| Your HTTPS proxy | Clients that can reach your configured proxy | You manage DNS, TLS, the proxy and uptime. Use a temporary exposure or register an existing service route below. |
| ngrok / Cloudflare named Tunnel | Detection only in 0.1.0 | Gozar cannot create these routes. Finding a CLI does not establish permission or readiness. |

**Before sharing:** Gozar does not add application authentication. Keep your service's access controls enabled and choose a provider you trust with its data. Detection is not proof of login, permission, reachability or URL stability.

**When the address disappears:** stop advertising the old URL. Only the current verified `snapshot.published` may be shared. A requested session lifetime does not reserve an address; update clients when a newly verified address replaces it.

[Expose a service](#expose-a-service) · [Keep an existing service address](#keep-an-existing-service-address) · [Embed and supervise](#embed-and-supervise)

## Expose a service

For a public internet client:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet
```

Review the displayed provider and exact local target before approving. Provider setup or verification from outside your network may still be required. Share the address only after verification succeeds.

Use `--client-reach tailnet` for an authorized Tailscale client, or `--client-reach lan` for a local-network client. Select a detected provider with `--adapter ID`; unsupported routes are still refused.

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar status --port 3000
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 3000
npx --package=@tnunamak/gozar@0.1.0 gozar stop --port 3000
```

- **Status** reports the currently published address.
- **Health** rechecks the route. Recheck after a network change, resume or wake.
- **Stop** attempts to close the exposure. Inspect unresolved cleanup before assuming the route is gone or starting another session.

Temporary sessions default to 15 minutes. Request a different lifetime with `--lifetime-ms`, an integer from 1 through 2147483647:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --lifetime-ms 1500000
```

That requests 25 minutes, not 25 minutes of guaranteed provider uptime or URL stability. Keep the service and host awake.

### Opt into the key-bound relay

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --adapter tunnl-gg
```

On first approved use, Gozar creates an Ed25519 identity under `GOZAR_HOME` (default `~/.local/state/gozar`) and reuses it. A refused second start reports the holding port and its stop command. Retry only after the holder stops and cleanup is confirmed.

Coordination covers the same home. **Do not copy the key into another home to start a second route:** those processes cannot coordinate, and a new route can interrupt the first. An announced address change withdraws this route; stop it and start a new session. This provider is opt-in, not a change to automatic selection.

### Use your own proxy temporarily

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar expose --port 3000 --client-reach internet --origin https://service.example
npx --package=@tnunamak/gozar@0.1.0 gozar health --port 3000
```

Replace the example origin. Point your HTTPS proxy to the local Gozar proxy target printed during setup, then recheck. Stopping Gozar closes its local proxy, not your DNS or external proxy.

## Keep an existing service address

For a backend and HTTPS proxy that should outlive Gozar, register a **service route** instead of a temporary exposure. Gozar starts no tunnel, listener or daemon and adds no session expiry. You retain responsibility for service uptime, DNS, TLS, proxy configuration and cleanup.

First install the [service verification helper](docs/service-routes.md#service-challenge) before your backend's ordinary request handlers. The proxy must preserve the public Host header, and the declared target port must equal the backend's actual listener. A [trusted verifier command](docs/service-routes.md#host-supplied-verification) is available when the controller cannot probe directly.

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar service add --origin https://service.example --target 127.0.0.1:3000 --json
npx --package=@tnunamak/gozar@0.1.0 gozar service status --origin https://service.example --json
npx --package=@tnunamak/gozar@0.1.0 gozar service remove --origin https://service.example --json
```

A saved record is not successful verification: inspect the returned status. Every status call probes afresh. Removing the record removes only Gozar metadata, not the service or proxy. Adding and removing records require Linux `flock` from util-linux. See the [service-route contract](docs/service-routes.md) for verification boundaries and the API.

## Embed and supervise

Install the package into your Node.js 24+ project:

```sh
npm install @tnunamak/gozar@0.1.0
```

The npm package includes the compiled WASM core and JavaScript bindings; npm users need neither Rust nor wasm-bindgen. The CLI examples use an explicit package with npx because a project-local installation does not put bare `gozar` on your normal shell PATH.

Your integration owns four decisions:

1. **Consent:** obtain approval for the selected provider and exact local target. Detection or JSON output is not consent.
2. **Publication:** read status for the whole session. Clear the displayed URL on status failure or absent `snapshot.published`; notify clients when the verified address changes.
3. **Recovery:** inspect route loss and follow the returned repair action. Do not silently expose a different target or provider.
4. **Cleanup:** stop the session your app owns, inspect the reply, and surface unresolved cleanup.

This example uses localhost.run and a service already listening on port 18765. **Obtain approval for that relay, which can read traffic, and `http://127.0.0.1:18765` before running it.** It supervises until interrupted or the route is lost, then attempts cleanup. Replace the logging with your UI and reconnection handling.

```js
import { setTimeout as delay } from 'node:timers/promises';
import { expose, status, stop } from '@tnunamak/gozar';

const target = { port: 18765 };
let stopping = false;
const requestStop = () => { stopping = true; };
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

const display = published => console.log('Current route:', published);

try {
  let reply = await expose({
    ...target,
    clientReach: 'internet',
    adapterId: 'localhost-run',
    lifetimeMs: 1_500_000,
    yes: true, // Approval already obtained by your application.
  });

  while (!stopping) {
    const published = reply.snapshot?.published ?? null;
    display(published); // Replace the old route; never retain a stale link.
    if (published === null) {
      console.error('Route unavailable; inspect this reply:', reply);
      break; // This example stops rather than silently restarting.
    }
    if (reply.snapshot?.lastRouteChange) {
      console.log('Notify clients of route change:', reply.snapshot.lastRouteChange);
    }
    await delay(5000);
    if (!stopping) reply = await status(target);
  }
} catch (error) {
  display(null);
  console.error(error.reply ?? error.message);
} finally {
  display(null);
  try {
    const cleanup = await stop(target);
    console.log('Inspect cleanup result:', cleanup);
  } catch (error) {
    console.error('Cleanup needs attention:', error.reply ?? error.message);
  }
  process.removeListener('SIGINT', requestStop);
  process.removeListener('SIGTERM', requestStop);
}
```

Polling is not instantaneous loss detection; choose a cadence appropriate for your app. The example's five seconds is not a Gozar guarantee. An abrupt process kill cannot run its cleanup handler, so your host must also reconcile interrupted sessions.

Each API call runs the packaged CLI. Optional `home` sets `GOZAR_HOME`; use the same home and port throughout, and only manage sessions your application owns. A successful reply does not guarantee all cleanup succeeded.

Unknown or invalid options throw, sometimes before a promise is returned; keep calls inside `try`. JSON CLI failures carry `error.reply` and `error.code`; other failures may contain only a message.

The root package exports `expose`, `status`, `stop`, `addService`, `statusServices`, `removeService` and `createServiceVerifier`. Service functions are also exported from `@tnunamak/gozar/service`. There are no root JavaScript `detect` or `health` exports in 0.1.0. Use the CLI for those, with `--json` for machine-readable output; `@tnunamak/gozar/bin/gozar.mjs` is the exported executable path for package integrations.

## Verification is not authentication

A passing route check does not prove that every external client can connect, that callers are authorized, or that an application-level MCP call succeeds. Test your application's access controls and client flow separately.

Temporary exposures forward to the selected loopback port and replace the request Host header with `127.0.0.1:PORT`. Test apps that check hostnames or generate public redirects and links. Existing service routes differ: your proxy must preserve the expected public Host.

The localhost.run and tunnl.gg relays terminate TLS and can read traffic. Public HTTPS does not hide payloads from those relay operators. Your own proxy and DNS remain your responsibility, even after Gozar stops.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Command not found | Use the full npx form above, not a bare command after a local install. |
| No eligible route | Run detection and resolve the reported tool, login, permission, interface or verification prerequisite. |
| No published address or stale link | Clear the old URL, inspect status, and run health. Share only a currently verified address. |
| Noninteractive approval required | Collect approval for the selected provider and exact target, then pass `--yes`. |
| Key already in use | Stop the reported holder using the reported recovery command in the same Gozar home; wait for confirmed owned-process cleanup before retrying. |
| Cleanup pending | Inspect the stop reply and retry as indicated. Do not assume the exposure is gone. |
| Existing service fails verification | Check the helper, public Host preservation and exact backend listener port; see [service routes](docs/service-routes.md). |

For machine-readable diagnostics, add `--json` to status, health or stop. For CLI usage:

```sh
npx --package=@tnunamak/gozar@0.1.0 gozar --help
```

## Development

Gozar combines a Rust planning core compiled to WASM, Node.js effects and data-defined provider adapters. npm use does not require a source build.

See the [architecture](https://github.com/tnunamak/gozar/blob/b4f72cf63530f8985a4f6a0fbf5cfedbd5959c94/docs/architecture.md), [protocol contract](https://github.com/tnunamak/gozar/blob/b4f72cf63530f8985a4f6a0fbf5cfedbd5959c94/runtime/core-protocol.json), [adapter guide](https://github.com/tnunamak/gozar/blob/b4f72cf63530f8985a4f6a0fbf5cfedbd5959c94/adapters/INTEGRATION.md) and [live provider harness](https://github.com/tnunamak/gozar/blob/b4f72cf63530f8985a4f6a0fbf5cfedbd5959c94/harness/README.md).
