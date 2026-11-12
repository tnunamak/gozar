# Design: durable routes and route adoption

Status: proposal for review. No code yet. Targets Gozar 0.2.0.

## Problem

Gozar can do two things today:

| | Gozar creates the route | The owner creates the route |
|---|---|---|
| **Temporary** | Sessions: `expose`, `status`, `stop`. Consent, a loopback gate, public-relay proof, a lifetime (default 15 min), teardown. | — |
| **Durable** | **Missing** | Service routes: `addService`, `statusServices`, `removeService`. A record of an HTTPS origin that the owner runs, verified by an in-app challenge. Gozar creates nothing. |

Some clients store an address and depend on it for a long time:
- an invitation that signs the host's origin, so members reject any other origin;
- an OAuth client registration or a hosted connector (for example a chat assistant's custom MCP server), where the URL is configured at the client side;
- a bridge that workers reach for days.

Such an app needs Gozar to **create** a route, **keep the same origin** across app restarts and host reboots, and **never publish a different origin** for that route. Today each app writes its own provider code for this (Tailscale `serve --bg` rules, ngrok reserved domains). That code repeats the ownership, verification and cleanup rules Gozar already has.

A second need: an app that already created such a route before it adopted Gozar must hand it to Gozar **without tearing it down**, because teardown and re-creation can change the origin and always causes a gap.

## Prior art

Summary of public research (2026-11-12):
- Tailscale `serve --bg` configuration persists until disabled and resumes after reboot. Foreground Serve ends with its session. Background config is shared by every app on the node and has ETag concurrency but no per-app ownership. Safe controllers read, compare and change only their own listener.
- tsnet apps (golink, tclip, tsidp), Syncthing (Device ID vs announced addresses) and embedded ngrok (account-owned reserved domain vs per-process endpoint) all separate a **durable identity** from a **replaceable route**. A reconnect callback or a returned URL is not proof that clients can reach the service.
- Idle limits differ by layer: ngrok HTTP 5 min, Syncthing relays 2 min, tunnl.gg about 121 s.
- Multi-provider tunnel libraries (LumeWeb tunneler, ToGO, Varin) expose `start/ready/stop`. None of them pins an origin or adopts an existing route.

## Proposal

### One record family, two ownership kinds

Durable routes live in the existing service-route store (`<home>/services/`, one 0600 record per origin, per-origin lock). A record gets `ownership`:
- `external-owned`: today's service route. Unchanged.
- `gozar-owned`: **new.** Gozar created or adopted the provider route and owns its removal.

`statusServices` lists both kinds, so a host has one place to ask "which long-lived routes exist".

### API (Node, `@tnunamak/gozar/service`)

```js
// Create a route, or reuse the one this record owns. Idempotent.
await ensureRoute({
  adapterId,          // 'tailscale-funnel' | 'tailscale-private' | later 'ngrok-https-edge'
  target,             // '127.0.0.1:PORT' — the app's own listener
  origin,             // optional pinned origin; required on every call after the first publication
  lifetimeMs,         // optional; absent = until released
  approval,           // { adapterId, target, origin|null, durable: true } echoed from the consent the host collected
  home,
});
// -> { schemaVersion: 1, route: { origin, target, adapterId, ownership: 'gozar-owned',
//      lifetime: 'provider-persistent' | 'host-supervised', state, verifiedAt?, expiresAt? } }

await adoptRoute({ adapterId, target, origin, claim, approval, home }); // see "Adoption"
await releaseRoute({ origin, home });   // withdraw, remove the owned provider route, delete the record
await statusServices({ origin, home }); // re-observes and re-verifies; never trusts saved readiness
```

The app verifies with the existing `createServiceVerifier()` in its own request handler. **No Gozar gate process sits in the data path** of a durable route. The provider forwards straight to the app's listener, so Host and the provider's forwarding headers reach the app unchanged.

### Lifetimes

An adapter declares how its durable route lives:
- `provider-persistent`: the provider keeps the route without a process, for example Tailscale `serve --bg` / `funnel --bg`. The route survives app exit and reboot. Removal is an explicit provider command.
- `host-supervised`: the route exists only while a process runs, for example an ngrok agent. The embedding app keeps that process alive by calling `ensureRoute` on start. Gozar re-creates the process and requires the **same origin** back.

An adapter can offer a durable route only if it declares `addressStability: 'stable'`, meaning the same inputs give the same origin. Anonymous localhost.run fails this. So does any relay that assigns random names. Such adapters stay session-only.

### States

`creating → usable → (lost | address_changed | expired) → releasing → released`

- `lost`: the provider route is absent or does not match the record. Gozar does **not** re-create it on its own. The host decides, normally by calling `ensureRoute` on start. That re-creates the route only if the result would have the pinned origin.
- `address_changed`: the provider would give, or gives, a different origin. **Terminal for publication.** Gozar never reports the new origin as the route's origin. The host must release, then create a new route with new consent.
- `expired`: `lifetimeMs` passed. Gozar withdraws publication and removes the owned route on the next `statusServices` or `ensureRoute` call, or on a call to `releaseRoute`.

### Pinned origin fails closed

1. Before any mutation, the adapter's plan computes the candidate origin from fresh observations (Tailscale: node DNS name + selected HTTPS port; ngrok: requested reserved domain). If `origin` is pinned and the candidate differs, stop with `address_changed`. Mutate nothing.
2. After mutation, read back the provider config and compare it with the exact recorded rule. Then verify through the challenge from the controller vantage. If the observed origin differs, remove what this call created (when ownership continuity holds) and stop with `address_changed`.
3. Provider fallback (for example Funnel not permitted, so try ngrok) is allowed **only when no origin is pinned**, i.e. before the first publication. A pinned route never changes adapter.

### Consent, lifetime and stop still hold

- **Consent:** the host collects approval of the exact tuple `{adapterId, target, origin|null, durable:true}` and passes it as `approval`. The record stores the tuple. A later `ensureRoute` with an identical tuple reuses the consent. Any difference (target, adapter, origin, durable↔temporary) requires new approval. The CLI asks interactively, as `expose` does. Durable consent copy names the difference: "stays reachable after Gozar exits, until you release it".
- **Lifetime:** `lifetimeMs` is optional and host-set. No silent default expiry for a durable route. `status` shows `expiresAt` or "until released".
- **Stop:** `releaseRoute` first marks the record `releasing` durably (so publication is withdrawn even if the process dies), then removes the provider route by exact match with a fresh ownership-continuity check, then deletes the record. A mismatch (an administrator changed the rule) leaves the foreign config in place and records **cleanup debt**, as sessions do today. Gozar never removes a rule it cannot attribute to the record.

### Ownership is saved before mutation

The record (with intent `creating` and the exact rule to be created) is written and fsynced before the provider command runs, and checked again after each await. A crash between intent and mutation leaves a record that `statusServices` resolves: rule present and exact → `usable` after verification; absent → `lost`; different → cleanup debt.

### Adoption (G2)

`adoptRoute({adapterId, target, origin, claim})` takes ownership of a provider route that exists now, with **no teardown**:
- `claim` is the exact rule the previous owner recorded (for Tailscale: node, DNS name, HTTPS port, mode, proxy target).
- Gozar reads fresh provider config and requires an **exact** match: same node, same port, same mode, same target, no other handler on that port, and the computed origin equals `origin`. Any difference is refused, and nothing changes.
- Gozar then verifies through the challenge and writes the `gozar-owned` record with provenance `adopted`. The route keeps serving throughout. There is no gap.
- **No double exposure:** adoption refuses if a Gozar session or another record already targets the same listener or the same provider port.
- **Handover:** the previous owner keeps its own record, marked "handed over", for one release, so a rollback can still stop the route. Two owners may both believe they own the rule during that window. Both remove only by exact match, so whichever runs first wins, and the other sees `lost`. Neither re-creates the route without a host call. The window is documented and closes when the previous owner deletes its record.

### Tailscale adapters

Durable Funnel/Serve recipes use `--bg`. They choose the HTTPS port from the node's `funnel-ports` capability (candidates 443, 8443, 10000; only 443/8443/10000 can be Funnel ports), refuse occupied ports instead of replacing them, require the same node ID on reuse, and remove with `serve --https=PORT off` (which works after Funnel permission is revoked). The current session recipes (foreground, :8443) stay as they are.

### Per-adapter idle limit

Adapters publish `idleTimeoutMs` (unknown = null) so hosts with long-lived streams can send keepalive data in time. This is data only, not behaviour.

## Not in scope
- macOS host (plan R12) and ngrok operational recipes (slice S1). Durable routes are designed for them but ship first for Tailscale on Linux.
- Authentication for the app's own routes (plan R5).
- Authenticated origin migration. An app that wants to move clients to a new origin signs that itself. Gozar only refuses to move silently.

## Tests (written red first)
`test/node/durable-routes.test.mjs` with a fake `tailscale` on PATH whose state lives in a temporary file:
1. ensure creates a `--bg` rule, verifies through the challenge, and records `gozar-owned`;
2. a second ensure with the same tuple reuses the rule and makes no mutation;
3. a pinned origin with a different node DNS name → `address_changed`, no mutation;
4. a readback mismatch after creation → removes only its own rule → `address_changed`;
5. occupied port → refused, the foreign rule is untouched;
6. a changed approval tuple → refused without approval;
7. release removes only an exact match, a changed rule → cleanup debt, the record stays;
8. a crash after intent and before mutation → status resolves to `lost`;
9. restart → status re-verifies and does not trust saved readiness;
10. adopt of an exact rule → no provider mutation, record `adopted`; a mismatch → refused;
11. adopt while another record or session targets the listener → refused;
12. an adapter without `addressStability: 'stable'` → durable refused;
13. `lifetimeMs` expiry → publication withdrawn, route removed;
14. fallback to another adapter only when no origin is pinned.

## Expect it to work because:
Both halves exist and are tested. Sessions already run adapter plans with saved intent, readback, ownership continuity and cleanup debt. Service routes already persist 0600 records with per-origin locks and verify with an HMAC challenge inside the app. A durable route is a session plan whose result is kept in a service record instead of being torn down at expiry, plus two rules: fail closed on the origin, and re-create only when the host calls. The assumption most likely to be wrong is that the plan executor can run outside a live session controller (a durable route has no long-running controller). The first implementation step is a spike that runs the Tailscale create plan from `ensureRoute` through the existing driver with a one-shot controller. If the driver needs a live session (lifetime timers, gate port), the spike shows it before the rest is built.
