# Gozar

SPDX-License-Identifier: Apache-2.0

Give a local service an HTTPS address a remote client can reach, or a private route inside your Tailscale network. Gozar can use Tailscale Funnel, Tailscale Serve, localhost.run, your own HTTPS proxy, or a selected LAN interface.

**Will it fit your app?** You need Linux or macOS with Node.js 22.13 or newer, a local service on a port you choose, and a client that reaches it over the internet, your tailnet or your LAN. Windows is not supported: every route answers `unsupported`. Gozar adds no authentication to your app.

**Start with the built-in echo demo, or your own service.** Start the demo in one terminal:

```sh
npx --package=@tnunamak/gozar@0.5.6 gozar demo-server --port 18765
```

Then, in a second terminal, run the [route example](#route-by-requirement) (replace `18765` with your own service's port). It asks the catalog for a route that meets the app's requirements (`reach: 'internet'`, `'tailnet'` or `'lan'`), shows the chosen provider's disclosure and the exact local target, and creates the route only after you approve it. Every provider, including the temporary localhost.run, tunnl.gg, LAN and Tailscale sessions, runs on the same session runtime. A provider that needs setup reports it in the catalog; it is never reported as unable to start. Only share an address once Gozar verifies it; the address can change or expire. **Gozar does not add authentication to your app.** The route checks do not test your app's sign-in or requests. For your own HTTPS address, you keep responsibility for the proxy, DNS, TLS and their cleanup.

There are three paths. **A quick session:** a route request with `usage: { kind: 'session' }`, a temporary address that lasts 15 minutes in the example. **A persistent service:** a [service route](#keep-an-existing-service-address) behind your own HTTPS proxy, with no expiry. **Gozar inside an app:** [Route by requirement](#route-by-requirement), where the app states what it needs and Gozar lists the providers that meet it. MCP is supported, but not required.

## Install

Use Linux or macOS with Node.js 22.13 or newer. On any other platform, such as Windows, every route answers `unsupported`.

For a one-off command, use the scoped package explicitly:

```sh
npx --package=@tnunamak/gozar@0.5.6 gozar --help
```

For a project or an embedded integration:

```sh
npm install @tnunamak/gozar@0.5.6
```

The ngrok SDK is optional. To use the ngrok HTTPS edge, install it in your app with `npm install @ngrok/ngrok@1.7.0`; without it, Gozar reports the ngrok candidate as needing setup.

The examples below use npx with an explicit package, so they do not require a global installation. Installing locally does not add a bare `gozar` command to your normal shell PATH.

The npm package includes the compiled WASM core and JavaScript bindings. You do not need Rust or wasm-bindgen to use it.

Providers have their own prerequisites: localhost.run needs OpenSSH; Tailscale needs a signed-in client and permission for the selected route.

## Share a local service

Start your own service on port 3000 and request a session route for it with the [route example](#route-by-requirement), or with `npx --package=@tnunamak/gozar@0.5.6 gozar ensure --query-file FILE` and `npx --package=@tnunamak/gozar@0.5.6 gozar expose --query-file FILE --approval-file FILE` (see the command table there). Review the displayed provider and exact local target. Approve only the route you want. localhost.run, tunnl.gg and the ngrok HTTPS edge terminate TLS and can read your traffic; for sensitive data, use Tailscale Funnel, which ends TLS on this computer, or your own proxy. Gozar allocates the route when its provider is ready, announces the exact address to the host, waits for the host's exact acknowledgment where the host declared one, and checks only that address before publishing it; outside-client verification can require additional setup.

```sh
npx --package=@tnunamak/gozar@0.5.6 gozar status --port 3000
npx --package=@tnunamak/gozar@0.5.6 gozar stop --port 3000
```

`status` lists every session, service route and durable route in the home, from fresh observation. `stop` closes the session recorded for that port, or reports cleanup it could not confirm. Sessions run in a background controller and default to 15 minutes; returning to the shell does not stop them. A provider can remove or rename an address earlier, especially the anonymous localhost.run relay, which can change its URL within minutes. Do not keep sharing a previous URL when status stops publishing it. A session recorded by an earlier Gozar version is shown as history; Gozar does not run an earlier controller. Closing it stops only what its journal proves, and anything else is reported as cleanup debt with a stop command.

## Providers

| Route | Who can reach it | Required setup / limit |
| --- | --- | --- |
| Tailscale Funnel | Public internet | Signed-in Tailscale client, HTTPS/Funnel permission, and verified unused listener; existing routes are not taken over. A session uses port 8443, or 10000 when 8443 is in use. A durable route uses the first free port of 443, 8443 and 10000 that the node's Funnel policy allows. |
| Tailscale Serve | Your tailnet | Signed-in Tailscale client and a trusted check from the intended tailnet. |
| localhost.run | Public internet | OpenSSH, a short-lived anonymous relay, and successful route checks. It terminates TLS and can read your traffic. Its HTTPS URL can change within minutes. |
| tunnl.gg stable | Public internet | Explicit opt-in and OpenSSH; Gozar creates its installation key on first approved use. The relay can read traffic, may show a browser warning, and can close quiet streams after about two minutes. |
| LAN | Selected local network | Explicit non-loopback interface and firewall approval. **HTTP only**; not a public HTTPS route. |
| Your HTTPS proxy | Clients that reach your configured proxy | You own DNS, TLS, reverse proxy, service uptime and cleanup. Gozar verifies the route, but does not deploy your proxy. |
| ngrok HTTPS edge | Public internet | **Attached routes only** (the route lives while your app runs). Needs the optional `@ngrok/ngrok` package, an agent authtoken and the assigned development domain or another domain your plan permits. The edge can read traffic. Saved inputs establish presence, not account validity or verified routing. |
| Cloudflare named tunnel | Public internet | Attached connector. Managed setup uses a scoped API token to provision an owned tunnel and hostname. Existing-tunnel setup uses its run token, HTTPS origin and local gate port. The edge can read traffic. Stopping a route keeps the remote tunnel/DNS/token; setup cleanup is separate, and DNS removal is an owner step. |
| ngrok TLS and TCP passthrough | Detect-only in 0.5 | Raw execution is deferred so the HTTP(S) embedding contract ships together. Local detection does not establish account permission. |

`docs/providers.md` lists every provider the registry ships, with its reach, address stability and cost. Use `gozar catalog --query-file FILE --json` to inspect candidates before making changes. A visible candidate does not prove login, permission, correct routing, client reachability or address stability. For a long-running origin that Gozar must not manage, use [service routes](docs/service-routes.md). For a Tailscale origin that Gozar creates and keeps fixed across restarts, use [durable routes](docs/service-routes.md#durable-routes-gozar-owned).

## Keep an existing service address

Already run a service behind your own HTTPS reverse proxy? Save and verify the existing route, without starting a tunnel, proxy or Gozar daemon. Gozar will not change DNS/TLS/proxy configuration or put an expiry on your service.

First install the [service verification helper](docs/service-routes.md#service-challenge) inside your backend request handler, before your ordinary routes. It proves that the public HTTPS address reaches the configured backend listener. If the controller cannot probe your service directly, the [trusted verifier-command alternative](docs/service-routes.md#host-supplied-verification) is available.

```sh
ORIGIN=https://service.example   # replace with your service's public HTTPS address
TARGET=127.0.0.1:3000            # replace with the host and port your backend listens on
npx --package=@tnunamak/gozar@0.5.6 gozar service add --origin "$ORIGIN" --target "$TARGET" --json
npx --package=@tnunamak/gozar@0.5.6 gozar service status --origin "$ORIGIN" --json
npx --package=@tnunamak/gozar@0.5.6 gozar service remove --origin "$ORIGIN" --json
```

Set `ORIGIN` and `TARGET` to your own values first; the sample origin is not a real service and fails verification. The target port must be the port your backend actually receives; the reverse proxy must preserve the public Host header. A saved record is not a passing verification result: read the returned status. Each status invocation probes afresh. Removing the record removes only Gozar metadata; your service, DNS and proxy continue running.

## Route by requirement

An app that needs a route states what it needs and never names a provider. Gozar's catalog lists the providers that meet the requirements. The app shows the user the chosen candidate's disclosure and passes the approval back.

The example below opens a 15-minute session route to the demo server from the top of this page, so start that first. Save it as `route-example.mjs` in a project with `@tnunamak/gozar@0.5.6` installed, and run `node route-example.mjs`. On its first run it prints the disclosure and creates the route only if you answer `y`; later runs recover that same logical request for inspection and exact cleanup, rather than making another route. For an address that survives restarts, use `ensureRoute` with `usage: { kind: 'durable', routeId }` instead of `expose`. The route-contract types are in `node_modules/@tnunamak/gozar/packages/gozar-node/route-contract.d.ts`, and the package exposes them to TypeScript through its `types` field.

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { mkdir, lstat, open, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { catalogRoutes, expose, listRoutes, watchRoutes, closeRoute } from '@tnunamak/gozar';

// Gozar's state directory. The CLI uses the same one, so `gozar status` lists this app's routes too.
const stateDirectory = process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');

const query = {
  schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:18765', home: stateDirectory,
  usage: { kind: 'session', lifetimeMs: 900_000 },            // or { kind: 'attached' }
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] },
};
// App-owned intent storage, NOT a file inside Gozar's state directory.
// Run one copy of this example at a time. Do not share this directory with another app.
const intentDirectory = join(homedir(), '.gozar-route-example');
await mkdir(intentDirectory, { recursive: true, mode: 0o700 });
const directoryInfo = await lstat(intentDirectory);
if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() ||
    directoryInfo.uid !== process.getuid() || (directoryInfo.mode & 0o777) !== 0o700) {
  throw new Error('Intent directory must be an owned private directory');
}
const intentPath = join(intentDirectory, 'demo-route.json');
const intent = JSON.stringify(query); // includes exact owner, target, home, usage and requirements
let saved, restarting = false;
try {
  const file = await open(intentPath, 'wx', 0o600); // never overwrite an earlier intent
  try {
    saved = { version: 1, intent, operationId: randomUUID() };
    await file.writeFile(JSON.stringify(saved) + '\n');
    await file.sync(); // intent is durable before expose can allocate
  } finally { await file.close(); }
  const directory = await open(intentDirectory, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
} catch (error) {
  if (error.code !== 'EEXIST') throw error; // retain any partial file; never invent a replacement ID
  restarting = true;
  const info = await lstat(intentPath);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o600) throw new Error('Intent file must be owned and private');
  saved = JSON.parse(await readFile(intentPath, 'utf8'));
}
if (saved.version !== 1 || saved.intent !== intent ||
    typeof saved.operationId !== 'string' || !saved.operationId) {
  throw new Error('Different or unreadable intent: keep this file and reconcile the original request');
}
const operationId = saved.operationId;
// Recover via public enumeration, never by scanning or editing Gozar's private files.
// A failed listing refuses this run; retain the app intent and all recovery state.
const matches = restarting
  ? (await listRoutes({ home: stateDirectory, owner: query.owner })).routes
      .filter(item => item.operationId === operationId)
  : [];
if (matches.length > 1) throw new Error('Ambiguous operation recovery; retain all handles');
const recovered = matches[0];
if (recovered?.cleanup.state === 'confirmed') {
  console.log('This logical request is already closed; its operation ID stays terminal.');
  process.exit(0);
}
// Only a new allocation needs the catalog (read-only: nothing is exposed). Recovery never does.
const catalog = recovered ? null : await catalogRoutes(query);
const candidate = catalog?.candidates.find(item => item.eligible && item.candidateToken);
if (!recovered && !candidate) throw new Error(catalog.noMatch?.code ?? 'setup needed');   // candidate.setup.actions says what the user can do

const ask = createInterface({ input: process.stdin, output: process.stdout });
if (!recovered) {
  console.log(candidate.disclosure.text);
  console.log(candidate.consent.disclosures); // render the typed consent disclosures in your UI
  for (const fact of candidate.consent.facts.filter(row => row.affectsConsent)) {
    console.log(fact.label, fact.known ? fact.value : `unknown (${fact.reason})`);
  }
}
if ((await ask.question(recovered ? 'Inspect and close this recovered route? [y/N] ' : 'Create this route? [y/N] ')).trim().toLowerCase() !== 'y') { ask.close(); process.exit(0); }
const route = recovered
  ? { ...recovered, published: null } // enumeration is not fresh publication authority
  : await expose({ ...query, operationId, wait: 'verified',
  approval: { ...Object.fromEntries(Object.entries(candidate).filter(([key]) =>
    ['candidateToken', 'consentFactsDigest'].includes(key))),
    kind: 'route', disclosureRevision: candidate.disclosure.revision } });
if (route.published) console.log('Published at', route.published);
else console.log('Not currently published; keep the exact handle for cleanup.');

const controller = new AbortController();
const watching = (async () => {
  for await (const event of watchRoutes({ home: stateDirectory, handle: route.handle, signal: controller.signal })) {
    console.log(event.type, event.route.state, event.route.published);   // snapshot, changed, terminal
  }
})();

// When the app no longer needs the route. The watch ends with a terminal event; controller.abort() ends it sooner.
await ask.question('Press Enter to close the route ');
ask.close();
const closed = await closeRoute({ home: stateDirectory, handle: route.handle, mode: 'remove' });
if (closed.cleanup.state !== 'confirmed') {
  throw new Error('Cleanup is unconfirmed; retain the handle and retry closeRoute');
}
await watching;
// Keep demo-route.json: the same logical request must not allocate again after close.
```

Keep `GOZAR_HOME` separate from `.gozar-route-example`; the latter belongs only to this app. The app intent file contains no candidate token or credential. Re-running the example reuses its operation ID and validates the unchanged request. If the first run failed after reserving the intent, retain that file and use the same owner/ID to recover; an unreadable file or failed public listing is a refusal, not permission to create another route. A deliberately new logical request needs a separately named app intent file and a fresh ID, only after the earlier route's owned cleanup is confirmed. Do not delete the old intent to bypass a conflict. This small single-process example is not a multi-controller journal; production hosts must serialize their own intent creation and recovery.

- `candidateToken` is private bearer data. It is single-use, expires after 10 minutes, and is bound to the query, the disclosure revision and what Gozar observed at the provider. If the provider changed, the call fails with `candidate_stale` and changes nothing: ask the catalog again. Do not log it.
- Each candidate shows what an app needs to list, choose and explain a route without knowing any provider. `providerId` is the provider's own stable id; add it to the query (`providerId: 'ID'`) and the catalog holds only that candidate. An unknown id fails with `route_not_found` and a message that lists the ids on offer. It cannot be combined with `route`. Show the id, store it and send it back; do not compare it with a literal. `display.needs` is one static sentence on what the route needs on this computer. `properties.address.ports` lists the public ports Gozar tries, in order (`null` when the provider assigns the port). `properties.proof` says what Gozar checks before it publishes: `vantage` is where the check runs from and `checks` is a subset of `tls`, `nonce` and `sse`. `RouteView.verification` carries the same two fields for the last check, so it says where that check actually ran from. [docs/providers.md](docs/providers.md) lists them for every provider.
- `ensureRoute` (durable), `adoptRoute` (takes over an existing rule and removes it when released or stopped) and `expose` (session or attached) all return a `RouteView`. Its `origin` is the route's address as soon as the provider has allocated it, also while the route is `unverified`: configure your server for it, so it can answer the challenge. `published` is the address you may advertise; it is `null` until the route is `usable`. With attached usage the calling process holds the route: the library sends a heartbeat every 5 seconds. The controller checks periodically for owner loss, using a default 20-second threshold from the last heartbeat. Owner loss starts bounded cleanup: closing local forwarding and removing the owned remote resource are separate attempts. Unconfirmed cleanup remains recorded as debt. Call `closeRoute` to end the route early and check its cleanup result.
- A candidate's unmet `requirement` and `reasonCode` use closed lists. Its `actual` value can name input that prevented the route: an invalid owner-run origin appears as `{ origin, reason: 'invalid_origin' }` on the `setup` entry; a durable create origin outside the provider's creatable addresses appears as `{ origin }` on an `address` entry. Neither candidate receives a token.
- Every failure has a code from a closed list, `GozarErrorCode` in `packages/gozar-node/route-contract.d.ts`, and an optional `nextAction`. Provider diagnostics never reach the app.
- Requirements `transport` is `'https'`, `'tcp'`, `'tls'` or `'any'`. Shipped 0.5 execution is HTTP(S); raw TCP/TLS profiles remain detect-only. `'any'` allows plain HTTP, and only with reach `lan` or `this-device`; any other reach is `invalid_input`. A `provide-value` setup action asks the user for one plain value (`valueFormat` is `https-origin`, `domain` or `text`). Send it as `runSetupAction({ ..., value })`; a value that does not match the format is `invalid_input`. It is stored as configuration, not as a secret. A route its owner keeps (an address the user already runs) has `ownership: 'external-owned'`; `ensureRoute` records it without creating anything, and the origin is the one the user gave.
- `getRoutePreferences` and `setRoutePreferences` keep the user's provider order as `preferenceRef` values or `providerId` values. `runSetupAction` runs one setup action the user approved. `resolveClientAddress` turns a proven connection into a client address, or says why it cannot.
- The route functions behave the same on Linux and macOS. On any other platform every candidate is `unsupported`.

For a durable route, suspend before closing the local listener. This removes forwarding while keeping the address and consent for the next start. A crash does not suspend automatically. See [Suspend and resume](docs/design/durable-routes.md#suspend-and-resume) for refusal and recovery details.

| Route API | What it does |
| --- | --- |
| `ensureRoute(query)` | Creates with approval, or resumes the pinned durable route without new approval and verifies it. |
| `suspendRoute({ home, handle })` | Removes a durable route's rule and retains its reservation. Returns `suspended` with `published: null`. |
| `routeStatus({ home, handle })` | Reads current state; a suspended route stays suspended. |
| `closeRoute({ home, handle, mode: 'remove' })` | Releases the route and its reservation. A later creation needs approval. |

The same requests run from the command line. Each command reads its request from files, prints one JSON envelope on stdout (`watch` prints one event per line) and writes progress to stderr. Files that hold an approval or a secret must be private (mode 0600). In the table, `gozar` stands for `npx --package=@tnunamak/gozar@0.5.6 gozar` (or a global install), and FILE, NAME, ACTION_ID, DIR, N and REF are your values.

| Command | What it does |
| --- | --- |
| `gozar catalog --query-file FILE [--route NAME] --json` | Lists candidates for the query. |
| `gozar ensure --query-file FILE [--approval-file FILE] [--reconsent] --json` | Creates or confirms a durable route. |
| `gozar adopt --query-file FILE --approval-file FILE --handover-file FILE --json` | Takes over an existing rule and removes it when the route is released or stopped. |
| `gozar expose --query-file FILE --approval-file FILE [--wait verified] --json` | Opens a session or attached route. `--wait verified`, the default, returns once the route is verified; `--wait allocated` returns as soon as the provider has allocated the address. For an attached route this process holds it; close stdin to end it. |
| `gozar setup ACTION_ID --query-file FILE --provider-id ID --approval-file FILE [--secret-file FILE \| --value VALUE \| --prompt] --json` | Runs one current scoped setup action. Secret files stay private; prompts follow input descriptors. |
| `gozar preference show [--profile-home DIR] --json` | Reads the user's provider order and its revision. |
| `gozar preference set --expected-revision N [--prefer REF ...] [--profile-home DIR] --json` | Replaces the provider order. N is the revision `show` returned. |
| `gozar suspend --route ID --json` | Suspends a durable route; `ensure` resumes it without new approval. |
| `gozar suspend --handle-file FILE --json` | Suspends the durable handle saved in FILE, with generation checking. |
| `gozar watch --handle-file FILE --json` | Streams route changes until the route is gone. |
| `gozar routes --home DIR [--owner OWNER] --json` | Lists retained route/recovery handles without refreshing proof. |
| `gozar route-status --handle-file FILE --json` | Reads current proof for an exact handle. |
| `gozar close --handle-file FILE --json` | Withdraws and retries cleanup for that handle. |
| `gozar review-consent --handle-file FILE --json` | Returns the current runtime consent snapshot. |
| `gozar approve-consent --handle-file FILE --approval-file FILE --json` | Redeems that review and safely reproves the same generation. |

`setup` applies a single current action. If the offered action carries a `step`, follow [the setup operation CLI](docs/design/provider-setup.md#cli-and-acceptance) instead.

Exit codes: `0` success; `2` requirements, setup or `unsupported`; `3` missing, stale or unknown approval, or no such route; `1` any other failure. There is no `--yes` for these commands: the approval is the private file that holds the token the catalog issued.

## Embed Gozar in your app

Use the JavaScript API below, or execute the route-contract commands with `--json`. A session is one `expose` call with a route request (`schemaVersion: 1`); there is no separate port-and-flags session form.

Detection never authorizes an exposure. If a user must choose a provider, confirm a firewall change or accept the exact service target, show that choice in your interface and pass the approval the catalog issued only after the user approves the selected route and exact target.

For active sessions, repeatedly read `routeStatus`: `published` is the current verified address, or `null` when no address may be advertised. An allocated `origin` is not publication; do not share it while `published` is `null`. Separately, show unknown or stale provider inventory as such; a passive read is not an explicit refresh. A change of address withdraws the old one until the new one is verified. Clear stale links promptly and tell clients to reconnect to the newly verified address. Anonymous localhost.run URLs can change within minutes. The requested lifetime does not lock the address.

Use `routeStatus` to recheck a route and `closeRoute` (or `gozar stop --port N`) for cleanup. A passing route check is not proof of authentication or of a successful application-level MCP call. For owner-operated persistent HTTPS, see [service routes](docs/service-routes.md).

### Which versions to accept

Depend on `^0.5.0`. Within one 0.N line, Gozar keeps the route contract an app codes against: the public error codes, the query fields an app must send, and every field a candidate or route already has. New providers and new optional fields ship as 0.5.x releases, so an app with `^0.5.0` offers a new provider without a code change, because it reads every choice from the catalog. A change that breaks the contract requires a separately adopted release line. A wider range such as `<1.0.0` would also accept those breaking lines. The 0.5 line is an early integration boundary, not a promise of future providers or releases. Qualify the library, CLI and installed host together; Linux/macOS support and offline fixtures do not establish live acceptance for every provider, account or architecture.

## JavaScript API

Install into your Node.js 22.13+ project:

```sh
npm install @tnunamak/gozar@0.5.6
```

For a new embedding, use `createGozar({secretBackend?,hostCapabilities?,identity?})`.
Use that same factory for configuration and runtime. `listProviders({home,owner})`
discovers every registered audience without issuing execution tokens. Render
input requirements through their `actionId`; read saved values and credential
presence from `configuration`. Scoped `storeSecret` accepts bytes and returns a
handle only to the trusted host. Setup requires the provider, current revision
and the offered action's setup approval. Use persisted configuration drafts for
editing or rotation while an older runtime is retained. Inventory polling can be cold or stale and never probes; request `refresh: true` when you need a fresh provider observation. See [polling reads](docs/embedding-contract.md#cached-polling-reads-052).

Recatalog the exact query before starting. Show the selected candidate's complete
`consent` snapshot: `{scope,consentFactsDigest,facts,disclosures}`. Show every
consent fact and typed disclosure; a display-only fact does not grant authority.
Return `approval:{kind:'route',candidateToken,disclosureRevision,consentFactsDigest}`.
Setup uses `kind:'setup'` with the offered action's digest, disclosure revision
and consent digest. Never reconstruct a draft scope or digest in the app.

Journal an `operationId` before `expose` or `ensureRoute`. It reserves a stable
handle before allocation; replay never starts a second runtime. `listRoutes`
recovers partial and uncertain allocations after a host crash. Its snapshots are
historical; use `routeStatus` for current subject-bound proof. Advertise only
`published`. Runtime consent drift withdraws publication; review and approve the
new snapshot for safe proof on the same generation, or stop when refresh is
unsupported. `closeRoute` retains uncertainty until exact owned cleanup succeeds. Configure the factory's `acknowledgeOrigin` callback if your host needs to accept the exact allocated origin before proof. With that callback, `watchRoutes` observes retained state; seeing an allocated origin there is not acknowledgment or publication. Use `routeStatus` to request fresh proof. See [host acknowledgment](docs/embedding-contract.md#exact-origin-host-acknowledgment-052).

Shipped execution in 0.5 is HTTP(S) only. Raw TCP/TLS profiles remain detect-only
so the full embedding contract can ship together. Trusted extensions can declare
their own protocol proof through `prepareProof`; the installed lifecycle fixture
uses non-HTTP proof without core changes. New display properties are open facts,
not additional typed fields. See [the embedding contract](docs/embedding-contract.md),
[migration changes](docs/migration-0.4.md), [testing effects](docs/testing-effects.md)
and the runnable [screen example](examples/remote-access-screen.mjs).

**Packaged hosts (including DataConnect):** declare how optional native modules are supplied. A read-only bundle includes the tested platform-specific dependencies; runtime installation needs an explicit declaration and authorization. See [packaged runtime modules](docs/embedding-contract.md#packaged-runtime-modules-052). The screen is a renderer example, not evidence that an installed host has passed acceptance. For a provider that still needs configuration, see [how to display setup progress, evidence and publication separately](docs/design/provider-setup.md#render-the-current-action).

The root exports `createGozar` and the same default factory methods: catalog/detect,
provider inventory, setup/secret intake, configuration drafts, route start/adopt,
status/list/watch, consent review/redeem, suspend/close, preferences and client
address resolution. See the [public types](packages/gozar-node/route-contract.d.ts)
for their exact names and requests. Factory methods share the configured registry,
credential backend and host capabilities.

`status({home?,port?})` and `stop({home,port})` read and close the sessions recorded in a home;
`@tnunamak/gozar/service` exports the service helpers and `createServiceVerifier`.
`expose` takes the route request (`schemaVersion: 1`); the earlier port-and-flags call was removed in 0.5.2
and is rejected with `invalid_input`. See [proof and cleanup boundaries](docs/proof-and-cleanup-0.4.md)
before treating older helper evidence as structured route verification.

## Try the echo server

Start the echo server (`gozar demo-server --port 18765`) and expose it with the [route example](#route-by-requirement). Once Gozar verifies the route, connect an MCP client to its `/mcp` URL. The demo has no application authentication: call its `echo` tool with `{"echo":"hello"}`, and it returns your text and an instance nonce. To end the route:

```sh
npx --package=@tnunamak/gozar@0.5.6 gozar stop --port 18765
```

Press Ctrl+C to stop the demo server. The demo is not a safe template for a real service, because it has no authentication.

## Choose a route

To inspect available providers without creating anything, ask the catalog with the same request an `expose` would use (`gozar catalog --query-file FILE --json`). Set `reach` to `internet` for a hosted client, `tailnet` for an authorized Tailscale client, or `lan` for a client on a local network. The catalog lists every candidate with its eligibility, its disclosure and any setup step still needed; ordering follows the user's provider preference (`gozar preference`).

tunnl.gg needs OpenSSH (`ssh` and `ssh-keygen`). Gozar creates an Ed25519 identity under its home directory (`GOZAR_HOME`, or `~/.local/state/gozar`) on first approved use and reuses it for later sessions. The key-bound relay permits one active route per installation key. Gozar refuses a second start that uses the same key and reports the holding port and its stop command. Retry after that session has stopped and its owned process cleanup is confirmed; Gozar does not queue the start. Gozar coordinates sessions in the same home. If you copy the key into another home, those processes cannot coordinate and a new route can interrupt the existing one. An announced address change withdraws this route.

For your own HTTPS proxy, register a [service route](#keep-an-existing-service-address). A temporary session through an external origin is no longer a separate command.

Private tailnet routes require a trusted check from the intended client network: the proof for a Serve session runs from the tailnet, and a check from this device or from the public internet never verifies it. Tailscale Funnel sessions use ports 8443 then 10000 and private Serve sessions use 9444 then 9445, only when unused; the durable-route ports (443, 8443, 10000) are a different list, and a session never adopts, rewrites or resets a rule it does not own. LAN requires an explicit selected interface, exact firewall approval and a trusted check; it serves HTTP rather than HTTPS. In the library API the interface and the firewall approval are two declared `provide-value` inputs (`interface` and `firewall`): each is the exact interface address, and Gozar re-checks that address at catalog, plan and start. It binds that one address, never a wildcard or loopback, and changes no firewall rule.

## Security and privacy

Gozar makes a service reachable; it does not add application authentication. Keep your service's access controls enabled and share only the intended service.

The localhost.run relay terminates TLS and can read requests and responses. Public HTTPS does not hide traffic from that relay operator. Choose a provider you trust with your service's data.

Route verification and application testing are different. A route check does not prove that every external client can connect, that a caller is authorized, or that an MCP client completed a tool call. Test your application's authentication and client flow separately.

Temporary sessions forward requests to the selected loopback port and replace the request's Host header with `127.0.0.1:PORT`. If your app checks hostnames or generates public links and redirects, test that behavior before sharing it. This differs from a service route through your own proxy, where the backend must receive the expected public Host; see [service routes](docs/service-routes.md).

Gozar cleans up resources it owns. Your own proxy and DNS remain your responsibility. If cleanup is pending, retry stopping the session and inspect the result before assuming the route is gone.

## Session output

A route request returns the route view: `published` is the address to share, set only after the required checks pass. A failed check names what Gozar could not verify. If removal is not confirmed, `cleanup` says a route or process may remain and carries the stop command. A background controller keeps the session running; use `gozar stop --port N` or `closeRoute` to end it early. `--json` prints one envelope per command.

## Session lifetime

A temporary exposure defaults to 15 minutes. Set the lifetime in the request: `usage: { kind: 'session', lifetimeMs: 1_500_000 }`. The value is an integer from 1 through 2147483647 milliseconds. This bounds Gozar's temporary session, **not a provider's URL stability or uptime**. A localhost.run trial URL can change within minutes; a host must read `routeStatus`, clear an old published URL when absent and update clients after a verified route change.

Keep the service and the host awake. On network change, resume or wake, recheck with `routeStatus`. When expired or finished, run `gozar stop --port 18765`; check for outstanding cleanup before starting a fresh exposure.

Registered service routes do not have Gozar session expiry, but their uptime depends on the service, proxy and network you manage.

## Troubleshooting

**Command not found:** For a local or one-shot npm install, use the full `npx --package=@tnunamak/gozar@0.5.6 gozar …` form shown throughout this README; a project-local install does not put `gozar` on your shell's PATH.

**Nothing eligible:** Ask the catalog (`gozar catalog --query-file FILE --json`). Fix missing tools, login, permission, interface or outside-network verification; a candidate in the catalog is not readiness.

**No published address, route changed, or cleanup is pending:** Choose the status and cleanup commands for the kind of route you opened:

- **Temporary session:** Use its local port with `gozar status --port 3000 --json` and `gozar stop --port 3000 --json` (replace `3000` with the recorded port). See [Share a local service](#share-a-local-service).
- **Attached or durable route:** Keep its exact retained handle. Check it with `routeStatus({ home, handle })` or `gozar route-status --handle-file FILE --json`; use `gozar close --handle-file FILE --json` to withdraw it and retry cleanup. For a durable route you can also use its route ID with the [durable status and stop commands](docs/service-routes.md#durable-routes-gozar-owned).
- **Registered existing HTTPS service:** Use its exact HTTPS origin with `gozar service status --origin "$ORIGIN" --json` or `gozar service remove --origin "$ORIGIN" --json`. See the [service-route guide](docs/service-routes.md). Removing the record does not stop your service or remove your proxy, DNS, or other infrastructure.

Share only the current verified `published` address for Gozar-managed routes. If it is `null`, stop sharing it and remove the old link from your app. Keep the exact cleanup reference (port, retained handle or durable route ID, or service origin) until the relevant cleanup or record removal is confirmed; retry when the result calls for it. Start a fresh `expose` only after owned cleanup is confirmed.

**Approval required:** Collect the user's approval of the chosen provider and exact local target, then pass the approval the catalog issued. A JSON response is not consent.

**Existing HTTPS service fails verification:** Ensure the service challenge helper is installed before normal routes, the proxy preserves the public Host, and the declared target port equals the backend's actual listener. See [service routes](docs/service-routes.md). A saved route record is not a verified route.

## Contributing

**Source-checkout-only instructions. npm users do not need Rust or a source build.** The npm archive includes the compiled core and these guides, not the Rust sources, build scripts or test suites. To contribute, first get a source checkout below. Building the WASM core there needs Rust and wasm-bindgen 0.2.105; `scripts/build-wasm.sh` is a source-checkout-only command:

```sh
git clone https://github.com/tnunamak/gozar.git
cd gozar
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
bash scripts/build-wasm.sh
```

Run `npm link` in a source checkout if you want a bare `gozar` command.

### Develop

Run the following test and build commands only from the `gozar` source checkout obtained above, after building its WASM core. They do not run from an npm installation.

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
read-back; `credentials` reports presence only. Use the same factory's
`storeSecret({home,owner,providerId,inputId,scopeId,expectedConfigurationRevision,bytes})`
and send its returned handle to the approved, revision-bound `runSetupAction`.
Use draftId for staged edits while a runtime retains applied configuration.

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


Configure one choice with descriptor prompts before opening it:

```sh
./node_modules/.bin/gozar configure --query-file query.json --provider-id ID --json
```

This project-local command requires an installed package; no global executable is assumed.
Secret terminal input is hidden and stored by Gozar. No provider credential belongs in argv,
an environment variable, an approval file or a support transcript. `configure`
collects inputs and does not open a route. The explicit-action alternative is
`gozar setup ACTION_ID --prompt --query-file query.json --provider-id ID --approval-file approval.json`.
See [the opt-in operator walk](docs/live-provider-walk.md) for the stored-credential
HTTPS flow and cleanup responsibilities.

A trusted extension loads through `createGozar({manifest, root})`. A manifest has
`providers: [{id, module, definition}]`, with files below `root/providers/`.
Definitions carry open facts and input requirements derived from setup actions.
The module implements the [adapter contract](packages/gozar-node/adapter-contract.d.ts).
An optional `prepareProof` supplies an attempt-bound proof session and protocol
address schemes; this requires no provider branch in core or renderer. CLI route
commands accept `--registry-file FILE [--registry-root DIR]` for the same seam.
Modules execute with the host's authority; load only trusted code.

The installed fixture command creates a random extension using only package
exports, collects a fake credential through CLI prompts, runs a non-HTTP nonce
proof and checks forwarding, status, idempotent stop and independent cleanup:

```sh
node node_modules/@tnunamak/gozar/examples/provider-lifecycle-fixture.mjs
```

Its JSON reports events, facts, input requirements and the observed resource
ledger. It uses no provider service or real credential. Raw TCP/TLS proof establishes
initial transport to Gozar's boundary, not application identity or login. Status
retains the original proof time/expiry when safe reproof is unavailable.
