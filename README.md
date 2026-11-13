# Gozar

Give a local service an HTTPS address a remote client can reach, or a private route inside your Tailscale network. Gozar can use Tailscale Funnel, Tailscale Serve, localhost.run, your own HTTPS proxy, or a selected LAN interface.

**Will it fit your app?** You need Linux or macOS with Node.js 22.13 or newer, a local service on a port you choose, and a client that reaches it over the internet, your tailnet or your LAN. Windows is not supported: every route answers `unsupported`. Gozar adds no authentication to your app.

**Start with the built-in echo demo, or your own service.** Start the demo in one terminal:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar demo-server --port 18765
```

Then, in a second terminal, expose it to the public internet (or replace `18765` with your own service's port; `--client-reach tailnet` or `lan` reaches private clients instead):

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 18765 --client-reach internet
```

Gozar finds eligible routes, shows the provider it chose and the exact local target, and asks for approval before making the service reachable. To compare usable ways before approval, add `--alternatives` to that `expose` command. It lists their setup status, then shows the same plan and prompt. Detected routes are shown as available and checked after approval. The plan says that reach starts after its checks pass, identifies who can read the traffic when the adapter declares it, labels an unassigned address as a pattern, says who can reach it, and states that Gozar adds no sign-in. Provider setup or an outside-network verification step may still be required. Only share an address once Gozar verifies it; the address can change or expire. **Gozar does not add authentication to your app.** The published block starts with the public URL and says which route checks passed; these checks do not test your app's sign-in or requests. For your own HTTPS address, you keep responsibility for the proxy, DNS, TLS and their cleanup. MCP configuration is available in `--verbose` for services that support `/mcp`.

There are three paths. **A quick session:** `expose` above, a temporary address that lasts 15 minutes by default. **A persistent service:** a [service route](#keep-an-existing-service-address) behind your own HTTPS proxy, with no expiry. **Gozar inside an app:** [Route by requirement](#route-by-requirement), where the app states what it needs and Gozar lists the providers that meet it, or the shorter session commands in [Embed Gozar in your app](#embed-gozar-in-your-app). MCP is supported, but not required.

## Install

Use Linux or macOS with Node.js 22.13 or newer. On any other platform, such as Windows, every route answers `unsupported`.

For a one-off command, use the scoped package explicitly:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar --help
```

For a project or an embedded integration:

```sh
npm install @tnunamak/gozar@0.4.0
```

The ngrok SDK is optional. To use the ngrok HTTPS edge, install it in your app with `npm install @ngrok/ngrok`; without it, Gozar reports the ngrok candidate as needing setup.

The examples below use npx with an explicit package, so they do not require a global installation. Installing locally does not add a bare `gozar` command to your normal shell PATH.

The npm package includes the compiled WASM core and JavaScript bindings. You do not need Rust or wasm-bindgen to use it.

Providers have their own prerequisites: localhost.run needs OpenSSH; Tailscale needs a signed-in client and permission for the selected route.

## Share a local service

Start your own service on port 3000, then:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 3000 --client-reach internet
```

Review the displayed provider and exact local target. Approve only the route you want. localhost.run, tunnl.gg and the ngrok HTTPS edge terminate TLS and can read your traffic; for sensitive data, use Tailscale Funnel, which ends TLS on this computer, or your own proxy. Gozar creates the route when its provider is ready and checks it before publishing an address; outside-client verification can require additional setup.

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar status --port 3000
npx --package=@tnunamak/gozar@0.4.0 gozar health --port 3000
npx --package=@tnunamak/gozar@0.4.0 gozar stop --port 3000
```

Status tells you what is currently published. Health rechecks it. Stop attempts to close the temporary exposure and reports unresolved cleanup. Sessions run in the background and default to 15 minutes; returning to the shell does not stop them. Use the printed stop command to end a session sooner. A provider can remove or rename an address earlier—especially the anonymous localhost.run relay, which can change its URL within minutes. Do not keep sharing a previous URL when status stops publishing it.

## Providers

| Route | Who can reach it | Required setup / limit |
| --- | --- | --- |
| Tailscale Funnel | Public internet | Signed-in Tailscale client, HTTPS/Funnel permission, and verified unused listener; existing routes are not taken over. A session uses port 8443, or 10000 when 8443 is in use. A durable route uses the first free port of 443, 8443 and 10000 that the node's Funnel policy allows. |
| Tailscale Serve | Your tailnet | Signed-in Tailscale client and a trusted check from the intended tailnet. |
| localhost.run | Public internet | OpenSSH, a short-lived anonymous relay, and successful route checks. It terminates TLS and can read your traffic. Its HTTPS URL can change within minutes. |
| tunnl.gg stable | Public internet | Explicit opt-in (`--adapter tunnl-gg`) and OpenSSH; Gozar creates its installation key on first approved use. The relay can read traffic, may show a browser warning, and can close quiet streams after about two minutes. |
| LAN | Selected local network | Explicit non-loopback interface and firewall approval. **HTTP only**; not a public HTTPS route. |
| Your HTTPS proxy | Clients that reach your configured proxy | You own DNS, TLS, reverse proxy, service uptime and cleanup. Gozar verifies the route, but does not deploy your proxy. |
| ngrok HTTPS edge | Public internet | **Attached routes only** (the route lives while your app runs). Needs the optional `@ngrok/ngrok` package, a reserved ngrok domain and an auth token. The ngrok edge terminates TLS and can read traffic. `gozar setup` stores the token and domain for the adapter, and the route is ready once every setup step is complete. |
| ngrok TLS and TCP passthrough; Cloudflare named Tunnel | Not creatable by Gozar 0.3.4 | Detection only; a detected CLI is not evidence of account permission or a usable route. |

`docs/providers.md` lists every provider the registry ships, with its reach, address stability and cost. Use `npx --package=@tnunamak/gozar@0.4.0 gozar detect --port 3000 --alternatives` to inspect candidates before making changes. A visible candidate does not prove login, permission, correct routing, client reachability or address stability. For a long-running origin that Gozar must not manage, use [service routes](docs/service-routes.md). For a Tailscale origin that Gozar creates and keeps fixed across restarts, use [durable routes](docs/service-routes.md#durable-routes-gozar-owned).

## Keep an existing service address

Already run a service behind your own HTTPS reverse proxy? Save and verify the existing route, without starting a tunnel, proxy or Gozar daemon. Gozar will not change DNS/TLS/proxy configuration or put an expiry on your service.

First install the [service verification helper](docs/service-routes.md#service-challenge) inside your backend request handler, before your ordinary routes. It proves that the public HTTPS address reaches the configured backend listener. If the controller cannot probe your service directly, the [trusted verifier-command alternative](docs/service-routes.md#host-supplied-verification) is available.

```sh
ORIGIN=https://service.example   # replace with your service's public HTTPS address
TARGET=127.0.0.1:3000            # replace with the host and port your backend listens on
npx --package=@tnunamak/gozar@0.4.0 gozar service add --origin "$ORIGIN" --target "$TARGET" --json
npx --package=@tnunamak/gozar@0.4.0 gozar service status --origin "$ORIGIN" --json
npx --package=@tnunamak/gozar@0.4.0 gozar service remove --origin "$ORIGIN" --json
```

Set `ORIGIN` and `TARGET` to your own values first; the sample origin is not a real service and fails verification. The target port must be the port your backend actually receives; the reverse proxy must preserve the public Host header. A saved record is not a passing verification result: read the returned status. Each status invocation probes afresh. Removing the record removes only Gozar metadata; your service, DNS and proxy continue running.

## Route by requirement

An app that needs a route states what it needs and never names a provider. Gozar's catalog lists the providers that meet the requirements. The app shows the user the chosen candidate's disclosure and passes the approval back.

The example below opens a 15-minute session route to the demo server from the top of this page, so start that first. Save it as `route-example.mjs` in a project with `@tnunamak/gozar@0.4.0` installed, and run `node route-example.mjs`. It prints the disclosure and creates the route only if you answer `y`. For an address that survives restarts, use `ensureRoute` with `usage: { kind: 'durable', routeId }` instead of `expose`. The route-contract types are in `node_modules/@tnunamak/gozar/packages/gozar-node/route-contract.d.ts`, and the package exposes them to TypeScript through its `types` field.

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { catalogRoutes, expose, watchRoutes, closeRoute } from '@tnunamak/gozar';

// Gozar's state directory. The CLI uses the same one, so `gozar status` lists this app's routes too.
const stateDirectory = process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');

const query = {
  schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:18765', home: stateDirectory,
  usage: { kind: 'session', lifetimeMs: 900_000 },            // or { kind: 'attached' }
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] },
};
const catalog = await catalogRoutes(query);                    // read-only: nothing is exposed
const candidate = catalog.candidates.find(item => item.eligible && item.candidateToken);
if (!candidate) throw new Error(catalog.noMatch?.code ?? 'setup needed');   // candidate.setup.actions says what the user can do

const ask = createInterface({ input: process.stdin, output: process.stdout });
console.log(candidate.disclosure.text);
for (const fact of candidate.facts.filter(row => row.affectsConsent)) {
  console.log(fact.label, fact.known ? fact.value : `unknown (${fact.reason})`);
}
if ((await ask.question('Create this route? [y/N] ')).trim().toLowerCase() !== 'y') { ask.close(); process.exit(0); }
const route = await expose({ ...query, wait: 'verified',
  approval: { candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } });
console.log('Published at', route.published);

const controller = new AbortController();
const watching = (async () => {
  for await (const event of watchRoutes({ home: stateDirectory, handle: route.handle, signal: controller.signal })) {
    console.log(event.type, event.route.state, event.route.published);   // snapshot, changed, terminal
  }
})();

// When the app no longer needs the route. The watch ends with a terminal event; controller.abort() ends it sooner.
await ask.question('Press Enter to close the route ');
ask.close();
await closeRoute({ home: stateDirectory, handle: route.handle, mode: 'remove' });
await watching;
```

- `candidateToken` is private bearer data. It is single-use, expires after 10 minutes, and is bound to the query, the disclosure revision and what Gozar observed at the provider. If the provider changed, the call fails with `candidate_stale` and changes nothing: ask the catalog again. Do not log it.
- Each candidate shows what an app needs to list, choose and explain a route without knowing any provider. `providerId` is the provider's own stable id; add it to the query (`providerId: 'ID'`) and the catalog holds only that candidate. An unknown id fails with `route_not_found` and a message that lists the ids on offer. It cannot be combined with `route`. Show the id, store it and send it back; do not compare it with a literal. `display.needs` is one static sentence on what the route needs on this computer. `properties.address.ports` lists the public ports Gozar tries, in order (`null` when the provider assigns the port). `properties.proof` says what Gozar checks before it publishes: `vantage` is where the check runs from and `checks` is a subset of `tls`, `nonce` and `sse`. `RouteView.verification` carries the same two fields for the last check, so it says where that check actually ran from. [docs/providers.md](docs/providers.md) lists them for every provider.
- `ensureRoute` (durable), `adoptRoute` (takes over an existing rule and removes it when released or stopped) and `expose` (session or attached) all return a `RouteView`. Its `origin` is the route's address as soon as the provider has allocated it, also while the route is `unverified`: configure your server for it, so it can answer the challenge. `published` is the address you may advertise; it is `null` until the route is `usable`. With attached usage the calling process holds the route: the library sends a heartbeat every 5 seconds, the route ends within 20 seconds of the process exiting, and `closeRoute` ends it early.
- A candidate's unmet `requirement` and `reasonCode` use closed lists. Its `actual` value can name input that prevented the route: an invalid owner-run origin appears as `{ origin, reason: 'invalid_origin' }` on the `setup` entry; a durable create origin outside the provider's creatable addresses appears as `{ origin }` on an `address` entry. Neither candidate receives a token.
- Every failure has a code from a closed list, `GozarErrorCode` in `packages/gozar-node/route-contract.d.ts`, and an optional `nextAction`. Provider diagnostics never reach the app.
- Requirements `transport` is `'https'` or `'any'`. `'any'` allows plain HTTP, and only with reach `lan` or `this-device`; any other reach is `invalid_input`. A `provide-value` setup action asks the user for one plain value (`valueFormat` is `https-origin`, `domain` or `text`). Send it as `runSetupAction({ ..., value })`; a value that does not match the format is `invalid_input`. It is stored as configuration, not as a secret. A route its owner keeps (an address the user already runs) has `ownership: 'external-owned'`; `ensureRoute` records it without creating anything, and the origin is the one the user gave.
- `getRoutePreferences` and `setRoutePreferences` keep the user's provider order as `preferenceRef` values or `providerId` values. `runSetupAction` runs one setup action the user approved. `resolveClientAddress` turns a proven connection into a client address, or says why it cannot.
- The route functions behave the same on Linux and macOS. On any other platform every candidate is `unsupported`.

For a durable route, suspend before closing the local listener. This removes forwarding while keeping the address and consent for the next start. A crash does not suspend automatically. See [Suspend and resume](docs/design/durable-routes.md#suspend-and-resume) for refusal and recovery details.

| Route API | What it does |
| --- | --- |
| `ensureRoute(query)` | Creates with approval, or resumes the pinned durable route without new approval and verifies it. |
| `suspendRoute({ home, handle })` | Removes a durable route's rule and retains its reservation. Returns `suspended` with `published: null`. |
| `routeStatus({ home, handle })` | Reads current state; a suspended route stays suspended. |
| `closeRoute({ home, handle, mode: 'remove' })` | Releases the route and its reservation. A later creation needs approval. |

The same requests run from the command line. Each command reads its request from files, prints one JSON envelope on stdout (`watch` prints one event per line) and writes progress to stderr. Files that hold an approval or a secret must be private (mode 0600). In the table, `gozar` stands for `npx --package=@tnunamak/gozar@0.4.0 gozar` (or a global install), and FILE, NAME, ACTION_ID, DIR, N and REF are your values.

| Command | What it does |
| --- | --- |
| `gozar catalog --query-file FILE [--route NAME] --json` | Lists candidates for the query. |
| `gozar ensure --query-file FILE [--approval-file FILE] [--reconsent] --json` | Creates or confirms a durable route. |
| `gozar adopt --query-file FILE --approval-file FILE --handover-file FILE --json` | Takes over an existing rule and removes it when the route is released or stopped. |
| `gozar expose --query-file FILE --approval-file FILE [--wait verified] --json` | Opens a session or attached route. `--wait verified`, the default, returns once the route is verified; `--wait allocated` returns as soon as the provider has allocated the address. For an attached route this process holds it; close stdin to end it. |
| `gozar setup ACTION_ID --approval-file FILE [--secret-file FILE] [--value VALUE] --json` | Runs one approved setup action. A `provide-value` action takes `--value`; a secret takes `--secret-file`. |
| `gozar preference show [--profile-home DIR] --json` | Reads the user's provider order and its revision. |
| `gozar preference set --expected-revision N [--prefer REF ...] [--profile-home DIR] --json` | Replaces the provider order. N is the revision `show` returned. |
| `gozar suspend --route ID --json` | Suspends a durable route; `ensure` resumes it without new approval. |
| `gozar suspend --handle-file FILE --json` | Suspends the durable handle saved in FILE, with generation checking. |
| `gozar watch --handle-file FILE --json` | Streams route changes until the route is gone. |

Exit codes: `0` success; `2` requirements, setup or `unsupported`; `3` missing, stale or unknown approval, or no such route; `1` any other failure. There is no `--yes` for these commands: the approval is the private file that holds the token the catalog issued. The session commands in [Share a local service](#share-a-local-service) and [Embed Gozar in your app](#embed-gozar-in-your-app) are a different form of `gozar expose`: they take `--port` and `--client-reach`, use `--yes` for approval, and do not take the files above.

## Embed Gozar in your app

Use the JavaScript API below, or execute CLI commands with `--json`. `expose` has two forms: `expose --port N --client-reach ...` is the session form shown here, approved with `--yes`; `expose --query-file FILE` is the [route-contract](#route-by-requirement) form, approved with `--approval-file` and never `--yes`.

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar detect --port 3000 --json
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 3000 --client-reach internet --json
```

Detection never authorizes an exposure. If a user must choose a provider, confirm a firewall change or accept the exact service target, show that choice in your interface. Pass `--yes` only after the user approves the selected route and exact target.

For active sessions, repeatedly read `status`: `snapshot.published` is the current verified address, or `null` when no address may be advertised. `snapshot.lastRouteChange` identifies the old and new origins and generation when an address changes. Clear stale links promptly and tell clients to reconnect to the newly verified address. Anonymous localhost.run URLs can change within minutes. The requested lifetime does not lock the address.

Use CLI `health` to recheck a route and `stop` for cleanup. A passing route check is not proof of authentication or of a successful application-level MCP call. For owner-operated persistent HTTPS, see [service routes](docs/service-routes.md).

### Which versions to accept

Depend on `^0.4.0`. Within one 0.N line, Gozar keeps the route contract an app codes against: the public error codes, the query fields an app must send, and every field a candidate or route already has. New providers and new optional fields ship as 0.4.x releases, so an app with `^0.4.0` offers a new provider without a code change, because it reads every choice from the catalog. A change that breaks the contract starts a new line (for example 0.5.0), which an app adopts on purpose. A wider range such as `<1.0.0` would also accept those breaking lines. Gozar 1.0 will follow standard semantic versioning.

## JavaScript API

Install into your Node.js 22.13+ project:

```sh
npm install @tnunamak/gozar@0.4.0
```

Start a service on port 18765. This example chooses localhost.run, which requires OpenSSH, forwards traffic through a relay that can read it, and may change its URL. **Obtain the user's approval of this provider and `http://127.0.0.1:18765` first.** This example polls six times and attempts cleanup; production integrations must monitor the entire session.

```js
import { setTimeout as delay } from 'node:timers/promises';
import { expose, status, stop } from '@tnunamak/gozar';

const target = { port: 18765 };
const display = reply => console.log(reply.snapshot?.published ?? null);

try {
  display(await expose({
    ...target,
    clientReach: 'internet',
    adapterId: 'localhost-run',
    lifetimeMs: 1_500_000,
    yes: true, // Explicit approval already obtained in your app.
  }));
  for (let i = 0; i < 6; i++) {
    await delay(5000);
    display(await status(target));
  }
} catch (error) {
  console.error(error.reply ?? error.message);
} finally {
  try {
    console.log(await stop(target));
  } catch (error) {
    console.error('Cleanup needs attention:', error.reply ?? error.message);
  }
}
```

Each call runs the packaged CLI. The optional `home` sets `GOZAR_HOME`; use the same `home` and port throughout. A successful reply is not a guarantee that all cleanup succeeded—inspect it. If status fails or `snapshot.published` is null, stop advertising the old URL. Use this example only for a port and session your application owns.

Accepted camelCase options include `probeDirectory`, `probeWaitMs`, `streamableHttp` and `oauthDcr`. Invalid/unknown options throw (sometimes before a promise is returned), so keep the invocation inside `try`. JSON CLI failures surface as `error.reply` plus `error.code`; other failures may contain only a message.

The root package exports the route functions `catalogRoutes` (also `detect`), `inspectLegacyRoute`, `ensureRoute`, `adoptRoute`, `expose`, `routeStatus`, `closeRoute`, `watchRoutes`, `getRoutePreferences`, `setRoutePreferences`, `runSetupAction` and `resolveClientAddress`, plus `status`, `stop`, `addService`, `statusServices`, `removeService`, `createServiceVerifier`, `releaseRoute`, `confirmHandBack` and `cancelHandBack`. `@tnunamak/gozar/service` exports the service and hand-back functions and `createServiceVerifier`. `expose` takes the route request shown in [Route by requirement](#route-by-requirement) when `schemaVersion` is 1, and the session options above otherwise. The 0.2.0 durable signatures `statusRoutes` and `durableConsentText` and the earlier `ensureRoute` and `adoptRoute` inputs are gone from the package root. For the legacy session commands `health`, use the CLI, with `@tnunamak/gozar/bin/gozar.mjs` if you need a resolved executable inside a package.

## Try the echo server

The two commands at the top of this page start the echo server and expose it. Once Gozar verifies the route, connect an MCP client to its `/mcp` URL. The demo has no application authentication: call its `echo` tool with `{"echo":"hello"}`, and it returns your text and an instance nonce. To end the route:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar stop --port 18765
```

Press Ctrl+C to stop the demo server. The demo is not a safe template for a real service, because it has no authentication.

## Choose a route

To inspect available providers without creating anything:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar detect --port 3000 --alternatives
```

Choose `--client-reach internet` for a hosted client, `tailnet` for an authorized Tailscale client, or `lan` for a client on a local network. For the session command, `--alternatives` lists only ways it can use, with any setup step still needed, then continues to the plan and approval prompt. Select one with `--via NAME`, for example `--via localhost.run` or `--via tailscale-funnel`. The list shows each selection name in parentheses when it differs from the service name. `--adapter ID` remains supported. Detection can also show providers that the session command cannot start.

To select tunnl.gg explicitly:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 3000 --client-reach internet --via tunnl.gg
```

tunnl.gg needs OpenSSH (`ssh` and `ssh-keygen`). Gozar creates an Ed25519 identity under its home directory (`GOZAR_HOME`, or `~/.local/state/gozar`) on first approved use and reuses it for later sessions. The key-bound relay permits one active route per installation key. Gozar refuses a second start that uses the same key and reports the holding port and its stop command. Retry after that session has stopped and its owned process cleanup is confirmed; Gozar does not queue the start. Gozar coordinates sessions in the same home. If you copy the key into another home, those processes cannot coordinate and a new route can interrupt the existing one. An announced address change withdraws this route and requires stop followed by a new session. The relay can read traffic, may show a browser warning, and can close quiet streams after about two minutes. Automatic provider selection is unchanged.

For a temporary route through an existing HTTPS proxy:

```sh
ORIGIN=https://service.example   # replace with the HTTPS address your proxy serves
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 3000 --client-reach internet --origin "$ORIGIN"
npx --package=@tnunamak/gozar@0.4.0 gozar health --port 3000
```

Set `ORIGIN` to your own proxy's address first; point your own HTTPS proxy to the local Gozar proxy target printed during setup, then run the health check. If your proxy's address changes while the session runs, run `npx --package=@tnunamak/gozar@0.4.0 gozar update-origin --port 3000 --origin "$NEW_ORIGIN"` and then the health check again. Gozar stops publishing the old address at once and publishes the new one only after the health check verifies it. Stopping Gozar closes its local proxy, not your DNS or external proxy. For a service and reverse proxy that should outlive Gozar independently, [register a service route](#keep-an-existing-service-address) instead.

Private tailnet routes require a trusted check from the intended client network. LAN requires an explicit selected interface, exact firewall approval and a trusted check; it serves HTTP rather than HTTPS.

## Security and privacy

Gozar makes a service reachable; it does not add application authentication. Keep your service's access controls enabled and share only the intended service.

The localhost.run relay terminates TLS and can read requests and responses. Public HTTPS does not hide traffic from that relay operator. Choose a provider you trust with your service's data.

Route verification and application testing are different. A route check does not prove that every external client can connect, that a caller is authorized, or that an MCP client completed a tool call. Test your application's authentication and client flow separately.

Temporary sessions forward requests to the selected loopback port and replace the request's Host header with `127.0.0.1:PORT`. If your app checks hostnames or generates public links and redirects, test that behavior before sharing it. This differs from a service route through your own proxy, where the backend must receive the expected public Host; see [service routes](docs/service-routes.md).

Gozar cleans up resources it owns. Your own proxy and DNS remain your responsibility. If cleanup is pending, retry stopping the session and inspect the result before assuming the route is gone.

## Session output

Before approval, the session command shows the target, who can reach it, the selected service, the address or address pattern, the lifetime and at most one relevant note. Funnel's exact hostname and free port are checked after approval, so its plan shows `https://<machine>.<tailnet>.ts.net` without a port. A trial address is assigned when it starts.

After the required checks pass, `Public URL` is the address to share. It comes before the MCP connection instructions. The command returns while a background controller keeps the session running; use the printed stop command to end it early. A failed check names what Gozar could not verify. If removal is not confirmed, the output says a route or process may remain and prints the stop command.

Add `--verbose` to a session command for the full plan sentence, all provider observations and every engineering limitation. `--json` keeps the existing machine-readable reply, including its engineering strings.

## Session lifetime

A temporary exposure defaults to 15 minutes. To request 25 minutes:

```sh
npx --package=@tnunamak/gozar@0.4.0 gozar expose --port 18765 --client-reach internet --lifetime-ms 1500000
```

The lifetime option is an integer from 1 through 2147483647 milliseconds. JSON status includes `lifetimeMs` and `expiresAtMs` (Unix milliseconds). This bounds Gozar's temporary session, **not a provider's URL stability or uptime**. A localhost.run trial URL can change within minutes; a host must read `status`, clear an old published URL when absent and update clients after a verified route change.

Keep the service and the host awake. On network change, resume or wake, recheck with `npx --package=@tnunamak/gozar@0.4.0 gozar health --port 18765`. When expired or finished, run `npx --package=@tnunamak/gozar@0.4.0 gozar stop --port 18765`; check for outstanding cleanup before starting a fresh exposure.

Registered service routes do not have Gozar session expiry, but their uptime depends on the service, proxy and network you manage.

## Troubleshooting

**Command not found:** For a local or one-shot npm install, use the full `npx --package=@tnunamak/gozar@0.4.0 gozar …` form shown throughout this README; a project-local install does not put `gozar` on your shell's PATH.

**Nothing eligible:** Run `npx --package=@tnunamak/gozar@0.4.0 gozar detect --port 3000 --alternatives`. Fix missing tools, login, permission, interface or outside-network verification; detection alone is not readiness.

**No published address, route changed or stopped responding:**
```sh
npx --package=@tnunamak/gozar@0.4.0 gozar status --port 3000 --json
npx --package=@tnunamak/gozar@0.4.0 gozar health --port 3000 --json
```
Use only the current verified `snapshot.published`. If it is `null`, remove the old link from your app. Anonymous relay URLs can change within minutes even within the requested session lifetime.

**Noninteractive approval required:** Collect the user's approval of the chosen provider and exact local target, then retry the session command (`gozar expose --port N`) with `--yes`. A JSON response is not consent. The route-contract commands above have no `--yes`.

**Expired session or cleanup debt:**
```sh
npx --package=@tnunamak/gozar@0.4.0 gozar stop --port 3000 --json
```
Inspect cleanup failures and retry when indicated. Start a fresh `expose` only after cleanup is resolved.

**Existing HTTPS service fails verification:** Ensure the service challenge helper is installed before normal routes, the proxy preserves the public Host, and the declared target port equals the backend's actual listener. See [service routes](docs/service-routes.md). A saved route record is not a verified route.

## Contributing

**npm users do not need Rust or a source build.** Only contributors building the WASM core need Rust and wasm-bindgen 0.2.105:

```sh
git clone https://github.com/tnunamak/gozar.git
cd gozar
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
bash scripts/build-wasm.sh
```

Run `npm link` in a source checkout if you want a bare `gozar` command.

### Develop

Gozar uses a Rust planning core compiled to WASM, a Node.js process to perform effects, and provider adapters defined in data. Consult the [architecture](docs/architecture.md), [protocol contract](runtime/core-protocol.json), and [adapter guide](adapters/INTEGRATION.md).

```sh
cargo test -p gozar-core
cargo build -p gozar-core --bin gozar-core-json
node --test --test-concurrency=2 test/adapters/*.test.mjs test/e2e/*.test.mjs test/node/*.test.mjs
node crates/gozar-core/tests/golden.cjs
node crates/gozar-core/tests/operational-golden.mjs
node crates/gozar-core/tests/public-relay-golden.mjs
```

The [live provider harness](harness/README.md) checks a real MCP call, streaming and cleanup. These development tools are not required for npm use.

### Embedding state (0.4)

Catalog and route responses use schemaVersion 2; requests still use 1. Read
`candidate.availability[usage.kind]` before offering an executable choice:
`detect-only` means Gozar can inspect it but cannot create it. Prerequisites carry
observed states and fixes independently of setup and route proof.

Render `candidate.configuration.inputRequirements` generically. Its `values` are non-secret
read-back; `credentials` reports presence only. Import `storeSecret` from
`@tnunamak/gozar`, pass `{home,value}`, and send the returned handle to the approved
`runSetupAction`. Configuration actions support edits and rotation while ready.

Render `facts` by group and show every `affectsConsent` row before approval. New
facts require no app changes. Unknown rows include a reason; `needs-provider-call`
never means false. Compute with typed reach, traffic, address, cost, availability,
prerequisites and proof; use fact rows for additional display details.

Route views include `routeState`, verification checks/time/expiry, route expiry,
recorded host configuration, cleanup state and actions. Expiry can be explicitly
unknown. A detected address is not a verified route. See the
[migration guide](docs/migration-0.4.md) and the shipped
[remote access example](examples/remote-access-screen.mjs), which accepts exactly
`--fakes` or `--detect` and never creates a real route.
