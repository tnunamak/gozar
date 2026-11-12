# Existing service routes

A service route records an existing HTTPS origin and its fixed HTTP target. The owner manages the service, reverse proxy, TLS and startup. Service mutations require Linux with `flock` from util-linux; checks use Node 22+. Gozar starts no listener or daemon, forwards no traffic, rewrites no Host header and changes no ingress. There is no route expiry. Records survive controller exit and reboot; service availability still depends on the owner's supervisors. Each status call checks the route again instead of restoring saved readiness.

```sh
gozar service add --origin https://service.example --target 192.0.2.10:3000 --json
gozar service status [--origin https://service.example] --json
gozar service remove --origin https://service.example --json
```

Use a credential-free HTTPS origin without a path, query or fragment. The target is `HOST:PORT` or `[IPv6]:PORT`, with port 1..65535. The proxy must preserve the application's expected public Host. Removing a record does not stop the service or edit the proxy. To change a target or verifier command, remove its record and add the replacement. Repeating an identical add is safe.

## Service challenge

Integrate the helper in the existing service before its application routes:

```js
import { createServiceVerifier } from './packages/gozar-node/service.mjs';
const verifyService = createServiceVerifier();
// In the existing HTTP request handler:
if (verifyService(req, res)) return;
// Continue normal application routing and authentication here.
```

Create one helper per service instance. It answers only `GET /.well-known/gozar/service?nonce=<64 hex characters>` with `{schemaVersion:1, nonce, instanceId, proof}`. It does not open a port or change normal request handling. The endpoint exposes a random service-instance ID; it provides no application access.

Gozar probes the declared target over HTTP using the public origin's Host, then probes the HTTPS origin with ordinary certificate validation and no redirects. The nonce, instance ID and HMAC-SHA256 proof must match. The helper signs each nonce with a per-instance secret that never leaves the service; copying its public instance ID cannot produce a fresh proof. Responses and probe duration are bounded. This proves that the origin reaches the same challenge-capable instance from the controller's network. It does not prove public access from every network, authenticated application behavior, MCP, OAuth or streaming.

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
  from './packages/gozar-node/service.mjs';

await addService({ origin, target, verifyCmd: null, home });
// { schemaVersion: 1, route }
await statusServices({ origin, home }); // origin optional; no args lists all
// { schemaVersion: 1, routes: [route] }
await removeService({ origin, home });
// { schemaVersion: 1, origin, removed: true } // false if already absent
```

`home` is optional, defaulting to `GOZAR_HOME` or `~/.local/state/gozar`. Service records use a separate `services` directory. Only configuration is persisted, never verification readiness. Per-origin advisory lock files remain in `services/.locks`; kernel locks release on controller exit and reboot. Concurrent mutations may reject as busy; retry the operation. Records require private ownership and mode 0600; service state directories must be private to the owner.

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
