# Existing service routes

A service route records an existing HTTPS origin and its fixed HTTP target. Use Linux or macOS with Node.js 22.13 or newer. Windows answers `unsupported`. You manage the service, reverse proxy, TLS and startup. Gozar starts no listener or daemon, forwards no traffic and changes no ingress. Records survive controller exit and reboot and have no Gozar expiry. Service availability still depends on your own supervisors. Each status call checks the route again rather than restoring saved readiness.

The commands below assume a global `gozar` executable. If you installed the package locally or want a one-off command, replace `gozar` with `npx --package=@tnunamak/gozar@0.2.1 gozar`.

```sh
gozar service add --origin https://service.example --target 192.0.2.10:3000 --json
gozar service status --origin https://service.example --json
gozar service remove --origin https://service.example --json
```

Use a credential-free HTTPS origin without a path, query or fragment. Omitting `--origin` from `service status` lists every record. The target is `HOST:PORT` or `[IPv6]:PORT`, with port 1..65535. The proxy must preserve the application's expected public Host. Removing a record does not stop the service or edit the proxy. To change a target or verifier command, remove its record and add the replacement. Repeating an identical add is safe.

## Service challenge

Integrate the helper in the existing service before its application routes:

```js
import { createServiceVerifier } from '@tnunamak/gozar/service';
const verifyService = createServiceVerifier();
// In the existing HTTP request handler:
if (verifyService(req, res)) return;
// Continue normal application routing and authentication here.
```

Create one helper per service instance (the no-argument API is unchanged). It answers only `GET /.well-known/gozar/service?nonce=<64 hex characters>` with `{schemaVersion:2, nonce, instanceId, authority, localPort, proof}`. It does not open a port or change normal request handling. The endpoint exposes a random service-instance ID; it provides no application access.

Gozar probes the declared target over HTTP using the public origin's Host, and probes the HTTPS origin with ordinary certificate validation and no redirects. Both responses must contain the requested nonce, the canonical intended public authority, and the declared target port as the observed localPort; instance ID and HMAC-SHA256 proof must match. The helper signs the versioned transcript with a per-instance secret that never leaves the service; copying its public instance ID cannot produce a fresh proof. Responses and probe duration are bounded. This proves that the origin reaches the same challenge-capable instance from the controller's network. It does not prove public access from every network, authenticated application behavior, MCP, OAuth or streaming.

### Exact challenge wire contract (v2)

The response object is `{schemaVersion:2, nonce, instanceId, authority, localPort, proof}`.
`nonce` is the requested 64 lowercase hexadecimal characters. `instanceId` is the helper's random UUID, stable only for that helper instance. `authority` is the canonical received Host header, not a caller-supplied override. `localPort` is the integer from `req.socket.localPort`, not a forwarded header.
`proof` is lowercase hex HMAC-SHA256 under the helper's per-instance in-memory secret over these exact UTF-8 bytes:
`JSON.stringify(["gozar-service-proof",2,nonce,instanceId,authority,localPort])`.
JSON array framing is unambiguous; no whitespace or trailing newline is added.

Exactly one Host field is required. Canonicalization uses HTTPS authority semantics even for the direct HTTP probe: DNS case folds to lowercase, explicit port 443 is omitted, other ports remain, IPv6 must be bracketed and is URL-normalized. Invalid DNS labels, unbracketed IPv6, userinfo, whitespace, paths, query/fragment, percent escapes, comma lists and ports outside 1..65535 are refused. A malformed challenge Host returns false from the helper for the application's normal handling. Legacy v1 responses fail closed; update the helper and checker together.

The declared target port MUST equal the service-observed local listener port. NAT, a sidecar, or an alias mapping that changes that port is not supported by this challenge contract: use an explicitly trusted `verifyCmd` instead. There is no unsigned or configurable observed-port override. Sharing one helper across multiple listeners cannot make the wrong listener pass. The public proxy must preserve the canonical public Host. Proof is still a bounded controller-vantage observation, not an assertion of arbitrary application behavior.

## Host-supplied verification

When source-IP filtering blocks the controller, supply a trusted command:

```sh
gozar service add --origin https://service.example --target 192.0.2.10:3000 --verify-cmd '/absolute/path/check-existing-route' --json
```

The command must check the real HTTPS origin from an allowed vantage and establish that it reaches the exact target. An unrelated HTTP 200 is insufficient. Exit zero asserts success; nonzero or timeout reports failure. Gozar passes `GOZAR_SERVICE_ORIGIN`, `GOZAR_SERVICE_TARGET` and fresh `GOZAR_SERVICE_NONCE` through the environment. It does not interpolate them into the command or retain command output.

The command is trusted owner code, executed by a shell under the invoking user's account on every add and status. Review it before registration. Avoid embedding credentials in the command; the private state contains the command string. Command verification is a host attestation, labelled `scope: 'host-command'`; it is not an independent public relay proof. Failed commands cannot become challenge successes.

## JavaScript and JSON contract

```js
import { addService, statusServices, removeService, createServiceVerifier }
  from '@tnunamak/gozar/service';

await addService({ origin, target, verifyCmd: null, home });
// { schemaVersion: 1, route }
await statusServices({ origin, home }); // origin optional; no args lists all
// { schemaVersion: 1, routes: [route] }
await removeService({ origin, home });
// { schemaVersion: 1, origin, removed: true } // false if already absent
```

`home` is optional, defaulting to `GOZAR_HOME` or `~/.local/state/gozar`. Service records use a separate `services` directory. Only configuration is persisted, never verification readiness. Per-origin advisory lock files remain in `services/.locks`; kernel locks release on controller exit and reboot. Concurrent mutations may reject as busy; retry the operation. Records and lock files require ownership by the invoking user and mode 0600; service state directories must be private to that user.

Gozar resolves the requested home to its real path once and uses that path for every read or mutation. Home symlinks and aliases in its ancestry are supported when the resolved path is trusted. Gozar checks every directory in the resolved ancestry: directories must belong to the invoking user or root, with no group or other write permission unless root-owned with the sticky bit (for example, `/tmp`). If the home does not exist, Gozar resolves its nearest existing ancestor, checks that ancestry, then creates and checks each missing directory below that real path. Status leaves missing state absent. Changing an alias after resolution does not redirect the current operation. Dangling and looping aliases are refused with a repair message. The services directory and its lock directory must still be real directories; record and lock symlinks are refused.

Errors name unsafe paths and the required ownership or permission change. Older lock files created with broader permissions must be changed to mode 0600 before mutations can proceed. Record bytes are bounded to 64 KiB and read through the same non-symlink descriptor whose ownership and permissions were checked.

Every route has this shape:

```json
{
  "schemaVersion": 1,
  "origin": "https://service.example",
  "target": "192.0.2.10:3000",
  "adapterId": "own-address",
  "ownership": "external-owned",
  "verifyCmd": null,
  "verification": {
    "status": "verified",
    "method": "challenge",
    "checkedAt": "2026-11-12T04:00:00.000Z",
    "error": null,
    "scope": "controller-origin"
  }
}
```

`status` is `verified|failed`, `method` is `challenge|host-command`, `scope` is `controller-origin|host-command`, and `error` is null or a bounded diagnostic. `checkedAt` is an ISO-8601 UTC timestamp at check completion. Each check has a five-second deadline; challenge responses are limited to 4096 bytes. Failed verification retains the record so status can retry after the network or service recovers. CLI add/status exit 1 if a returned check fails; remove exits 0 on success, including an absent record. Invalid input or state rejects the JS promise and produces CLI exit 1 with `{schemaVersion:1,error:{code:'SERVICE_ERROR',message}}`. With `--json`, stdout contains one JSON reply. Status for an absent selected origin returns an empty routes array.

# Durable routes (Gozar-owned)

A durable route is a Tailscale Funnel or Serve listener that Gozar creates, keeps at one origin across app restarts and reboots, and removes only when asked. Use it when a client stores the address for a long time (a signed invitation, an OAuth client registration, a hosted connector). For exposure that ends on its own, use a session (`gozar expose`) or an attached route (see the [README](../README.md#route-by-requirement)).

An app asks for a durable route by requirement. It never names a provider. Gozar's catalog returns the providers that meet the requirement, and the app passes back the approval of the one the user chose.

Requirements: Linux or macOS, Node.js 22.13 or newer, and a running Tailscale whose LocalAPI the invoking user may use. Gozar changes the serve config only through the LocalAPI with ETag compare-and-set, never through the `tailscale` CLI, and never writes the config without `If-Match`. Windows answers `unsupported`.

- **Linux:** tailscaled with a socket the invoking user may write (`sudo tailscale set --operator=$USER`).
- **macOS, three setups.** Gozar finds the LocalAPI the way Tailscale's own CLI does (`safesocket_darwin.go`):
  1. **Homebrew or other open-source tailscaled:** the unix socket `/var/run/tailscaled.socket`. Gozar uses a socket first when one exists.
  2. **Mac App Store app:** a loopback TCP port and a token. Gozar runs `lsof` for the app's `IPNExtension` process and reads the port and token from the name of its open `sameuserproof-<port>-<token>` file.
  3. **Standalone app (also called macsys):** a loopback port and token in `/Library/Tailscale/` (`ipnport` is a symlink to the port, `sameuserproof-<port>` holds the token). The file is readable only by admin users. Gozar checks that the port accepts a connection, because the files can outlive the app.

  Gozar sends the token as the Basic-auth password with the LocalAPI host header, as the Tailscale client does. It reads the token for each request, uses it in that one request and keeps it nowhere: not in a fact, an error, a log, a journal or a file. With no socket and no running app the answer is `provider_unavailable`, and its next action says to open the Tailscale app or start tailscaled. If the app refuses the token (for example after the app restarted), the answer is `provider_denied`: quit and reopen the app.
- **Set `GOZAR_TAILSCALED_SOCKET`** for a non-default socket. It overrides everything, and Gozar then looks for no app.
- **The CLI.** The detect step and session recipes run the `tailscale` program. On macOS, when no `tailscale` is on `PATH`, Gozar runs `/Applications/Tailscale.app/Contents/MacOS/Tailscale` if it exists. That is the CLI the app bundles ([Tailscale CLI documentation](https://tailscale.com/kb/1080/cli), macOS section). A `tailscale` on `PATH` always wins, and Linux never uses the bundle. The recipe and its consent do not change. If the app is installed elsewhere, install the CLI integration from the Tailscale app settings.

**Proof level.** The two app paths are proven only by fixture tests: the file and `lsof` formats are transcribed from Tailscale's source, and the tests run against a fake LocalAPI. No Gozar test has run against a live App Store or standalone app. Run the check below on a Mac with an app to settle it.

**Check a Mac with a Tailscale app (read-only).** Run these in a Gozar checkout or an installed `@tnunamak/gozar` package. Neither command changes anything or prints the token.

```sh
node packages/gozar-node/check-tailscale-app.mjs
```

Expected, for the App Store app (the standalone app prints `standalone app`; `tailscale CLI` is `on PATH` when the CLI integration is installed):

```
Gozar Tailscale check (read-only)
platform: darwin
tailscale CLI: the Tailscale app bundle
Tailscale app LocalAPI: App Store app on loopback port 61577 (a unix socket is used first when one exists)
LocalAPI status: ok
LocalAPI serve-config: ok
result: reachable
```

The port differs per run. A failure line names the code and the next action, for example `LocalAPI status: provider_unavailable (open the Tailscale app, or start tailscaled)`. Then ask the catalog the way an app would (`gozar` is `node bin/gozar.mjs` in a checkout):

```sh
mkdir -m 700 "$HOME/.gozar-check"
cat > q.json <<EOF
{
  "schemaVersion": 1,
  "owner": "gozar-live-check",
  "target": "127.0.0.1:3000",
  "home": "$HOME/.gozar-check",
  "usage": { "kind": "durable", "routeId": "live-check" },
  "requirements": { "reach": "tailnet", "transport": "https", "payloadAccess": "allow-provider", "address": "stable", "setup": "none", "protocols": [] }
}
EOF
gozar catalog --query-file q.json --json | node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
for (const c of o.candidates) if (c.display.label.startsWith("Tailscale")) console.log(c.display.label, "| eligible:", c.eligible, "| setup:", c.setup.state, "| token:", c.candidateToken ? "issued" : "none");'
```

Expected:

```
Tailscale Funnel | eligible: false | setup: ready | token: none
Tailscale private Serve | eligible: true | setup: ready | token: issued
```

A durable candidate becomes `ready` and gets a token only after Gozar has read the node and the serve config through the LocalAPI, so `Tailscale private Serve ... setup: ready | token: issued` proves the LocalAPI was reached. If the LocalAPI is not reachable, that line reads `eligible: false | setup: unknown | token: none`; run the first command to see why. If the CLI is missing, the line reads `setup: action-required`. Do not paste the raw catalog JSON anywhere: it holds the single-use token. Remove the check directory afterwards with `rm -r "$HOME/.gozar-check"`.

**What it exposes.** A durable route is a standing forward from the public origin to `127.0.0.1:PORT`. It forwards to whatever listens on that port, whether or not the app that asked for it is running. Use a port you keep for the route. Show the user the candidate's `disclosure.text` before you pass an approval. `gozar status` shows the same facts afterwards.

```js
import { catalogRoutes, ensureRoute, routeStatus, closeRoute } from '@tnunamak/gozar';
import { createServiceVerifier } from '@tnunamak/gozar/service';

// Install createServiceVerifier() in the app's request handler first, as for service routes.
const query = {
  schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:3000', home,
  usage: { kind: 'durable', routeId: 'coordinator' },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'stable', setup: 'none', protocols: [] },
};
const catalog = await catalogRoutes(query);
const candidate = catalog.candidates.find(item => item.eligible && item.candidateToken);
// Show candidate.disclosure.text. After the user agrees, pass the token and the revision the user saw:
const route = await ensureRoute({ ...query, approval: { candidateToken: candidate.candidateToken, disclosureRevision: candidate.disclosure.revision } });
// route.state is 'usable' once the challenge passed through the origin; route.origin is then fixed for good.
await routeStatus({ home, handle: route.handle });
await closeRoute({ home, handle: route.handle, mode: 'remove' });
```

- **Idempotent and pinned.** Call `ensureRoute` on every start with the same query. The first allocation needs an approval. Later identical calls read the persisted pin and need none. The record is authoritative: Gozar never reports a different origin for the route, and a changed requirement does not move the pin. If the node's DNS name changes, the route is `address_changed`; close it and ask again with a new approval.
- **Approval.** A `candidateToken` is single-use, expires after 10 minutes, and is bound to the owner, home, target, usage, requirements, origin and disclosure revision, and to what Gozar observed at the provider when it issued the token. If the provider changed since, `ensureRoute` fails with `candidate_stale` and changes nothing. Ask the catalog again and show the new offer.
- **States.** `usable`, `unverified` (rule present, challenge failed), `lost` (rule gone; the next `ensureRoute` restores it at the pinned origin only), `uncertain` (a rule Gozar cannot attribute), `address_changed`, `releasing` (cleanup debt) and `handing-back`.
- **Removal** reads the serve config and its ETag, requires an exact match with the receipt, and writes the config without that one listener with `If-Match`. A changed rule stays in place and the route shows cleanup debt (`cleanup.state: 'debt'`). When the foreign rule is gone, close again. `releaseRoute({ routeId, mode: 'dismiss' })` from `@tnunamak/gozar/service` drops the debt record. A `closeRoute` with a stale `handle.generation` fails with `route_conflict`.
- **Hand-back** has two phases. `releaseRoute({ routeId, mode: 'hand-back' })` returns `{ claim, transfer }` and keeps the record; repeat calls return the same values. After the previous owner has taken the rule back, call `confirmHandBack({ routeId, transfer })`. `cancelHandBack` returns the route to Gozar. These stay in `@tnunamak/gozar/service`.
- **Adoption.** `adoptRoute({ ...query, intent: 'adopt', origin, approval, handover: { from, generation } })` takes an existing rule with no teardown. Ask the catalog with the same query (`intent: 'adopt'` and the exact `origin`) to get the approval. Gozar looks for the one rule that is exactly this target's rule at `origin`, and requires the same match before and after verification. No match gives `candidate_stale`; more than one gives `ambiguous_route`; nothing changes in either case. The previous owner must already have fenced itself at `handover.generation`. The `claim` that hand-back returns is for the previous owner's rollback; adoption never needs it.
- **Errors.** Apps branch only on the frozen codes in `route-contract.d.ts`. Provider diagnostics (a missing LocalAPI socket, a denied operator permission, an ETag conflict) stay inside Gozar. A missing prerequisite is `setup_required` with a `nextAction` the user can follow. Gozar never falls back to the `tailscale` CLI.
- **Reservations.** One home-wide lock (30 s bounded wait) serializes sessions, ensure, adopt and release. A listener or provider port held by a session or another route is refused with `route_conflict`.

The user can always see and stop durable routes without the app:

```sh
gozar status                  # sessions, service routes and durable routes
gozar status --route coordinator --json
gozar stop --route coordinator    # compare-and-set removal; also blocks re-creation
gozar allow --route coordinator   # shows the consent text again and lifts the stop
```

`gozar status` shows each route as `owner-run`, says `forwards to 127.0.0.1:PORT whether or not OWNER is running`, and checks the target live: `app answering`, `nothing listening`, or the warning `another program is listening` with `gozar stop --route ID` as the next action. A user stop is sticky: the app's next `ensureRoute` or `adoptRoute` fails with `stopped_by_user` until the user runs `gozar allow --route ID` or the app passes `reconsent: true` together with a fresh `approval` right after the user approved again. No close mode clears it.

The same flow runs from files with `gozar catalog`, `gozar ensure` and `gozar adopt`; see [CLI commands](../README.md#route-by-requirement).
